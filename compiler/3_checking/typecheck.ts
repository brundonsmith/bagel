import { Block, Module, PlainIdentifier } from "../_model/ast.ts";
import { ARRAY_OF_ANY, BOOLEAN_TYPE, ELEMENT_TAG_CHILD_TYPE, FuncType, GenericFuncType, GenericProcType, GenericType, ITERATOR_OF_ANY, NIL_TYPE, NUMBER_TYPE, RECORD_OF_ANY, ProcType, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { given } from "../utils/misc.ts";
import { alreadyDeclared, assignmentError,BagelError,cannotFindExport,cannotFindModule,cannotFindName,miscError } from "../errors.ts";
import { propertiesOf, inferType, subtract, bindInvocationGenericArgs, parameterizedGenericType, simplifyUnions, invocationFromMethodCall, BINARY_OPERATOR_TYPES, TYPE_AST_NOISE, AST_NOISE } from "./typeinfer.ts";
import { getBindingMutability, ModuleName, ReportError } from "../_model/common.ts";
import { ancestors, findAncestor, iterateParseTree, typesEqual, within } from "../utils/ast.ts";
import Store, { getModuleByName, _Store } from "../store.ts";
import { format } from "../other/format.ts";
import { ExactStringLiteral, Expression, InlineConstGroup } from "../_model/expressions.ts";
import { log, stripSourceInfo } from "../utils/debugging.ts";
import { computedFn } from "../mobx.ts";
import { parsed } from "../1_parse/index.ts";
import { resolve } from "./resolve.ts";
import { DeriveDeclaration, FuncDeclaration, ImportDeclaration, ProcDeclaration, RemoteDeclaration, TypeDeclaration, ValueDeclaration } from "../_model/declarations.ts";


export const typeerrors = computedFn((store: _Store, moduleName: ModuleName): BagelError[] => {
    const ast = parsed(store, moduleName)?.ast

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
    for (const { current, parent } of iterateParseTree(ast)) {
            
        switch(current.kind) {
            case "import-all-declaration":
            case "import-declaration": {
                const otherModule = getModuleByName(Store, current.module as ModuleName, current.path.value)

                if (otherModule == null) {
                    // other module doesn't exist
                    reportError(cannotFindModule(current.path))
                }
            } break;
            case "import-item": {
                const importDeclaration = (current.parent as ImportDeclaration)
                const otherModule = getModuleByName(Store, current.module as ModuleName, importDeclaration.path.value)

                if (otherModule != null) {
                    const imported = otherModule.declarations.find(other =>
                        (other.kind === 'value-declaration' ||
                        other.kind === 'func-declaration' ||
                        other.kind === 'proc-declaration' ||
                        other.kind === 'type-declaration' ||
                        other.kind === 'derive-declaration' ||
                        other.kind === 'remote-declaration')
                        && other.name.name === current.name.name) as ValueDeclaration|FuncDeclaration|ProcDeclaration|TypeDeclaration|DeriveDeclaration|RemoteDeclaration|undefined
    
                    if (imported?.kind === 'type-declaration') {
                        reportError(miscError(current, `'${current.name.name}' refers to a type, but it's used as an expression`))
                    } else if(!imported?.exported) {
                        reportError(miscError(current, `'${current.name.name}' exists but is not exported`))
                    }
                }
            } break;
            case "module": {
                const seen = new Map<string, PlainIdentifier>()
                const duplicates = new Set<PlainIdentifier>()

                for (const decl of current.declarations) {
                    const names = (() => {
                        switch(decl.kind) {
                            case "import-declaration":
                                return decl.imports.map(i => i.alias ?? i.name)
                            case "import-all-declaration":
                                return [decl.alias]
                            case "type-declaration":
                            case "proc-declaration":
                            case "func-declaration":
                            case "value-declaration":
                            case "derive-declaration":
                            case "remote-declaration":
                                return [decl.name]
                            case "autorun-declaration":
                            case "test-expr-declaration":
                            case "test-block-declaration":
                            case "debug":
                            case "javascript-escape":
                                return []
                            default:
                                // @ts-expect-error: exhaustiveness
                                throw Error(decl.kind)
                        }
                    })()

                    for (const name of names) {
                        const existing = seen.get(name.name)
                        if (existing) {
                            duplicates.add(existing)
                            duplicates.add(name)
                        } else {
                            seen.set(name.name, name)
                        }
                    }
                }

                for (const duplicate of duplicates) {
                    reportError(alreadyDeclared(duplicate))
                }
            } break;
            case "block": {
                const seen = new Map<string, PlainIdentifier>()
                const duplicates = new Set<PlainIdentifier>()

                for (const stmt of current.statements) {
                    const names = (() => {
                        switch(stmt.kind) {
                            case "value-declaration-statement":
                                return [stmt.name]
                            case "destructuring-declaration-statement":
                                return stmt.properties
                            case "await-statement":
                                return stmt.name ? [stmt.name] : []
                            case "invocation":
                            case "if-else-statement":
                            case "for-loop":
                            case "while-loop":
                            case "assignment":
                            case "javascript-escape":
                                return []
                            default:
                                // @ts-expect-error: exhaustiveness
                                throw Error(stmt.kind)
                        }
                    })()

                    for (const name of names) {
                        const existing = seen.get(name.name)
                        if (existing) {
                            duplicates.add(existing)
                            duplicates.add(name)
                        } else {
                            seen.set(name.name, name)
                        }
                    }
                }

                for (const duplicate of duplicates) {
                    reportError(alreadyDeclared(duplicate))
                }
            } break;
            case "inline-const-group": {
                const seen = new Map<string, PlainIdentifier>()
                const duplicates = new Set<PlainIdentifier>()

                for (const decl of current.declarations) {
                    const names = (() => {
                        switch(decl.kind) {
                            case "inline-const-declaration":
                                return [decl.name]
                            case "inline-destructuring-declaration":
                                return decl.properties
                            default:
                                // @ts-expect-error: exhaustiveness
                                throw Error(decl.kind)
                        }
                    })()

                    for (const name of names) {
                        const existing = seen.get(name.name)
                        if (existing) {
                            duplicates.add(existing)
                            duplicates.add(name)
                        } else {
                            seen.set(name.name, name)
                        }
                    }
                }

                for (const duplicate of duplicates) {
                    reportError(alreadyDeclared(duplicate))
                }
            } break
            case "value-declaration":
            case "value-declaration-statement":
            case "inline-const-declaration": {

                if (current.kind === 'inline-const-declaration' && current.awaited) {
                    const valueType = resolveType(inferType(current.value))

                    if (valueType.kind !== 'plan-type') {
                        // make sure value is a plan
                        reportError(miscError(current.value, `Can only await expressions of type Plan; found type '${format(valueType)}'`))
                    } else if (current.type != null) {
                        // make sure value fits declared type, if there is one
                        if (!subsumes(current.type, valueType.inner)) {
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
                const valueType = resolveType(inferType(current.plan))

                if (valueType.kind !== 'plan-type') {
                    // make sure value is a plan
                    reportError(miscError(current.plan, `Can only await expressions of type Plan; found type '${format(valueType)}'`))
                } else if (current.type != null) {
                    // make sure value fits declared type, if there is one
                    if (!subsumes(current.type, valueType.inner)) {
                        reportError(assignmentError(current.plan, current.type, valueType.inner))
                    }
                }
            } break;
            case "inline-destructuring-declaration":
            case "destructuring-declaration-statement": {
                const valueType = resolveType(inferType(current.value))
                
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
                    } else {
                        const objectProperties = propertiesOf(valueType)
                        for (const property of current.properties) {
                            if (!objectProperties?.find(prop => prop.name.name === property.name)) {
                                reportError(miscError(property, `Property '${property.name}' does not exist on type '${format(valueType)}'`))
                            }
                        }
                    }
                } else {
                    if (valueType.kind !== 'array-type' && valueType.kind !== 'tuple-type') {
                        reportError(miscError(current.value, `Can only destructure array or tuple types using '[ ]'; found type '${format(valueType)}'`))
                    } else {
                        if (valueType.kind === 'tuple-type') {
                            for (let i = valueType.members.length; i < current.properties.length; i++) {
                                reportError(miscError(current.properties[i], `Can't destructure element in index ${i}, because the provided tuple only has ${valueType.members.length} elements`))
                            }
                        }
                    }
                }
            } break;
            case "derive-declaration": {
                const fnType = resolveType(inferType(current.fn))

                if (fnType.kind === 'func-type') {
                    if (fnType.args.length > 0) {
                        reportError(miscError(current.fn, `Derive functions shouldn't take any arguments`))
                    }

                    if (current.type != null) {
                        // make sure value fits declared type, if there is one
                        if (!subsumes(current.type, fnType.returnType ?? UNKNOWN_TYPE)) {
                            reportError(assignmentError(current.fn, current.type, fnType.returnType ?? UNKNOWN_TYPE))
                        }
                    }
                } else {
                    // make sure value is a plan
                    reportError(miscError(current.fn, `Remote declarations must be defined with either a Plan or a function that returns a Plan; found type '${format(fnType)}'`))
                }
            } break;
            case "remote-declaration": {
                const fnType = resolveType(inferType(current.fn))

                if (fnType.kind === 'plan-type') {
                    if (current.type != null) {
                        // make sure value fits declared type, if there is one
                        if (!subsumes(current.type, fnType.inner)) {
                            reportError(assignmentError(current.fn, current.type, fnType.inner))
                        }
                    }
                } else if (fnType.kind === 'func-type' && fnType.returnType?.kind === 'plan-type') {
                    if (fnType.args.length > 0) {
                        reportError(miscError(current.fn, `Remote functions shouldn't take any arguments`))
                    }

                    if (current.type != null) {
                        // make sure value fits declared type, if there is one
                        if (!subsumes(current.type, fnType.returnType.inner)) {
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
                const effectType = resolveType(inferType(current.effect))

                if (effectType.kind !== "proc-type") {
                    reportError(miscError(current.effect, `Expected procedure`));
                } else if (effectType.args.length > 0) {
                    reportError(miscError(current.effect, `Effect procedure should not take any arguments; provided procedure expects ${effectType.args.length}`));
                }
            } break;
            case "func":
            case "proc": {
                const inferred = inferType(current) as FuncType|ProcType|GenericFuncType|GenericProcType
                const funcOrProcType = inferred.kind === 'generic-type' ? inferred.inner : inferred

                {
                    const seen = new Map<string, PlainIdentifier>()
                    const duplicates = new Set<PlainIdentifier>()
    
                    for (const { name } of funcOrProcType.args) {
                        const existing = seen.get(name.name)
                        if (existing) {
                            duplicates.add(existing)
                            duplicates.add(name)
                        } else {
                            seen.set(name.name, name)
                        }
                    }

                    for (const duplicate of duplicates) {
                        reportError(alreadyDeclared(duplicate))
                    }
                }

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
                const leftType = inferType(current.left)
                const rightType = inferType(current.right)

                if (current.op.op === '==' || current.op.op === '!=') {
                    if (!subsumes(leftType, rightType) 
                     && !subsumes(rightType, leftType)) {
                        reportError(miscError(current, `Can't compare types ${format(leftType)} and ${format(rightType)} because they have no overlap`))
                    }
                } else if (current.op.op !== '??' && current.op.op !== '&&' && current.op.op !== '||') {
                    const types = BINARY_OPERATOR_TYPES[current.op.op]?.find(({ left, right }) =>
                        subsumes(left, leftType) && 
                        subsumes(right, rightType))

                    if (types == null) {
                        reportError(miscError(current.op, `Operator '${current.op.op}' cannot be applied to types '${format(leftType)}' and '${format(rightType)}'`));
                    }
                }
            } break;
            case "invocation": {

                // Creation of nominal values looks like/parses as function 
                // invocation, but needs to be treated differently
                if (current.subject.kind === "local-identifier") {
                    const binding = resolve(current.subject.name, current.subject)
                    if (binding?.owner.kind === 'type-declaration') {
                        const resolvedType = resolveType(binding.owner.type)
    
                        if (resolvedType.kind === "nominal-type") {
                            expect(reportError, resolvedType.inner, current.args[0])
                            break;
                        }
                    }
                }

                // method call
                const invocation = invocationFromMethodCall(current) ?? current;
                const resolvedSubject = resolveType(inferType(invocation.subject))

                // bound generic
                const subjectType = bindInvocationGenericArgs(invocation)

                if (subjectType == null) {
                    const subject = resolvedSubject as GenericType

                    if (invocation.typeArgs.length === 0) {
                        reportError(miscError(invocation, `Failed to infer generic type parameters; ${subject.typeParams.length} type arguments will need to be provided explicitly`))
                    } else if (subject.typeParams.length !== invocation.typeArgs.length) {
                        reportError(miscError(invocation, `Expected ${subject.typeParams.length} type arguments, but got ${invocation.typeArgs.length}`))
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
                
                // check that provided type args fit `extends` clauses
                if (subjectType?.kind === 'generic-type' && subjectType.typeParams.length > 0 && invocation.typeArgs.length > 0) {
                    for (let i = 0; i < subjectType.typeParams.length; i++) {
                        const typeParam = subjectType.typeParams[i]
                        const typeArg = invocation.typeArgs[i]
                        
                        if (typeParam && typeArg && typeParam.extends && !subsumes(typeParam.extends, typeArg)) {
                            reportError(assignmentError(typeArg, typeParam.extends, typeArg))
                        }
                    }
                }
            } break;
            case "switch-expression": {
                for (const { condition } of current.cases) {
                    expect(reportError, inferType(current.value), condition)
                }
            } break;
            case "indexer": {
                const subjectType = resolveType(inferType(current.subject))
                const indexType = resolveType(inferType(current.indexer))
                
                if (subjectType.kind === "object-type" && indexType.kind === "literal-type") {
                    const key = indexType.value.value;
                    const valueType = propertiesOf(subjectType)?.find(entry => entry.name.name === key)?.type;
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
                    const subjectType = resolveType(inferType(current.subject))
                    const subjectProperties = current.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                        ? propertiesOf(subtract(subjectType, NIL_TYPE))
                        : propertiesOf(subjectType)

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

                if (typesEqual(resolveType(current.type), resolveType(inferType(current.inner)))) {
                    reportError(miscError(current, `Casting here is redundant, because ${format(current.inner)} is already of type ${format(current.type)}`))
                }
            } break;
            case "named-type": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                const binding = resolve(current.name.name, current)

                if (!binding) {
                    reportError(cannotFindName(current, current.name.name))
                } else if (binding.owner.kind !== 'type-declaration' && binding.owner.kind !== 'generic-param-type') {
                    reportError(miscError(current, `'${current.name.name}' is not a type`))
                }
            } break;
            case "local-identifier": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                const binding = resolve(current.name, current)

                if (binding) {
                    if (binding.owner.kind === 'value-declaration' || 
                        binding.owner.kind === 'value-declaration-statement' ||
                        binding.owner.kind === 'inline-const-declaration' ||
                        binding.owner.kind === 'inline-destructuring-declaration') {

                        // using a let-declaration to initialize a const
                        if (binding.owner.kind === 'value-declaration' && 
                            !binding.owner.isConst && 
                            (findAncestor(current, a => a.kind === 'value-declaration') as ValueDeclaration|undefined)?.isConst) {
                            
                            reportError(miscError(current, `Const declarations cannot be initialized from mutable state (referencing '${format(current)}')`))
                        }

                        const declarations = (
                            binding.owner.kind === 'value-declaration' ? (binding.owner.parent as Module).declarations :
                            binding.owner.kind === 'value-declaration-statement' ? (binding.owner.parent as Block).statements :
                            binding.owner.kind === 'inline-const-declaration' ? (binding.owner.parent as InlineConstGroup).declarations :
                            binding.owner.kind === 'inline-destructuring-declaration' ? (binding.owner.parent as InlineConstGroup).declarations :
                            undefined
                        )

                        if (declarations) {
                            if (within(current, binding.owner.value)) {
                                reportError(miscError(current, `Can't reference "${current.name}" in its own initialization`))
                            } else {
                                const decl = [...ancestors(current)].find(a => a.kind === binding.owner.kind)

                                if (decl) {
                                    if ((declarations as unknown[]).indexOf(binding.owner) > (declarations as unknown[]).indexOf(decl)) {
                                        reportError(miscError(current, `Can't reference "${current.name}" before initialization`))
                                    }
                                }
                            }
                        }
                    }
                } else {
                    reportError(cannotFindName(current, current.name))
                }
            } break;
            case "assignment": {

                // if assigning directly to variable, make sure it isn't a constant
                const resolved = current.target.kind === "local-identifier" ? resolve(current.target.name, current.target) : undefined
                if (current.target.kind === "local-identifier" && resolved != null && getBindingMutability(resolved, current.target) !== "assignable") {
                    reportError(miscError(current.target, `Cannot assign to '${current.target.name}' because it's constant`));
                }

                // if assigning into object or array, make sure the subject isn't immutable
                if (current.target.kind === "property-accessor" || current.target.kind === "indexer") {
                    const subjectType = resolveType(inferType(current.target.subject))
                    if (subjectType.mutability !== "mutable") {
                        reportError(miscError(current.target, `Cannot assign to '${format(current.target)}' because '${format(current.target.subject)}' is constant`));
                    }
                }

                const targetType = inferType(current.target);
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
                    (_, val) => `Expected iterator after "of" in for loop; found '${format(val)}'`)
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
                    const resolved = resolveType(spread)

                    if (!subsumes(RECORD_OF_ANY, resolved)) {
                        reportError(miscError(spread, `${format(resolved)} is not an object type; can only spread object types into object types`))
                    }
                }
            } break;
            case "instance-of": {
                const exprType = resolveType(inferType(current.expr))

                if (!subsumes(exprType, current.type)) {
                    reportError(miscError(current, `This check will always be false, because ${format(current.expr)} can never be a ${format(current.type)}`))
                } else if (typesEqual(resolveType(exprType), resolveType(current.type))) {
                    reportError(miscError(current, `This check will always be true, because ${format(current.expr)} will always be a ${format(current.type)}`))
                }
            } break;
            case "generic-type": {
                const seen = new Map<string, PlainIdentifier>()
                const duplicates = new Set<PlainIdentifier>()

                for (const { name } of current.typeParams) {
                    const existing = seen.get(name.name)
                    if (existing) {
                        duplicates.add(existing)
                        duplicates.add(name)
                    } else {
                        seen.set(name.name, name)
                    }
                }

                for (const duplicate of duplicates) {
                    reportError(alreadyDeclared(duplicate))
                }
            } break;
            case "keyof-type":
            case "valueof-type":
                if (!subsumes(RECORD_OF_ANY, current.inner)) {
                    const keyword = current.kind === 'keyof-type' ? 'keyof' : 'valueof'
                    reportError(miscError(current, `${keyword} can only be used on object types; found ${format(current.inner)}`))
                }
                break;
            case "elementof-type":
                if (!subsumes(ARRAY_OF_ANY, current.inner)) {
                    reportError(miscError(current, `elementof can only be used on array types; found ${format(current.inner)}`))
                }
                break;
            case "bound-generic-type": {
                const resolvedGeneric = resolveType(current.generic)

                if (resolvedGeneric.kind !== 'generic-type') {
                    reportError(miscError(current, 'Can only bind type arguments to a generic type'))
                }
            } break;
            case "if-else-expression":
            case "if-else-statement":
            case "while-loop":
            case "negation-operator":
            case "js-proc":
            case "js-func":
            case "test-block-declaration":
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
            case "type-declaration":
            case "proc-declaration":
            case "func-declaration":
            case "typeof-type":
                break;
            default:
                // @ts-expect-error: exhaustiveness
                throw Error(current.kind)
        }        
    }
}

function expect(reportError: ReportError, destinationType: TypeExpression, value: Expression, generateMessage?: (dest: TypeExpression, val: TypeExpression) => string) {
    const inferredType = inferType(value);
    if (!subsumes(destinationType, inferredType)) {
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
export function subsumes(destination: TypeExpression, value: TypeExpression): boolean {

    if (destination === value) {
        return true;
    }

    const resolvedDestination = resolveType(destination)
    const resolvedValue = resolveType(value)

    // constants can't be assigned to mutable slots
    if (resolvedDestination.mutability === "mutable" && (resolvedValue.mutability !== "mutable" && resolvedValue.mutability !== "literal")) {
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
                    subsumes(destinationMember, valueMember)));
        } else {
            return resolvedDestination.members.some(member => 
                subsumes(member, resolvedValue));
        }
    } else if (resolvedValue.kind === "union-type") {
        return resolvedValue.members.every(member =>
            subsumes(resolvedDestination, member));
    } else if(typesEqual(resolvedDestination, resolvedValue)) {
        return true;
    } else if (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type" 
            && resolvedValue.args.length <= resolvedDestination.args.length
            && resolvedDestination.args.every((_, i) => 
                // NOTE: Value and destination are flipped on purpose for args!
                subsumes(resolvedValue.args[i]?.type ?? UNKNOWN_TYPE, resolvedDestination.args[i]?.type ?? UNKNOWN_TYPE))
            && subsumes(resolvedDestination.returnType ?? UNKNOWN_TYPE, resolvedValue.returnType ?? UNKNOWN_TYPE)) {
        return true;
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" 
            && resolvedValue.args.length <= resolvedDestination.args.length
            && resolvedDestination.args.every((_, i) => 
                // NOTE: Value and destination are flipped on purpose for args!
                subsumes(resolvedValue.args[i]?.type ?? UNKNOWN_TYPE, resolvedDestination.args[i]?.type ?? UNKNOWN_TYPE))) {
        return true;
    } else if (resolvedDestination.kind === "array-type") {
        if (resolvedValue.kind === "array-type") {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return subsumes(resolvedDestination.element, resolvedValue.element)
            } else {
                return typesEqual(resolvedDestination.element, resolvedValue.element)
            }
        }
        if (resolvedValue.kind === 'tuple-type') {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return resolvedValue.members.every(member =>
                    subsumes(resolvedDestination.element, member))
            }
        }
    } else if (resolvedDestination.kind === "tuple-type") {
        if (resolvedValue.kind === 'tuple-type') {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return resolvedValue.members.length === resolvedDestination.members.length
                    && resolvedValue.members.every((member, index) =>
                        subsumes(resolvedDestination.members[index], member))
            } else {
                return resolvedValue.members.length === resolvedDestination.members.length
                    && resolvedValue.members.every((member, index) =>
                        typesEqual(resolvedDestination.members[index], member))
            }
        }
    } else if (resolvedDestination.kind === "record-type") {
        if (resolvedValue.kind === "record-type") {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return subsumes(resolvedDestination.keyType, resolvedValue.keyType)
                    && subsumes(resolvedDestination.valueType, resolvedValue.valueType)
            } else {
                return typesEqual(resolvedDestination.keyType, resolvedValue.keyType)
                    && typesEqual(resolvedDestination.valueType, resolvedValue.valueType)
            }
        }
        if (resolvedValue.kind === "object-type") {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                // TODO: Spreads
                return resolvedValue.entries.every(({ name, type }) =>
                    subsumes(resolvedDestination.keyType, { kind: 'literal-type', value: { kind: 'exact-string-literal', value: name.name, ...AST_NOISE }, ...TYPE_AST_NOISE }) &&
                    subsumes(resolvedDestination.valueType, type))
            }
        }
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        // TODO: Spreads
        const destinationEntries = propertiesOf(resolvedDestination)
        const valueEntries =       propertiesOf(resolvedValue)

        return (
            destinationEntries?.every(({ name: key, type: destinationValue, optional }) => {
                const valueEntry = valueEntries?.find(e => e.name.name === key.name)

                if (valueEntry == null) {
                    return optional
                } else {
                    return subsumes( destinationValue, valueEntry.type)
                }
            }) === true
        );
    } else if ((resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") ||
                (resolvedDestination.kind === "plan-type" && resolvedValue.kind === "plan-type") ||
                (resolvedDestination.kind === "error-type" && resolvedValue.kind === "error-type") ||
                (resolvedDestination.kind === "remote-type" && resolvedValue.kind === "remote-type")) {
        return subsumes(resolvedDestination.inner, resolvedValue.inner);
    } else if (resolvedDestination.kind === 'nominal-type' && resolvedValue.kind === 'nominal-type') {
        return resolvedDestination.name === resolvedValue.name;
    }

    return false;
}

/**
 * Determine whether or not two types have any overlap at all
 */
export function overlaps(a: TypeExpression, b: TypeExpression): boolean {
    const resolvedA = resolveType(a)
    const resolvedB = resolveType(b)

    if (subsumes(resolvedA, resolvedB) || subsumes(resolvedB, resolvedA)) {
        return true
    } else if (resolvedA.kind === 'union-type' && resolvedB.kind === 'union-type') {
        return resolvedA.members.some(memberA => resolvedB.members.some(memberB => overlaps(memberA, memberB)))
    } else if (resolvedA.kind === 'union-type') {
        return resolvedA.members.some(memberA => overlaps(memberA, resolvedB))
    } else if (resolvedB.kind === 'union-type') {
        return resolvedB.members.some(memberB => overlaps(memberB, resolvedA))
    }

    return false
}

/**
 * Resolve named types, unpack parenthesized types, bind generic types, 
 * simplify unions; generally collapse a type into its "real" form, whatever 
 * that means.
 */
export function resolveType(type: TypeExpression): TypeExpression {
    switch (type.kind) {
        case "named-type": {
            const binding = resolve(type.name.name, type.name)

            if (binding) {
                if (binding.owner.kind === 'type-declaration') {
                    return resolveType(binding.owner.type)
                }
    
                if (binding.owner.kind === 'generic-param-type') {
                    return resolveType(binding.owner)
                }
            }

            return UNKNOWN_TYPE
        }
        case "generic-param-type":
            return resolveType(type.extends ?? UNKNOWN_TYPE)
        case "parenthesized-type":
            return resolveType(type.inner)
        case "typeof-type":
            return inferType(type.expr)
        case "keyof-type": {
            const inner = resolveType(type.inner)

            if (inner.kind === 'record-type') {
                return inner.keyType
            } else if (inner.kind === 'object-type') {
                const { parent, module, code, startIndex, endIndex } = type

                return {
                    kind: 'union-type',
                    members: inner.entries.map(entry => {
                        const { parent, module, code, startIndex, endIndex } = entry.name

                        return {
                            kind: 'literal-type',
                            value: {
                                kind: 'exact-string-literal',
                                value: entry.name.name,
                                parent, module, code, startIndex, endIndex
                            },
                            mutability: undefined,
                            parent, module, code, startIndex, endIndex
                        }
                    }),
                    mutability: undefined,
                    parent, module, code, startIndex, endIndex
                }
            } else {
                return UNKNOWN_TYPE
            }
        }
        case "valueof-type": {
            const inner = resolveType(type.inner)
            
            if (inner.kind === 'record-type') {
                return inner.valueType
            } else if (inner.kind === 'object-type') {
                const { parent, module, code, startIndex, endIndex } = type

                return {
                    kind: 'union-type',
                    members: inner.entries.map(entry => entry.type),
                    mutability: undefined,
                    parent, module, code, startIndex, endIndex
                }
            } else {
                return UNKNOWN_TYPE
            }
        }
        case "elementof-type": {
            const inner = resolveType(type.inner)
            
            if (inner.kind === 'array-type') {
                return inner.element
            } else if (inner.kind === 'tuple-type') {
                const { parent, module, code, startIndex, endIndex } = type

                return {
                    kind: 'union-type',
                    members: inner.members,
                    mutability: undefined,
                    parent, module, code, startIndex, endIndex
                }
            } else {
                return UNKNOWN_TYPE
            }
        }
        case "error-type":
        case "remote-type":
        case "iterator-type": {
            return {
                ...type,
                inner: resolveType(type.inner)
            }
        }
        case "plan-type": {
            let inner = type.inner
            while (inner.kind === 'plan-type') {
                inner = inner.inner
            }

            return {
                ...type,
                inner: resolveType(inner)
            }
        }
        case "maybe-type": {
            const { parent, module, code, startIndex, endIndex } = type

            return resolveType({
                kind: "union-type",
                members: [
                    type.inner,
                    NIL_TYPE
                ],
                mutability: undefined,
                parent, module, code, startIndex, endIndex
            })
        }
        case "bound-generic-type": {
            const resolvedGeneric = resolveType(type.generic)

            if (resolvedGeneric.kind !== 'generic-type') {
                return UNKNOWN_TYPE
            } else {
                return resolveType(parameterizedGenericType(resolvedGeneric, type.typeArgs))
            }
        }
        case "union-type": {
            const resolved = {
                ...type,
                members: type.members.map(resolveType)
            }

            const simplified = simplifyUnions(resolved)

            if (simplified.kind === 'union-type') {
                return simplified
            } else {
                return resolveType(simplified)
            }
        }
        case "array-type": {
            return {
                ...type,
                element: resolveType(type.element)
            }
        }
        case "tuple-type": {
            return {
                ...type,
                members: type.members.map(resolveType)
            }
        }
        case "record-type": {
            return {
                ...type,
                keyType: resolveType(type.keyType),
                valueType: resolveType(type.valueType)
            }
        }
        case "object-type": {
            return {
                ...type,
                entries: type.entries.map(entry => ({
                    ...entry,
                    type: resolveType(entry.type)
                }))
            }
        }
        case "property-type": {
            const subjectType = resolveType(type.subject)
            const nilTolerantSubjectType = type.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(subjectType, NIL_TYPE)
                : subjectType;
            const property = propertiesOf(nilTolerantSubjectType)?.find(entry => entry.name.name === type.property.name)
            
            const { parent, module, code, startIndex, endIndex } = type
            if (type.optional && property) {
                return resolveType({
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
                    given(property, property => resolveType((
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
