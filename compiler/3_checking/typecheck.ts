import { Module } from "../_model/ast.ts";
import { BOOLEAN_TYPE, ELEMENT_TAG_CHILD_TYPE, FuncType, GenericFuncType, GenericProcType, isTypeExpression, ITERATOR_OF_ANY, NIL_TYPE, NUMBER_TYPE, ProcType, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { given } from "../utils/misc.ts";
import { assignmentError,miscError } from "../errors.ts";
import { propertiesOf, inferType, subtract, bindInvocationGenericArgs, parameterizedGenericType, simplifyUnions, invocationFromMethodCall } from "./typeinfer.ts";
import { getBindingMutability, ReportError } from "../_model/common.ts";
import { iterateParseTree, typesEqual } from "../utils/ast.ts";
import Store from "../store.ts";
import { format } from "../other/format.ts";
import { stripSourceInfo } from "../utils/debugging.ts";

/**
 * Walk an entire AST and report all issues that we find
 */
export function typecheck(reportError: ReportError, ast: Module): void {

    for (const { current, parent } of iterateParseTree(ast)) {
            
        switch(current.kind) {
            case "value-declaration":
            case "value-declaration-statement":
            case "inline-const": {

                // make sure value fits declared type, if there is one
                const valueType = inferType(reportError, current.value);
                if (current.type != null && !subsumes(reportError,  current.type, valueType)) {
                    reportError(assignmentError(current.value, current.type, valueType));
                }

            } break;
            case "test-expr-declaration": {

                // make sure test value is a boolean
                const valueType = inferType(reportError, current.expr);
                if (!subsumes(reportError,  BOOLEAN_TYPE, valueType)) {
                    reportError(assignmentError(current.expr, BOOLEAN_TYPE, valueType));
                }
            } break;
            case "autorun-declaration": {
                const effectType = resolveType(reportError, inferType(reportError, current.effect))

                if (effectType.kind !== "proc-type") {
                    reportError(miscError(current.effect, `Expected procedure`));
                } else if (effectType.args.length > 0) {
                    reportError(miscError(current.effect, `Effect procedure should not take any arguments; provided procedure expects ${effectType.args.length}`));
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
            case "func":
            case "proc": {
                const inferred = inferType(reportError, current) as FuncType|ProcType|GenericFuncType|GenericProcType
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

                if (current.kind === 'func' && funcOrProcType.kind === 'func-type') {
                    // make sure body expression fits declared return type, if there is one
                    const bodyType = inferType(reportError, current.body);
                    if (funcOrProcType.returnType != null && !subsumes(reportError,  funcOrProcType.returnType, bodyType)) {
                        reportError(assignmentError(current.body, funcOrProcType.returnType, bodyType));
                    }
                }
            } break;
            case "binary-operator": {
                let leftType = inferType(reportError, current.base)

                for (const [op, expr] of current.ops) {
                    const leftTypeResolved = resolveType(reportError, leftType)
                    const rightType = inferType(reportError, expr)
                    const rightTypeResolved = resolveType(reportError, rightType)

                    if (op.op === '==' || op.op === '!=') {
                        if (!subsumes(reportError, leftTypeResolved, rightTypeResolved) 
                        && !subsumes(reportError, rightTypeResolved, leftTypeResolved)) {
                            reportError(miscError(current, `Can't compare types ${format(leftTypeResolved)} and ${format(rightTypeResolved)} because they have no overlap`))
                        }

                        leftType = BOOLEAN_TYPE
                    }
                }
            } break;
            case "negation-operator": {
                const baseType = inferType(reportError, current.base);
                if (!subsumes(reportError,  BOOLEAN_TYPE, baseType)) {
                    reportError(assignmentError(current.base, BOOLEAN_TYPE, baseType));
                }
            } break;
            case "pipe":
            case "invocation": {

                // Creation of nominal values looks like/parses as function 
                // invocation, but needs to be treated differently
                if (current.kind === "invocation" && current.subject.kind === "local-identifier") {
                    const binding = Store.getBinding(() => {}, current.subject.name, current.subject)
                    if (binding?.kind === 'type-binding') {
                        const resolvedType = resolveType(reportError, binding.type)
    
                        if (resolvedType.kind === "nominal-type") {
                            const argType = inferType(reportError, current.args[0])
    
                            if (!subsumes(reportError, resolvedType.inner, argType)) {
                                reportError(assignmentError(current.args[0], resolvedType.inner, argType))
                            }
    
                            continue;
                        }
                    }
                }

                // method call
                const invocation = invocationFromMethodCall(current) ?? current;

                const subjectType = invocation.kind === "invocation"
                    ? bindInvocationGenericArgs(reportError, invocation)
                    : resolveType(reportError, inferType(reportError, invocation.subject))
                
                // check that type args satisfy any `extends` clauses
                if (invocation.kind === "invocation") {
                    const resolvedSubject = resolveType(reportError, inferType(reportError, invocation.subject))

                    if (resolvedSubject.kind === 'generic-type' && resolvedSubject.typeParams.length === invocation.typeArgs.length) {
                        for (let i = 0; i < resolvedSubject.typeParams.length; i++) {
                            const typeParam = resolvedSubject.typeParams[i]
                            const typeArg = invocation.typeArgs[i]

                            if (typeParam.extends && !subsumes(reportError, typeParam.extends, typeArg)) {
                                reportError(assignmentError(typeArg, typeParam.extends, typeArg))
                            }
                        }
                    }
                }

                if (subjectType.kind !== "func-type" && subjectType.kind !== "proc-type" 
                && (subjectType.kind !== 'generic-type' || (subjectType.inner.kind !== 'func-type' && subjectType.inner.kind !== 'proc-type'))) {  // check that subject is callable
                    reportError(miscError(invocation.subject, "Expression must be a function or procedure to be called"));
                }
                
                if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {
                    
                    // check that if this is a statement, the call subject is a procedure
                    if (parent?.kind === 'block' && subjectType.kind === 'func-type') {
                        reportError(miscError(invocation.subject, `Only procedures can be called as statements, not functions`))
                    }

                    const nonOptionalArgs = subjectType.args.filter(a => !a.optional).length

                    // check that the right number of arguments are passed
                    if (invocation.args.length > subjectType.args.length || invocation.args.length < nonOptionalArgs) {
                        const functionOrProcedure = subjectType.kind === "func-type" ? "Function" : "Procedure"
                        reportError(miscError(invocation, `${functionOrProcedure} expected ${nonOptionalArgs}-${subjectType.args.length} arguments but got ${invocation.args.length}`));
                    } else { // check that each argument matches the expected type
                        for (let i = 0; i < invocation.args.length; i++) {
                            const arg = invocation.args[i]
                            const subjectArgType = subjectType.args[i].type ?? UNKNOWN_TYPE

                            const argValueType = inferType(reportError, arg)
                            if (!subsumes(reportError,  subjectArgType, argValueType)) {
                                reportError(assignmentError(arg, subjectArgType, argValueType));
                            }
                        }
                    }
                }
            } break;
            case "if-else-expression":
            case "if-else-statement":
            case "switch-expression": {
                const valueType = current.kind === "if-else-expression" || current.kind === "if-else-statement" ? BOOLEAN_TYPE : inferType(reportError, current.value);

                for (const { condition } of current.cases) {
                    const conditionType = inferType(reportError, condition);
                    if (!subsumes(reportError,  valueType, conditionType)) {
                        reportError(assignmentError(condition, valueType, conditionType));
                    }
                }
            } break;
            case "indexer": {
                const baseType = resolveType(reportError, inferType(reportError, current.subject))
                const indexType = resolveType(reportError, inferType(reportError, current.indexer))
                
                if (baseType.kind === "object-type" && indexType.kind === "literal-type") {
                    const key = indexType.value.value;
                    const valueType = propertiesOf(reportError, baseType)?.find(entry => entry.name.name === key)?.type;
                    if (valueType == null) {
                        reportError(miscError(current.indexer, `Property '${key}' doesn't exist on type '${format(baseType)}'`));
                    }
                } else if (baseType.kind === "record-type") {
                    if (!subsumes(reportError,  baseType.keyType, indexType)) {
                        reportError(assignmentError(current.indexer, baseType.keyType, indexType));
                    }
                } else if (baseType.kind === "array-type") {
                    if (!subsumes(reportError,  NUMBER_TYPE, indexType)) {
                        reportError(miscError(current.indexer, `Expression of type '${format(indexType)}' can't be used to index type '${format(baseType)}'`));
                    }
                } else if (baseType.kind === "tuple-type") {
                    if (!subsumes(reportError,  NUMBER_TYPE, indexType)) {
                        reportError(miscError(current.indexer, `Expression of type '${format(indexType)}' can't be used to index type '${format(baseType)}'`));
                    } else if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                        if (indexType.value.value < 0 || indexType.value.value >= baseType.members.length) {
                            reportError(miscError(current.indexer, `Index ${indexType.value.value} is out of range on type '${format(baseType)}'`));
                        }
                    }
                } else if (baseType.kind === "string-type") {
                    if (!subsumes(reportError,  NUMBER_TYPE, indexType)) {
                        reportError(miscError(current.indexer, `Expression of type '${format(indexType)}' can't be used to index type '${format(baseType)}'`));
                    }
                } else if (baseType.kind === 'literal-type' && baseType.value.kind === 'exact-string-literal') {
                    if (!subsumes(reportError,  NUMBER_TYPE, indexType)) {
                        reportError(miscError(current.indexer, `Expression of type '${format(indexType)}' can't be used to index type '${format(baseType)}'`));
                    } else if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                        if (indexType.value.value < 0 || indexType.value.value >= baseType.value.value.length) {
                            reportError(miscError(current.indexer, `Index ${indexType.value.value} is out of range on type '${format(baseType)}'`));
                        }
                    }
                } else {
                    reportError(miscError(current.indexer, `Expression of type '${format(indexType)}' can't be used to index type '${format(baseType)}'`));
                }
            } break;
            case "property-accessor": {
                const isMethodCall = current.parent?.kind === 'invocation' && invocationFromMethodCall(current.parent) != null

                if (!isMethodCall) {
                    const subjectType = resolveType(reportError, inferType(reportError, current.subject))
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
                        const segmentType = inferType(reportError, segment);
                        if (!subsumes(reportError,  STRING_TEMPLATE_INSERT_TYPE, segmentType)) {
                            reportError(assignmentError(segment, STRING_TEMPLATE_INSERT_TYPE, segmentType));
                        }
                    }
                }
            } break;
            case "as-cast": {
                const innerType = inferType(reportError, current.inner)
                if (!subsumes(reportError, current.type, innerType)) {
                    reportError(miscError(current, `Expression of type ${format(innerType)} cannot be expanded to type ${format(current.type)}`))
                }
            } break;
            case "local-identifier": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                Store.getBinding(reportError, current.name, current)
            } break;
            case "assignment": {
                const resolved = current.target.kind === "local-identifier" ? Store.getBinding(reportError, current.target.name, current.target) : undefined
                if (current.target.kind === "local-identifier" && resolved != null && resolved.kind !== 'type-binding' && getBindingMutability(resolved, current.target) !== "assignable") {
                    reportError(miscError(current.target, `Cannot assign to '${current.target.name}' because it's constant`));
                }

                if (current.target.kind === "property-accessor" || current.target.kind === "indexer") {
                    const subjectType = resolveType(reportError, inferType(reportError, current.target.subject))
                    if (subjectType.mutability !== "mutable") {
                        reportError(miscError(current.target, `Cannot assign to '${format(current.target)}' because '${format(current.target.subject)}' is constant`));
                    }
                }

                const targetType = inferType(reportError, current.target);
                const valueType = inferType(reportError, current.value);
                if (!subsumes(reportError,  targetType, valueType)) {
                    reportError(assignmentError(current.value, targetType, valueType));
                }
            } break;
            case "range": {

                const startType = inferType(reportError, current.start)
                if (!subsumes(reportError, NUMBER_TYPE, startType)) {
                    reportError(miscError(current.start, `Expected number for start of iterator; got '${format(startType)}'`));
                }

                const endType = inferType(reportError, current.end)
                if (!subsumes(reportError, NUMBER_TYPE, endType)) {
                    reportError(miscError(current.end, `Expected number for end of iterator; got '${format(endType)}'`));
                }
            } break;
            case "for-loop": {
                const iteratorType = inferType(reportError, current.iterator);
                if (!subsumes(reportError,  ITERATOR_OF_ANY, iteratorType)) {
                    reportError(miscError(current.iterator, `Expected iterator after "of" in for loop`));
                }
            } break;
            case "while-loop": {
                const conditionType = inferType(reportError, current.condition);
                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(current.condition, `Condition for while loop must be boolean`));
                }
            } break;
            case "element-tag": {
                for (const child of current.children) {
                    const childType = inferType(reportError, child);
                    if (!subsumes(reportError, ELEMENT_TAG_CHILD_TYPE, childType)) {
                        reportError(assignmentError(child, ELEMENT_TAG_CHILD_TYPE, childType));
                    }
                }
            } break;
            case "spread": {
                const spreadType = inferType(reportError, current.expr)

                if (parent?.kind === 'object-literal' && spreadType.kind !== 'object-type') {
                    reportError(miscError(current.expr, `Only objects can be spread into an object; found ${format(spreadType)}`))
                } else if (parent?.kind === 'array-literal' && spreadType.kind !== 'array-type' && spreadType.kind !== 'tuple-type') {
                    reportError(miscError(current.expr, `Only arrays or tuples can be spread into an array; found ${format(spreadType)}`))
                }
            } break;
            case "module":
            case "import-all-declaration":
            case "import-declaration":
            case "import-item":
            case "proc-declaration":
            case "func-declaration":
            case "js-proc-declaration":
            case "js-func-declaration":
            case "type-declaration":
            case "test-block-declaration":
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
            case "named-type":
            case "generic-param-type":
            case "generic-type":
            case "bound-generic-type":
            case "element-type":
            case "object-type":
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
            case "parenthesized-type":
            case "unknown-type":
            case "any-type":
            case "javascript-escape-type":
                break;
            default:
                // @ts-expect-error
                throw Error(current.kind)
        }        
    }
}

/**
 * Determine whether `value` can "fit into" `destination`. Used for verifying 
 * values passed to consts, arguments, etc, but for other things too.
 */
export function subsumes(reportError: ReportError, destination: TypeExpression, value: TypeExpression): boolean {
    if (destination === value) {
        return true;
    }

    const resolvedDestination = resolveType(reportError, destination)
    const resolvedValue = resolveType(reportError, value)

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
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        const destinationEntries = propertiesOf(reportError, resolvedDestination)
        const valueEntries =       propertiesOf(reportError, resolvedValue)

        return (
            !!destinationEntries?.every(({ name: key, type: destinationValue }) => 
                given(valueEntries?.find(e => e.name.name === key.name)?.type, value =>
                    subsumes(reportError,  destinationValue, value)))
        );
    } else if ((resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") ||
                (resolvedDestination.kind === "plan-type" && resolvedValue.kind === "plan-type")) {
        return subsumes(reportError, resolvedDestination.inner, resolvedValue.inner);
    } else if (resolvedDestination.kind === 'nominal-type' && resolvedValue.kind === 'nominal-type') {
        return resolvedDestination.name === resolvedValue.name;
    }

    return false;
}

export function resolveType(reportError: ReportError, type: TypeExpression): TypeExpression {
    switch (type.kind) {
        case "named-type": {
            const binding = Store.getBinding(reportError, type.name.name, type.name)
            return resolveType(reportError, binding?.kind === 'type-binding' ? binding.type : UNKNOWN_TYPE)
        }
        case "generic-param-type":
            return resolveType(reportError, type.extends ?? UNKNOWN_TYPE)
        case "parenthesized-type":
            return resolveType(reportError, type.inner)
        case "maybe-type": {
            const { mutability, parent, module, code, startIndex, endIndex } = type

            return resolveType(reportError, {
                kind: "union-type",
                members: [
                    type.inner,
                    NIL_TYPE
                ],
                mutability, parent, module, code, startIndex, endIndex
            })
        }
        case "bound-generic-type": {
            const resolvedGeneric = resolveType(reportError, type.generic)

            if (resolvedGeneric.kind !== 'generic-type') {
                reportError(miscError(type, 'Can only bind type arguments to a generic type'))
                return UNKNOWN_TYPE
            } else {
                return resolveType(reportError, parameterizedGenericType(reportError, resolvedGeneric, type.typeArgs))
            }
        }
        case "union-type": {
            const resolved = {
                ...type,
                members: type.members.map(member => resolveType(reportError, member))
            }

            const simplified = simplifyUnions(reportError, resolved)

            if (simplified.kind === 'union-type') {
                return simplified
            } else {
                return resolveType(reportError, simplified)
            }
        }
    }

    return type
}
