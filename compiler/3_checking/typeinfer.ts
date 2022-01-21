import { Refinement, TypeBinding, ReportError } from "../_model/common.ts";
import { BinaryOp, Expression, InlineConst, Invocation, isExpression, Spread } from "../_model/expressions.ts";
import { ANY_TYPE, ArrayType, Attribute, BOOLEAN_TYPE, FuncType, GenericType, ITERATOR_OF_ANY, JAVASCRIPT_ESCAPE_TYPE, Mutability, NamedType, NIL_TYPE, NUMBER_TYPE, ProcType, STRING_TYPE, TypeExpression, UnionType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { given } from "../utils/misc.ts";
import { resolveType, subsumes } from "./typecheck.ts";
import { Declaration } from "../_model/declarations.ts";
import { assignmentError, cannotFindName, miscError } from "../errors.ts";
import { withoutSourceInfo } from "../utils/debugging.ts";
import { AST, Module } from "../_model/ast.ts";
import { LetDeclarationStatement,ConstDeclarationStatement } from "../_model/statements.ts";
import { computedFn } from "../mobx.ts";
import { mapParseTree, typesEqual } from "../utils/ast.ts";
import Store from "../store.ts";
import { format } from "../other/format.ts";

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

    if (previouslyVisited.includes(ast)) {
        return UNKNOWN_TYPE
    }

    const visited = [...previouslyVisited, ast]

    switch(ast.kind) {
        case "proc":
            return ast.type
        case "func": {
            
            // infer callback type based on context
            const typeDictatedByParent = (() => {
                const parent = Store.getParent(ast)

                if (parent?.kind === "invocation") {
                    const parentSubjectType = resolveType(reportError, inferType(reportError, parent.subject, visited))
                    const thisArgIndex = parent.args.findIndex(a => a === ast)

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
                    inferType(reportError, ast.body, visited)
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
            let leftType = inferType(reportError, ast.base, visited)

            for (const [op, expr] of ast.ops) {
                const leftTypeResolved = resolveType(reportError, leftType)
                const rightType = inferType(reportError, expr, visited)
                const rightTypeResolved = resolveType(reportError, rightType)

                if (op.op === '??') {
                    leftType = {
                        kind: "union-type",
                        members: [
                            subtract(reportError, leftTypeResolved, NIL_TYPE),
                            rightTypeResolved
                        ],
                        mutability: undefined, module: undefined, code: undefined, startIndex: undefined, endIndex: undefined
                    }
                } else {
                    const types = BINARY_OPERATOR_TYPES[op.op]?.find(({ left, right }) =>
                    subsumes(reportError, left, leftTypeResolved) && subsumes(reportError, right, rightTypeResolved))

                    if (types == null) {
                        leftType = UNKNOWN_TYPE
                        reportError(miscError(op, `Operator '${op.op}' cannot be applied to types '${format(leftType)}' and '${format(rightType)}'`));
                            return BINARY_OPERATOR_TYPES[op.op]?.[0].output ?? UNKNOWN_TYPE
                    } else {
                        leftType = types.output;
                    }
                }
            }

            return leftType;
        }
        case "negation-operator": return BOOLEAN_TYPE;
        case "pipe":
        case "invocation": {
            // Creation of nominal values looks like/parses as function 
            // invocation, but needs to be treated differently
            if (ast.kind === "invocation" && ast.subject.kind === "local-identifier") {
                const binding = Store.getBinding(() => {}, ast.subject.name, ast.subject)
                if (binding?.kind === 'type-binding') {
                    const resolvedType = resolveType(reportError, binding.type)

                    if (resolvedType.kind === "nominal-type") {
                        return resolvedType
                    }
                }
            }

            const subjectType = ast.kind === "invocation"
                ? bindInvocationGenericArgs(reportError, ast)
                : resolveType(reportError, inferType(reportError, ast.subject, visited))

            if (subjectType.kind === "func-type") {
                return subjectType.returnType ?? UNKNOWN_TYPE;
            } else {
                return UNKNOWN_TYPE;
            }
        }
        case "indexer": {
            const baseType = resolveType(reportError, inferType(reportError, ast.subject, visited));
            const indexType = resolveType(reportError, inferType(reportError, ast.indexer, visited));

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
                        kind: "union-type",
                        members: [ baseType.valueType, NIL_TYPE ],
                        ...TYPE_AST_NOISE
                    };
                }
            } else if (baseType.kind === "array-type" && indexIsNumber) {
                return {
                    kind: "union-type",
                    members: [ baseType.element, NIL_TYPE ],
                    ...TYPE_AST_NOISE
                }
            } else if (baseType.kind === "tuple-type" && indexIsNumber) {
                if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                    return baseType.members[indexType.value.value] ?? NIL_TYPE
                } else {
                    return {
                        kind: "union-type",
                        members: [ ...baseType.members, NIL_TYPE ],
                        ...TYPE_AST_NOISE
                    }
                }
            } else if (baseType.kind === 'string-type' && indexIsNumber) {
                return {
                    kind: "union-type",
                    members: [ STRING_TYPE, NIL_TYPE ],
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
                                ...AST_NOISE
                            },
                            ...TYPE_AST_NOISE
                        }
                    } else {
                        return NIL_TYPE
                    }
                } else {
                    return {
                        kind: "union-type",
                        members: [ STRING_TYPE, NIL_TYPE ],
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
                        inferType(reportError, outcome, visited)),
                    ast.defaultCase 
                        ? inferType(reportError, ast.defaultCase, visited) 
                        : NIL_TYPE
                ],
                mutability: undefined,
                module: undefined,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            }
        }
        case "range": {
            const { module, code, startIndex, endIndex, ..._rest } = ast

            return {
                kind: 'iterator-type',
                inner: NUMBER_TYPE,
                mutability: undefined,
                module, code, startIndex, endIndex
            }
        }
        case "debug": {
            if (isExpression(ast.inner)) {
                const type = inferType(reportError, ast.inner, visited)
                console.log(JSON.stringify({
                    bgl: given(ast.inner.code, code =>
                        given(ast.inner.startIndex, startIndex =>
                        given(ast.inner.endIndex, endIndex =>
                            code.substring(startIndex, endIndex)))),
                    type: withoutSourceInfo(type)
                }, null, 2));
                return type;
            } else {
                return UNKNOWN_TYPE
            }
        }
        case "parenthesized-expression":
            return inferType(reportError, ast.inner, visited);
        case "inline-const":
            return inferType(reportError, ast.next, visited);
        case "property-accessor": {
            const subjectType = resolveType(reportError, inferType(reportError, ast.subject, visited));
            const nilTolerantSubjectType = ast.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(reportError, subjectType, NIL_TYPE)
                : subjectType;
            const propertyType = propertiesOf(reportError, nilTolerantSubjectType)?.find(entry => entry.name.name === ast.property.name)?.type

            if (ast.optional && propertyType) {
                return {
                    kind: "union-type",
                    members: [propertyType, NIL_TYPE],
                    mutability: undefined,
                    module: undefined,
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined
                }
            } else {
                const mutability = (
                    propertyType?.mutability == null ? undefined :
                    propertyType.mutability === "mutable" && subjectType.mutability === "mutable" ? "mutable" :
                    subjectType.mutability === "immutable" ? "immutable" :
                    "readonly"
                )
    
                return (
                    given(propertyType, t => ({ ...t, mutability }) as TypeExpression) 
                        ?? UNKNOWN_TYPE
                )
            }
        }
        case "local-identifier": {

            // deno-lint-ignore no-inner-declarations
            function getDeclType(decl: Declaration|LetDeclarationStatement|ConstDeclarationStatement|InlineConst): TypeExpression {
                switch (decl.kind) {
                    case 'value-declaration':
                    case 'let-declaration-statement':
                    case 'const-declaration-statement': {
                        const baseType = decl.type ?? inferType(reportError, decl.value, visited)
                        const mutability: Mutability['mutability']|undefined = given(baseType.mutability, mutability =>
                            (decl.kind === 'value-declaration' && (
                                decl.isConst // const
                                || (decl.exported === 'expose' && decl.module !== ast.module))) // 'exposed' let imported from another module
                            || decl.kind === 'const-declaration-statement' // block const
                                ? 'immutable'
                                : mutability)

                        // if this is a let declaration, its type may need to be made less exact to enable reasonable mutation
                        const correctedBaseType = (
                            decl.kind === 'let-declaration-statement' || (decl.kind === 'value-declaration' && !decl.isConst)
                                ? broadenTypeForMutation(baseType)
                                : baseType
                        )

                        return {
                            ...correctedBaseType,
                            mutability
                        } as TypeExpression
                    }
                    case 'func-declaration':
                    case 'proc-declaration':
                    case 'inline-const': {
                        const baseType = resolveType(reportError, inferType(reportError, decl.value, visited))
                        const mutability: Mutability['mutability']|undefined = given(baseType.mutability, () =>
                            decl.kind === 'func-declaration' || decl.kind === 'proc-declaration'
                                ? 'immutable'
                                : 'readonly')

                        return {
                            ...baseType,
                            mutability
                        } as TypeExpression
                    }
                    default:
                        throw Error('getDeclType is nonsensical on declaration of type ' + decl?.kind)
                }
            }
    
            const binding = Store.getBinding(reportError, ast.name, ast)

            if (binding != null) {
                switch (binding.kind) {
                    case 'basic': return getDeclType(binding.ast)
                    case 'arg': {
                        const funcOrProcType = binding.holder.type.kind === 'generic-type' ? binding.holder.type.inner : binding.holder.type
                        const argType = funcOrProcType.args[binding.argIndex].type

                        if (argType) {
                            return argType
                        }

                        const inferredHolderType = inferType(reportError, binding.holder, visited)
                        if (inferredHolderType.kind === 'func-type' || inferredHolderType.kind === 'proc-type') {
                            return inferredHolderType.args[binding.argIndex].type ?? UNKNOWN_TYPE
                        }
                        
                        return UNKNOWN_TYPE
                    }
                    case 'iterator': {
                        const iteratorType = resolveType(reportError, inferType(reportError, binding.iterator, visited))
    
                        if (!subsumes(reportError, ITERATOR_OF_ANY, iteratorType)) {
                            reportError(assignmentError(binding.iterator, ITERATOR_OF_ANY, iteratorType))
                        }
    
                        return iteratorType.kind === 'iterator-type'
                            ? iteratorType.inner
                            : UNKNOWN_TYPE
                    }
                    case 'type-binding': break;
                    default:
                        // @ts-expect-error
                        throw Error('Unreachable!' + binding.kind)
                }
            }

            reportError(cannotFindName(ast))
            return UNKNOWN_TYPE
        }
        case "element-tag": {
            return {
                kind: "element-type",
                // tagName: ast.tagName,
                // attributes: ast.attributes
                mutability: undefined,
                module: undefined,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "object-literal": {
            const entries = ast.entries.map(entry => {
                if (Array.isArray(entry)) {
                    const [name, value] = entry

                    const type = resolveType(reportError, inferType(reportError, value, visited));
                    return {
                        kind: "attribute",
                        name,
                        type, 
                        mutability: undefined,
                        module: undefined,
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined,
                    }
                } else {
                    const spreadObj = (entry as Spread).expr
                    const spreadObjType = resolveType(reportError, inferType(reportError, spreadObj, visited));

                    if (spreadObjType.kind !== 'object-type') {
                        reportError(miscError(spreadObj, `Can only spread objects into an object; found ${format(spreadObjType)}`))
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
                module: undefined,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "array-literal": {
            const memberTypes: TypeExpression[] = []
            const arraySpreads: ArrayType[] = []

            for (const entry of ast.entries) {
                if (entry.kind === 'spread') {
                    const spreadType = resolveType(reportError, inferType(reportError, entry.expr, visited))

                    if (spreadType.kind === 'array-type') {
                        arraySpreads.push(spreadType)
                    } else if (spreadType.kind === 'tuple-type') {
                        memberTypes.push(...spreadType.members)
                    } else {
                        reportError(miscError(entry.expr, `Can only spread arrays into an array; found ${format(spreadType)}`))
                        memberTypes.push(UNKNOWN_TYPE)
                    }
                } else {
                    memberTypes.push(inferType(reportError, entry, visited))
                }
            }

            if (arraySpreads.length === 0) {
                return {
                    kind: "tuple-type",
                    members: memberTypes,
                    mutability: "mutable",
                    module: undefined,
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined,
                }
            } else {
                return {
                    kind: "array-type",
                    element: simplifyUnions(reportError, {
                        kind: "union-type",
                        members: [...memberTypes, ...arraySpreads.map(t => t.element)],
                        mutability: undefined,
                        module: undefined,
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined,
                    }),
                    mutability: "mutable",
                    module: undefined,
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined,
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
            module: ast.module,
            code: ast.code,
            startIndex: ast.startIndex,
            endIndex: ast.endIndex,
        };
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;
        case "as-cast": return ast.type;
        default:
            // @ts-expect-error
            throw Error(ast.kind)
    }
})

function broadenTypeForMutation(type: TypeExpression) {
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
    } else if (type.kind === 'tuple-type') {
        return { ...type, kind: 'array-type', element: { kind: 'union-type', members: type.members, ...TYPE_AST_NOISE } }
    }

    // TODO: This needs to include object literals, and also probably be recursive. Might need its own function.
    return type
}

/**
 * Given some invocation,
 * a) infer its subject's type
 * b) if the subject is generic, bind its provided type args or try to infer 
 *    them
 */
export function bindInvocationGenericArgs(reportError: ReportError, invocation: Invocation): FuncType|ProcType {
    let subjectType = resolveType(reportError, inferType(reportError, invocation.subject))

    if (subjectType.kind === 'generic-type' && (subjectType.inner.kind === "func-type" || subjectType.inner.kind === "proc-type")) {
        if (subjectType.typeParams.length > 0) {
            if (invocation.typeArgs.length > 0) { // explicit type arguments
                if (subjectType.typeParams.length !== invocation.typeArgs.length) {
                    reportError(miscError(invocation, `Expected ${subjectType.typeParams.length} type arguments, but got ${invocation.typeArgs.length}`))
                }

                subjectType = parameterizedGenericType(
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

                if (inferredBindings.size === subjectType.typeParams.length) {
                    subjectType = parameterizedGenericType(
                        reportError, 
                        subjectType, 
                        subjectType.typeParams.map(param =>
                            inferredBindings.get(param.name.name) ?? UNKNOWN_TYPE)
                    )
                } else {
                    reportError(miscError(invocation, `Failed to infer generic type parameters; ${subjectType.typeParams.length} type arguments should be specified explicitly`))
                }
            }
        }
    }

    return subjectType as FuncType|ProcType
}

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
    } else { // TODO: There's probably more we can do here
        return type
    }
}

function resolveRefinements(expr: Expression): Refinement[] {
    const refinements: Refinement[] = []

    let current: AST = expr
    let parent = Store.getParent(expr)
    let grandparent = given(parent, Store.getParent)

    // traverse upwards through the AST, looking for nodes that refine the type 
    // of the current expression
    while (parent != null) {
        if (parent.kind === 'case') {
            if (grandparent?.kind === 'if-else-expression' && current === parent.outcome) {
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
        parent = Store.getParent(parent)
        grandparent = given(parent, Store.getParent)
    }

    return refinements
}

function typeFromTypeof(typeofStr: string): TypeExpression|undefined {
    return (
        typeofStr === "string" ? STRING_TYPE :
        typeofStr === "number" ? NUMBER_TYPE :
        typeofStr === "boolean" ? BOOLEAN_TYPE :
        typeofStr === "nil" ? NIL_TYPE :
        typeofStr === "array" ? { kind: "array-type", element: ANY_TYPE, mutability: "readonly", module: undefined, code: undefined, startIndex: undefined, endIndex: undefined } :
        typeofStr === "object" ? { kind: "record-type", keyType: ANY_TYPE, valueType: ANY_TYPE, mutability: "readonly", module: undefined, code: undefined, startIndex: undefined, endIndex: undefined } :
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
                {
                    kind: "attribute",
                    name: { kind: "plain-identifier", name: "value", ...AST_NOISE },
                    type: resolvedType.inner,
                    ...TYPE_AST_NOISE
                }
            ]
        }
        case "iterator-type":
        case "plan-type": {
            const preludeModule = given(resolvedType.module, module => Store.parsed(module, true)?.ast) as Module
            const generic = (Store.getBinding(reportError, resolvedType.kind === 'iterator-type' ? 'Iterator' : 'Plan', preludeModule.declarations[0]) as TypeBinding).type
            return propertiesOf(reportError, {
                kind: "bound-generic-type",
                generic,
                typeArgs: [resolvedType.inner],
                mutability: undefined,
                module: resolvedType.module,
                code: resolvedType.code,
                startIndex: resolvedType.startIndex,
                endIndex: resolvedType.endIndex,
            })
        }
        case "object-type": {
            const attrs = [...resolvedType.entries]

            for (const spread of resolvedType.spreads) {
                const resolved = Store.getBinding(reportError, spread.name.name, spread)

                if (resolved != null && resolved.kind === 'type-binding' && resolved.type.kind === 'object-type') {
                    attrs.push(...(propertiesOf(reportError, resolved.type) ?? []))
                } else {
                    if (resolved != null) {
                        if (resolved.kind !== 'type-binding') {
                            reportError(miscError(spread, `${spread.name.name} is not a type`))
                        } else if (resolved.type.kind !== 'object-type') {
                            reportError(miscError(spread, `${format(resolved.type)} is not an object type; can only spread object types into object types`))
                        }
                    }
                }
            }

            return attrs
        }
        case "string-type": {
            return [
                attribute("length", NUMBER_TYPE),
            ]
        }
        case "array-type": {
        // case "tuple-type":
            const props: Attribute[] = [
                attribute("length", NUMBER_TYPE),
            ];

            if (resolvedType.mutability === "mutable") {
                props.push(attribute("push", {
                    kind: "proc-type",
                    args: [{
                        kind: "arg",
                        name: { kind: "plain-identifier", name: "el", ...AST_NOISE },
                        type: resolvedType.element,
                        ...AST_NOISE
                    }],
                    ...TYPE_AST_NOISE
                }))
            }

            return props;
        }
    }
})

function attribute(name: string, type: TypeExpression): Attribute {
    return {
        kind: "attribute",
        name: { kind: "plain-identifier", name, ...AST_NOISE },
        type,
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
): ReadonlyMap<string, TypeExpression> {

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

    if (parameterized.kind === "func-type" && reified.kind === "func-type") {
        const matchGroups = [
            ...parameterized.args.map((arg, index) =>
                fitTemplate(reportError, arg.type ?? UNKNOWN_TYPE, reified.args[index].type ?? UNKNOWN_TYPE)),
            // fitTemplate(reportError, getParent, getBinding, parameterized.returnType ?? UNKNOWN_TYPE, reified.returnType ?? UNKNOWN_TYPE)
        ]

        const matches = new Map<string, TypeExpression>();

        for (const map of matchGroups) {
            for (const [key, value] of map.entries()) {
                const existing = matches.get(key)
                if (existing) {
                    if (!subsumes(reportError, existing, value)) {
                        matches.set(key, simplifyUnions(reportError, {
                            kind: "union-type",
                            members: [value, existing],
                            mutability: undefined,
                            module: undefined, code: undefined, startIndex: undefined, endIndex: undefined
                        }))
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
                    module: undefined, code: undefined, startIndex: undefined, endIndex: undefined
                }))
                
                return matches;
            }
        } else if(parameterized.members.some(isGenericParam)) {
            const param = parameterized.members.find(isGenericParam) as NamedType;

            const matches = new Map<string, TypeExpression>();

            matches.set(param.name.name, reified);

            return matches;
        }
    }

    return new Map();
}

const BINARY_OPERATOR_TYPES: Partial<{ [key in BinaryOp]: { left: TypeExpression, right: TypeExpression, output: TypeExpression }[] }> = {
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
