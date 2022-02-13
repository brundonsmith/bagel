import { Refinement, ReportError, ModuleName } from "../_model/common.ts";
import { BinaryOp, Expression, Invocation, isExpression, Spread } from "../_model/expressions.ts";
import { ANY_TYPE, ArrayType, Attribute, BOOLEAN_TYPE, FuncType, GenericType, JAVASCRIPT_ESCAPE_TYPE, Mutability, NamedType, NIL_TYPE, NUMBER_TYPE, ProcType, STRING_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { given } from "../utils/misc.ts";
import { resolveType, subsumes } from "./typecheck.ts";
import { assignmentError, cannotFindModule } from "../errors.ts";
import { stripSourceInfo } from "../utils/debugging.ts";
import { AST } from "../_model/ast.ts";
import { computedFn } from "../mobx.ts";
import { areSame, mapParseTree, typesEqual } from "../utils/ast.ts";
import Store from "../store.ts";
import { format } from "../other/format.ts";
import { ValueDeclaration,FuncDeclaration,ProcDeclaration } from "../_model/declarations.ts";

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

    return simplifyUnions(reportError, refinedType)
}

const inferTypeInner = computedFn((
    reportError: ReportError,
    ast: Expression,
    previouslyVisited: readonly AST[],
): TypeExpression => {
    const infer = (expr: Expression) => inferType(reportError, expr, visited)
    const resolve = (type: TypeExpression) => resolveType(reportError, type)

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
                    const parentSubjectType = resolve(infer(parent.subject))
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
            let leftType = infer(ast.base)

            for (const [op, expr] of ast.ops) {
                const leftTypeResolved = resolve(leftType)
                const rightType = infer(expr)
                const rightTypeResolved = resolve(rightType)

                if (op.op === '??') {
                    leftType = {
                        kind: "union-type",
                        members: [
                            subtract(reportError, leftTypeResolved, NIL_TYPE),
                            rightTypeResolved
                        ],
                        mutability: undefined, parent, module, code, startIndex, endIndex
                    }
                } else {
                    const types = BINARY_OPERATOR_TYPES[op.op]?.find(({ left, right }) =>
                        subsumes(reportError, left, leftTypeResolved) && 
                        subsumes(reportError, right, rightTypeResolved))

                    if (types == null) {
                        return BINARY_OPERATOR_TYPES[op.op]?.[0].output ?? UNKNOWN_TYPE
                    } else {
                        leftType = types.output;
                    }
                }
            }

            return leftType;
        }
        case "negation-operator": return BOOLEAN_TYPE;
        case "invocation": {

            // Creation of nominal values looks like/parses as function 
            // invocation, but needs to be treated differently
            if (ast.subject.kind === "local-identifier") {
                const binding = Store.getBinding(() => {}, ast.subject.name, ast.subject)
                if (binding?.kind === 'type-binding') {
                    const resolvedType = resolve(binding.type)

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
            const baseType = resolve(infer(ast.subject));
            const indexType = resolve(infer(ast.indexer));

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
            const subjectType = resolve(infer(ast.subject));
            const nilTolerantSubjectType = ast.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(reportError, subjectType, NIL_TYPE)
                : subjectType;
            const property = propertiesOf(reportError, nilTolerantSubjectType)?.find(entry => entry.name.name === ast.property.name)

            if (ast.optional && property) {
                return {
                    kind: "maybe-type",
                    inner: property.type,
                    mutability: undefined,
                    parent, module, code, startIndex, endIndex
                }
            } else {
                const mutability = (
                    property?.type?.mutability == null ? undefined :
                    property.type.mutability === "mutable" && subjectType.mutability === "mutable" && !property.forceReadonly ? "mutable" :
                    subjectType.mutability === "immutable" ? "immutable" :
                    "readonly"
                )
    
                return (
                    given(property, property => (
                        property.optional
                            ?  {
                                kind: "maybe-type",
                                inner: { ...property.type, mutability },
                                mutability: undefined,
                                module, code, startIndex, endIndex
                            }
                            : { ...property.type, mutability }) as TypeExpression) 
                        ?? UNKNOWN_TYPE
                )
            }
        }
        case "local-identifier": {
            const binding = Store.getBinding(reportError, ast.name, ast)

            if (binding?.kind === 'value-binding') {
                const decl = binding.owner

                switch (decl.kind) {
                    case 'value-declaration':
                    case 'value-declaration-statement': {
                        const baseType = decl.type ?? resolve(infer(decl.value))
                        const mutability: Mutability['mutability']|undefined = given(baseType.mutability, mutability =>
                            decl.isConst || (decl.kind === 'value-declaration' && decl.exported === 'expose' && decl.module !== ast.module)
                                ? 'immutable'
                                : mutability)

                        // if this is a let declaration, its type may need to be made less exact to enable reasonable mutation
                        const broadenedBaseType = (
                            !decl.isConst
                                ? broadenTypeForMutation(baseType)
                                : baseType
                        )

                        return {
                            ...broadenedBaseType,
                            mutability
                        } as TypeExpression
                    }
                    case 'func-declaration':
                    case 'proc-declaration':
                    case 'inline-const-declaration': {
                        const baseType = resolve(infer(decl.value))
                        const mutability: Mutability['mutability']|undefined = given(baseType.mutability, () =>
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

                        const planType = resolve(infer(decl.plan))
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

                        const fnType = resolve(infer(decl.fn))
                        if (fnType.kind === 'func-type' && fnType.returnType) {
                            return fnType.returnType
                        }

                        return UNKNOWN_TYPE
                    }
                    case 'remote-declaration': {
                        const fnType = resolve(infer(decl.fn))

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
                        const objectOrArrayType = resolve(infer(decl.value))

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
                        const iteratorType = resolve(infer(decl.iterator))

                        return iteratorType.kind === 'iterator-type'
                            ? iteratorType.inner
                            : UNKNOWN_TYPE
                    }
                    case 'import-all-declaration': {
                        const otherModule = Store.getModuleByName(decl.module as ModuleName, decl.path.value)

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
                    const [name, value] = entry

                    const type = resolve(infer(value));
                    return {
                        kind: "attribute",
                        name,
                        type, 
                        mutability: undefined,
                        parent, module, code, startIndex, endIndex
                    }
                } else {
                    const spreadObj = (entry as Spread).expr
                    const spreadObjType = resolve(infer(spreadObj));

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
                mutability: "mutable",
                parent, module, code, startIndex, endIndex
            };
        }
        case "array-literal": {
            const memberTypes: TypeExpression[] = []
            const arraySpreads: ArrayType[] = []

            for (const entry of ast.entries) {
                if (entry.kind === 'spread') {
                    const spreadType = resolve(infer(entry.expr))

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
                    mutability: "mutable",
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
                    mutability: "mutable",
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
            const resolved = Store.getBinding(reportError, ast.name.name, ast)

            if (resolved?.kind === 'type-binding' && resolved.type.kind === 'generic-param-type' && bindings[resolved.type.name.name]) {
                return bindings[resolved.type.name.name]
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
            return UNKNOWN_TYPE
        }
    }
    
    return type;
}

export function subtract(reportError: ReportError, type: TypeExpression, without: TypeExpression): TypeExpression {
    type = resolveType(reportError, type)
    without = resolveType(reportError, without)

    if (type.kind === "union-type") {
        return simplifyUnions(reportError, {
            ...type,
            members: type.members.filter(member => !subsumes(reportError, without, member))
        })
    } else { // TODO: There's probably more we can do here
        return type
    }
}

function narrow(reportError: ReportError, type: TypeExpression, fit: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        return simplifyUnions(reportError, {
            ...type,
            members: type.members.filter(member => subsumes(reportError, fit, member))
        })
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
            if (grandparent?.kind === 'if-else-expression' && areSame(current, parent.outcome)) {
                const condition = parent.condition.kind === 'parenthesized-expression' ? parent.condition.inner : parent.condition;

                if (condition.kind === "binary-operator" && condition.ops[0][0].op === "!=") {
                    const targetExpression = 
                        condition.ops[0][1].kind === 'nil-literal' ? condition.base :
                        condition.base.kind === "nil-literal" ? condition.ops[0][1] :
                        undefined;

                    if (targetExpression != null) {
                        refinements.push({ kind: "subtraction", type: NIL_TYPE, targetExpression })
                    }
                }

                if (condition.kind === "binary-operator" && condition.ops[0][0].op === "==") {
                    const bits = (
                        condition.base.kind === "invocation" && condition.base.subject.kind === "local-identifier" && condition.base.subject.name === "typeof" 
                        && condition.ops[0][1].kind === "string-literal" && typeof condition.ops[0][1].segments[0] === "string" ? [condition.base.args[0], condition.ops[0][1].segments[0]] as const :
                        condition.base.kind === "string-literal" && typeof condition.base.segments[0] === "string"
                        && condition.ops[0][1].kind === "invocation" && condition.ops[0][1].subject.kind === "local-identifier" && condition.ops[0][1].subject.name === "typeof" ? [condition.ops[0][1].args[0], condition.base.segments[0]] as const :
                        undefined
                    )
                    
                    if (bits) {
                        const [targetExpression, typeofStr] = bits
    
                        const refinedType = typeFromTypeof(typeofStr)
                        
                        if (refinedType) {
                            refinements.push({ kind: "narrowing", type: refinedType, targetExpression })
                        }
                    }
                }

                if (condition.kind === 'instance-of') {
                    refinements.push({ kind: "narrowing", type: condition.type, targetExpression: condition.expr })
                }
            } else if (grandparent?.kind === "switch-expression") {
                if (grandparent.value.kind === "invocation" &&
                    grandparent.value.subject.kind === "local-identifier" &&
                    grandparent.value.subject.name === "typeof" &&
                    parent.condition.kind === "string-literal" &&
                    parent.condition.segments.length === 1 &&
                    typeof parent.condition.segments[0] === 'string') {
                    
                    const targetExpression = grandparent.value.args[0]
                    const typeofStr = parent.condition.segments[0]

                    const refinedType = typeFromTypeof(typeofStr)

                    if (refinedType) {
                        refinements.push({ kind: "narrowing", type: refinedType, targetExpression })
                    }
                }
            }
        }

        current = parent
        parent = parent.parent
        grandparent =parent?.parent
    }

    return refinements
}

function typeFromTypeof(typeofStr: string): TypeExpression|undefined {
    return (
        typeofStr === "string" ? STRING_TYPE :
        typeofStr === "number" ? NUMBER_TYPE :
        typeofStr === "boolean" ? BOOLEAN_TYPE :
        typeofStr === "nil" ? NIL_TYPE :
        typeofStr === "array" ? { kind: "array-type", element: ANY_TYPE, mutability: "readonly", parent: undefined, module: undefined, code: undefined, startIndex: undefined, endIndex: undefined } :
        typeofStr === "object" ? { kind: "record-type", keyType: ANY_TYPE, valueType: ANY_TYPE, mutability: "readonly", parent: undefined, module: undefined, code: undefined, startIndex: undefined, endIndex: undefined } :
        // TODO
        // type.value === "set" ?
        // type.value === "class-instance" ?
        undefined
    )
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
                const resolved = Store.getBinding(reportError, spread.name.name, spread)

                if (resolved != null && resolved.kind === 'type-binding' && resolved.type.kind === 'object-type') {
                    attrs.push(...(propertiesOf(reportError, resolved.type) ?? []))
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
        case "remote-type": {
            return [
                attribute("value", resolvedType.inner, true),
                attribute("loading", BOOLEAN_TYPE, true),
                // TODO: reload() proc
            ]
        }
    }
})

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

const AST_NOISE = { module: undefined, code: undefined, startIndex: undefined, endIndex: undefined }
const TYPE_AST_NOISE = { mutability: undefined, ...AST_NOISE }

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
            const binding = Store.getBinding(reportError, type.name.name, type)
            return binding?.kind === 'type-binding' && binding.type.kind === 'generic-param-type'
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
    "&&": [
        { left: BOOLEAN_TYPE, right: BOOLEAN_TYPE, output: BOOLEAN_TYPE }
    ],
    "||": [
        { left: BOOLEAN_TYPE, right: BOOLEAN_TYPE, output: BOOLEAN_TYPE }
    ],
    "==": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: BOOLEAN_TYPE }
    ],
    "!=": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: BOOLEAN_TYPE }
    ],
}
