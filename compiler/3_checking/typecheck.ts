import { AST, Module, PlainIdentifier } from "../_model/ast.ts";
import { ARRAY_OF_ANY, BOOLEAN_TYPE, FuncType, GenericFuncType, GenericProcType, GenericType, ITERATOR_OF_ANY, NIL_TYPE, NUMBER_TYPE, RECORD_OF_ANY, ProcType, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE, ERROR_OF_ANY, PLAN_OF_ANY, VALID_RECORD_KEY, PlanType, isEmptyType, UnionType, STRING_TYPE, STRING_OR_NUMBER_TYPE } from "../_model/type-expressions.ts";
import { exists, given, hlt, iesOrY } from "../utils/misc.ts";
import { alreadyDeclared, assignmentError,cannotFindModule,cannotFindName,miscError } from "../errors.ts";
import { propertiesOf, inferType, subtract, bindInvocationGenericArgs, parameterizedGenericType, throws } from "./typeinfer.ts";
import { Context, getBindingMutability, ModuleName } from "../_model/common.ts";
import { ancestors, argsBounds, elementOf, findAncestor, getName, invocationFromMethodCall, iterateParseTree, literalType, maybeOf, planOf, typesEqual, unionOf, within } from "../utils/ast.ts";
import { DEFAULT_OPTIONS, format } from "../other/format.ts";
import { ExactStringLiteral, Expression, Func, Proc } from "../_model/expressions.ts";
import { resolve, resolveImport } from "./resolve.ts";
import { ImportDeclaration, ValueDeclaration } from "../_model/declarations.ts";

const msgFormat = (ast: AST) => format(ast, { ...DEFAULT_OPTIONS, lineBreaks: false })

/**
 * Walk an entire AST and report all issues that we find
 */
export function typecheck(ctx: Pick<Context, 'allModules'|'sendError'|'config'|'canonicalModuleName'>, ast: Module): void {
    const { allModules, sendError, config, canonicalModuleName } = ctx

    // TODO: This needs to be broadened to factor in autoruns, even in non-entry modules in the project
    // if (entry != null && ast.module === entry) {
    //     if (!ast.declarations.some(decl => decl.kind === 'proc-declaration' && decl.name.name === 'main')) {
    //         sendError(miscError(ast, `Entry module doesn't have a proc named "main". Entry module is: ${entry}`))
    //     }
    // }

    for (const { current, parent } of iterateParseTree(ast)) {
            
        switch(current.kind) {
            case "import-all-declaration":
            case "import-declaration": {
                const otherModuleName = canonicalModuleName(current.module as ModuleName, current.path.value)
                const otherModule = allModules.get(otherModuleName)?.ast
                
                if (otherModule == null) {
                    // other module doesn't exist
                    sendError(cannotFindModule(current.path))
                }
            } break;
            case "import-item": {
                const imported = resolveImport(ctx, current)

                if (imported) {
                    if (imported == null) {
                        sendError(miscError(current, `Can't find declaration ${hlt(current.name.name)} in module ${hlt((current.parent as ImportDeclaration).path.value)}`))
                    } else if(!imported.exported) {
                        sendError(miscError(current, `Declaration ${hlt(current.name.name)} exists in module ${hlt((current.parent as ImportDeclaration).path.value)} but is not exported`))
                    }
                }
            } break;
            case "module": {

                // check against re-declarations of symbols
                const duplicates = findDuplicateIdentifiers(current.declarations, decl => {
                    switch (decl.kind) {
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
                        case "autorun":
                        case "test-expr-declaration":
                        case "test-block-declaration":
                        case "test-type-declaration":
                        case "debug":
                        case "javascript-escape":
                            return []
                        default:
                            // @ts-expect-error: exhaustiveness
                            throw Error(decl.kind)
                    }
                })

                for (const duplicate of duplicates) {
                    sendError(alreadyDeclared(duplicate))
                }
            } break;
            case "block": {

                // check against re-declarations of symbols
                const duplicates = findDuplicateIdentifiers(current.statements, stmt => {
                    switch(stmt.kind) {
                        case "declaration-statement":
                            if (stmt.destination.kind === 'name-and-type') {
                                return [
                                    stmt.destination.name
                                ]
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
                        case "autorun":
                            return []
                        default:
                            // @ts-expect-error: exhaustiveness
                            throw Error(stmt.kind)
                    }
                })

                for (const duplicate of duplicates) {
                    sendError(alreadyDeclared(duplicate))
                }


                if (current.parent?.kind === 'try-catch' && current === current.parent.tryBlock) {
                    // shouldn't use ? inside try-blocks
                    for (const stmt of current.statements) {
                        if (stmt.kind === 'invocation' && stmt.bubbles) {
                            sendError(miscError(stmt, `Don't use '?' operator inside try-blocks; errors here are caught, and don't bubble up to the outer proc`))
                        }
                    }
                } else {
                    for (const stmt of current.statements) {
                        if (stmt.kind === 'invocation' && !stmt.bubbles) {
                            const procType = inferType(ctx, stmt.subject)

                            if (procType.kind === 'proc-type') {
                                // check against "throwing" invocations without a ?
                                if (procType.throws && !stmt.bubbles) {
                                    sendError(miscError(stmt, `Proc calls that might throw an error must either be handled in a try-catch, or bubble their error up using '?'`))
                                }
                                // check against non-throwing invocations that do have a ?
                                if (!procType.throws && stmt.bubbles) {
                                    sendError(miscError(stmt, `This proc can't throw an error, so there's no reason to use '?' here`))
                                }
                            }
                        }
                    }
                }
            } break;
            case "inline-const-group": {
                const duplicates = findDuplicateIdentifiers(current.declarations, decl => 
                    decl.destination.kind === 'name-and-type'
                        ? [decl.destination.name]
                        : decl.destination.properties)

                for (const duplicate of duplicates) {
                    sendError(alreadyDeclared(duplicate))
                }
            } break
            case "value-declaration":
            case "declaration-statement":
            case "inline-declaration": {
                const declaredType = (
                    current.kind === 'value-declaration' ?
                        given(current.type, t =>
                            current.isConst && t.mutability != null
                            ? { ...t, mutability: 'constant' } as TypeExpression
                            : t) :
                    current.destination.kind === 'name-and-type' ? (
                        current.awaited
                            ? given(current.destination.type, planOf)
                            : current.destination.type
                    ) :
                    undefined
                )

                if (declaredType) {
                    expect(ctx, declaredType, current.value)
                }

                let valueType = resolveType(ctx, inferType(ctx, current.value))
                if (current.kind !== 'value-declaration' && current.awaited) {
                    {
                        const nearestFuncOrProc = getNearestFuncOrProc(current)

                        if (!nearestFuncOrProc == null) {
                            sendError(miscError(current, `Can only await within an async func or proc`))
                        } else if (!nearestFuncOrProc?.isAsync) {
                            sendError(miscError(current, `Containing ${nearestFuncOrProc?.kind} must be async to have await ${nearestFuncOrProc?.kind === 'func' ? 'expressions' : 'statements'}`))
                        }
                    }

                    if (subsumationIssues(ctx, PLAN_OF_ANY, valueType)) {
                        // make sure value is a plan
                        sendError(miscError(current.value, `Can only await expressions of type Plan; found type ${hlt(msgFormat(valueType))}`))
                    } else {
                        valueType = (valueType as PlanType).inner
                    }
                }

                if (current.kind !== 'value-declaration' && current.destination.kind === 'destructure') {
                    if (current.destination.destructureKind === 'object') {
                        if (subsumationIssues(ctx, RECORD_OF_ANY, valueType)) {
                            sendError(miscError(current.value, `Can only destructure object types using '{ }'; found type ${hlt(msgFormat(valueType))}`))
                        } else {
                            const objectProperties = propertiesOf(ctx, valueType)
                            for (const property of current.destination.properties) {
                                if (!objectProperties?.find(prop => getName(prop.name) === property.name)) {
                                    sendError(miscError(property, `Property ${hlt(property.name)} does not exist on type ${hlt(msgFormat(valueType))}`))
                                }
                            }
                        }
                    } else {
                        if (subsumationIssues(ctx, ARRAY_OF_ANY, valueType)) {
                            sendError(miscError(current.value, `Can only destructure array or tuple types using '[ ]'; found type ${hlt(msgFormat(valueType))}`))
                        } else {
                            const resolvedValueType = resolveType(ctx, valueType)
                            if (resolvedValueType.kind === 'tuple-type') {
                                for (let i = resolvedValueType.members.length; i < current.destination.properties.length; i++) {
                                    sendError(miscError(current.destination.properties[i], `Can't destructure element in index ${i}, because the provided tuple only has ${resolvedValueType.members.length} elements`))
                                }
                            }
                        }
                    }
                }
            } break;
            case "derive-declaration": {
                const exprType = resolveType(ctx, inferType(ctx, current.expr))
                const declaredType = current.type

                if (declaredType) {
                    // make sure value fits declared type, if there is one
                    given(subsumationIssues(ctx, declaredType, exprType), issues => {
                        sendError(assignmentError(current.expr, declaredType, exprType, issues))
                    })
                }
            } break;
            case "remote-declaration": {
                const exprType = resolveType(ctx, inferType(ctx, current.expr))
                const declaredType = current.type

                if (exprType.kind === 'plan-type') {
                    if (declaredType != null) {
                        // make sure value fits declared type, if there is one
                        given(subsumationIssues(ctx, declaredType, exprType.inner), issues => {
                            sendError(assignmentError(current.expr, declaredType, exprType.inner, issues))
                        })
                    }
                } else {
                    // make sure value is a plan
                    sendError(miscError(current.expr, `Remote declarations must be defined with a Plan expression; found type ${hlt(msgFormat(exprType))}`))
                }
            } break;
            case "test-expr-declaration": {
                // make sure test value might be an error
                const exprType = inferType(ctx, current.expr)

                expectType(ctx, current.expr, exprType, ERROR_OF_ANY, () =>
                    `Test is redundant; this expression won't ever be an Error`)
            } break;
            case "func":
            case "proc": {
                const inferred = inferType(ctx, current) as FuncType|ProcType|GenericFuncType|GenericProcType
                const funcOrProcType = inferred.kind === 'generic-type' ? inferred.inner : inferred

                if (current.kind === 'func' && funcOrProcType.kind === 'func-type' && funcOrProcType.returnType != null) {    
                    // make sure body expression fits declared return type, if there is one
                    expect(ctx, funcOrProcType.returnType, current.body)
                }
            } break;
            case "binary-operator": {
                const leftType = inferType(ctx, current.left)
                const rightType = inferType(ctx, current.right)

                const op = current.op.op
                switch (op) {
                    case '==':
                    case '!=':
                        if (subsumationIssues(ctx, leftType, rightType) 
                         && subsumationIssues(ctx, rightType, leftType)) {
                            sendError(miscError(current, `Can't compare types ${hlt(msgFormat(leftType))} and ${hlt(msgFormat(rightType))} because they have no overlap`))
                        }
                        break;
                    case '??':
                    case '&&':
                    case '||':
                        break;
                    default: {
                        const required = REQUIRED_OPERANDS[op]

                        if (subsumationIssues(ctx, required, leftType) || subsumationIssues(ctx, required, rightType)) {
                            sendError(miscError(current.op, `Operator ${hlt(current.op.op)} cannot be applied to types ${hlt(msgFormat(leftType))} and ${hlt(msgFormat(rightType))}`));
                        }
                    }
                }
            } break;
            case "invocation": {

                // Creation of nominal values looks like/parses as function 
                // invocation, but needs to be treated differently
                if (current.subject.kind === "local-identifier") {
                    const binding = resolve(ctx, current.subject.name, current.subject, true)
                        
                    if (binding?.owner.kind === 'type-declaration') {
                        const resolvedType = resolveType(ctx, binding.owner.type)
    
                        if (resolvedType.kind === "nominal-type") {
                            if (resolvedType.inner) {
                                expect(ctx, resolvedType.inner, current.args[0])
                            } else {
                                sendError(miscError(current.args[0] ?? current, `Nominal type ${hlt(current.subject.name)} doesn't have an inner value`))
                            }
                            break;
                        }
                    }
                }

                // method call
                const invocation = invocationFromMethodCall(ctx, current) ?? current;
                const resolvedSubject = resolveType(ctx, inferType(ctx, invocation.subject))

                // bound generic
                const subjectType = bindInvocationGenericArgs(ctx, invocation)

                if (subjectType == null) { // failed to bind
                    const subject = resolvedSubject as GenericType

                    if (invocation.typeArgs.length === 0) {
                        sendError(miscError(invocation, `Failed to infer generic type parameters; ${subject.typeParams.length} type arguments will need to be provided explicitly`))
                    } else if (subject.typeParams.length !== invocation.typeArgs.length) {
                        sendError(miscError(invocation, `Expected ${subject.typeParams.length} type arguments, but got ${invocation.typeArgs.length}`))
                    }

                    for (let i = 0; i < Math.min(subject.typeParams.length, invocation.typeArgs.length); i++) {
                        const constraint = subject.typeParams[i].extends
                        if (constraint && subsumationIssues(ctx, constraint, invocation.typeArgs[i])) {
                            sendError(miscError(invocation.typeArgs[i], `${hlt(msgFormat(invocation.typeArgs[i]))} is not a valid type argument for ${hlt(subject.typeParams[i].name.name)} because it doesn't match the extends clause (${hlt(msgFormat(constraint))})`))
                        }
                    }
                } else if ( // check that subject is callable
                    subjectType.kind !== "func-type" && subjectType.kind !== "proc-type" 
                && (subjectType.kind !== 'generic-type' || (subjectType.inner.kind !== 'func-type' && subjectType.inner.kind !== 'proc-type'))) {
                    sendError(miscError(invocation.subject, `Expression must be a function or procedure to be called; ${hlt(msgFormat(invocation.subject))} is of type ${hlt(msgFormat(subjectType))}`));
                } else {
                    const invoked = subjectType.kind === 'generic-type' ? subjectType.inner as FuncType|ProcType : subjectType
        
                    // if this is a statement
                    if (parent?.kind === 'block') {

                        // check that the call subject is a procedure
                        if (invoked.kind === 'func-type') {
                            sendError(miscError(invocation.subject, `Only procedures can be called as statements, not functions`))
                        } else {
                            const nearestFuncOrProc = getNearestFuncOrProc(current)
    
                            if (current.awaitedOrDetached) {
                                if (current.awaitedOrDetached === 'await') {
                                    if (nearestFuncOrProc == null) {
                                        sendError(miscError(current, `Can only await within an async proc`))
                                    } else if (!nearestFuncOrProc?.isAsync) {
                                        sendError(miscError(current, `Proc must be async to contain await`))
                                    }
                                }

                                if (!invoked.isAsync) {
                                    sendError(miscError(current, `Can only ${current.awaitedOrDetached} async procs`))
                                }
                            } else {
                                if (invoked.isAsync) {
                                    sendError(miscError(current, `Must await or detach calls to async procs`))
                                }
                            }
                        }
                    }

                    {
                        const minMaxArgs = argsBounds(ctx, invoked.args)

                        // check that the right number of arguments are passed
                        if (minMaxArgs != null && (invocation.args.length > minMaxArgs.max || invocation.args.length < minMaxArgs.min)) {
                            const functionOrProcedure = invoked.kind === "func-type" ? "Function" : "Procedure"
                            const argsStr = (
                                minMaxArgs.min !== minMaxArgs.max ? `${minMaxArgs.min}-${minMaxArgs.max}` :
                                minMaxArgs.min
                            )
                            sendError(miscError(invocation, `${functionOrProcedure} expected ${argsStr} arguments but got ${invocation.args.length}`));
                        }

                        // check that each argument matches the expected type
                        for (let i = 0; i < invocation.args.length; i++) {
                            const arg = invocation.args[i]

                            if (invoked.args.kind === 'args') {
                                const expectedType = invoked.args.args[i]?.type ?? UNKNOWN_TYPE
                                expect(ctx, expectedType, arg)
                            } else {
                                const resolvedSpreadType = resolveType(ctx, invoked.args.type)

                                if (resolvedSpreadType.kind === 'array-type') {
                                    expect(ctx, resolvedSpreadType.element, arg)
                                } else if (resolvedSpreadType.kind === 'tuple-type') {
                                    const expectedType = resolvedSpreadType.members[i] ?? UNKNOWN_TYPE
                                    expect(ctx, expectedType, arg)
                                }
                            }
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
                            given(subsumationIssues(ctx, extendsType, typeArg), issues => {
                                sendError(assignmentError(typeArg, extendsType, typeArg, issues))
                            })
                        }
                    }
                }
            } break;
            case "switch-expression": {
                const valueType = inferType(ctx, current.value)
                let remainingType = valueType

                for (const { type } of current.cases) {
                    const isFirst = type === current.cases[0]?.type

                    // check that no cases are redundant
                    expectType(ctx, type, remainingType, type, (_dest, val) => {
                        const neverEver = isFirst || subsumationIssues(ctx, valueType, val)
                        return `${hlt(msgFormat(current.value))} can never be a ${hlt(msgFormat(val))}${neverEver ?  '' : ' at this point'}, so this case will never be reached`
                    })
                    
                    remainingType = subtract(ctx, remainingType, type)
                }

                const finalType = resolveType(ctx, remainingType)
                if (current.defaultCase == null && !isEmptyType(finalType)) {
                    // if no default case, check that arms are exhaustive
                    sendError(miscError(current, `Switch expression doesn't handle all possible values; ${hlt(msgFormat(current.value))} can still be a ${hlt(msgFormat(remainingType))}. Either add cases to cover the rest of the possible values, or add a default case.`))
                } else if (current.defaultCase != null && isEmptyType(finalType)) {
                    // if default case, check that arms are *not* exhaustive
                    sendError(miscError(current.defaultCase, `Default case will never be reached, because all possible values for ${hlt(msgFormat(current.value))} are covered by cases above`))
                }
            } break;
            case "property-accessor": {
                const isMethodCall = current.parent?.kind === 'invocation' && invocationFromMethodCall(ctx, current.parent) != null

                if (!isMethodCall) {
                    const subjectType = resolveType(ctx, inferType(ctx, current.subject))
                    const property = current.property

                    const nillable = subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")

                    if (nillable && !current.optional) {
                        sendError(miscError(current.property, `Can't access properties on ${hlt(format(subjectType))} without an optional-chaining operator (".?"), because it is potentially nil`))
                    }

                    const effectiveSubjectType = current.optional && nillable
                        ? resolveType(ctx, subtract(ctx, subjectType, NIL_TYPE))
                        : subjectType

                    const subjectProperties = propertiesOf(ctx, effectiveSubjectType)


                    if (property.kind === 'plain-identifier') {
                        const { name } = property

                        if (effectiveSubjectType.kind === 'record-type') {
                            expectType(ctx, current.subject, effectiveSubjectType.keyType, literalType(name), () =>
                                `Property ${hlt(name)} will never be found on object with type ${hlt(msgFormat(subjectType))}`)
                        } else {
                            if (subjectProperties == null) {
                                sendError(miscError(current.subject, `Can only use dot operator (".") on objects with properties (value is of type ${hlt(msgFormat(subjectType))})`));
                            } else if (!subjectProperties.some(p => getName(p.name) === name)) {
                                sendError(miscError(property, `Property ${hlt(name)} does not exist on type ${hlt(msgFormat(subjectType))}`));
                            }
                        }
                    } else {
                        const indexType = resolveType(ctx, inferType(ctx, property))

                        if (subjectProperties && indexType.kind === "literal-type" && indexType.value.kind === "exact-string-literal") {
                            const key = indexType.value.value;
                            const valueType = subjectProperties?.find(entry => getName(entry.name) === key)?.type;
                            
                            if (valueType == null) {
                                sendError(miscError(property, `Property ${hlt(key)} doesn't exist on type ${hlt(msgFormat(subjectType))}`));
                            }
                        } else if (effectiveSubjectType.kind === "record-type") {
                            expect(ctx, effectiveSubjectType.keyType, property,
                                (_, val) => `Expression of type ${hlt(msgFormat(val))} can't be used to index type ${hlt(msgFormat(subjectType))}`)
                        } else if (
                            !subsumationIssues(ctx,
                                unionOf([
                                    ARRAY_OF_ANY,
                                    STRING_TYPE,
                                ]),
                                effectiveSubjectType)
                        ) {
                            expect(ctx, NUMBER_TYPE, property,
                                (_, val) => `Expression of type ${hlt(msgFormat(val))} can't be used to index type ${hlt(msgFormat(subjectType))}`)
    
                            if (effectiveSubjectType.kind === "tuple-type" || (effectiveSubjectType.kind === 'literal-type' && effectiveSubjectType.value.kind === 'exact-string-literal')) {
                                const max = effectiveSubjectType.kind === 'tuple-type' ? effectiveSubjectType.members.length : (effectiveSubjectType.value as ExactStringLiteral).value.length
    
                                if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal' && (indexType.value.value < 0 || indexType.value.value >= max)) {
                                    sendError(miscError(property, `Index ${indexType.value.value} is out of range on type ${hlt(msgFormat(subjectType))}`));
                                }
                            }
                        } else {
                            sendError(miscError(property, `Expression of type ${hlt(msgFormat(indexType))} can't be used to index type ${hlt(msgFormat(subjectType))}`));
                        }
                    }
                }
            } break;
            case "string-literal": {
                // check that all template insertions are allowed to be inserted
                for (const segment of current.segments) {
                    if (typeof segment !== "string") {
                        expect(ctx, STRING_TEMPLATE_INSERT_TYPE, segment)
                    }
                }
            } break;
            case "as-cast": {
                expect(ctx, current.type, current.inner,
                    (dest, val) => `Expression of type ${hlt(msgFormat(val))} cannot be expanded to type ${hlt(msgFormat(dest))}`)

                if (typesEqual(resolveType(ctx, current.type), resolveType(ctx, inferType(ctx, current.inner)))) {
                    sendError(miscError(current, `Casting here is redundant, because ${hlt(msgFormat(current.inner))} is already of type ${hlt(msgFormat(current.type))}`))
                }
            } break;
            case "named-type": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                const binding = resolve(ctx, current.name.name, current, true)

                if (!binding) {
                    sendError(cannotFindName(current, current.name.name))
                } else {
                    if (binding.owner?.kind !== 'type-declaration' && binding.owner?.kind !== 'generic-param-type') {
                        sendError(miscError(current, `${hlt(current.name.name)} is not a type`))
                    }
                }
            } break;
            case "local-identifier": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                const binding = resolve(ctx, current.name, current, true)?.owner

                if (binding) {
                    if (binding.kind === 'value-declaration' || 
                        binding.kind === 'declaration-statement' ||
                        binding.kind === 'inline-declaration') {

                        // using a let-declaration to initialize a const
                        if (binding.kind === 'value-declaration' && 
                            !binding.isConst &&
                            (findAncestor(current, a => a.kind === 'value-declaration') as ValueDeclaration|undefined)?.isConst) {
                            
                            sendError(miscError(current, `Const declarations cannot be initialized from mutable state (referencing ${hlt(msgFormat(current))})`))
                        }

                        // TODO: Once we have pure/impure functions, forbid impure functions when initializing a const!

                        if (within(current, binding.value)) {
                            // value referenced in its own initialization
                            sendError(miscError(current, `Can't reference ${hlt(current.name)} in its own initialization`))
                        } else {
                            // check correct order of declarations
                            let child: AST = current
                            for (const ancestor of ancestors(current)) {
                                const declarations = (
                                    ancestor.kind === 'module' || ancestor.kind === 'inline-const-group' ? ancestor.declarations :
                                    ancestor.kind === 'block' ? ancestor.statements :
                                    undefined
                                ) as unknown[] | undefined

                                if (declarations) {
                                    const identIndex = declarations.indexOf(child)
                                    const declarationIndex = declarations.indexOf(binding)

                                    if (identIndex > -1 && declarationIndex > -1) {
                                        if (declarationIndex > identIndex) {
                                            sendError(miscError(current, `Can't reference ${hlt(current.name)} before initialization`))
                                        }

                                        break;
                                    }
                                }

                                child = ancestor
                            }
                        }
                    } else if (binding.kind === 'type-declaration') {
                        if (binding.type.kind !== 'nominal-type') { // nominals with no inner value are allowed here
                            sendError(miscError(current, `${hlt(current.name)} is a type, but it's used like a value`))
                        }
                    }
                    
                    if (config.platforms && (binding.kind === 'proc-declaration' || binding.kind === 'func-declaration' || binding.kind === 'value-declaration')) {
                        const unmetPlatforms = config.platforms.filter(platform => !binding.platforms.includes(platform))

                        if (unmetPlatforms.length > 0) {
                            sendError(miscError(current, `Project is configured to target platforms ${config.platforms.join(', ')}, but ${hlt(current.name)} is only supported in ${binding.platforms.join(', ')}`))
                        }
                    }
                } else {
                    sendError(cannotFindName(current, current.name))
                }
            } break;
            case "assignment": {

                // if assigning directly to variable, make sure it isn't a constant
                const resolved = current.target.kind === "local-identifier" ? resolve(ctx, current.target.name, current.target, true) : undefined
                if (current.target.kind === "local-identifier" && resolved != null && getBindingMutability(resolved, current.target) !== "assignable") {
                    sendError(miscError(current.target, `Cannot assign to ${hlt(current.target.name)} because it's constant`));
                }

                // if assigning into object or array, make sure the subject isn't immutable
                if (current.target.kind === "property-accessor") {
                    const subjectType = resolveType(ctx, inferType(ctx, current.target.subject))
                    if (subjectType.mutability !== "mutable") {
                        sendError(miscError(current.target, `Cannot assign to ${hlt(msgFormat(current.target))} because ${hlt(msgFormat(current.target.subject))} is readonly`));
                    }
                }

                const targetType = inferType(ctx, current.target, true);

                if (current.operator) {
                    // +=, -=, etc
                    const leftType = targetType
                    const rightType = inferType(ctx, current.value)
                    const op = current.operator.op as '+' | '-' | '*' | '/' // enforced in parse/index.ts

                    const required = REQUIRED_OPERANDS[op]

                    if (subsumationIssues(ctx, required, leftType) || subsumationIssues(ctx, required, rightType)) {
                        // check that both sides of operator can be handled by it
                        sendError(miscError(current.operator, `Operator ${hlt(op)} cannot be applied to types ${hlt(msgFormat(leftType))} and ${hlt(msgFormat(rightType))}`));
                    } else {
                        const output = (
                            op === '+' && (!subsumationIssues(ctx, STRING_TYPE, leftType) || !subsumationIssues(ctx, STRING_TYPE, rightType))
                                ? STRING_TYPE
                                : NUMBER_TYPE
                        )

                        // check that resulting value is assignable to target
                        const issues = subsumationIssues(ctx, targetType, output)

                        if (issues) {
                            sendError(assignmentError(current, targetType, output, issues));
                        }
                    }
                } else {
                    // normal assignment
                    expect(ctx, targetType, current.value)
                }
            } break;
            case "range":
                expect(ctx, NUMBER_TYPE, current.start, 
                    (_, val) => `Expected number for start of range; got ${hlt(msgFormat(val))}`)
                expect(ctx, NUMBER_TYPE, current.end, 
                    (_, val) => `Expected number for end of range; got ${hlt(msgFormat(val))}`)
                break;
            case "for-loop":
                expect(ctx, ITERATOR_OF_ANY, current.iterator, 
                    (_, val) => `Expected iterator after "of" in for loop; found ${hlt(msgFormat(val))}`)
                break;
            case "test-block-declaration":
            case "try-catch": {
                const block = current.kind === 'try-catch' ? current.tryBlock : current.block
                const thrown = throws(ctx, block)

                if (thrown.length === 0) {
                    const blockName = current.kind === 'try-catch' ? 'Try/catch' : 'Test'
                    sendError(miscError(block, `${blockName} is redundant; no errors can be thrown in this block`))
                }
            } break;
            case "test-type-declaration": {
                given(subsumationIssues(ctx, current.destinationType, current.valueType), issues => {
                    sendError(assignmentError(current.valueType, current.destinationType, current.valueType, issues));
                })
            } break;
            case "throw-statement": {
                expect(ctx, ERROR_OF_ANY, current.errorExpression,
                    (_, val) => `Can only thow Errors; this is a ${hlt(msgFormat(val))}`)
                
                const nearestFuncOrProc = getNearestFuncOrProc(current)
                if (nearestFuncOrProc?.kind === 'proc') {
                    const procType = nearestFuncOrProc.type.kind === 'generic-type' ? nearestFuncOrProc.type.inner : nearestFuncOrProc.type
                    const { throws } = procType

                    if (throws != null) {
                        expect(ctx, throws, current.errorExpression,
                            (_, val) => `This proc can only throw ${hlt(msgFormat(throws))}; this is a ${hlt(msgFormat(val))}`)
                    }
                }
            } break;
            case "spread": {
                if (parent?.kind === 'object-literal') {
                    expect(ctx, RECORD_OF_ANY, current.expr, 
                        (_, val) => `Only objects can be spread into an object; found ${hlt(msgFormat(val))}`)
                } else if (parent?.kind === 'array-literal') {
                    expect(ctx, ARRAY_OF_ANY, current.expr, 
                        (_, val) => `Only arrays or tuples can be spread into an array; found ${hlt(msgFormat(val))}`)
                }
            } break;
            case "args": {
                {
                    // make sure no duplicate arg names
                    const duplicates = findDuplicateIdentifiers(current.args, arg => [arg.name])

                    for (const duplicate of duplicates) {
                        sendError(alreadyDeclared(duplicate))
                    }
                }

                { // make sure no required arguments after optional arguments
                    let encounteredOptional = false;

                    for (const arg of current.args) {
                        if (arg.optional) {
                            encounteredOptional = true
                        }
                        
                        if (!arg.optional && encounteredOptional) {
                            sendError(miscError(arg, `Required args can't come after optional args`))
                        }
                    }
                }
            } break;
            case "spread-args": {
                expectType(ctx, current.type, ARRAY_OF_ANY, current.type, () =>
                    `Can only spread an array or tuple type as args`)
            } break;
            case "object-type": {
                for (const spread of current.spreads) {
                    expectType(ctx, spread, RECORD_OF_ANY, spread, (_dest, val) =>
                        `${hlt(msgFormat(val))} is not an object type; can only spread object types into object types`)
                }
            } break;
            case "instance-of": {
                const exprType = inferType(ctx, current.expr)

                if (subsumationIssues(ctx, exprType, current.type)) {
                    sendError(miscError(current, `This check will always be false, because ${hlt(msgFormat(current.expr))} can never be a ${hlt(msgFormat(current.type))}`))
                } else if (typesEqual(resolveType(ctx, exprType), resolveType(ctx, current.type))) {
                    sendError(miscError(current, `This check will always be true, because ${hlt(msgFormat(current.expr))} will always be a ${hlt(msgFormat(current.type))}`))
                }
            } break;
            case "generic-type": {
                const duplicates = findDuplicateIdentifiers(current.typeParams, param => [param.name])

                for (const duplicate of duplicates) {
                    sendError(alreadyDeclared(duplicate))
                }
            } break;
            case "keyof-type":
            case "valueof-type":
                expectType(ctx, current, RECORD_OF_ANY, current.inner, (_dest, val) => {
                    const keyword = current.kind === 'keyof-type' ? 'keyof' : 'valueof'
                    return `${keyword} can only be used on object types; found ${hlt(msgFormat(val))}`
                })
                break;
            case "elementof-type":
                expectType(ctx, current, ARRAY_OF_ANY, current.inner, (_dest, val) =>
                    `elementof can only be used on array types; found ${hlt(msgFormat(val))}`)
                break;
            case "bound-generic-type": {
                const resolvedGeneric = resolveType(ctx, current.generic)

                if (resolvedGeneric.kind !== 'generic-type') {
                    sendError(miscError(current, 'Can only bind type arguments to a generic type'))
                }
            } break;
            case "object-entry":
                if (current.key.kind !== 'plain-identifier') {
                    expect(ctx, VALID_RECORD_KEY, current.key)
                }
                break;
            case "proc-declaration":
            case "func-declaration": {
                const baseDeclType = inferType(ctx, current.value)

                for (const decorator of current.decorators) {
                    const decoratorType = inferType(ctx, decorator.decorator)
                    
                    if (decoratorType.kind !== 'func-type' && (decoratorType.kind !== 'generic-type' || decoratorType.inner.kind !== 'func-type')) {
                        sendError(miscError(decorator, `Decorators must be functions, but ${hlt(format(decorator.decorator))} is a ${hlt(format(decoratorType))}`))
                    } else {
                        const { module, code, startIndex, endIndex } = decorator
                        const boundType = bindInvocationGenericArgs(ctx, {
                            kind: 'invocation',
                            subject: decorator.decorator,
                            args: [
                                current.value
                            ],
                            typeArgs: [],
                            spreadArg: undefined,
                            bubbles: false,
                            module, code, startIndex, endIndex
                        })
    
                        if (boundType == null || boundType.kind !== 'func-type' || boundType.returnType == null || subsumationIssues(ctx, baseDeclType, boundType.returnType)) {
                            sendError(miscError(decorator, `Couldn't use ${hlt(format(decorator.decorator))} as a decorator for ${hlt(current.name.name)}`))
                        }
                    }
                }
            } break;
            case "autorun": {
                if (current.until != null) {
                    expect(ctx, BOOLEAN_TYPE, current.until)
                }
            } break;
            case "decorator":
            case "proc-type":
            case "func-type":
            case "name-and-type":
            case "destructure":
            case "if-else-expression":
            case "if-else-statement":
            case "while-loop":
            case "negation-operator":
            case "js-proc":
            case "js-func":
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
            case "poisoned-type":
            case "any-type":
            case "property-type":
            case "javascript-escape-type":
            case "error-type":
            case "error-expression":
            case "type-declaration":
            case "typeof-type":
            case "element-tag":
            case "regular-expression":
            case "regular-expression-type":
            case "readonly-type":
                break;
            default:
                // @ts-expect-error: exhaustiveness
                throw Error("No typecheck logic for: " + current.kind)
        }        
    }
}

const REQUIRED_OPERANDS = {
    '+': STRING_OR_NUMBER_TYPE,
    '-': NUMBER_TYPE,
    '*': NUMBER_TYPE,
    '/': NUMBER_TYPE,
    '<': NUMBER_TYPE,
    '<=': NUMBER_TYPE,
    '>': NUMBER_TYPE,
    '>=': NUMBER_TYPE,
} as const

/**
 * Walk through `iter`, producing an array of PlainIdentifiers for each element,
 * and gather and return any duplicated identifiers from the bunch
 */
function findDuplicateIdentifiers<T>(iter: Iterable<T>, cb: (el: T) => PlainIdentifier[]) {
    const seen = new Map<string, PlainIdentifier>()
    const duplicates = new Set<PlainIdentifier>()

    for (const el of iter) {
        for (const ident of cb(el)) {
            const existing = seen.get(ident.name)
            if (existing) {
                duplicates.add(existing)
                duplicates.add(ident)
            } else {
                seen.set(ident.name, ident)
            }
        }
    }

    return duplicates
}

function expect(ctx: Pick<Context, 'allModules'|'sendError'|'encounteredNames'|'canonicalModuleName'>, destinationType: TypeExpression, value: Expression, generateMessage?: (dest: TypeExpression, val: TypeExpression) => string) {
    expectType(ctx, value, destinationType, inferType(ctx, value), generateMessage)
}

function expectType(ctx: Pick<Context, 'allModules'|'sendError'|'encounteredNames'|'canonicalModuleName'>, ast: AST, destinationType: TypeExpression, valueType: TypeExpression, generateMessage?: (dest: TypeExpression, val: TypeExpression) => string) {
    const { sendError } = ctx
    
    given(subsumationIssues(ctx, destinationType, valueType), issues => {
        sendError(
            generateMessage
                ? miscError(ast, generateMessage(destinationType, valueType))
                : assignmentError(ast, destinationType, valueType, issues));
    })
}

/**
 * Determine whether `value` can "fit into" `destination`. Used for verifying 
 * values passed to consts, arguments, etc, but for other things too.
 */
export function subsumationIssues(ctx: Pick<Context, 'allModules'|'encounteredNames'|'canonicalModuleName'>, destination: TypeExpression, value: TypeExpression): Array<string | string[]> | undefined {

    if (destination === value) {
        return undefined;
    }

    const resolvedDestination = resolveType(ctx, destination)
    const resolvedValue = resolveType(ctx, value)

    const baseErrorMessage = `Type ${hlt(msgFormat(resolvedValue))} is not assignable to type ${hlt(msgFormat(resolvedDestination))}`
    const withBase = (inner: Array<string | string[]>) => [baseErrorMessage, ...inner]
    const all = (...inner: Array<Array<string | string[]> | undefined>) =>
        given(emptyToUndefined(inner.filter(exists).flat()), withBase)

    if (resolvedDestination.mutability === "mutable" && resolvedValue.mutability !== undefined && resolvedValue.mutability !== "mutable" && resolvedValue.mutability !== "literal") {
        return [
            baseErrorMessage,
            `Value with ${resolvedValue.mutability} type ${hlt(msgFormat(value))} isn't compatible with ${resolvedDestination.mutability} type ${hlt(msgFormat(destination))}`
        ];
    } else if (
        resolvedValue.kind === "javascript-escape-type" || 
        resolvedValue.kind === "any-type" || 
        resolvedValue.kind === "poisoned-type" ||
        resolvedDestination.kind === "any-type" || 
        resolvedDestination.kind === "unknown-type"
    ) {
        return undefined;
    } else if (resolvedValue.kind === "unknown-type") {
        return [baseErrorMessage];
    } else if (
        (resolvedDestination.kind === "number-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "number-literal") ||
        (resolvedDestination.kind === "string-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "exact-string-literal") ||
        (resolvedDestination.kind === "boolean-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "boolean-literal")
    ) {
        return undefined;
    } else if(resolvedDestination.kind === "union-type") {
        const valueMembers = (
            resolvedValue.kind === "union-type"
                ? resolvedValue.members
                : [resolvedValue]
        )

        const subsumed = valueMembers.every(valueMember => 
            resolvedDestination.members.some(destinationMember => 
                !subsumationIssues(ctx, destinationMember, valueMember)));

        if (subsumed) {
            return undefined
        } else {
            return [baseErrorMessage]
        }
    } else if (resolvedValue.kind === "union-type") {
        const subsumed = resolvedValue.members.every(valueMember => 
            !subsumationIssues(ctx, resolvedDestination, valueMember))

        if (subsumed) {
            return undefined
        } else {
            return [baseErrorMessage]
        }
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
                `${hlt(msgFormat(resolvedValue))} and ${hlt(msgFormat(resolvedDestination))} are different nominal types`
            ]
        }
    } else if (typesEqual(resolvedDestination, resolvedValue)) {
        return undefined;
    } else if (
        (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type") ||
        (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type")
    ) {
        {
            const minMaxArgsValue = argsBounds(ctx, resolvedValue.args)
            const minMaxArgsDestination = argsBounds(ctx, resolvedDestination.args)
            if (minMaxArgsValue != null) { // value func requires a certain number of arguments
                if (minMaxArgsDestination != null) { // destination will pass a certain number of arguments
                    if (minMaxArgsValue.min > minMaxArgsDestination.min) {
                        return [
                            baseErrorMessage,
                            `${hlt(msgFormat(resolvedValue))} requires ${minMaxArgsValue.min} arguments, but ${hlt(msgFormat(resolvedDestination))} is only provided with ${minMaxArgsDestination.min}`
                        ]
                    }
                } else { // destination could pass any number of arguments
                    if (minMaxArgsValue.min > 0) {
                        return [
                            baseErrorMessage,
                            `${hlt(msgFormat(resolvedValue))} requires ${minMaxArgsValue.min} arguments, but ${hlt(msgFormat(resolvedDestination))} may not be passed that many`
                        ]
                    }
                }
            }
        }
        
        {
            const valueArgs = resolvedValue.args
            const destinationArgs = resolvedDestination.args
            
            const returnTypeIssues = resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type"
                ? subsumationIssues(ctx, resolvedDestination.returnType ?? UNKNOWN_TYPE, resolvedValue.returnType ?? UNKNOWN_TYPE)
                : undefined

            const asyncIssues = resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" && resolvedDestination.isAsync !== resolvedValue.isAsync
                ? [ `${hlt(msgFormat(resolvedValue))} is ${resolvedValue.isAsync ? '' : 'not '}async, but ${hlt(msgFormat(resolvedDestination))} is ${resolvedDestination.isAsync ? '' : 'not '}async` ]
                : undefined

            const throwsTypeIssues = resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type"
                ? subsumationIssues(ctx, resolvedDestination.throws ?? UNKNOWN_TYPE, resolvedValue.throws ?? UNKNOWN_TYPE)
                : undefined

            if (valueArgs.kind === 'args') {
                if (destinationArgs.kind === 'args') {
                    return all(
                        ...destinationArgs.args.map((_, i) => 
                            // NOTE: Value and destination are flipped on purpose for args!
                            subsumationIssues(ctx, valueArgs.args[i]?.type ?? UNKNOWN_TYPE, destinationArgs.args[i]?.type ?? UNKNOWN_TYPE)),
                        returnTypeIssues,
                        asyncIssues,
                        throwsTypeIssues
                    )
                } else {
                    const elementOfDestination = elementOf(destinationArgs.type)

                    return all(
                        ...valueArgs.args.map(valueArg =>
                            subsumationIssues(ctx, valueArg.type ?? UNKNOWN_TYPE, elementOfDestination)),
                        returnTypeIssues,
                        asyncIssues,
                        throwsTypeIssues
                    )
                }
            } else {
                if (destinationArgs.kind === 'args') {
                    const elementOfValue = elementOf(valueArgs.type)

                    return all(
                        ...destinationArgs.args.map(destinationArg =>
                            subsumationIssues(ctx, elementOfValue, destinationArg.type ?? UNKNOWN_TYPE)),
                        returnTypeIssues,
                        asyncIssues,
                        throwsTypeIssues
                    )
                    
                } else {
                    return all(
                        subsumationIssues(ctx, valueArgs.type, destinationArgs.type),
                        returnTypeIssues,
                        asyncIssues,
                        throwsTypeIssues
                    )
                }
            }
        }
    } else if (resolvedDestination.kind === "array-type") {
        if (resolvedValue.kind === "array-type") {
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return all(subsumationIssues(ctx, resolvedDestination.element, resolvedValue.element))
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
                    subsumationIssues(ctx, resolvedDestination.element, member)))
            }
        }
    } else if (resolvedDestination.kind === "tuple-type") {
        if (resolvedValue.kind === 'tuple-type') {
            if (resolvedValue.members.length !== resolvedDestination.members.length) {
                return [
                    baseErrorMessage,
                    `${hlt(msgFormat(resolvedDestination))} has exactly ${resolvedDestination.members.length} members, but ${hlt(msgFormat(resolvedValue))} has ${resolvedValue.members.length}`
                ]
            }
            if (resolvedDestination.mutability !== 'mutable' || resolvedValue.mutability === 'literal') {
                return all(
                    ...resolvedValue.members.map((member, index) =>
                        subsumationIssues(ctx, resolvedDestination.members[index], member))
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
                    subsumationIssues(ctx, resolvedDestination.keyType, resolvedValue.keyType),
                    subsumationIssues(ctx, resolvedDestination.valueType, resolvedValue.valueType)
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
                    subsumationIssues(ctx, resolvedDestination.keyType, literalType(name)),
                    subsumationIssues(ctx, resolvedDestination.valueType, type)
                )))
            }
        }
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        // TODO: Spreads
        const destinationEntries = propertiesOf(ctx, resolvedDestination)
        const valueEntries =       propertiesOf(ctx, resolvedValue)

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
                propertyTypeIssues.push(...all(subsumationIssues(ctx, destinationValue, valueEntry.type)) ?? [])
            }
        }
        const missingPropertiesMessage = missingProperties.length > 0
            ? [`Missing propert${iesOrY(missingProperties.length)} ${missingProperties.map(hlt).join(', ')} required by type ${hlt(msgFormat(resolvedDestination))}`]
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
            ? [`Has propert${iesOrY(extraProperties.length)} ${extraProperties.map(p => `${hlt(p)}`).join(', ')} not found on type ${hlt(msgFormat(resolvedDestination))}`]
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
        return all(subsumationIssues(ctx, resolvedDestination.inner, resolvedValue.inner));
    }

    return [baseErrorMessage];
}

const emptyToUndefined = (arr: ReturnType<typeof subsumationIssues>): ReturnType<typeof subsumationIssues> =>
    arr?.length === 0 ? undefined : arr?.filter(el => el.length > 0)

const getNearestFuncOrProc = (node: AST): Func|Proc|undefined => {
    let current: AST|undefined = node

    while (current && current.kind !== 'func' && current.kind !== 'proc') {
        current = current.parent
    }

    return current
}

/**
 * Resolve named types, unpack parenthesized types, bind generic types, 
 * simplify unions; generally collapse a type into its "real" form, whatever 
 * that means.
 */
export function resolveType(ctx: Pick<Context, 'allModules'|'encounteredNames'|'canonicalModuleName'> & { preserveNamedTypes?: boolean }, type: TypeExpression): TypeExpression {
    const { encounteredNames = [], preserveNamedTypes } = ctx
    
    switch (type.kind) {
        case "named-type": {
            if (encounteredNames.includes(type.name.name) || preserveNamedTypes) {
                return type
            } else {
                ctx = {
                    ...ctx,
                    encounteredNames: [...encounteredNames, type.name.name]
                }

                const binding = resolve(ctx, type.name.name, type.name)

                if (binding) {
                    if (binding.owner.kind === 'type-declaration') {
                        return resolveType(ctx, binding.owner.type)
                    }
        
                    if (binding.owner.kind === 'generic-param-type') {
                        return resolveType(ctx, binding.owner)
                    }

                    if (binding.owner.kind === 'import-item') {
                        const imported = resolveImport(ctx, binding.owner)

                        if (imported && imported.exported && imported.kind === 'type-declaration') {
                            return resolveType(ctx, imported.type)
                        }
                    }
                }

                return UNKNOWN_TYPE
            }
        }
        case "generic-param-type":
            return resolveType(ctx, type.extends ?? UNKNOWN_TYPE)
        case "parenthesized-type":
            return resolveType(ctx, type.inner)
        case "readonly-type": {
            const inner = resolveType(ctx, type.inner)
            return {
                ...inner,
                mutability: inner.mutability != null ? 'readonly' : inner.mutability as any
            }
        }
        case "typeof-type":
            return inferType(ctx, type.expr)
        case "keyof-type": {
            const inner = resolveType(ctx, type.inner)

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
            const inner = resolveType(ctx, type.inner)
            
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
            const inner = resolveType(ctx, type.inner)
            
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
                inner: resolveType(ctx, type.inner)
            }
        }
        case "plan-type": {
            let inner = type.inner
            while (inner.kind === 'plan-type') {
                inner = inner.inner
            }

            return {
                ...type,
                inner: resolveType(ctx, inner)
            }
        }
        case "maybe-type": {
            const { parent, module, code, startIndex, endIndex } = type

            return resolveType(ctx, {
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
            const resolvedGeneric = resolveType(ctx, type.generic)

            if (resolvedGeneric.kind !== 'generic-type') {
                return UNKNOWN_TYPE
            } else {
                return resolveType(ctx, parameterizedGenericType(ctx, resolvedGeneric, type.typeArgs))
            }
        }
        case "union-type": {
            const resolved = {
                ...type,
                members: type.members.map(m => resolveType(ctx, m))
            }

            const simplified = simplifyUnion(ctx, resolved)

            if (simplified.kind === 'union-type') {
                return simplified
            } else {
                return resolveType(ctx, simplified)
            }
        }
        case "array-type": {
            return {
                ...type,
                element: resolveType(ctx, type.element)
            }
        }
        case "tuple-type": {
            return {
                ...type,
                members: type.members.map(m => resolveType(ctx, m))
            }
        }
        case "record-type": {
            return {
                ...type,
                keyType: resolveType(ctx, type.keyType),
                valueType: resolveType(ctx, type.valueType)
            }
        }
        case "object-type": {
            return {
                ...type,
                entries: type.entries.map(entry => ({
                    ...entry,
                    type: resolveType(ctx, entry.type)
                }))
            }
        }
        case "property-type": {
            const subjectType = resolveType(ctx, type.subject)
            const nilTolerantSubjectType = type.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(ctx, subjectType, NIL_TYPE)
                : subjectType;
            const property = propertiesOf(ctx, nilTolerantSubjectType)?.find(entry => getName(entry.name) === type.property.name)
            
            if (type.optional && property) {
                return resolveType(ctx, maybeOf(property.type))
            } else {
                const mutability = (
                    property?.type?.mutability == null ? undefined :
                    property.type.mutability === "mutable" && subjectType.mutability === "mutable" && !property.forceReadonly ? "mutable" :
                    subjectType.mutability === 'constant' ? 'constant' :
                    "readonly"
                )
    
                return (
                    given(property, property => resolveType(ctx, (
                            property.optional
                                ?  maybeOf({ ...property.type, mutability } as TypeExpression)
                                : { ...property.type, mutability } as TypeExpression
                            ))) 
                        ?? UNKNOWN_TYPE
                )
            }
        }
    }

    return type
}

/**
 * Apply all union simplifications
 */
function simplifyUnion(ctx:  Pick<Context, 'allModules'|'encounteredNames'|'canonicalModuleName'>, type: UnionType): TypeExpression {
    let members: TypeExpression[] = (
        // flatten inner unions
        type.members.map(member =>
            member.kind === 'union-type'
                ? member.members
                : [member]).flat()
    )

    {
        const indicesToDrop = new Set<number>();

        for (let i = 0; i < type.members.length; i++) {
            for (let j = 0; j < type.members.length; j++) {
                if (i !== j) {
                    const a = type.members[i];
                    const b = type.members[j];

                    if (typesEqual(b, a) && !indicesToDrop.has(j) && resolveType(ctx, b).kind !== 'unknown-type') {
                        indicesToDrop.add(i);
                    }
                }
            }
        }

        members = members.filter((type, index) =>
            !indicesToDrop.has(index) && !isEmptyType(type))
    }

    // handle singleton and empty unions
    if (members.length === 1) {
        return members[0];
    } else {
        return {
            kind: "union-type",
            members,
            mutability: undefined,
            parent: type.parent,
            module: type.module,
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        }
    }
}
