import { Refinement, ReportError, ModuleName } from "../_model/common.ts";
import { BinaryOp, Expression, Invocation, isExpression, Spread } from "../_model/expressions.ts";
import { ArrayType, Attribute, BOOLEAN_TYPE, FALSE_TYPE, FALSY, FuncType, GenericType, JAVASCRIPT_ESCAPE_TYPE, Mutability, NamedType, NEVER_TYPE, NIL_TYPE, NUMBER_TYPE, ProcType, STRING_TYPE, TRUE_TYPE, TRUTHINESS_SAFE_TYPES, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { given } from "../utils/misc.ts";
import { resolveType, subsumes } from "./typecheck.ts";
import { assignmentError, cannotFindModule } from "../errors.ts";
import { stripSourceInfo } from "../utils/debugging.ts";
import { AST, PlainIdentifier } from "../_model/ast.ts";
import { computedFn } from "../mobx.ts";
import { areSame, expressionsEqual, mapParseTree, typesEqual } from "../utils/ast.ts";
import Store, { getModuleByName } from "../store.ts";
import { format } from "../other/format.ts";
import { ValueDeclaration,FuncDeclaration,ProcDeclaration } from "../_model/declarations.ts";
import { resolve } from "./resolve.ts";

export function inferType(
    reportError: ReportError,
    ast: Expression,
    visited: readonly AST[] = [],
): TypeExpression {
    const baseType = inferTypeInner(reportError, ast, visited)

    let refinedType = baseType
    {
        const refinements = resolveRefinements(ast)

        for (const refinement of refinements ?? []) {
            if (expressionsEqual(refinement.targetExpression, ast)) {
                switch (refinement.kind) {
                    case "subtraction": {
                        refinedType = subtract(reportError, refinedType, refinement.type)
                    } break;
                    case "narrowing": {
                        refinedType = narrow(reportError, refinedType, refinement.type)
                    } break;
                }
            }
        }
    }

    return simplifyUnions(reportError, refinedType)
}

const inferTypeInner = computedFn((
    reportError: ReportError,
    ast: Expression,
    previouslyVisited: readonly AST[],
): TypeExpression => {
    const infer = (expr: Expression) => inferType(reportError, expr, visited)
    const resolveT = (type: TypeExpression) => resolveType(reportError, type)

    const { parent, module, code, startIndex, endIndex, ..._rest } = ast

    if (previouslyVisited.includes(ast)) {
        return UNKNOWN_TYPE
    }

    const visited = [...previouslyVisited, ast]

    switch(ast.kind) {
        case "proc":
        case "js-proc":
        case "js-func":
            return ast.type
        case "func": {
            
            // infer callback type based on context
            const typeDictatedByParent = (() => {
                const parent = ast.parent

                if (parent?.kind === "invocation") {
                    const parentSubjectType = resolveT(infer(parent.subject))
                    const thisArgIndex = parent.args.findIndex(a => areSame(a, ast))

                    if (parentSubjectType.kind === "func-type" || parentSubjectType.kind === "proc-type") {
                        const thisArgParentType = parentSubjectType.args[thisArgIndex]?.type

                        if (thisArgParentType && thisArgParentType.kind === ast.type.kind) {
                            return thisArgParentType.kind === 'generic-type' ? thisArgParentType.inner as FuncType : thisArgParentType;
                        }
                    }
                }
            })()

            const funcType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type

            const inferredFuncType = {
                ...funcType,
                args: funcType.args.map((arg, index) =>
                    ({ ...arg, type: arg.type ?? typeDictatedByParent?.args[index].type })),
                returnType: (
                    funcType.returnType ??
                    typeDictatedByParent?.returnType ??
                    // if no return-type is declared, try inferring the type from the inner expression
                    infer(ast.body)
                )
            }
    
            if (ast.type.kind === 'generic-type') {
                return {
                    ...ast.type,
                    inner: inferredFuncType
                }
            } else {
                return inferredFuncType
            }
        }
        case "binary-operator": {
            const leftType = resolveT(infer(ast.left))
            const rightType = resolveT(infer(ast.right))
            
            if (ast.op.op === '??') {
                return {
                    kind: "union-type",
                    members: [
                        subtract(reportError, leftType, NIL_TYPE),
                        rightType
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else if (ast.op.op === '&&') {
                return {
                    kind: "union-type",
                    members: [
                        rightType,
                        narrow(reportError, leftType, FALSY)
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else if (ast.op.op === '||') {
                return {
                    kind: "union-type",
                    members: [
                        subtract(reportError, leftType, FALSY),
                        rightType
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else {
                const types = BINARY_OPERATOR_TYPES[ast.op.op]?.find(({ left, right }) =>
                    subsumes(reportError, left, leftType) && 
                    subsumes(reportError, right, rightType))

                if (types == null) {
                    return BINARY_OPERATOR_TYPES[ast.op.op]?.[0].output ?? UNKNOWN_TYPE
                } else {
                    return types.output;
                }
            }
        }
        case "negation-operator": return BOOLEAN_TYPE;
        case "invocation": {

            // Creation of nominal values looks like/parses as function 
            // invocation, but needs to be treated differently
            if (ast.subject.kind === "local-identifier") {
                const binding = resolve(() => {}, ast.subject.name, ast.subject)
                if (binding?.owner.kind === 'type-declaration') {
                    const resolvedType = resolveT(binding.owner.type)

                    if (resolvedType.kind === "nominal-type") {
                        return resolvedType
                    }
                }
            }
            
            // method call
            const inv = invocationFromMethodCall(ast)
            if (inv) {
                return infer(inv)
            }

            // normal func or proc call
            const subjectType = bindInvocationGenericArgs(reportError, ast)
            if (subjectType?.kind === "func-type") {
                return subjectType.returnType ?? UNKNOWN_TYPE;
            } else {
                return UNKNOWN_TYPE;
            }
        }
        case "indexer": {
            const baseType = resolveT(infer(ast.subject));
            const indexType = resolveT(infer(ast.indexer));

            const indexIsNumber = subsumes(reportError, NUMBER_TYPE, indexType)
            
            if (baseType.kind === "object-type" && indexType.kind === "literal-type" && indexType.value.kind === "exact-string-literal") {
                const key = indexType.value.value;
                const valueType = propertiesOf(reportError, baseType)?.find(entry => entry.name.name === key)?.type;

                return valueType ?? UNKNOWN_TYPE;
            } else if (baseType.kind === "record-type") {
                if (!subsumes(reportError, baseType.keyType, indexType)) {
                    return UNKNOWN_TYPE;
                } else {
                    return {
                        kind: "maybe-type",
                        inner: baseType.valueType,
                        parent,
                        ...TYPE_AST_NOISE
                    };
                }
            } else if (baseType.kind === "array-type" && indexIsNumber) {
                return {
                    kind: "maybe-type",
                    inner: baseType.element,
                    parent,
                    ...TYPE_AST_NOISE
                }
            } else if (baseType.kind === "tuple-type" && indexIsNumber) {
                if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                    return baseType.members[indexType.value.value] ?? NIL_TYPE
                } else {
                    return {
                        kind: "union-type",
                        members: [ ...baseType.members, NIL_TYPE ],
                        parent,
                        ...TYPE_AST_NOISE
                    }
                }
            } else if (baseType.kind === 'string-type' && indexIsNumber) {
                return {
                    kind: "maybe-type",
                    inner: STRING_TYPE,
                    parent,
                    ...TYPE_AST_NOISE
                }
            } else if (baseType.kind === 'literal-type' && baseType.value.kind === 'exact-string-literal' && indexIsNumber) {
                if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                    const char = baseType.value.value[indexType.value.value]

                    if (char) {
                        return {
                            kind: 'literal-type',
                            value: {
                                kind: 'exact-string-literal',
                                value: char,
                                parent,
                                ...AST_NOISE
                            },
                            parent,
                            ...TYPE_AST_NOISE
                        }
                    } else {
                        return NIL_TYPE
                    }
                } else {
                    return {
                        kind: "maybe-type",
                        inner: STRING_TYPE,
                        parent,
                        ...TYPE_AST_NOISE
                    }
                }
            }

            return UNKNOWN_TYPE;
        }
        case "if-else-expression":
        case "switch-expression": {
            return {
                kind: "union-type",
                members: [
                    ...ast.cases.map(({ outcome }) => 
                        infer(outcome)),
                    ast.defaultCase 
                        ? infer(ast.defaultCase) 
                        : NIL_TYPE
                ],
                mutability: undefined,
                parent, module, code, startIndex, endIndex
            }
        }
        case "range": {
            return {
                kind: 'iterator-type',
                inner: NUMBER_TYPE,
                mutability: undefined,
                parent, module, code, startIndex, endIndex
            }
        }
        case "debug": {
            if (isExpression(ast.inner)) {
                const type = infer(ast.inner)
                stripSourceInfo(type)
                console.log(JSON.stringify({
                    bgl: given(ast.inner.code, code =>
                        given(ast.inner.startIndex, startIndex =>
                        given(ast.inner.endIndex, endIndex =>
                            code.substring(startIndex, endIndex)))),
                    type,
                }, null, 2));
                return type;
            } else {
                return UNKNOWN_TYPE
            }
        }
        case "parenthesized-expression":
        case "inline-const-group": {
            const innerType = infer(ast.inner);

            if (ast.kind === 'inline-const-group' && ast.declarations.some(d => d.awaited)) {
                return {
                    kind: 'plan-type',
                    inner: innerType,
                    mutability: undefined,
                    parent, module, code, startIndex, endIndex
                }
            }

            return innerType
        }
        case "property-accessor": {
            return {
                kind: "property-type",
                subject: infer(ast.subject),
                property: ast.property,
                optional: ast.optional,
                parent: ast.parent,
                module: ast.module,
                code: ast.code,
                startIndex: ast.startIndex,
                endIndex: ast.endIndex,
                mutability: undefined
            }
        }
        case "local-identifier": {
            const binding = resolve(reportError, ast.name, ast)

            if (binding) {
                const decl = binding.owner

                type MutabilityKind = Mutability['mutability']|undefined

                switch (decl.kind) {
                    case 'value-declaration':
                    case 'value-declaration-statement': {
                        const baseType = decl.type ?? resolveT(infer(decl.value))
                        const mutability: MutabilityKind = given(baseType.mutability, mutability =>
                            decl.isConst || (decl.kind === 'value-declaration' && decl.exported === 'expose' && decl.module !== ast.module)
                                ? 'immutable'
                                : mutability
                        )

                        // if this is a let declaration, its type may need to be made less exact to enable reasonable mutation
                        const broadenedBaseType = (
                            !decl.isConst
                                ? broadenTypeForMutation(baseType)
                                : baseType
                        )

                        return {
                            ...broadenedBaseType,
                            mutability: mutability === 'literal' ? 'mutable' : mutability
                        } as TypeExpression
                    }
                    case 'func-declaration':
                    case 'proc-declaration':
                    case 'inline-const-declaration': {
                        const baseType = resolveT(infer(decl.value))
                        const mutability: MutabilityKind = given(baseType.mutability, () =>
                            decl.kind === 'func-declaration' || decl.kind === 'proc-declaration'
                                ? 'immutable'
                                : 'readonly')

                        if (decl.kind === 'inline-const-declaration' && decl.awaited) {
                            if (baseType.kind === 'plan-type') {
                                return baseType.inner
                            } else {
                                return UNKNOWN_TYPE
                            }
                        }
                        
                        return {
                            ...baseType,
                            mutability
                        } as TypeExpression
                    }
                    case 'await-statement': {

                        if (decl.type) {
                            return {
                                ...decl.type,
                                mutability: 'immutable'
                            } as TypeExpression
                        }

                        if (decl.name == null) {
                            return UNKNOWN_TYPE
                        }

                        const planType = resolveT(infer(decl.plan))
                        if (planType.kind !== 'plan-type') {
                            return UNKNOWN_TYPE
                        } else {
                            return {
                                ...planType.inner,
                                mutability: 'immutable'
                            } as TypeExpression
                        }
                    }
                    case 'derive-declaration': {
                        if (decl.type) {
                            return decl.type
                        }

                        const fnType = resolveT(infer(decl.fn))
                        if (fnType.kind === 'func-type' && fnType.returnType) {
                            return fnType.returnType
                        }

                        return UNKNOWN_TYPE
                    }
                    case 'remote-declaration': {
                        const fnType = resolveT(infer(decl.fn))

                        let inner;
                        if (fnType.kind === 'plan-type') {
                            inner = fnType.inner
                        } else if (fnType.kind === 'func-type' && fnType.returnType?.kind === 'plan-type') {
                            inner = fnType.returnType.inner
                        } else {
                            inner = UNKNOWN_TYPE
                        }

                        const { module, code, startIndex, endIndex } = decl

                        return {
                            kind: 'remote-type',
                            inner,
                            mutability: undefined,
                            module, code, startIndex, endIndex
                        }
                    }
                    case 'inline-destructuring-declaration':
                    case 'destructuring-declaration-statement': {
                        const objectOrArrayType = resolveT(infer(decl.value))

                        if (decl.destructureKind === 'object' && objectOrArrayType.kind === 'object-type') {
                            const props = propertiesOf(reportError, objectOrArrayType)

                            return props?.find(prop => prop.name.name === binding.identifier.name)?.type ?? UNKNOWN_TYPE
                        } else if (decl.destructureKind === 'array') {
                            if (objectOrArrayType.kind === 'array-type') {
                                return {
                                    kind: "maybe-type",
                                    inner: objectOrArrayType.element,
                                    parent,
                                    ...TYPE_AST_NOISE
                                }
                            } else if (objectOrArrayType.kind === 'tuple-type') {
                                const index = decl.properties.findIndex(p => p.name === binding.identifier.name)
                                return objectOrArrayType.members[index] ?? UNKNOWN_TYPE
                            }
                        }
                    } break;
                    case 'func':
                    case 'proc': {
                        const funcOrProcType = decl.type.kind === 'generic-type' ? decl.type.inner : decl.type
                        const argType = funcOrProcType.args.find(a => a.name.name === binding.identifier.name)?.type

                        if (argType) {
                            return argType
                        }

                        const inferredHolderType = infer(decl)
                        if (inferredHolderType.kind === 'func-type' || inferredHolderType.kind === 'proc-type') {
                            const inferredArg = inferredHolderType.args.find(a => a.name.name === binding.identifier.name)
                            const declaredType = inferredArg?.type

                            if (declaredType) {
                                if (!inferredArg?.optional) {
                                    return declaredType
                                } else {
                                    const { module, code, startIndex, endIndex } = declaredType

                                    return {
                                        kind: 'maybe-type',
                                        inner: declaredType,
                                        mutability: undefined,
                                        module, code, startIndex, endIndex
                                    }
                                }
                            }
                            
                            return UNKNOWN_TYPE
                        }
                        
                        return UNKNOWN_TYPE
                    }
                    case 'for-loop': {
                        const iteratorType = resolveT(infer(decl.iterator))

                        return iteratorType.kind === 'iterator-type'
                            ? iteratorType.inner
                            : UNKNOWN_TYPE
                    }
                    case 'import-all-declaration': {
                        const otherModule = getModuleByName(Store, decl.module as ModuleName, decl.path.value)

                        if (otherModule == null) {
                            // other module doesn't exist
                            reportError(cannotFindModule(decl.path))
                            return {
                                kind: 'object-type',
                                spreads: [],
                                entries: [],
                                mutability: 'immutable',
                                parent,
                                ...AST_NOISE
                            }
                        } else {
                            const exportedDeclarations = otherModule.declarations.filter(decl =>
                                (decl.kind === 'value-declaration' || decl.kind === 'func-declaration' || decl.kind === 'proc-declaration')
                                && decl.exported) as (ValueDeclaration|FuncDeclaration|ProcDeclaration)[]

                            return {
                                kind: 'object-type',
                                spreads: [],
                                entries: exportedDeclarations.map(decl => {
                                    const declaredType = decl.kind === 'value-declaration' ? decl.type : decl.value.type

                                    return attribute(
                                        decl.name.name, 
                                        declaredType ?? infer(decl.value),
                                        decl.kind !== 'value-declaration' || decl.isConst || decl.exported === 'expose'
                                    )
                                }),
                                mutability: 'mutable',
                                parent,
                                ...AST_NOISE
                            }
                        }
                    }
                    case 'type-declaration':
                    case 'generic-param-type':
                        return UNKNOWN_TYPE
                    default:
                        // @ts-expect-error
                        throw Error('getDeclType is nonsensical on declaration of type ' + decl?.kind)
                }
            }

            return UNKNOWN_TYPE
        }
        case "element-tag": {
            return {
                kind: "element-type",
                // tagName: ast.tagName,
                // attributes: ast.attributes
                mutability: undefined,
                parent, module, code, startIndex, endIndex
            };
        }
        case "object-literal": {
            const entries = ast.entries.map(entry => {
                if (Array.isArray(entry)) {
                    const [name, value] = entry as [PlainIdentifier, Expression]

                    const type = resolveT(infer(value));
                    return {
                        kind: "attribute",
                        name,
                        type, 
                        mutability: undefined,
                        parent, module, code, startIndex, endIndex
                    }
                } else {
                    const spreadObj = (entry as Spread).expr
                    const spreadObjType = resolveT(infer(spreadObj));

                    if (spreadObjType.kind !== 'object-type') {
                        return undefined
                    } else {
                        return spreadObjType.entries
                    }
                }
            }).filter(el => el != null).flat() as Attribute[]

            return {
                kind: "object-type",
                spreads: [],
                entries,
                mutability: "literal",
                parent, module, code, startIndex, endIndex
            };
        }
        case "array-literal": {
            const memberTypes: TypeExpression[] = []
            const arraySpreads: ArrayType[] = []

            for (const entry of ast.entries) {
                if (entry.kind === 'spread') {
                    const spreadType = resolveT(infer(entry.expr))

                    if (spreadType.kind === 'array-type') {
                        arraySpreads.push(spreadType)
                    } else if (spreadType.kind === 'tuple-type') {
                        memberTypes.push(...spreadType.members)
                    } else {
                        memberTypes.push(UNKNOWN_TYPE)
                    }
                } else {
                    memberTypes.push(infer(entry))
                }
            }

            if (arraySpreads.length === 0) {
                return {
                    kind: "tuple-type",
                    members: memberTypes,
                    mutability: "literal",
                    parent, module, code, startIndex, endIndex
                }
            } else {
                return {
                    kind: "array-type",
                    element: simplifyUnions(reportError, {
                        kind: "union-type",
                        members: [...memberTypes, ...arraySpreads.map(t => t.element)],
                        mutability: undefined,
                        parent, module, code, startIndex, endIndex
                    }),
                    mutability: "literal",
                    parent, module, code, startIndex, endIndex
                }
            }
        }
        case "string-literal": return STRING_TYPE;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return {
            kind: 'literal-type',
            value: ast,
            mutability: undefined,
            parent, module, code, startIndex, endIndex
        };
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;
        case "instance-of": return BOOLEAN_TYPE;
        case "as-cast": return ast.type;
        case "error-expression":
            return {
                kind: "error-type",
                inner: infer(ast.inner),
                mutability: undefined,
                parent, module, code, startIndex, endIndex
            }
        default:
            // @ts-expect-error
            throw Error(ast.kind)
    }
})

/**
 * When initializing a mutable variable, sometimes we want to broaden the type
 * a bit to allow for "normal" kinds of mutation
 */
function broadenTypeForMutation(type: TypeExpression): TypeExpression {
    if (type.kind === 'literal-type') {
        if (type.value.kind === 'exact-string-literal') {
            return STRING_TYPE
        }
        if (type.value.kind === 'number-literal') {
            return NUMBER_TYPE
        }
        if (type.value.kind === 'boolean-literal') {
            return BOOLEAN_TYPE
        }
    } else if (type.kind === 'tuple-type' && type.mutability === 'mutable') {
        return { ...type, kind: 'array-type', element: { kind: 'union-type', members: type.members.map(broadenTypeForMutation), parent: type.parent, ...TYPE_AST_NOISE } }
    } else if (type.kind === 'array-type'&& type.mutability === 'mutable') {
        return { ...type, element: broadenTypeForMutation(type.element) }
    } else if (type.kind === 'object-type' && type.mutability === 'mutable') {
        return { ...type, entries: type.entries.map(attribute => ({ ...attribute, type: broadenTypeForMutation(attribute.type) })) }
    }

    return type
}

/**
 * Given some invocation,
 * a) infer its subject's type
 * b) if the subject is generic, bind its provided type args or try to infer 
 *    them
 */
export function bindInvocationGenericArgs(reportError: ReportError, invocation: Invocation): TypeExpression|undefined {
    const subjectType = resolveType(reportError, inferType(reportError, invocation.subject))

    if (subjectType.kind === 'generic-type' && subjectType.typeParams.length > 0 && (subjectType.inner.kind === "func-type" || subjectType.inner.kind === "proc-type")) {
        if (invocation.typeArgs.length > 0) { // explicit type arguments

            // some provided, but not the right number
            if (subjectType.typeParams.length !== invocation.typeArgs.length) {
                return undefined
            }

            // check that provided type args fit `extends` clauses
            for (let i = 0; i < subjectType.typeParams.length; i++) {
                const typeParam = subjectType.typeParams[i]
                const typeArg = invocation.typeArgs[i]
                
                if (typeParam.extends && !subsumes(reportError, typeParam.extends, typeArg)) {
                    reportError(assignmentError(typeArg, typeParam.extends, typeArg))
                    return undefined
                }
            }

            return parameterizedGenericType(
                reportError, 
                subjectType, 
                invocation.typeArgs
            )
        } else { // no type arguments (try to infer)
            const funcOrProcType = subjectType.inner

            const invocationSubjectType: FuncType|ProcType = {
                ...funcOrProcType,
                args: funcOrProcType.args.map((arg, index) => ({
                    ...arg,
                    type: inferType(reportError, invocation.args[index])
                }))
            }

                    
            // attempt to infer params for generic
            const inferredBindings = fitTemplate(
                reportError, 
                funcOrProcType, 
                invocationSubjectType
            );

            if (inferredBindings && inferredBindings.size === subjectType.typeParams.length) {

                // check that inferred type args fit `extends` clauses
                for (const param of subjectType.typeParams) {
                    const inferred = inferredBindings.get(param.name.name)
                    
                    if (param.extends && inferred && !subsumes(reportError, param.extends, inferred)) {
                        return undefined
                    }
                }
    
                return parameterizedGenericType(
                    reportError, 
                    subjectType, 
                    subjectType.typeParams.map(param =>
                        inferredBindings.get(param.name.name) ?? UNKNOWN_TYPE)
                )
            } else {
                return undefined
            }
        }
    }

    return subjectType
}

/**
 * Given some generic type and a series of known type args, substitute the args 
 * into the type as appropriate, yielding a non-generic type.
 */
export function parameterizedGenericType(reportError: ReportError, generic: GenericType, typeArgs: readonly TypeExpression[]): TypeExpression {
    
    // index bindings by name
    const bindings: Record<string, TypeExpression> = {}
    for (let i = 0; i < generic.typeParams.length; i++) {
        const typeParam = generic.typeParams[i]
        const typeArg = typeArgs[i] as TypeExpression

        bindings[typeParam.name.name] = typeArg
    }

    return mapParseTree(generic.inner, ast => {

        // if we've found one of the generic params, substitute it
        if (ast.kind === 'named-type') {
            const resolved = resolve(reportError, ast.name.name, ast)

            if (resolved?.owner.kind === 'generic-param-type' && bindings[resolved.owner.name.name]) {
                return bindings[resolved.owner.name.name]
            }
        }

        return ast
    }) as TypeExpression
}

/**
 * Apply all union simplifications
 */
export function simplifyUnions(reportError: ReportError, type: TypeExpression): TypeExpression {
    return handleSingletonUnion(
        distillUnion(reportError,
            flattenUnions(type)));
}

/**
 * Nested unions can be flattened
 */
function flattenUnions(type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        const members: TypeExpression[] = [];

        for (const member of type.members) {
            if (member.kind === "union-type") {
                members.push(...member.members.map(flattenUnions));
            } else {
                members.push(member);
            }
        }

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
    } else {
        return type;
    }
}

/**
 * Remove redundant members in union type (members subsumed by other members)
 */
function distillUnion(reportError: ReportError, type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        const indicesToDrop = new Set<number>();

        for (let i = 0; i < type.members.length; i++) {
            for (let j = 0; j < type.members.length; j++) {
                if (i !== j) {
                    const a = type.members[i];
                    const b = type.members[j];

                    if (subsumes(reportError, b, a) && !indicesToDrop.has(j) && resolveType(reportError, b).kind !== 'unknown-type') {
                        indicesToDrop.add(i);
                    }
                }
            }
        }

        const members = type.members.filter((_, index) => !indicesToDrop.has(index))

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
    } else {
        return type;
    }
}

/**
 * If union only has one member, putting it in a union-type is redundant
 */
 function handleSingletonUnion(type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        if (type.members.length === 1) {
            return type.members[0];
        }
        if (type.members.length === 0) {
            return NEVER_TYPE
        }
    }
    
    return type;
}

export function subtract(reportError: ReportError, type: TypeExpression, without: TypeExpression): TypeExpression {
    type = resolveType(reportError, type)
    without = resolveType(reportError, without)

    if (type.kind === "union-type") {
        return {
            ...type,
            members: type.members.filter(member => !subsumes(reportError, without, member))
        }
    } else if(type.kind === 'boolean-type' && without.kind === 'literal-type' && without.value.kind === 'boolean-literal') {
        if (without.value.value) {
            return FALSE_TYPE
        } else {
            return TRUE_TYPE
        }
    } else { // TODO: There's probably more we can do here
        return type
    }
}

function narrow(reportError: ReportError, type: TypeExpression, fit: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        return {
            ...type,
            members: type.members.filter(member => subsumes(reportError, fit, member))
        }
    } else if (type.kind === 'unknown-type') {
        return fit
    } else { // TODO: There's probably more we can do here
        return type
    }
}

/**
 * Given some expression, find all Refinements that modify its type in some way
 */
function resolveRefinements(expr: Expression): Refinement[] {
    const refinements: Refinement[] = []

    let current: AST = expr
    let parent = expr.parent
    let grandparent = parent?.parent

    // traverse upwards through the AST, looking for nodes that refine the type 
    // of the current expression
    while (parent != null) {
        if (parent.kind === 'case') {
            if (grandparent?.kind === 'if-else-expression' && current === parent.outcome) {
                
                for (let i = 0; i < grandparent.cases.indexOf(parent); i++) {
                    const condition = grandparent.cases[i]?.condition

                    // conditions for all past clauses are false
                    const refinement = conditionToRefinement(condition, false)
                    if (refinement) {
                        refinements.push(refinement)
                    }
                }
                
                // condition for current clause is true
                const refinement = conditionToRefinement(parent.condition, true)
                if (refinement) {
                    refinements.push(refinement)
                }
            } else if (grandparent?.kind === "switch-expression") {
                // TODO
            }
        } else if (parent.kind === 'if-else-expression' && current === parent.defaultCase) {
            for (const { condition } of parent.cases) {

                // conditions for all past clauses are false
                const refinement = conditionToRefinement(condition, false)
                if (refinement) {
                    refinements.push(refinement)
                }
            }
        } else if (parent.kind === 'binary-operator' && current === parent.right) {
            if (parent.op.op === '&&') {
                const refinement = conditionToRefinement(parent.left, true)
                if (refinement) {
                    refinements.push(refinement)
                }
            } else if (parent.op.op === '||') {
                const refinement = conditionToRefinement(parent.left, false)
                if (refinement) {
                    refinements.push(refinement)
                }
            }
        }

        current = parent
        parent = parent.parent
        grandparent =parent?.parent
    }

    return refinements
}

function conditionToRefinement(condition: Expression, conditionIsTrue: boolean): Refinement|undefined {
    if (condition.kind === "binary-operator") {

        if (condition.op.op === '!=') {
            const targetExpression = 
                condition.right.kind === 'nil-literal' ? condition.left :
                condition.left.kind === "nil-literal" ? condition.right :
                undefined;

            if (targetExpression != null) {
                return { kind: conditionIsTrue ? "subtraction" : "narrowing", type: NIL_TYPE, targetExpression }
            }
        }

        if (condition.op.op === '==') {
            // TODO: Somehow assert that both of these types are the same... combine their refinements? intersection? etc
            // TODO: Translate this more general logic to the '!=' case too
        }
    }

    if (condition.kind === 'instance-of') {
        return { kind: conditionIsTrue ? "narrowing" : "subtraction", type: condition.type, targetExpression: condition.expr }
    }

    if (condition.kind === 'negation-operator') {
        return { kind: conditionIsTrue ? "narrowing" : "subtraction", type: FALSY, targetExpression: condition.base }
    }

    // condition is truthy or falsy
    return { kind: conditionIsTrue ? "subtraction" : "narrowing", type: FALSY, targetExpression: condition }
}

export const propertiesOf = computedFn((
    reportError: ReportError,
    type: TypeExpression
): readonly Attribute[] | undefined => {
    const resolvedType = resolveType(reportError, type)

    switch (resolvedType.kind) {
        case "nominal-type": {
            return [
                attribute("value", resolvedType.inner, false)
            ]
        }
        case "object-type": {
            const attrs = [...resolvedType.entries]

            for (const spread of resolvedType.spreads) {
                const resolved = resolve(reportError, spread.name.name, spread)

                if (resolved != null && (resolved.owner.kind === 'type-declaration' || resolved.owner.kind === 'generic-param-type')) {
                    const type = resolved.owner.kind === 'type-declaration' ? resolved.owner.type : resolved.owner
                    if (type.kind === 'object-type') {
                        attrs.push(...(propertiesOf(reportError, type) ?? []))
                    }
                }
            }

            return attrs
        }
        case "string-type":
        case "array-type": {
            return [
                attribute("length", NUMBER_TYPE, true),
            ]
        }
        case "tuple-type": {
            return [
                attribute("length", {
                    kind: "literal-type",
                    value: {
                        kind: "number-literal",
                        value: resolvedType.members.length,
                        parent: resolvedType.parent,
                        ...AST_NOISE
                    },
                    parent: resolvedType.parent,
                    ...TYPE_AST_NOISE
                }, true)
            ]
        }
        case "error-type": {
            return [
                attribute("value", resolvedType.inner, true),
            ]
        }
        case "remote-type": {
            return [
                attribute("value", resolvedType.inner, true),
                attribute("loading", BOOLEAN_TYPE, true),
                // TODO: reload() proc
            ]
        }
    }
})

/**
 * Convenience function for creating a simple Attribute
 */
function attribute(name: string, type: TypeExpression, forceReadonly: boolean): Attribute {
    return {
        kind: "attribute",
        name: { kind: "plain-identifier", name, parent: type.parent, ...AST_NOISE },
        type,
        optional: false,
        forceReadonly,
        parent: type.parent,
        ...TYPE_AST_NOISE
    }
}

export const AST_NOISE = { module: undefined, code: undefined, startIndex: undefined, endIndex: undefined }
export const TYPE_AST_NOISE = { mutability: undefined, ...AST_NOISE }

/**
 * Given some type containing generic type params, and some other type intended
 * to align with it, find a mapping from type params to possible bindings for 
 * them. Used to infer generic args when not supplied.
 */
function fitTemplate(
    reportError: ReportError,
    parameterized: TypeExpression, 
    reified: TypeExpression, 
): ReadonlyMap<string, TypeExpression>|undefined {

    function isGenericParam(type: TypeExpression): type is NamedType {
        if (type.kind === 'named-type') {
            const binding = resolve(reportError, type.name.name, type)
            return binding?.owner.kind === 'generic-param-type'
        }

        return false
    }

    if (isGenericParam(parameterized)) {
        const matches = new Map<string, TypeExpression>();
        matches.set(parameterized.name.name, reified);
        return matches;
    }

    if ((parameterized.kind === "func-type" && reified.kind === "func-type") 
     || (parameterized.kind === "proc-type" && reified.kind === "proc-type")) {
        const matchGroups = [
            ...parameterized.args.map((arg, index) =>
                fitTemplate(reportError, arg.type ?? UNKNOWN_TYPE, reified.args[index].type ?? UNKNOWN_TYPE)),
        ]

        // if (parameterized.kind === 'func-type' && reified.kind === 'func-type' &&
        //     parameterized.returnType && reified.returnType) {
        //     matchGroups.push(
        //         fitTemplate(reportError, parameterized.returnType, reified.returnType)
        //     )
        // }

        if (matchGroups.some(g => g == null)) {
            return undefined
        }

        const matches = new Map<string, TypeExpression>();

        for (const map of matchGroups) {
            for (const [key, value] of (map as ReadonlyMap<string, TypeExpression>).entries()) {
                const existing = matches.get(key)
                if (existing) {
                    if (!subsumes(reportError, existing, value)) {
                        return undefined
                    }
                } else {
                    matches.set(key, value);
                }
            }
        }
        
        return matches;
    }

    if (parameterized.kind === "array-type" && reified.kind === "array-type") {
        return fitTemplate(reportError, parameterized.element, reified.element);
    }

    if (parameterized.kind === "tuple-type" && reified.kind === "tuple-type" && parameterized.members.length === reified.members.length) {
        const all = new Map<string, TypeExpression>()

        for (let i = 0; i < parameterized.members.length; i++) {
            const matches = fitTemplate(reportError, parameterized.members[i], reified.members[i]);

            for (const key in matches) {
                all.set(key, matches.get(key) as TypeExpression)
            }
        }

        return all
    }

    if (parameterized.kind === "object-type" && reified.kind === "object-type") {
        const all = new Map<string, TypeExpression>()

        for (const entry of parameterized.entries) {
            const other = reified.entries.find(e => entry.name.name === e.name.name)

            if (other) {
                const matches = fitTemplate(reportError, entry.type, other.type);

                for (const key in matches) {
                    all.set(key, matches.get(key) as TypeExpression)
                }
            }
        }

        return all
    }

    if ((parameterized.kind === "iterator-type" && reified.kind === "iterator-type") 
     || (parameterized.kind === "plan-type" && reified.kind === "plan-type")) {
        return fitTemplate(reportError, parameterized.inner, reified.inner);
    }

    if (parameterized.kind === "union-type") {
        if (reified.kind === "union-type") {
            const parameterizedMembers = [...parameterized.members];
            const reifiedMembers = [...reified.members];

            const remove = new Set<TypeExpression>();

            for (const p of parameterizedMembers) {
                for (const r of reifiedMembers) {
                    if (typesEqual(p, r)) {
                        remove.add(p);
                        remove.add(r);
                    }
                }
            }

            const parameterizedMembersRemaining = parameterizedMembers.filter(m => !remove.has(m))
            const reifiedMembersRemaining = reifiedMembers.filter(m => !remove.has(m))

            if (parameterizedMembersRemaining.length === 1 && isGenericParam(parameterizedMembersRemaining[0])) {
                const matches = new Map<string, TypeExpression>();

                matches.set(parameterizedMembersRemaining[0].name.name, simplifyUnions(reportError, {
                    kind: "union-type",
                    members: reifiedMembersRemaining,
                    mutability: undefined,
                    parent: reifiedMembers[0]?.parent,
                    module: undefined, code: undefined, startIndex: undefined, endIndex: undefined
                }))
                
                return matches;
            }
        } else if (parameterized.members.some(isGenericParam)) {
            const param = parameterized.members.find(isGenericParam) as NamedType;

            const matches = new Map<string, TypeExpression>();

            matches.set(param.name.name, reified);

            return matches;
        }
    }

    return new Map();
}

/**
 * Convert a.foo() to foo(a)
 */
export function invocationFromMethodCall(expr: Expression): Invocation|undefined {
    if (expr.kind === 'invocation' && expr.subject.kind === 'property-accessor') {
        const fnName = expr.subject.property.name
        const subjectType = inferType(() => {}, expr.subject.subject)

        if (!propertiesOf(() => {}, subjectType)?.some(p => p.name.name === fnName)) {
            const { module, code, startIndex, endIndex } = expr.subject.property

            const inv: Invocation = {
                ...expr,
                module,
                code,
                startIndex,
                endIndex,
                subject: {
                    kind: 'local-identifier',
                    name: fnName,
                    parent: expr.parent,
                    module,
                    code,
                    startIndex,
                    endIndex
                },
                args: [
                    expr.subject.subject,
                    ...expr.args
                ]
            }

            return inv
        }
    }
}

export const BINARY_OPERATOR_TYPES: Partial<{ [key in BinaryOp]: { left: TypeExpression, right: TypeExpression, output: TypeExpression }[] }> = {
    "+": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: NUMBER_TYPE },
        { left: STRING_TYPE, right: STRING_TYPE, output: STRING_TYPE },
        { left: NUMBER_TYPE, right: STRING_TYPE, output: STRING_TYPE },
        { left: STRING_TYPE, right: NUMBER_TYPE, output: STRING_TYPE },
    ],
    "-": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: NUMBER_TYPE }
    ],
    "*": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: NUMBER_TYPE }
    ],
    "/": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: NUMBER_TYPE }
    ],
    "<": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: BOOLEAN_TYPE }
    ],
    ">": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: BOOLEAN_TYPE }
    ],
    "<=": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: BOOLEAN_TYPE }
    ],
    ">=": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: BOOLEAN_TYPE }
    ],
    "==": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: BOOLEAN_TYPE }
    ],
    "!=": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: BOOLEAN_TYPE }
    ],
}
