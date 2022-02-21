import { Module } from "../_model/ast.ts";
import { ARRAY_OF_ANY, BOOLEAN_TYPE, ELEMENT_TAG_CHILD_TYPE, FuncType, GenericFuncType, GenericProcType, GenericType, ITERATOR_OF_ANY, NIL_TYPE, NUMBER_TYPE, RECORD_OF_ANY, ProcType, STRING_TEMPLATE_INSERT_TYPE, STRING_TYPE, TypeExpression, UNKNOWN_TYPE, TRUTHINESS_SAFE_TYPES } from "../_model/type-expressions.ts";
import { given } from "../utils/misc.ts";
import { assignmentError,BagelError,miscError } from "../errors.ts";
import { propertiesOf, inferType, subtract, bindInvocationGenericArgs, parameterizedGenericType, simplifyUnions, invocationFromMethodCall, BINARY_OPERATOR_TYPES } from "./typeinfer.ts";
import { getBindingMutability, ModuleName, ReportError } from "../_model/common.ts";
import { iterateParseTree, typesEqual } from "../utils/ast.ts";
import { _Store } from "../store.ts";
import { format } from "../other/format.ts";
import { ExactStringLiteral, Expression } from "../_model/expressions.ts";
import { stripSourceInfo } from "../utils/debugging.ts";
import { computedFn } from "../mobx.ts";
import { parsed } from "../1_parse/index.ts";
import { resolve } from "./resolve.ts";


export const typeerrors = computedFn((store: _Store, moduleName: ModuleName): BagelError[] => {
    const ast = parsed(store, moduleName, true)?.ast

    if (!ast) {
        return []
    }

    const errors: BagelError[] = []
    typecheck(
        err => errors.push(err), 
        ast
    )
    return errors
})

/**
 * Walk an entire AST and report all issues that we find
 */
export function typecheck(reportError: ReportError, ast: Module): void {
    const infer = (expr: Expression) => inferType(reportError, expr)
    const resolveT = (type: TypeExpression) => resolveType(reportError, type)

    for (const { current, parent } of iterateParseTree(ast)) {
            
        switch(current.kind) {
            // check all imports and declarations to make sure they aren't 
            // re-defining anything, even if they don't get used right now
            case "import-all-declaration": {
                const declarations = (current.parent as Module).declarations
                resolve(reportError, current.alias.name, declarations[declarations.length - 1])
            } break;
            case "import-declaration": {
                const declarations = (current.parent as Module).declarations
                for (const { name, alias } of current.imports) {
                    resolve(reportError, alias?.name ?? name.name, declarations[declarations.length - 1])
                }
            } break;
            case "proc-declaration":
            case "func-declaration":
            case "type-declaration": {
                const declarations = (current.parent as Module).declarations
                resolve(reportError, current.name.name, declarations[declarations.length - 1])
            } break;
            case "value-declaration":
            case "value-declaration-statement":
            case "inline-const-declaration": {
                if (current.kind === "value-declaration") {
                    const declarations = (current.parent as Module).declarations
                    resolve(reportError, current.name.name, declarations[declarations.length - 1])
                }

                if (current.kind === 'inline-const-declaration' && current.awaited) {
                    const valueType = resolveT(infer(current.value))

                    if (valueType.kind !== 'plan-type') {
                        // make sure value is a plan
                        reportError(miscError(current.value, `Can only await expressions of type Plan; found type '${format(valueType)}'`))
                    } else if (current.type != null) {
                        // make sure value fits declared type, if there is one
                        if (!subsumes(reportError, current.type, valueType.inner)) {
                            reportError(assignmentError(current.value, current.type, valueType.inner))
                        }
                    }
                } else {
                    // make sure value fits declared type, if there is one
                    if (current.type != null) {
                        expect(reportError, current.type, current.value)
                    }
                }
            } break;
            case "await-statement": {
                const valueType = resolveT(infer(current.plan))

                if (valueType.kind !== 'plan-type') {
                    // make sure value is a plan
                    reportError(miscError(current.plan, `Can only await expressions of type Plan; found type '${format(valueType)}'`))
                } else if (current.type != null) {
                    // make sure value fits declared type, if there is one
                    if (!subsumes(reportError, current.type, valueType.inner)) {
                        reportError(assignmentError(current.plan, current.type, valueType.inner))
                    }
                }
            } break;
            case "inline-destructuring-declaration":
            case "destructuring-declaration-statement": {
                const valueType = resolveT(infer(current.value))
                
                if (current.kind === 'inline-destructuring-declaration' && current.awaited) {
                    if (valueType.kind !== 'plan-type') {
                        // make sure value is a plan
                        reportError(miscError(current.value, `Can only await expressions of type Plan; found type '${format(valueType)}'`))
                    } else {
                        // make sure destructuring matches value type
                        if (current.destructureKind === 'object') {
                            if (valueType.inner.kind !== 'object-type') {
                                reportError(miscError(current.value, `Can only destructure object types using '{ }'; found type '${format(valueType.inner)}'`))
                            }
                        } else {
                            if (valueType.inner.kind !== 'array-type' && valueType.inner.kind !== 'tuple-type') {
                                reportError(miscError(current.value, `Can only destructure array or tuple types using '[ ]'; found type '${format(valueType.inner)}'`))
                            }
                        }
                    }
                }

                // make sure destructuring matches value type
                if (current.destructureKind === 'object') {
                    if (valueType.kind !== 'object-type') {
                        reportError(miscError(current.value, `Can only destructure object types using '{ }'; found type '${format(valueType)}'`))
                    }
                } else {
                    if (valueType.kind !== 'array-type' && valueType.kind !== 'tuple-type') {
                        reportError(miscError(current.value, `Can only destructure array or tuple types using '[ ]'; found type '${format(valueType)}'`))
                    }
                }
            } break;
            case "derive-declaration": {
                const fnType = resolveT(infer(current.fn))

                if (fnType.kind === 'func-type') {
                    if (fnType.args.length > 0) {
                        reportError(miscError(current.fn, `Derive functions shouldn't take any arguments`))
                    }

                    if (current.type != null) {
                        // make sure value fits declared type, if there is one
                        if (!subsumes(reportError, current.type, fnType.returnType ?? UNKNOWN_TYPE)) {
                            reportError(assignmentError(current.fn, current.type, fnType.returnType ?? UNKNOWN_TYPE))
                        }
                    }
                } else {
                    // make sure value is a plan
                    reportError(miscError(current.fn, `Remote declarations must be defined with either a Plan or a function that returns a Plan; found type '${format(fnType)}'`))
                }
            } break;
            case "remote-declaration": {
                const fnType = resolveT(infer(current.fn))

                if (fnType.kind === 'plan-type') {
                    if (current.type != null) {
                        // make sure value fits declared type, if there is one
                        if (!subsumes(reportError, current.type, fnType.inner)) {
                            reportError(assignmentError(current.fn, current.type, fnType.inner))
                        }
                    }
                } else if (fnType.kind === 'func-type' && fnType.returnType?.kind === 'plan-type') {
                    if (fnType.args.length > 0) {
                        reportError(miscError(current.fn, `Remote functions shouldn't take any arguments`))
                    }

                    if (current.type != null) {
                        // make sure value fits declared type, if there is one
                        if (!subsumes(reportError, current.type, fnType.returnType.inner)) {
                            reportError(assignmentError(current.fn, current.type, fnType.returnType.inner))
                        }
                    }
                } else {
                    // make sure value is a plan
                    reportError(miscError(current.fn, `Remote declarations must be defined with either a Plan or a function that returns a Plan; found type '${format(fnType)}'`))
                }
            } break;
            case "test-expr-declaration": {
                // make sure test value is a boolean
                expect(reportError, BOOLEAN_TYPE, current.expr)
            } break;
            case "autorun-declaration": {
                const effectType = resolveT(infer(current.effect))

                if (effectType.kind !== "proc-type") {
                    reportError(miscError(current.effect, `Expected procedure`));
                } else if (effectType.args.length > 0) {
                    reportError(miscError(current.effect, `Effect procedure should not take any arguments; provided procedure expects ${effectType.args.length}`));
                }
            } break;
            case "func":
            case "proc": {
                const inferred = infer(current) as FuncType|ProcType|GenericFuncType|GenericProcType
                const funcOrProcType = inferred.kind === 'generic-type' ? inferred.inner : inferred

                {
                    let encounteredOptional = false;

                    for (const arg of funcOrProcType.args) {
                        if (arg.optional) {
                            encounteredOptional = true
                        }
                        
                        if (!arg.optional && encounteredOptional) {
                            reportError(miscError(arg, `Required args can't come after optional args`))
                        }
                    }
                }

                if (current.kind === 'func' && funcOrProcType.kind === 'func-type' && funcOrProcType.returnType != null) {
                    // make sure body expression fits declared return type, if there is one
                    expect(reportError, funcOrProcType.returnType, current.body)
                }
            } break;
            case "binary-operator": {
                const leftType = infer(current.left)
                const rightType = infer(current.right)

                if (current.op.op === '==' || current.op.op === '!=') {
                    if (!subsumes(reportError, leftType, rightType) 
                     && !subsumes(reportError, rightType, leftType)) {
                        reportError(miscError(current, `Can't compare types ${format(leftType)} and ${format(rightType)} because they have no overlap`))
                    }
                } else if (current.op.op !== '??' && current.op.op !== '&&' && current.op.op !== '||') {
                    const types = BINARY_OPERATOR_TYPES[current.op.op]?.find(({ left, right }) =>
                        subsumes(reportError, left, leftType) && 
                        subsumes(reportError, right, rightType))

                    if (types == null) {
                        reportError(miscError(current.op, `Operator '${current.op.op}' cannot be applied to types '${format(leftType)}' and '${format(rightType)}'`));
                    }
                }
            } break;
            case "invocation": {

                // Creation of nominal values looks like/parses as function 
                // invocation, but needs to be treated differently
                if (current.subject.kind === "local-identifier") {
                    const binding = resolve(() => {}, current.subject.name, current.subject)
                    if (binding?.kind === 'type-binding') {
                        const resolvedType = resolveT(binding.type)
    
                        if (resolvedType.kind === "nominal-type") {
                            expect(reportError, resolvedType.inner, current.args[0])
                            break;
                        }
                    }
                }

                // method call
                const invocation = invocationFromMethodCall(current) ?? current;
                const resolvedSubject = resolveT(infer(invocation.subject))

                // bound generic
                const subjectType = bindInvocationGenericArgs(reportError, invocation)

                if (subjectType == null) {
                    const subject = resolvedSubject as GenericType

                    if (invocation.typeArgs.length === 0) {
                        reportError(miscError(invocation, `Failed to infer generic type parameters; ${subject.typeParams.length} type arguments will need to be provided explicitly`))
                    } else if (subject.typeParams.length !== invocation.typeArgs.length) {
                        reportError(miscError(invocation, `Expected ${subject.typeParams.length} type arguments, but got ${invocation.typeArgs.length}`))
                    } else {
                        reportError(miscError(invocation, `Something went wrong while binding generic args`))
                    }
                } else if ( // check that subject is callable
                    subjectType.kind !== "func-type" && subjectType.kind !== "proc-type" 
                && (subjectType.kind !== 'generic-type' || (subjectType.inner.kind !== 'func-type' && subjectType.inner.kind !== 'proc-type'))) {
                    reportError(miscError(invocation.subject, "Expression must be a function or procedure to be called"));
                } else {
                    const invoked = subjectType.kind === 'generic-type' ? subjectType.inner as FuncType|ProcType : subjectType
        
                    // check that if this is a statement, the call subject is a procedure
                    if (parent?.kind === 'block' && invoked.kind === 'func-type') {
                        reportError(miscError(invocation.subject, `Only procedures can be called as statements, not functions`))
                    }

                    const nonOptionalArgs = invoked.args.filter(a => !a.optional).length

                    // check that the right number of arguments are passed
                    if (invocation.args.length > invoked.args.length || invocation.args.length < nonOptionalArgs) {
                        const functionOrProcedure = invoked.kind === "func-type" ? "Function" : "Procedure"
                        const argsStr = nonOptionalArgs !== invoked.args.length ? `${nonOptionalArgs}-${invoked.args.length}` : invoked.args.length
                        reportError(miscError(invocation, `${functionOrProcedure} expected ${argsStr} arguments but got ${invocation.args.length}`));
                    } else { // check that each argument matches the expected type
                        for (let i = 0; i < invocation.args.length; i++) {
                            const arg = invocation.args[i]
                            const subjectArgType = invoked.args[i].type ?? UNKNOWN_TYPE
                            expect(reportError, subjectArgType, arg)
                        }
                    }
                }
            } break;
            case "switch-expression": {
                for (const { condition } of current.cases) {
                    expect(reportError, infer(current.value), condition)
                }
            } break;
            case "indexer": {
                const subjectType = resolveT(infer(current.subject))
                const indexType = resolveT(infer(current.indexer))
                
                if (subjectType.kind === "object-type" && indexType.kind === "literal-type") {
                    const key = indexType.value.value;
                    const valueType = propertiesOf(reportError, subjectType)?.find(entry => entry.name.name === key)?.type;
                    if (valueType == null) {
                        reportError(miscError(current.indexer, `Property '${key}' doesn't exist on type '${format(subjectType)}'`));
                    }
                } else if (subjectType.kind === "record-type") {
                    expect(reportError, subjectType.keyType, current.indexer,
                        (_, val) => `Expression of type '${format(val)}' can't be used to index type '${format(subjectType)}'`)
                } else if (subjectType.kind === "array-type" || subjectType.kind === "string-type" || subjectType.kind === "tuple-type" || (subjectType.kind === 'literal-type' && subjectType.value.kind === 'exact-string-literal')) {
                    expect(reportError, NUMBER_TYPE, current.indexer,
                        (_, val) => `Expression of type '${format(val)}' can't be used to index type '${format(subjectType)}'`)

                    if (subjectType.kind === "tuple-type" || (subjectType.kind === 'literal-type' && subjectType.value.kind === 'exact-string-literal')) {
                        const max = subjectType.kind === 'tuple-type' ? subjectType.members.length : (subjectType.value as ExactStringLiteral).value.length

                        if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal' && (indexType.value.value < 0 || indexType.value.value >= max)) {
                            reportError(miscError(current.indexer, `Index ${indexType.value.value} is out of range on type '${format(subjectType)}'`));
                        }
                    }
                } else {
                    reportError(miscError(current.indexer, `Expression of type '${format(indexType)}' can't be used to index type '${format(subjectType)}'`));
                }
            } break;
            case "property-accessor": {
                const isMethodCall = current.parent?.kind === 'invocation' && invocationFromMethodCall(current.parent) != null

                if (!isMethodCall) {
                    const subjectType = resolveT(infer(current.subject))
                    const subjectProperties = current.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                        ? propertiesOf(reportError, subtract(reportError, subjectType, NIL_TYPE))
                        : propertiesOf(reportError, subjectType)

                    if (subjectProperties == null) {
                        reportError(miscError(current.subject, `Can only use dot operator (".") on objects with known properties (value is of type "${format(subjectType)}")`));
                    } else if (!subjectProperties.some(property => property.name.name === current.property.name)) {
                        reportError(miscError(current.property, `Property '${current.property.name}' does not exist on type '${format(subjectType)}'`));
                    }
                }
            } break;
            case "string-literal": {
                // check that all template insertions are allowed to be inserted
                for (const segment of current.segments) {
                    if (typeof segment !== "string") {
                        expect(reportError, STRING_TEMPLATE_INSERT_TYPE, segment)
                    }
                }
            } break;
            case "as-cast": {
                expect(reportError, current.type, current.inner,
                    (dest, val) => `Expression of type ${format(val)} cannot be expanded to type ${format(dest)}`)

                if (typesEqual(resolveT(current.type), resolveT(infer(current.inner)))) {
                    reportError(miscError(current, `Casting here is redundant, because ${format(current.inner)} is already of type ${format(current.type)}`))
                }
            } break;
            case "named-type":
                resolve(reportError, current.name.name, current)
                break;
            case "local-identifier": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                resolve(reportError, current.name, current)
            } break;
            case "assignment": {

                // if assigning directly to variable, make sure it isn't a constant
                const resolved = current.target.kind === "local-identifier" ? resolve(reportError, current.target.name, current.target) : undefined
                if (current.target.kind === "local-identifier" && resolved != null && resolved.kind !== 'type-binding' && getBindingMutability(resolved, current.target) !== "assignable") {
                    reportError(miscError(current.target, `Cannot assign to '${current.target.name}' because it's constant`));
                }

                // if assigning into object or array, make sure the subject isn't immutable
                if (current.target.kind === "property-accessor" || current.target.kind === "indexer") {
                    const subjectType = resolveT(infer(current.target.subject))
                    if (subjectType.mutability !== "mutable") {
                        reportError(miscError(current.target, `Cannot assign to '${format(current.target)}' because '${format(current.target.subject)}' is constant`));
                    }
                }

                const targetType = infer(current.target);
                expect(reportError, targetType, current.value)
            } break;
            case "range": {
                expect(reportError, NUMBER_TYPE, current.start, 
                    (_, val) => `Expected number for start of range; got '${format(val)}'`)
                expect(reportError, NUMBER_TYPE, current.end, 
                    (_, val) => `Expected number for end of range; got '${format(val)}'`)
            } break;
            case "for-loop": {
                expect(reportError, ITERATOR_OF_ANY, current.iterator, 
                    () => `Expected iterator after "of" in for loop`)
            } break;
            case "element-tag": {
                for (const child of current.children) {
                    expect(reportError, ELEMENT_TAG_CHILD_TYPE, child)
                }
            } break;
            case "spread": {
                if (parent?.kind === 'object-literal') {
                    expect(reportError, RECORD_OF_ANY, current.expr, 
                        (_, val) => `Only objects can be spread into an object; found ${format(val)}`)
                } else if (parent?.kind === 'array-literal') {
                    expect(reportError, ARRAY_OF_ANY, current.expr, 
                        (_, val) => `Only arrays or tuples can be spread into an array; found ${format(val)}`)
                }
            } break;
            case "proc-type":
            case "func-type": {
                let encounteredOptional = false;

                for (const arg of current.args) {
                    if (arg.optional) {
                        encounteredOptional = true
                    }
                    
                    if (!arg.optional && encounteredOptional) {
                        reportError(miscError(arg, `Required args can't come after optional args`))
                    }
                }
            } break;
            case "object-type": {
                for (const spread of current.spreads) {
                    const resolved = resolveT(spread)

                    if (!subsumes(reportError, RECORD_OF_ANY, resolved)) {
                        reportError(miscError(spread, `${format(resolved)} is not an object type; can only spread object types into object types`))
                    }
                }
            } break;
            case "instance-of": {
                const exprType = resolveT(infer(current.expr))

                if (!subsumes(reportError, exprType, current.type)) {
                    reportError(miscError(current, `This check will always be false, because ${format(current.expr)} can never be a ${format(current.type)}`))
                } else if (typesEqual(resolveT(exprType), resolveT(current.type))) {
                    reportError(miscError(current, `This check will always be true, because ${format(current.expr)} will always be a ${format(current.type)}`))
                }
            } break;
            case "if-else-expression":
            case "if-else-statement":
            case "while-loop":
            case "negation-operator":
            case "module":
            case "import-item":
            case "js-proc":
            case "js-func":
            case "test-block-declaration":
            case "inline-const-group":
            case "block":
            case "attribute":
            case "case":
            case "switch-case":
            case "case-block":
            case "arg":
            case "operator":
            case "parenthesized-expression":
            case "object-literal":
            case "array-literal":
            case "exact-string-literal":
            case "number-literal":
            case "boolean-literal":
            case "nil-literal":
            case "plain-identifier":
            case "javascript-escape":
            case "debug":
            case "union-type":
            case "maybe-type":
            case "generic-param-type":
            case "generic-type":
            case "bound-generic-type":
            case "element-type":
            case "record-type":
            case "array-type":
            case "tuple-type":
            case "string-type":
            case "number-type":
            case "boolean-type":
            case "nil-type":
            case "literal-type":
            case "nominal-type":
            case "iterator-type":
            case "plan-type":
            case "remote-type":
            case "parenthesized-type":
            case "unknown-type":
            case "any-type":
            case "never-type":
            case "property-type":
            case "javascript-escape-type":
            case "error-type":
            case "error-expression":
                break;
            default:
                // @ts-expect-error
                throw Error(current.kind)
        }        
    }
}

function expect(reportError: ReportError, destinationType: TypeExpression, value: Expression, generateMessage?: (dest: TypeExpression, val: TypeExpression) => string) {
    const inferredType = inferType(reportError, value);
    if (!subsumes(reportError, destinationType, inferredType)) {
        reportError(
            generateMessage
                ? miscError(value, generateMessage(destinationType, inferredType))
                : assignmentError(value, destinationType, inferredType));
    }
}

/**
 * Determine whether `value` can "fit into" `destination`. Used for verifying 
 * values passed to consts, arguments, etc, but for other things too.
 */
export function subsumes(reportError: ReportError, destination: TypeExpression, value: TypeExpression): boolean {
    const resolve = (type: TypeExpression) => resolveType(reportError, type)

    if (destination === value) {
        return true;
    }

    const resolvedDestination = resolve(destination)
    const resolvedValue = resolve(value)

    // constants can't be assigned to mutable slots
    if (resolvedDestination.mutability === "mutable" && resolvedValue.mutability !== "mutable") {
        return false;
    }

    if (
        resolvedValue.kind === "javascript-escape-type" || 
        resolvedValue.kind === "any-type" || 
        resolvedDestination.kind === "any-type" || 
        resolvedDestination.kind === "unknown-type"
    ) {
        return true;
    } else if (resolvedValue.kind === "unknown-type") {
        return false;
    } else if (resolvedValue.kind === 'never-type' || resolvedDestination.kind === 'never-type') {
        return false;
    } else if (
        (resolvedDestination.kind === "number-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "number-literal") ||
        (resolvedDestination.kind === "string-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "exact-string-literal") ||
        (resolvedDestination.kind === "boolean-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "boolean-literal")
    ) {
        return true;
    } else if(resolvedDestination.kind === "union-type") {
        if (resolvedValue.kind === "union-type") {
            return resolvedValue.members.every(valueMember => 
                resolvedDestination.members.some(destinationMember => 
                    subsumes(reportError, destinationMember, valueMember)));
        } else {
            return resolvedDestination.members.some(member => 
                subsumes(reportError, member, resolvedValue));
        }
    } else if (resolvedValue.kind === "union-type") {
        return resolvedValue.members.every(member =>
            subsumes(reportError, resolvedDestination, member));
    } else if(typesEqual(resolvedDestination, resolvedValue)) {
        return true;
    } else if (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedDestination.args.every((_, i) => subsumes(reportError, resolvedValue.args[i].type ?? UNKNOWN_TYPE, resolvedDestination.args[i].type ?? UNKNOWN_TYPE))
            && subsumes(reportError, resolvedDestination.returnType ?? UNKNOWN_TYPE, resolvedValue.returnType ?? UNKNOWN_TYPE)) {
        return true;
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedDestination.args.every((_, i) => subsumes(reportError, resolvedValue.args[i].type ?? UNKNOWN_TYPE, resolvedDestination.args[i].type ?? UNKNOWN_TYPE))) {
        return true;
    } else if (resolvedDestination.kind === "array-type") {
        if (resolvedValue.kind === "array-type") {
            return subsumes(reportError, resolvedDestination.element, resolvedValue.element)
        }
        if (resolvedValue.kind === 'tuple-type') {
            return resolvedValue.members.every(member =>
                subsumes(reportError, resolvedDestination.element, member))
        }
    } else if (resolvedDestination.kind === "tuple-type") {
        if (resolvedValue.kind === 'tuple-type') {
            return resolvedValue.members.every((member, index) =>
                subsumes(reportError, resolvedDestination.members[index], member))
        }
    } else if (resolvedDestination.kind === "record-type") {
        if (resolvedValue.kind === "record-type") {
            return subsumes(reportError, resolvedDestination.keyType, resolvedValue.keyType)
                && subsumes(reportError, resolvedDestination.valueType, resolvedValue.valueType)
        }
        if (resolvedValue.kind === "object-type") {
            // TODO: Spreads
            return subsumes(reportError, resolvedDestination.keyType, STRING_TYPE)
                && resolvedValue.entries.every(({ type }) =>
                    // TODO: Optionals
                    subsumes(reportError, resolvedDestination.valueType, type))
        }
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        // TODO: Spreads
        const destinationEntries = propertiesOf(reportError, resolvedDestination)
        const valueEntries =       propertiesOf(reportError, resolvedValue)

        return (
            !!destinationEntries?.every(({ name: key, type: destinationValue }) => 
                given(valueEntries?.find(e => e.name.name === key.name)?.type, value =>
                    // TODO: Optionals
                    subsumes(reportError,  destinationValue, value)))
        );
    } else if ((resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") ||
                (resolvedDestination.kind === "plan-type" && resolvedValue.kind === "plan-type") ||
                (resolvedDestination.kind === "error-type" && resolvedValue.kind === "error-type") ||
                (resolvedDestination.kind === "remote-type" && resolvedValue.kind === "remote-type")) {
        return subsumes(reportError, resolvedDestination.inner, resolvedValue.inner);
    } else if (resolvedDestination.kind === 'nominal-type' && resolvedValue.kind === 'nominal-type') {
        return resolvedDestination.name === resolvedValue.name;
    }

    return false;
}

/**
 * Determine whether or not two types have any overlap at all
 */
export function overlaps(reportError: ReportError, a: TypeExpression, b: TypeExpression): boolean {
    const resolvedA = resolveType(reportError, a)
    const resolvedB = resolveType(reportError, b)

    if (subsumes(reportError, resolvedA, resolvedB) || subsumes(reportError, resolvedB, resolvedA)) {
        return true
    } else if (resolvedA.kind === 'union-type' && resolvedB.kind === 'union-type') {
        return resolvedA.members.some(memberA => resolvedB.members.some(memberB => overlaps(reportError, memberA, memberB)))
    } else if (resolvedA.kind === 'union-type') {
        return resolvedA.members.some(memberA => overlaps(reportError, memberA, resolvedB))
    } else if (resolvedB.kind === 'union-type') {
        return resolvedB.members.some(memberB => overlaps(reportError, memberB, resolvedA))
    }

    return false
}

/**
 * Resolve named types, unpack parenthesized types, bind generic types, 
 * simplify unions; generally collapse a type into its "real" form, whatever 
 * that means.
 */
export function resolveType(reportError: ReportError, type: TypeExpression): TypeExpression {
    const resolveT = (type: TypeExpression) => resolveType(reportError, type)

    switch (type.kind) {
        case "named-type": {
            const binding = resolve(reportError, type.name.name, type.name)

            if (binding?.kind !== 'type-binding') {
                reportError(miscError(type, `${type.name.name} is not a type`))
                return UNKNOWN_TYPE
            }

            return resolveT(binding.type)
        }
        case "generic-param-type":
            return resolveT(type.extends ?? UNKNOWN_TYPE)
        case "parenthesized-type":
            return resolveT(type.inner)
        case "plan-type": {
            let inner = type.inner
            while (inner.kind === 'plan-type') {
                inner = inner.inner
            }

            return {
                ...type,
                inner: resolveT(inner)
            }
        }
        case "maybe-type": {
            const { mutability, parent, module, code, startIndex, endIndex } = type

            return resolveT({
                kind: "union-type",
                members: [
                    type.inner,
                    NIL_TYPE
                ],
                mutability, parent, module, code, startIndex, endIndex
            })
        }
        case "bound-generic-type": {
            const resolvedGeneric = resolveT(type.generic)

            if (resolvedGeneric.kind !== 'generic-type') {
                reportError(miscError(type, 'Can only bind type arguments to a generic type'))
                return UNKNOWN_TYPE
            } else {
                return resolveT(parameterizedGenericType(reportError, resolvedGeneric, type.typeArgs))
            }
        }
        case "union-type": {
            const resolved = {
                ...type,
                members: type.members.map(resolveT)
            }

            const simplified = simplifyUnions(reportError, resolved)

            if (simplified.kind === 'union-type') {
                return simplified
            } else {
                return resolveT(simplified)
            }
        }
        case "array-type": {
            return {
                ...type,
                element: resolveT(type.element)
            }
        }
        case "tuple-type": {
            return {
                ...type,
                members: type.members.map(resolveT)
            }
        }
        case "record-type": {
            return {
                ...type,
                keyType: resolveT(type.keyType),
                valueType: resolveT(type.valueType)
            }
        }
        case "object-type": {
            return {
                ...type,
                entries: type.entries.map(entry => ({
                    ...entry,
                    type: resolveT(entry.type)
                }))
            }
        }
        case "property-type": {
            const subjectType = resolveT(type.subject)
            const nilTolerantSubjectType = type.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(reportError, subjectType, NIL_TYPE)
                : subjectType;
            const property = propertiesOf(reportError, nilTolerantSubjectType)?.find(entry => entry.name.name === type.property.name)
            
            const { parent, module, code, startIndex, endIndex } = type
            if (type.optional && property) {
                return resolveT({
                    kind: "maybe-type",
                    inner: property.type,
                    mutability: undefined,
                    parent, module, code, startIndex, endIndex
                })
            } else {
                const mutability = (
                    property?.type?.mutability == null ? undefined :
                    property.type.mutability === "mutable" && subjectType.mutability === "mutable" && !property.forceReadonly ? "mutable" :
                    subjectType.mutability === "immutable" ? "immutable" :
                    "readonly"
                )
    
                return (
                    given(property, property => resolveT((
                            property.optional
                                ?  {
                                    kind: "maybe-type",
                                    inner: { ...property.type, mutability },
                                    mutability: undefined,
                                    module, code, startIndex, endIndex
                                }
                                : { ...property.type, mutability }
                            ) as TypeExpression)) 
                        ?? UNKNOWN_TYPE
                )
            }
        }
    }

    return type
}
