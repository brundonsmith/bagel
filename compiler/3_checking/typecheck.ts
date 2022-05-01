import { AST, Block, Module, PlainIdentifier } from "../_model/ast.ts";
import { ARRAY_OF_ANY, BOOLEAN_TYPE, ELEMENT_TAG_CHILD_TYPE, FuncType, GenericFuncType, GenericProcType, GenericType, ITERATOR_OF_ANY, NIL_TYPE, NUMBER_TYPE, RECORD_OF_ANY, ProcType, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE, ERROR_OF_ANY, NamedType, PLAN_OF_ANY, VALID_RECORD_KEY, PlanType } from "../_model/type-expressions.ts";
import { exists, given, iesOrY } from "../utils/misc.ts";
import { alreadyDeclared, assignmentError,BagelError,cannotFindModule,cannotFindName,miscError } from "../errors.ts";
import { propertiesOf, inferType, subtract, bindInvocationGenericArgs, parameterizedGenericType, simplifyUnions, invocationFromMethodCall, BINARY_OPERATOR_TYPES, throws } from "./typeinfer.ts";
import { getBindingMutability, ModuleName, ReportError } from "../_model/common.ts";
import { ancestors, findAncestor, getName, iterateParseTree, literalType, maybeOf, planOf, typesEqual, within } from "../utils/ast.ts";
import { getConfig, getModuleByName } from "../store.ts";
import { DEFAULT_OPTIONS, format } from "../other/format.ts";
import { ExactStringLiteral, Expression, InlineConstGroup } from "../_model/expressions.ts";
import { resolve, resolveImport } from "./resolve.ts";
import { ImportDeclaration, ValueDeclaration } from "../_model/declarations.ts";
import { computedFn } from "../../lib/ts/reactivity.ts";

const msgFormat = (ast: AST) => format(ast, { ...DEFAULT_OPTIONS, lineBreaks: false })


export const typeerrors = computedFn(function typeerrors (ast: Module): BagelError[] {
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
    const config = getConfig()
    
    for (const { current, parent } of iterateParseTree(ast)) {
            
        switch(current.kind) {
            case "import-all-declaration":
            case "import-declaration": {
                const otherModule = getModuleByName(current.module as ModuleName, current.path.value)

                if (otherModule == null) {
                    // other module doesn't exist
                    reportError(cannotFindModule(current.path))
                }
            } break;
            case "import-item": {
                const imported = resolveImport(current)

                if (imported) {
                    if (imported == null) {
                        reportError(miscError(current, `Can't find declaration '${current.name.name}' in module '${(current.parent as ImportDeclaration).path.value}'`))
                    } else if(!imported.exported) {
                        reportError(miscError(current, `Declaration '${current.name.name}' exists in module '${(current.parent as ImportDeclaration).path.value}' but is not exported`))
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

                // check against re-declarations of symbols
                const seen = new Map<string, PlainIdentifier>()
                const duplicates = new Set<PlainIdentifier>()

                for (const stmt of current.statements) {
                    const names = (() => {
                        switch(stmt.kind) {
                            case "declaration-statement":
                                if (stmt.destination.kind === 'name-and-type') {
                                    return [stmt.destination.name]
                                } else {
                                    return stmt.destination.properties
                                }
                            case "invocation":
                            case "if-else-statement":
                            case "for-loop":
                            case "while-loop":
                            case "assignment":
                            case "javascript-escape":
                            case "try-catch":
                            case "throw-statement":
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


                if (current.parent?.kind === 'try-catch' && current === current.parent.tryBlock) {
                    // shouldn't use ? inside try-blocks
                    for (const stmt of current.statements) {
                        if (stmt.kind === 'invocation' && stmt.bubbles) {
                            reportError(miscError(stmt, `Don't use '?' operator inside try-blocks; errors here are caught, and don't bubble up to the outer proc`))
                        }
                    }
                } else {
                    for (const stmt of current.statements) {
                        if (stmt.kind === 'invocation' && !stmt.bubbles) {
                            const procType = inferType(stmt.subject)

                            if (procType.kind === 'proc-type') {
                                // check against "throwing" invocations without a ?
                                if (procType.throws && !stmt.bubbles) {
                                    reportError(miscError(stmt, `Proc calls that might throw an error must either be handled in a try-catch, or bubble their error up using '?'`))
                                }
                                // check against non-throwing invocations that do have a ?
                                if (!procType.throws && stmt.bubbles) {
                                    reportError(miscError(stmt, `This proc can't throw an error, so there's no reason to use '?' here`))
                                }
                            }
                        }
                    }
                }
            } break;
            case "inline-const-group": {
                const seen = new Map<string, PlainIdentifier>()
                const duplicates = new Set<PlainIdentifier>()

                for (const decl of current.declarations) {
                    const names = (
                        decl.destination.kind === 'name-and-type'
                            ? [decl.destination.name]
                            : decl.destination.properties
                    )

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
            case "declaration-statement":
            case "inline-declaration": {
                const declaredType = (
                    current.kind === 'value-declaration' ? current.type :
                    current.destination.kind === 'name-and-type' ? (
                        current.awaited
                            ? given(current.destination.type, planOf)
                            : current.destination.type
                    ) :
                    undefined
                )

                if (declaredType) {
                    expect(reportError, declaredType, current.value)
                }

                let valueType = resolveType(inferType(current.value))
                if (current.kind !== 'value-declaration' && current.awaited) {
                    if (subsumationIssues(PLAN_OF_ANY, valueType)) {
                        // make sure value is a plan
                        reportError(miscError(current.value, `Can only await expressions of type Plan; found type '${msgFormat(valueType)}'`))
                    } else {
                        valueType = (valueType as PlanType).inner
                    }
                }

                if (current.kind !== 'value-declaration' && current.destination.kind === 'destructure') {
                    if (current.destination.destructureKind === 'object') {
                        if (subsumationIssues(RECORD_OF_ANY, valueType)) {
                            reportError(miscError(current.value, `Can only destructure object types using '{ }'; found type '${msgFormat(valueType)}'`))
                        } else {
                            const objectProperties = propertiesOf(valueType)
                            for (const property of current.destination.properties) {
                                if (!objectProperties?.find(prop => getName(prop.name) === property.name)) {
                                    reportError(miscError(property, `Property '${property.name}' does not exist on type '${msgFormat(valueType)}'`))
                                }
                            }
                        }
                    } else {
                        if (subsumationIssues(ARRAY_OF_ANY, valueType)) {
                            reportError(miscError(current.value, `Can only destructure array or tuple types using '[ ]'; found type '${msgFormat(valueType)}'`))
                        } else {
                            const resolvedValueType = resolveType(valueType)
                            if (resolvedValueType.kind === 'tuple-type') {
                                for (let i = resolvedValueType.members.length; i < current.destination.properties.length; i++) {
                                    reportError(miscError(current.destination.properties[i], `Can't destructure element in index ${i}, because the provided tuple only has ${resolvedValueType.members.length} elements`))
                                }
                            }
                        }
                    }
                }
            } break;
            case "derive-declaration": {
                const exprType = resolveType(inferType(current.expr))
                const declaredType = current.type

                if (declaredType) {
                    // make sure value fits declared type, if there is one
                    given(subsumationIssues(declaredType, exprType), issues => {
                        reportError(assignmentError(current.expr, declaredType, exprType, issues))
                    })
                }
            } break;
            case "remote-declaration": {
                const exprType = resolveType(inferType(current.expr))
                const declaredType = current.type

                if (exprType.kind === 'plan-type') {
                    if (declaredType != null) {
                        // make sure value fits declared type, if there is one
                        given(subsumationIssues(declaredType, exprType.inner), issues => {
                            reportError(assignmentError(current.expr, declaredType, exprType.inner, issues))
                        })
                    }
                } else {
                    // make sure value is a plan
                    reportError(miscError(current.expr, `Remote declarations must be defined with a Plan expression; found type '${msgFormat(exprType)}'`))
                }
            } break;
            case "test-expr-declaration": {
                // make sure test value is a boolean
                expect(reportError, BOOLEAN_TYPE, current.expr)
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
                    if (subsumationIssues(leftType, rightType) 
                     && subsumationIssues(rightType, leftType)) {
                        reportError(miscError(current, `Can't compare types '${msgFormat(leftType)}' and '${msgFormat(rightType)}' because they have no overlap`))
                    }
                } else if (current.op.op !== '??' && current.op.op !== '&&' && current.op.op !== '||') {
                    const types = BINARY_OPERATOR_TYPES[current.op.op]?.find(({ left, right }) =>
                        !subsumationIssues(left, leftType) && 
                        !subsumationIssues(right, rightType))

                    if (types == null) {
                        reportError(miscError(current.op, `Operator '${current.op.op}' cannot be applied to types '${msgFormat(leftType)}' and '${msgFormat(rightType)}'`));
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
                            if (resolvedType.inner) {
                                expect(reportError, resolvedType.inner, current.args[0])
                            } else {
                                reportError(miscError(current.args[0] ?? current, `Nominal type ${current.subject.name} doesn't have an inner value`))
                            }
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
                    reportError(miscError(invocation.subject, `Expression must be a function or procedure to be called; '${msgFormat(invocation.subject)}' is of type '${msgFormat(subjectType)}'`));
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

                        const extendsType = typeParam?.extends
                        
                        if (typeParam && typeArg && extendsType) {
                            given(subsumationIssues(extendsType, typeArg), issues => {
                                reportError(assignmentError(typeArg, extendsType, typeArg, issues))
                            })
                        }
                    }
                }
            } break;
            case "switch-expression": {
                const valueType = inferType(current.value)
                let remainingType = valueType

                for (const { type } of current.cases) {
                    const isFirst = type === current.cases[0]?.type

                    // check that no cases are redundant
                    if (subsumationIssues(remainingType, type)) {
                        const neverEver = isFirst || subsumationIssues(valueType, type)
                        reportError(miscError(type, `${msgFormat(current.value)} can never be a ${msgFormat(type)}${neverEver ?  '' : ' at this point'}, so this case will never be reached`))
                    }
                    
                    remainingType = subtract(remainingType, type)
                }

                const finalType = resolveType(remainingType)
                if (current.defaultCase == null && finalType.kind !== 'never-type') {
                    // if no default case, check that arms are exhaustive
                    reportError(miscError(current, `Switch expression doesn't handle all possible values; ${msgFormat(current.value)} can still be a '${msgFormat(remainingType)}'. Either add cases to cover the rest of the possible values, or add a default case.`))
                } else if (current.defaultCase != null && finalType.kind === 'never-type') {
                    // if default case, check that arms are *not* exhaustive
                    reportError(miscError(current.defaultCase, `Default case will never be reached, because all possible values for ${msgFormat(current.value)} are covered by cases above`))
                }
            } break;
            case "property-accessor": {
                const isMethodCall = current.parent?.kind === 'invocation' && invocationFromMethodCall(current.parent) != null

                if (!isMethodCall) {
                    const subjectType = resolveType(inferType(current.subject))
                    const property = current.property

                    const nillable = subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")

                    if (nillable && !current.optional) {
                        reportError(miscError(current.property, `Can't access properties on '${format(subjectType)}' without an optional-chaining operator (".?"), because it is potentially nil`))
                    }

                    const subjectProperties = current.optional && nillable
                        ? propertiesOf(subtract(subjectType, NIL_TYPE))
                        : propertiesOf(subjectType)


                    if (property.kind === 'plain-identifier' || property.kind === 'exact-string-literal') {
                        if (subjectProperties == null) {
                            // TODO: I don't think this allows accessing record properties with dot
                            reportError(miscError(current.subject, `Can only use dot operator (".") on objects with properties (value is of type "${msgFormat(subjectType)}")`));
                        } else if (!subjectProperties.some(p => getName(p.name) === getName(property))) {
                            reportError(miscError(property, `Property '${getName(property)}' does not exist on type '${msgFormat(subjectType)}'`));
                        }
                    } else {
                        const indexType = resolveType(inferType(property))

                        if (subjectProperties && indexType.kind === "literal-type" && indexType.value.kind === "exact-string-literal") {
                            const key = indexType.value.value;
                            const valueType = subjectProperties?.find(entry => getName(entry.name) === key)?.type;
                            
                            if (valueType == null) {
                                reportError(miscError(property, `Property '${key}' doesn't exist on type '${msgFormat(subjectType)}'`));
                            }
                        } else if (subjectType.kind === "record-type") {
                            expect(reportError, subjectType.keyType, property,
                                (_, val) => `Expression of type '${msgFormat(val)}' can't be used to index type '${msgFormat(subjectType)}'`)
                        } else if (subjectType.kind === "array-type" || subjectType.kind === "string-type" || subjectType.kind === "tuple-type" || (subjectType.kind === 'literal-type' && subjectType.value.kind === 'exact-string-literal')) {
                            expect(reportError, NUMBER_TYPE, property,
                                (_, val) => `Expression of type '${msgFormat(val)}' can't be used to index type '${msgFormat(subjectType)}'`)
    
                            if (subjectType.kind === "tuple-type" || (subjectType.kind === 'literal-type' && subjectType.value.kind === 'exact-string-literal')) {
                                const max = subjectType.kind === 'tuple-type' ? subjectType.members.length : (subjectType.value as ExactStringLiteral).value.length
    
                                if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal' && (indexType.value.value < 0 || indexType.value.value >= max)) {
                                    reportError(miscError(property, `Index ${indexType.value.value} is out of range on type '${msgFormat(subjectType)}'`));
                                }
                            }
                        } else {
                            reportError(miscError(property, `Expression of type '${msgFormat(indexType)}' can't be used to index type '${msgFormat(subjectType)}'`));
                        }
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
                    (dest, val) => `Expression of type ${msgFormat(val)} cannot be expanded to type ${msgFormat(dest)}`)

                if (typesEqual(resolveType(current.type), resolveType(inferType(current.inner)))) {
                    reportError(miscError(current, `Casting here is redundant, because ${msgFormat(current.inner)} is already of type ${msgFormat(current.type)}`))
                }
            } break;
            case "named-type": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                const binding = resolve(current.name.name, current, true)

                if (!binding) {
                    reportError(cannotFindName(current, current.name.name))
                } else {
                    if (binding.owner?.kind !== 'type-declaration' && binding.owner?.kind !== 'generic-param-type') {
                        reportError(miscError(current, `'${current.name.name}' is not a type`))
                    }
                }
            } break;
            case "local-identifier": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                const binding = resolve(current.name, current, true)?.owner

                if (binding) {
                    if (binding.kind === 'value-declaration' || 
                        binding.kind === 'declaration-statement' ||
                        binding.kind === 'inline-declaration') {

                        // using a let-declaration to initialize a const
                        if (binding.kind === 'value-declaration' && 
                            !binding.isConst &&
                            (findAncestor(current, a => a.kind === 'value-declaration') as ValueDeclaration|undefined)?.isConst) {
                            
                            reportError(miscError(current, `Const declarations cannot be initialized from mutable state (referencing '${msgFormat(current)}')`))
                        }

                        const declarations = (
                            binding.kind === 'value-declaration' ?     (binding.parent as Module).declarations :
                            binding.kind === 'declaration-statement' ? (binding.parent as Block).statements :
                            binding.kind === 'inline-declaration' ?    (binding.parent as InlineConstGroup).declarations :
                            undefined
                        )

                        if (declarations) {
                            if (within(current, binding.value)) {
                                reportError(miscError(current, `Can't reference "${current.name}" in its own initialization`))
                            } else {
                                const decl = [...ancestors(current)].find(a => a.kind === binding.kind)

                                if (decl) {
                                    if ((declarations as unknown[]).indexOf(binding) > (declarations as unknown[]).indexOf(decl)) {
                                        reportError(miscError(current, `Can't reference "${current.name}" before initialization`))
                                    }
                                }
                            }
                        }
                    } else if (binding.kind === 'type-declaration') {
                        if (binding.type.kind !== 'nominal-type') { // nominals with no inner value are allowed here
                            reportError(miscError(current, `'${current.name}' is a type, but it's used like a value`))
                        }
                    } else if (config?.platforms && (binding.kind === 'proc-declaration' || binding.kind === 'func-declaration')) {
                        const unmetPlatforms = config.platforms.filter(platform => !binding.platforms.includes(platform))

                        if (unmetPlatforms.length > 0) {
                            reportError(miscError(current, `Project is configured to target platforms ${config.platforms.join(', ')}, but '${current.name}' is only supported in ${binding.platforms.join(', ')}`))
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
                if (current.target.kind === "property-accessor") {
                    const subjectType = resolveType(inferType(current.target.subject))
                    if (subjectType.mutability !== "mutable") {
                        reportError(miscError(current.target, `Cannot assign to '${msgFormat(current.target)}' because '${msgFormat(current.target.subject)}' is immutable`));
                    }
                }

                const targetType = inferType(current.target);
                expect(reportError, targetType, current.value)
            } break;
            case "range":
                expect(reportError, NUMBER_TYPE, current.start, 
                    (_, val) => `Expected number for start of range; got '${msgFormat(val)}'`)
                expect(reportError, NUMBER_TYPE, current.end, 
                    (_, val) => `Expected number for end of range; got '${msgFormat(val)}'`)
                break;
            case "for-loop":
                expect(reportError, ITERATOR_OF_ANY, current.iterator, 
                    (_, val) => `Expected iterator after "of" in for loop; found '${msgFormat(val)}'`)
                break;
            case "try-catch": {
                const thrown = throws(current.tryBlock)

                if (thrown.length === 0) {
                    reportError(miscError(current.tryBlock, `try/catch is redundant; no errors can be thrown in this block`))
                }
            } break;
            case "throw-statement":
                expect(reportError, ERROR_OF_ANY, current.errorExpression,
                    (_, val) => `Can only thow Errors; this is a '${msgFormat(val)}'`)
                break;
            case "element-tag": {
                for (const child of current.children) {
                    expect(reportError, ELEMENT_TAG_CHILD_TYPE, child)
                }
            } break;
            case "spread": {
                if (parent?.kind === 'object-literal') {
                    expect(reportError, RECORD_OF_ANY, current.expr, 
                        (_, val) => `Only objects can be spread into an object; found ${msgFormat(val)}`)
                } else if (parent?.kind === 'array-literal') {
                    expect(reportError, ARRAY_OF_ANY, current.expr, 
                        (_, val) => `Only arrays or tuples can be spread into an array; found ${msgFormat(val)}`)
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
                    if (subsumationIssues(RECORD_OF_ANY, spread)) {
                        reportError(miscError(spread, `${msgFormat(spread)} is not an object type; can only spread object types into object types`))
                    }
                }
            } break;
            case "instance-of": {
                const exprType = inferType(current.expr)

                if (subsumationIssues(exprType, current.type)) {
                    reportError(miscError(current, `This check will always be false, because ${msgFormat(current.expr)} can never be a ${msgFormat(current.type)}`))
                } else if (typesEqual(resolveType(exprType), resolveType(current.type))) {
                    reportError(miscError(current, `This check will always be true, because ${msgFormat(current.expr)} will always be a ${msgFormat(current.type)}`))
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
                if (subsumationIssues(RECORD_OF_ANY, current.inner)) {
                    const keyword = current.kind === 'keyof-type' ? 'keyof' : 'valueof'
                    reportError(miscError(current, `${keyword} can only be used on object types; found ${msgFormat(current.inner)}`))
                }
                break;
            case "elementof-type":
                if (subsumationIssues(ARRAY_OF_ANY, current.inner)) {
                    reportError(miscError(current, `elementof can only be used on array types; found ${msgFormat(current.inner)}`))
                }
                break;
            case "bound-generic-type": {
                const resolvedGeneric = resolveType(current.generic)

                if (resolvedGeneric.kind !== 'generic-type') {
                    reportError(miscError(current, 'Can only bind type arguments to a generic type'))
                }
            } break;
            case "object-entry":
                if (current.key.kind !== 'plain-identifier') {
                    expect(reportError, VALID_RECORD_KEY, current.key)
                }
                break;
            case "name-and-type":
            case "destructure":
            case "autorun-declaration":
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
    given(subsumationIssues(destinationType, inferredType), issues => {
        reportError(
            generateMessage
                ? miscError(value, generateMessage(destinationType, inferredType))
                : assignmentError(value, destinationType, inferredType, issues));
    })
}

/**
 * Determine whether `value` can "fit into" `destination`. Used for verifying 
 * values passed to consts, arguments, etc, but for other things too.
 */
export function subsumationIssues(destination: TypeExpression, value: TypeExpression): Array<string | string[]> | undefined {

    if (destination === value) {
        return undefined;
    }

    const resolvedDestination = resolveType(destination.kind === 'named-type' ? resolveNamedType(destination) : destination, true)
    const resolvedValue = resolveType(value.kind === 'named-type' ? resolveNamedType(value) : value, true)

    const baseErrorMessage = `Type '${msgFormat(resolvedValue)}' is not assignable to type '${msgFormat(resolvedDestination)}'`
    const withBase = (inner: Array<string | string[]>) => [baseErrorMessage, ...inner]
    const all = (...inner: Array<ReturnType<typeof subsumationIssues>>): ReturnType<typeof subsumationIssues> =>
        given(emptyToUndefined(inner.filter(exists).flat()), withBase)

    // constants can't be assigned to mutable slots
    if (resolvedDestination.mutability === "mutable" && (resolvedValue.mutability !== "mutable" && resolvedValue.mutability !== "literal")) {
        return [
            baseErrorMessage,
            `Value with constant type '${msgFormat(value)}' can't be assigned to slot with mutable type '${msgFormat(destination)}'`
        ];
    }

    if (
        resolvedValue.kind === "javascript-escape-type" || 
        resolvedValue.kind === "any-type" || 
        resolvedDestination.kind === "any-type" || 
        resolvedDestination.kind === "unknown-type"
    ) {
        return undefined;
    } else if (resolvedValue.kind === "unknown-type") {
        return [baseErrorMessage];
    } else if (resolvedValue.kind === 'never-type' || resolvedDestination.kind === 'never-type') {
        return [baseErrorMessage];
    } else if (
        (resolvedDestination.kind === "number-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "number-literal") ||
        (resolvedDestination.kind === "string-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "exact-string-literal") ||
        (resolvedDestination.kind === "boolean-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "boolean-literal")
    ) {
        return undefined;
    } else if(resolvedDestination.kind === "union-type") {
        if (resolvedValue.kind === "union-type") {
            const subsumed = resolvedValue.members.every(valueMember => 
                resolvedDestination.members.some(destinationMember => 
                    !subsumationIssues(destinationMember, valueMember)));

            if (subsumed) {
                return undefined
            } else {
                return [baseErrorMessage]
            }
        } else {
            const subsumed = resolvedDestination.members.some(member => 
                !subsumationIssues(member, resolvedValue))
                
            if (subsumed) {
                return undefined
            } else {
                return [baseErrorMessage]
            }
        }
    } else if (resolvedValue.kind === "union-type") {
        return all(
            resolvedValue.members.map(member =>
                subsumationIssues(resolvedDestination, member))
            .filter(exists)
            .flat())
    } else if (resolvedDestination.kind === 'nominal-type' && resolvedValue.kind === 'nominal-type') {
        if (
            resolvedDestination.module != null && resolvedValue.module != null &&
            resolvedDestination.module === resolvedValue.module &&
            resolvedDestination.name === resolvedValue.name
        ) {
            return undefined
        } else {
            return [
                baseErrorMessage,
                `'${msgFormat(resolvedValue)}' and '${msgFormat(resolvedDestination)}' are different nominal types`
            ]
        }
    } else if(typesEqual(resolvedDestination, resolvedValue)) {
        return undefined;
    } else if (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type") {
        if (resolvedValue.args.length > resolvedDestination.args.length) {
            return [
                baseErrorMessage,
                `'${msgFormat(resolvedValue)}' requires ${resolvedValue.args.length} arguments, but '${msgFormat(resolvedDestination)}' is only provided with ${resolvedDestination.args.length}`
            ]
        } else {
            return all(
                ...resolvedDestination.args.map((_, i) => 
                    // NOTE: Value and destination are flipped on purpose for args!
                    subsumationIssues(resolvedValue.args[i]?.type ?? UNKNOWN_TYPE, resolvedDestination.args[i]?.type ?? UNKNOWN_TYPE)),
                subsumationIssues(resolvedDestination.returnType ?? UNKNOWN_TYPE, resolvedValue.returnType ?? UNKNOWN_TYPE)
            )
        }
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type") {
        if (resolvedValue.args.length > resolvedDestination.args.length) {
            return [
                baseErrorMessage,
                `'${msgFormat(resolvedValue)}' requires ${resolvedValue.args.length} arguments, but '${msgFormat(resolvedDestination)}' is only provided with ${resolvedDestination.args.length}`
            ]
        } else {
            return all(
                ...resolvedDestination.args.map((_, i) => 
                    // NOTE: Value and destination are flipped on purpose for args!
                    subsumationIssues(resolvedValue.args[i]?.type ?? UNKNOWN_TYPE, resolvedDestination.args[i]?.type ?? UNKNOWN_TYPE)))
        }
    } else if (resolvedDestination.kind === "array-type") {
        if (resolvedValue.kind === "array-type") {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return all(subsumationIssues(resolvedDestination.element, resolvedValue.element))
            } else {
                if (typesEqual(resolvedDestination.element, resolvedValue.element)) {
                    return undefined
                } else {
                    return [baseErrorMessage]
                }
            }
        }
        if (resolvedValue.kind === 'tuple-type') {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return all(...resolvedValue.members.map(member =>
                    subsumationIssues(resolvedDestination.element, member)))
            }
        }
    } else if (resolvedDestination.kind === "tuple-type") {
        if (resolvedValue.kind === 'tuple-type') {
            if (resolvedValue.members.length !== resolvedDestination.members.length) {
                return [
                    baseErrorMessage,
                    `'${resolvedDestination}' has exactly ${resolvedDestination.members.length} members, but '${resolvedValue.members.length}' has ${resolvedValue.members.length}`
                ]
            }
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return all(
                    ...resolvedValue.members.map((member, index) =>
                        subsumationIssues(resolvedDestination.members[index], member))
                )
            } else {
                if (resolvedValue.members.every((member, index) =>
                    typesEqual(resolvedDestination.members[index], member))) {
                    return undefined
                } else {
                    return [baseErrorMessage]
                }
            }
        }
    } else if (resolvedDestination.kind === "record-type") {
        if (resolvedValue.kind === "record-type") {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return all(
                    subsumationIssues(resolvedDestination.keyType, resolvedValue.keyType),
                    subsumationIssues(resolvedDestination.valueType, resolvedValue.valueType)
                )
            } else {
                if (typesEqual(resolvedDestination.keyType, resolvedValue.keyType) &&
                    typesEqual(resolvedDestination.valueType, resolvedValue.valueType)) {
                    return undefined
                } else {
                    return [baseErrorMessage]
                }
            }
        }
        if (resolvedValue.kind === "object-type") {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                // TODO: Spreads
                return all(...resolvedValue.entries.map(({ name, type }) => all(
                    subsumationIssues(resolvedDestination.keyType, literalType(name)),
                    subsumationIssues(resolvedDestination.valueType, type)
                )))
            }
        }
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        // TODO: Spreads
        const destinationEntries = propertiesOf(resolvedDestination)
        const valueEntries =       propertiesOf(resolvedValue)

        if (destinationEntries == null || valueEntries == null) {
            return [baseErrorMessage]
        }

        const missingProperties: string[] = []
        const propertyTypeIssues: Array<string | string[]> = []
        for (const { name: key, type: destinationValue, optional } of destinationEntries) {
            const valueEntry = valueEntries.find(e => getName(e.name) === getName(key))

            if (valueEntry == null) {
                if (!optional) {
                    missingProperties.push(getName(key))
                }
            } else {
                propertyTypeIssues.push(...all(subsumationIssues(destinationValue, valueEntry.type)) ?? [])
            }
        }
        const missingPropertiesMessage = missingProperties.length > 0
            ? [`Missing propert${iesOrY(missingProperties.length)} ${missingProperties.map(p => `'${p}'`).join(', ')} required by type '${msgFormat(resolvedDestination)}'`]
            : []

        const extraProperties: string[] = []
        // disallow passing object literals with unrecognized properties
        if (resolvedValue.mutability === 'literal') {
            for (const { name: key } of valueEntries) {
                if (!destinationEntries.some(e => getName(e.name) === getName(key))) {
                    extraProperties.push(getName(key))
                }
            }
        }
        const extraPropertiesMessage = extraProperties.length > 0
            ? [`Has propert${iesOrY(extraProperties.length)} ${extraProperties.map(p => `'${p}'`).join(', ')} not found on type '${msgFormat(resolvedDestination)}'`]
            : []

        if (missingPropertiesMessage || extraPropertiesMessage) {
            return all(
                missingPropertiesMessage,
                extraPropertiesMessage,
                propertyTypeIssues
            )
        }
    } else if ((resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") ||
                (resolvedDestination.kind === "plan-type" && resolvedValue.kind === "plan-type") ||
                (resolvedDestination.kind === "error-type" && resolvedValue.kind === "error-type") ||
                (resolvedDestination.kind === "remote-type" && resolvedValue.kind === "remote-type")) {
        return all(subsumationIssues(resolvedDestination.inner, resolvedValue.inner));
    }

    return [baseErrorMessage];
}

const emptyToUndefined = (arr: ReturnType<typeof subsumationIssues>): ReturnType<typeof subsumationIssues> =>
    arr?.length === 0 ? undefined : arr?.filter(el => el.length > 0)

/**
 * Determine whether or not two types have any overlap at all
 */
export function overlaps(a: TypeExpression, b: TypeExpression): boolean {
    const resolvedA = resolveType(a)
    const resolvedB = resolveType(b)

    if (!subsumationIssues(resolvedA, resolvedB) || !subsumationIssues(resolvedB, resolvedA)) {
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
export function resolveType(type: TypeExpression, skipNamed?: boolean): TypeExpression {
    switch (type.kind) {
        case "named-type": {
            if (skipNamed) {
                return type
            } else {
                const binding = resolve(type.name.name, type.name)

                if (binding) {
                    if (binding.owner.kind === 'type-declaration') {
                        return resolveType(binding.owner.type, skipNamed)
                    }
        
                    if (binding.owner.kind === 'generic-param-type') {
                        return resolveType(binding.owner, skipNamed)
                    }

                    if (binding.owner.kind === 'import-item') {
                        const imported = resolveImport(binding.owner)

                        if (imported && imported.exported && imported.kind === 'type-declaration') {
                            return resolveType(imported.type, skipNamed)
                        }
                    }
                }

                return UNKNOWN_TYPE
            }
        }
        case "generic-param-type":
            return resolveType(type.extends ?? UNKNOWN_TYPE, skipNamed)
        case "parenthesized-type":
            return resolveType(type.inner, skipNamed)
        case "typeof-type":
            return inferType(type.expr)
        case "keyof-type": {
            const inner = resolveType(type.inner, skipNamed)

            if (inner.kind === 'record-type') {
                return inner.keyType
            } else if (inner.kind === 'object-type') {
                const { parent, module, code, startIndex, endIndex } = type

                return {
                    kind: 'union-type',
                    members: inner.entries.map(entry => 
                        literalType(entry.name)),
                    mutability: undefined,
                    parent, module, code, startIndex, endIndex
                }
            } else {
                return UNKNOWN_TYPE
            }
        }
        case "valueof-type": {
            const inner = resolveType(type.inner, skipNamed)
            
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
            const inner = resolveType(type.inner, skipNamed)
            
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
                inner: resolveType(type.inner, skipNamed)
            }
        }
        case "plan-type": {
            let inner = type.inner
            while (inner.kind === 'plan-type') {
                inner = inner.inner
            }

            return {
                ...type,
                inner: resolveType(inner, skipNamed)
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
            }, skipNamed)
        }
        case "bound-generic-type": {
            const resolvedGeneric = resolveType(type.generic, skipNamed)

            if (resolvedGeneric.kind !== 'generic-type') {
                return UNKNOWN_TYPE
            } else {
                return resolveType(parameterizedGenericType(resolvedGeneric, type.typeArgs), skipNamed)
            }
        }
        case "union-type": {
            const resolved = {
                ...type,
                members: type.members.map(m => resolveType(m, skipNamed))
            }

            const simplified = simplifyUnions(resolved)

            if (simplified.kind === 'union-type') {
                return simplified
            } else {
                return resolveType(simplified, skipNamed)
            }
        }
        case "array-type": {
            return {
                ...type,
                element: resolveType(type.element, skipNamed)
            }
        }
        case "tuple-type": {
            return {
                ...type,
                members: type.members.map(m => resolveType(m, skipNamed))
            }
        }
        case "record-type": {
            return {
                ...type,
                keyType: resolveType(type.keyType, skipNamed),
                valueType: resolveType(type.valueType, skipNamed)
            }
        }
        case "object-type": {
            return {
                ...type,
                entries: type.entries.map(entry => ({
                    ...entry,
                    type: resolveType(entry.type, skipNamed)
                }))
            }
        }
        case "property-type": {
            const subjectType = resolveType(type.subject, skipNamed)
            const nilTolerantSubjectType = type.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(subjectType, NIL_TYPE)
                : subjectType;
            const property = propertiesOf(nilTolerantSubjectType)?.find(entry => getName(entry.name) === type.property.name)
            
            if (type.optional && property) {
                return resolveType(maybeOf(property.type), skipNamed)
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
                                ?  maybeOf({ ...property.type, mutability } as TypeExpression)
                                : { ...property.type, mutability } as TypeExpression
                            ), skipNamed)) 
                        ?? UNKNOWN_TYPE
                )
            }
        }
    }

    return type
}

function resolveNamedType(type: NamedType): TypeExpression {
    const binding = resolve(type.name.name, type.name)

    if (binding) {
        if (binding.owner.kind === 'type-declaration') {
            return binding.owner.type
        }

        if (binding.owner.kind === 'generic-param-type') {
            return binding.owner
        }

        if (binding.owner.kind === 'import-item') {
            const imported = resolveImport(binding.owner)

            if (imported && imported.exported && imported.kind === 'type-declaration') {
                return imported.type
            }
        }
    }

    return UNKNOWN_TYPE
}
