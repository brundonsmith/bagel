import { Refinement, ModuleName, Binding, Context } from "../_model/common.ts";
import { BinaryOp, ElementTag, ExactStringLiteral, Expression, IfElseExpression, Invocation, isExpression, ObjectEntry, ObjectLiteral } from "../_model/expressions.ts";
import { ArrayType, Attribute, BOOLEAN_TYPE, FALSE_TYPE, FALSY, FuncType, GenericType, JAVASCRIPT_ESCAPE_TYPE, Mutability, NamedType, EMPTY_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, TRUE_TYPE, TypeExpression, UNKNOWN_TYPE, UnionType, isEmptyType, SpreadArgs, Args, POISONED_TYPE } from "../_model/type-expressions.ts";
import { exists, given, devMode } from "../utils/misc.ts";
import { resolveType, subsumationIssues } from "./typecheck.ts";
import { stripSourceInfo } from "../utils/debugging.ts";
import { AST, Block, PlainIdentifier, SourceInfo } from "../_model/ast.ts";
import { areSame, expressionsEqual, getName, literalType, mapParseTree, maybeOf, tupleOf, typesEqual, unionOf } from "../utils/ast.ts";
import { ValueDeclaration,FuncDeclaration,ProcDeclaration } from "../_model/declarations.ts";
import { resolve, resolveImport } from "./resolve.ts";
import { JSON_AND_PLAINTEXT_EXPORT_NAME } from "../1_parse/index.ts";
import { memo } from "../../lib/ts/reactivity.ts";
import { IfElseStatement } from "../_model/statements.ts";
import { format } from "../other/format.ts";
import { Colors } from "../deps.ts";

export function inferType(
    ctx: Pick<Context, 'allModules'|'visited'|'canonicalModuleName'>,
    ast: Expression,
    skipRefinement?: boolean,
): TypeExpression {
    const baseType = inferTypeInner(ctx, ast)

    let refinedType = baseType
    if (!skipRefinement) {
        const refinements = resolveRefinements(ctx, ast)

        for (const refinement of refinements ?? []) {
            if (expressionsEqual(refinement.targetExpression, ast)) {
                switch (refinement.kind) {
                    case "subtraction": {
                        refinedType = subtract(ctx, refinedType, refinement.type)
                    } break;
                    case "narrowing": {
                        refinedType = narrow(ctx, refinedType, refinement.type)
                    } break;
                }
            }
        }
    }

    return refinedType
}

const inferTypeInner = memo(function inferTypeInner(
    ctx: Pick<Context, 'allModules'|'visited'|'canonicalModuleName'>,
    ast: Expression,
): TypeExpression {
    const { visited } = ctx
    const { parent, module, code, startIndex, endIndex, ..._rest } = ast

    // assert(() => !previouslyVisited.includes(ast))

    if (visited?.includes(ast)) {
        if (devMode) console.log(Colors.red(`Encountered inference cycle and aborted type inference for ${format(ast, { lineBreaks: false })}`))
        if (devMode) console.log([...visited, ast].map(n => '  ' + format(n, { lineBreaks: false })).join('\n'))
        return UNKNOWN_TYPE
    }

    ctx = {
        ...ctx,
        visited: [...visited ?? [], ast]
    }

    switch(ast.kind) {
        case "js-proc":
        case "js-func":
            return ast.type
        case "proc": {
            // TODO: infer arg types just like we do under func
            const procType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type
            
            if (procType.throws) {
                return procType
            } else {
                const thrown = throws(ctx, ast.body)
                return {
                    ...procType,
                    throws: thrown.length > 0
                        ? {
                            kind: 'union-type',
                            members: thrown,
                            ...TYPE_AST_NOISE
                        }
                        : undefined
                }
            }
        }
        case "func": {
            
            // infer callback type based on context
            const typeDictatedByInvocation = (() => {
                const parent = ast.parent

                if (parent?.kind === "invocation") {
                    const parentSubjectType = resolveType(ctx, inferType(ctx, parent.subject))
                    const thisArgIndex = parent.args.findIndex(a => areSame(a, ast))

                    if (parentSubjectType.kind === "func-type" || parentSubjectType.kind === "proc-type") {
                        const thisArgParentType = argType(ctx, parentSubjectType.args, thisArgIndex)

                        if (thisArgParentType && thisArgParentType.kind === ast.type.kind) {
                            return (
                                thisArgParentType.kind === 'generic-type'
                                    ? thisArgParentType.inner as FuncType 
                                    : thisArgParentType
                            )
                        }
                    }
                }
            })()

            const funcType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type

            const inferredFuncType = {
                ...funcType,
                args: (
                    funcType.args.kind === 'args'
                        ? {
                            ...funcType.args,
                            args: funcType.args.args.map((arg, index) =>
                                ({ ...arg, type: arg.type ?? given(typeDictatedByInvocation, ({ args }) => argType(ctx, args, index)) }))
                        }
                        : funcType.args
                ),
                returnType: (
                    funcType.returnType ??
                    typeDictatedByInvocation?.returnType ??
                    // if no return-type is declared, try inferring the type from the inner expression
                    inferType(ctx, ast.body)
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
            const leftType = inferType(ctx, ast.left)
            const rightType = inferType(ctx, ast.right)

            if (leftType.kind === "poisoned-type" || rightType.kind === "poisoned-type") {
                return POISONED_TYPE
            } else if (ast.op.op === '??') {
                return {
                    kind: "union-type",
                    members: [
                        subtract(ctx, leftType, NIL_TYPE),
                        rightType
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else if (ast.op.op === '&&') {
                return {
                    kind: "union-type",
                    members: [
                        rightType,
                        narrow(ctx, leftType, FALSY)
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else if (ast.op.op === '||') {
                return {
                    kind: "union-type",
                    members: [
                        subtract(ctx, leftType, FALSY),
                        rightType
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else if (
                (ast.op.op === '+' || ast.op.op === '-' || ast.op.op === '*' || ast.op.op === '/') &&
                leftType.kind === 'literal-type' && 
                rightType.kind === 'literal-type'
            ) {
                if (
                    ast.op.op === '+' &&
                    (leftType.value.kind === 'exact-string-literal' || leftType.value.kind === 'number-literal') &&
                    (rightType.value.kind === 'exact-string-literal' || rightType.value.kind === 'number-literal')
                ) {
                    // @ts-ignore "Operator '+' cannot be applied to types 'string | number' and 'string | number'." ???
                    return literalType(leftType.value.value + rightType.value.value)
                } else if (leftType.value.kind === 'number-literal' && rightType.value.kind === 'number-literal') {
                    switch (ast.op.op) {
                        case '-': return literalType(leftType.value.value - rightType.value.value)
                        case '*': return literalType(leftType.value.value * rightType.value.value)
                        case '/': return literalType(leftType.value.value / rightType.value.value)
                        default: return UNKNOWN_TYPE
                    }
                } else {
                    return UNKNOWN_TYPE
                }
            } else {
                const types = BINARY_OPERATOR_TYPES[ast.op.op]?.find(({ left, right }) =>
                    !subsumationIssues(ctx, left, leftType) && 
                    !subsumationIssues(ctx, right, rightType))

                if (types != null) {
                    return types.output
                } else if (BINARY_OPERATOR_TYPES[ast.op.op]?.length === 1) {
                    return BINARY_OPERATOR_TYPES[ast.op.op]?.[0].output ?? UNKNOWN_TYPE
                } else {
                    return UNKNOWN_TYPE
                }
            }
        }
        case "negation-operator": return BOOLEAN_TYPE;
        case "invocation": {

            // Creation of nominal values looks like/parses as function 
            // invocation, but needs to be treated differently
            if (ast.subject.kind === "local-identifier") {
                const binding = resolve(ctx, ast.subject.name, ast.subject, true)

                if (binding?.owner.kind === 'type-declaration') {
                    const resolvedType = resolveType(ctx, binding.owner.type)

                    if (resolvedType.kind === "nominal-type") {
                        return resolvedType
                    }
                }
            }
            
            // method call
            const inv = invocationFromMethodCall(ctx, ast)
            if (inv) {
                return inferType(ctx, inv)
            }

            // normal func or proc call
            const subjectType = bindInvocationGenericArgs(ctx, ast)
            if (subjectType?.kind === "func-type") {
                return subjectType.returnType ?? UNKNOWN_TYPE;
            } else {
                return UNKNOWN_TYPE;
            }
        }
        case "property-accessor": {
            if (ast.property.kind === 'plain-identifier') {
                return {
                    kind: "property-type",
                    subject: inferType(ctx, ast.subject),
                    property: ast.property,
                    optional: ast.optional,
                    parent: ast.parent,
                    module: ast.module,
                    code: ast.code,
                    startIndex: ast.startIndex,
                    endIndex: ast.endIndex,
                    mutability: undefined
                }
            } else {
                const subjectType = resolveType(ctx, inferType(ctx, ast.subject));
                const indexType = resolveType(ctx, inferType(ctx, ast.property));

                const nillable = subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")

                const effectiveSubjectType = ast.optional && nillable
                    ? resolveType(ctx, subtract(ctx, subjectType, NIL_TYPE))
                    : subjectType

                const subjectProperties = propertiesOf(ctx, effectiveSubjectType)

                const indexIsNumber = !subsumationIssues(ctx, NUMBER_TYPE, indexType)
                
                
                if (subjectProperties && indexType.kind === "literal-type" && indexType.value.kind === "exact-string-literal") {
                    const key = indexType.value.value;
                    const valueType = subjectProperties.find(entry => getName(entry.name) === key)?.type;

                    return valueType ?? UNKNOWN_TYPE;
                } else if (effectiveSubjectType.kind === "record-type") {
                    if (subsumationIssues(ctx, effectiveSubjectType.keyType, indexType)) {
                        return UNKNOWN_TYPE;
                    } else {
                        return maybeOf(effectiveSubjectType.valueType)
                    }
                } else if (effectiveSubjectType.kind === "array-type" && indexIsNumber) {
                    return maybeOf(effectiveSubjectType.element)
                } else if (effectiveSubjectType.kind === "tuple-type" && indexIsNumber) {
                    if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                        return effectiveSubjectType.members[indexType.value.value] ?? NIL_TYPE
                    } else {
                        return {
                            kind: "union-type",
                            members: [ ...effectiveSubjectType.members, NIL_TYPE ],
                            parent,
                            ...TYPE_AST_NOISE
                        }
                    }
                } else if (effectiveSubjectType.kind === 'string-type' && indexIsNumber) {
                    return maybeOf(STRING_TYPE)
                } else if (effectiveSubjectType.kind === 'literal-type' && effectiveSubjectType.value.kind === 'exact-string-literal' && indexIsNumber) {
                    if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                        const char = effectiveSubjectType.value.value[indexType.value.value]

                        if (char) {
                            return literalType(char)
                        } else {
                            return NIL_TYPE
                        }
                    } else {
                        return maybeOf(STRING_TYPE)
                    }
                }

                return UNKNOWN_TYPE;
            }
        }
        case "if-else-expression":
        case "switch-expression": {
            return {
                kind: "union-type",
                members: [
                    ...ast.cases.map(({ outcome }) => 
                        inferType(ctx, outcome)),
                    ast.defaultCase 
                        ? inferType(ctx, ast.defaultCase) 
                        : (ast.kind === 'if-else-expression'
                            ? NIL_TYPE
                            : null)
                ].filter(exists),
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
                const type = inferType(ctx, ast.inner)
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
            const innerType = inferType(ctx, ast.inner);

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
        case "local-identifier": {
            const binding = resolve(ctx, ast.name, ast)

            if (binding) {
                return getBindingType(ctx, ast, binding)
            } else {
                return POISONED_TYPE
            }
        }
        case "element-tag": {
            return inferType(ctx, elementTagToObject(ast))
        }
        case "object-literal": {
            const entries = ast.entries.map((entry): Attribute | readonly Attribute[] | ObjectEntry | undefined => {
                if (entry.kind === 'local-identifier') {
                    return attribute(entry.name, resolveType(ctx, inferType(ctx, entry)), false)
                } else if (entry.kind === 'spread') {
                    const spreadObj = entry.expr
                    const spreadObjType = resolveType(ctx, inferType(ctx, spreadObj));

                    if (spreadObjType.kind !== 'object-type') {
                        return undefined
                    } else {
                        return spreadObjType.entries
                    }
                } else {
                    const { key, value } = entry

                    if (key.kind === 'plain-identifier' || key.kind === 'exact-string-literal') {
                        const valueType = inferType(ctx, value);
    
                        return {
                            kind: "attribute",
                            name: key,
                            type: valueType,
                            optional: false,
                            forceReadonly: false,
                            parent, module, code, startIndex, endIndex
                        }
                    } else {
                        // arbitrary expression; bail out to record type
                        return entry
                    }
                }
            }).filter(exists).flat()

            if (entries.some((entry): entry is ObjectEntry => entry.kind === 'object-entry')) {
                // bail out to record type

                const keyType = unionOf(entries.map(entry =>
                    entry.kind === 'object-entry' ? inferType(ctx, 
                            entry.key.kind === 'plain-identifier'
                                ? identifierToExactString(entry.key)
                                : entry.key,
                        ) :
                    entry.name.kind === 'exact-string-literal' ? {
                        kind: 'literal-type',
                        value: entry.name,
                        module: entry.module,
                        code: entry.code,
                        startIndex: entry.startIndex,
                        endIndex: entry.endIndex,
                        mutability: undefined
                    } :
                    {
                        kind: 'literal-type',
                        value: identifierToExactString(entry.name),
                        module: entry.module,
                        code: entry.code,
                        startIndex: entry.startIndex,
                        endIndex: entry.endIndex,
                        mutability: undefined
                    }
                ))

                const valueType = unionOf(entries.map(entry =>
                    entry.kind === 'object-entry' ? inferType(ctx, entry.value) :
                    entry.type
                ))

                return {
                    kind: "record-type",
                    keyType,
                    valueType,
                    mutability: "literal",
                    parent, module, code, startIndex, endIndex
                };
            } else {
                return {
                    kind: "object-type",
                    spreads: [],
                    entries: entries as Attribute[],
                    mutability: "literal",
                    parent, module, code, startIndex, endIndex
                };
            }
        }
        case "array-literal": {
            const memberTypes: TypeExpression[] = []
            const arraySpreads: ArrayType[] = []

            for (const entry of ast.entries) {
                if (entry.kind === 'spread') {
                    const spreadType = resolveType(ctx, inferType(ctx, entry.expr))

                    if (spreadType.kind === 'array-type') {
                        arraySpreads.push(spreadType)
                    } else if (spreadType.kind === 'tuple-type') {
                        memberTypes.push(...spreadType.members)
                    } else {
                        memberTypes.push(UNKNOWN_TYPE)
                    }
                } else {
                    memberTypes.push(inferType(ctx, entry))
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
                    element: resolveType(ctx, {
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
        case "regular-expression": return {
            kind: "regular-expression-type",
            mutability: undefined,
            parent, module, code, startIndex, endIndex
        }
        case "string-literal": return STRING_TYPE;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return literalType(ast);
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;
        case "instance-of": return BOOLEAN_TYPE;
        case "as-cast": return ast.type;
        case "error-expression":
            return {
                kind: "error-type",
                inner: inferType(ctx, ast.inner),
                mutability: undefined,
                parent, module, code, startIndex, endIndex
            }
        default:
            // @ts-expect-error: exhaustiveness
            throw Error(ast.kind)
    }
})

function getBindingType(ctx: Pick<Context, "allModules"|"visited"|"canonicalModuleName">, importedFrom: Pick<SourceInfo, 'parent' | 'module'>, binding: Binding): TypeExpression {
    const { allModules, canonicalModuleName } = ctx
    const { parent, module, ..._rest } = importedFrom

    type MutabilityKind = Mutability['mutability']|undefined

    const decl = binding.owner

    switch (decl.kind) {
        case 'value-declaration':{
            if (decl.type != null) return decl.type

            const valueType = resolveType(ctx, inferType(ctx, decl.value))
            const mutability: MutabilityKind = given(valueType.mutability, mutability =>
                decl.isConst || (decl.exported === 'expose' && decl.module !== module)
                    ? 'constant'
                    : mutability
            )

            // if this is a let declaration, its type may need to be made less exact to enable reasonable mutation
            const broadenedValueType = (
                !decl.isConst
                    ? broadenTypeForMutation(ctx, valueType)
                    : valueType
            )

            return {
                ...broadenedValueType,
                mutability: mutability === 'literal' ? 'mutable' : mutability
            } as TypeExpression
        }
        case 'func-declaration':
        case 'proc-declaration': {
            return resolveType(ctx, inferType(ctx, decl.value))
        }
        case 'declaration-statement':
        case 'inline-declaration': {
            if (decl.destination.kind === 'name-and-type' && decl.destination.type != null) return decl.destination.type

            let valueType = resolveType(ctx, inferType(ctx, decl.value))
            if (decl.awaited) {
                if (valueType.kind === 'plan-type') {
                    valueType = valueType.inner
                } else {
                    valueType = UNKNOWN_TYPE
                }
            }

            const mutability: MutabilityKind = given(valueType.mutability, mutability =>
                decl.kind === 'declaration-statement' && decl.isConst
                    ? 'constant'
                    : mutability
            )

            // if this is a let declaration, its type may need to be made less exact to enable reasonable mutation
            const broadenedValueType = (
                decl.kind === 'declaration-statement' && !decl.isConst
                    ? broadenTypeForMutation(ctx, valueType)
                    : valueType
            )

            if (decl.destination.kind === 'name-and-type') {
                return {
                    ...broadenedValueType,
                    mutability: mutability === 'literal' ? 'mutable' : mutability
                } as TypeExpression
            } else {
                if (decl.destination.destructureKind === 'object' && valueType.kind === 'object-type') {
                    const props = propertiesOf(ctx, valueType)
                    return props?.find(prop => getName(prop.name) === binding.identifier.name)?.type ?? UNKNOWN_TYPE
                } else if (decl.destination.destructureKind === 'array') {
                    if (valueType.kind === 'array-type') {
                        return maybeOf(valueType.element)
                    } else if (valueType.kind === 'tuple-type') {
                        const index = decl.destination.properties.findIndex(p => p.name === binding.identifier.name)
                        return valueType.members[index] ?? UNKNOWN_TYPE
                    }
                }
            }
        } break;
        case 'derive-declaration':
            return decl.type ?? resolveType(ctx, inferType(ctx, decl.expr))
        case 'remote-declaration': {
            const inner = decl.type ?? resolveType(ctx, inferType(ctx, decl.expr))

            const { module, code, startIndex, endIndex } = decl

            return {
                kind: 'remote-type',
                inner,
                mutability: undefined,
                module, code, startIndex, endIndex
            }
        }
        case 'func':
        case 'proc': {
            const funcOrProcType = decl.type.kind === 'generic-type' ? decl.type.inner : decl.type

            if (funcOrProcType.args.kind === 'args') {
                const arg = funcOrProcType.args.args.find(a => a.name.name === binding.identifier.name)

                if (arg?.type) {
                    if (arg.optional) {
                        return maybeOf(arg.type)
                    } else {
                        return arg.type
                    }
                }
            } else {
                if (funcOrProcType.args.name?.name === binding.identifier.name) {
                    return funcOrProcType.args.type
                }
            }


            const inferredHolderType = inferType(ctx, decl)


            if (inferredHolderType.kind !== 'func-type' && inferredHolderType.kind !== 'proc-type') return UNKNOWN_TYPE

            if (inferredHolderType.args.kind === 'args') {
                const inferredArg = inferredHolderType.args.args.find(a => a.name?.name === binding.identifier.name)

                if (inferredArg?.type) {
                    if (inferredArg.optional) {
                        return maybeOf(inferredArg.type)
                    } else {
                        return inferredArg.type
                    }
                }
            } else if (inferredHolderType.args.name?.name === binding.identifier.name) {
                return inferredHolderType.args.type
            }

            return UNKNOWN_TYPE
        }
        case 'for-loop': {
            const iteratorType = resolveType(ctx, inferType(ctx, decl.iterator))

            return iteratorType.kind === 'iterator-type'
                ? iteratorType.inner
                : UNKNOWN_TYPE
        }
        case 'try-catch': {
            const thrown = throws(ctx, decl.tryBlock)

            if (thrown.length === 0) {
                return UNKNOWN_TYPE
            } else {
                return {
                    kind: 'union-type',
                    members: thrown,
                    ...TYPE_AST_NOISE
                }
            }
        }
        case 'import-all-declaration': {
            const otherModuleName = canonicalModuleName(decl.module as ModuleName, decl.path.value)
            const otherModule = allModules.get(otherModuleName)?.ast

            if (otherModule == null) {
                return {
                    kind: 'object-type',
                    spreads: [],
                    entries: [],
                    mutability: 'constant',
                    parent,
                    ...AST_NOISE
                }
            } else if (otherModule.moduleType === "bgl") {
                const exportedDeclarations = otherModule.declarations.filter(decl =>
                    (decl.kind === 'value-declaration' || decl.kind === 'func-declaration' || decl.kind === 'proc-declaration')
                    && decl.exported) as (ValueDeclaration|FuncDeclaration|ProcDeclaration)[]

                return {
                    kind: 'object-type',
                    spreads: [],
                    entries: exportedDeclarations.map(otherDecl => {
                        return attribute(
                            otherDecl.name.name, 
                            getBindingType(ctx, decl, { identifier: otherDecl.name, owner: otherDecl }),
                            false
                        )
                    }),
                    mutability: 'mutable',
                    parent,
                    ...AST_NOISE
                }
            } else {
                // json or plaintext
                const contents = otherModule.declarations.find((decl): decl is ValueDeclaration =>
                    decl.kind === 'value-declaration' && decl.name.name === JSON_AND_PLAINTEXT_EXPORT_NAME)

                if (contents) {
                    return inferType(ctx, contents.value)
                } else {
                    return UNKNOWN_TYPE
                }
            }
        }
        case 'import-item': {
            const imported = resolveImport(ctx, decl)

            if (imported) {
                return getBindingType(ctx, importedFrom, { owner: imported, identifier: imported.name })
            }
        } break;
        case 'type-declaration': {
            if (decl.type.kind === 'nominal-type' && decl.type.inner == null) {
                return decl.type
            } else {
                return UNKNOWN_TYPE
            }
        }
        case 'generic-param-type':
            return UNKNOWN_TYPE
        default:
            // @ts-expect-error: exhaustiveness
            if (Deno.env.get('DEV_MODE')) throw Error('getDeclType is nonsensical on declaration of type ' + decl?.kind)
    }

    return UNKNOWN_TYPE
}

/**
 * When initializing a mutable variable, sometimes we want to broaden the type
 * a bit to allow for "normal" kinds of mutation
 */
function broadenTypeForMutation(ctx: Pick<Context, "allModules"|"encounteredNames"|"canonicalModuleName">, type: TypeExpression): TypeExpression {
    if (type.kind === 'union-type') {
        return distillOverlappingUnionMembers(ctx, type)
    } else if (type.kind === 'literal-type') {
        if (type.value.kind === 'exact-string-literal') {
            return STRING_TYPE
        }
        if (type.value.kind === 'number-literal') {
            return NUMBER_TYPE
        }
        if (type.value.kind === 'boolean-literal') {
            return BOOLEAN_TYPE
        }
    } else if (type.mutability === 'mutable' || type.mutability === 'literal') {
        if (type.kind === 'tuple-type') {
            return { ...type, kind: 'array-type', element: distillOverlappingUnionMembers(ctx, { kind: 'union-type', members: type.members.map(m => broadenTypeForMutation(ctx, m)), parent: type.parent, ...TYPE_AST_NOISE }) }
        } else if (type.kind === 'array-type') {
            return { ...type, element: broadenTypeForMutation(ctx, type.element) }
        } else if (type.kind === 'object-type') {
            return { ...type, entries: type.entries.map(attribute => ({ ...attribute, type: broadenTypeForMutation(ctx, attribute.type) })) }
        } else if (type.kind === 'record-type') {
            return { ...type, keyType: broadenTypeForMutation(ctx, type.keyType), valueType: broadenTypeForMutation(ctx, type.valueType) }
        }
    }

    return type
}

export function distillOverlappingUnionMembers(ctx: Pick<Context, "allModules"|"encounteredNames"|"canonicalModuleName">, type: UnionType): UnionType {
    const indicesToDrop = new Set<number>();

    for (let i = 0; i < type.members.length; i++) {
        for (let j = 0; j < type.members.length; j++) {
            if (i !== j) {
                const a = type.members[i];
                const b = type.members[j];

                if (!subsumationIssues(ctx, b, a) && !indicesToDrop.has(j) && resolveType(ctx, b).kind !== 'unknown-type') {
                    indicesToDrop.add(i);
                }
            }
        }
    }

    return {
        ...type,
        members: type.members.filter((type, index) =>
            !indicesToDrop.has(index) && !isEmptyType(type))
    }
}

/**
 * Given some invocation,
 * a) infer its subject's type
 * b) if the subject is generic, bind its provided type args or try to infer 
 *    them
 * c) return the subject's type with generic params filled in, if possible
 */
export function bindInvocationGenericArgs(ctx: Pick<Context, "allModules"|"visited"|"canonicalModuleName">, invocation: Invocation): TypeExpression|undefined {
    const subjectType = resolveType(ctx, inferType(ctx, invocation.subject))

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
                
                if (typeParam.extends && subsumationIssues(ctx, typeParam.extends, typeArg)) {
                    return undefined
                }
            }

            return parameterizedGenericType(
                ctx,
                subjectType, 
                invocation.typeArgs
            )
        } else { // no type arguments (try to infer)
            const funcOrProcType = subjectType.inner

            const spreadArgType = given(invocation.spreadArg, spread => inferType(ctx, spread.expr))
            const invocationSubjectType = {
                ...funcOrProcType,
                args: (
                    funcOrProcType.args.kind === 'args'
                        ? {
                            ...funcOrProcType.args,
                            args: [
                                ...funcOrProcType.args.args.map((arg, index) => ({
                                    ...arg,
                                    type: given(invocation.args[index], arg => inferType(ctx, arg))
                                })),
                                ...(
                                    spreadArgType?.kind === 'tuple-type' ? spreadArgType.members.map((type, index) => {
                                        const { parent, module, code, startIndex, endIndex } = type

                                        return {
                                            kind: 'arg',
                                            name: {
                                                kind: 'plain-identifier',
                                                name: `arg${index}`,
                                                parent, module, code, startIndex, endIndex
                                            },
                                            type,
                                            optional: false,
                                            parent, module, code, startIndex, endIndex
                                        } as const
                                    }) :
                                    // TODO: Spreading an array value into a function with explicit arg types isn't handled yet
                                    []
                                )
                            ]
                        }
                        : {
                            ...funcOrProcType.args,
                            type: unionOf([
                                ...invocation.args.map(arg => inferType(ctx, arg)),
                                ...(
                                    spreadArgType?.kind === 'tuple-type' ? spreadArgType.members :
                                    spreadArgType?.kind === 'array-type' ? [spreadArgType.element] :
                                    []
                                )
                            ])
                        }
                )
            }

            // attempt to infer params for generic
            const inferredBindings = fitTemplate(
                ctx,
                funcOrProcType, 
                invocationSubjectType
            );

            if (inferredBindings && inferredBindings.size === subjectType.typeParams.length) {

                // check that inferred type args fit `extends` clauses
                for (const param of subjectType.typeParams) {
                    const inferred = inferredBindings.get(param.name.name)
                    
                    if (param.extends && inferred && subsumationIssues(ctx, param.extends, inferred)) {
                        return undefined
                    }
                }
    
                return parameterizedGenericType(
                    ctx,
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
export function parameterizedGenericType(ctx: Pick<Context, "allModules"|"canonicalModuleName">, generic: GenericType, typeArgs: readonly TypeExpression[]): TypeExpression {
    
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
            const resolved = resolve(ctx, ast.name.name, ast)

            if (resolved?.owner.kind === 'generic-param-type' && bindings[resolved.owner.name.name]) {
                return bindings[resolved.owner.name.name]
            }
        }

        return ast
    }) as TypeExpression
}

export function subtract(ctx: Pick<Context, "allModules"|"encounteredNames"|"canonicalModuleName">, type: TypeExpression, without: TypeExpression): TypeExpression {
    type = resolveType(ctx, type)
    without = resolveType(ctx, without)

    if (typesEqual(type, without)) {
        return EMPTY_TYPE
    } else if (without.kind === 'union-type') {
        let t = type

        for (const member of without.members) {
            t = subtract(ctx, t, member)
        }

        return t
    } else if (type.kind === "union-type") {
        return {
            ...type,
            members: type.members
                .filter(member => !typesEqual(member, without))
                .map(member => subtract(ctx, member, without))
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

function narrow(ctx: Pick<Context, "allModules" | "encounteredNames"|"canonicalModuleName">, type: TypeExpression, fit: TypeExpression): TypeExpression {
    type = resolveType(ctx, type)
    fit = resolveType(ctx, fit)

    if (type.kind === "union-type") {
        return {
            ...type,
            members: type.members.map(member => narrow(ctx, member, fit))
        }
    } else if (type.kind === 'unknown-type') {
        return fit
    } else if (!subsumationIssues(ctx, fit, type)) {
        return type
    } else {
        return EMPTY_TYPE
    }
}

/**
 * Given some expression, find all Refinements that modify its type in some way
 */
function resolveRefinements(ctx: Pick<Context, "allModules" | "visited" | "canonicalModuleName">, expr: Expression): Refinement[] {
    const refinements: Refinement[] = []

    let current: AST = expr
    let parent = current.parent
    let grandparent = current?.parent?.parent
    let greatGrandparent = current?.parent?.parent?.parent

    // traverse upwards through the AST, looking for nodes that refine the type 
    // of the current expression
    // TODO: for closures, we can carve out some cases where the value does not depend on a reference to a mutable object. but this might get complicated!
    while (parent != null && parent.kind !== 'func' && parent.kind !== 'proc') {
        if (
            (parent.kind === 'case' && grandparent?.kind === 'if-else-expression' && current === parent.outcome) ||
            (parent.kind === 'if-else-expression' && current === parent.defaultCase)
        ) {
            const pastCases = (
                parent.kind === 'case' && grandparent?.kind === 'if-else-expression'
                    ? grandparent.cases.slice(0, grandparent.cases.indexOf(parent))
                    : (parent as IfElseExpression).cases
            )

            // conditions for all past clauses are false
            for (const { condition } of pastCases) {
                refinements.push(conditionToRefinement(ctx, condition, false))
            }
            
            // condition for current clause is true (if not default case)
            if (parent.kind === 'case') {
                refinements.push(conditionToRefinement(ctx, parent.condition, true))
            }
        } else if (parent.kind === 'switch-case' &&  // || parent.kind === 'switch-statement'
                    grandparent?.kind === 'switch-expression' &&  // we know this, but TS doesn't
                    current === parent.outcome) {
            refinements.push({ kind: 'narrowing', type: parent.type, targetExpression: grandparent.value })
        } else if (parent.kind === 'switch-expression' && current === parent.defaultCase) { // || parent.kind === 'switch-statement') {
            // conditions for all past clauses are false
            for (const { type } of parent.cases) {
                refinements.push({ kind: 'subtraction', type, targetExpression: current })
            }
        } else if (parent.kind === 'binary-operator' && current === parent.right) {
            if (parent.op.op === '&&') {
                refinements.push(conditionToRefinement(ctx, parent.left, true))
            } else if (parent.op.op === '||') {
                refinements.push(conditionToRefinement(ctx, parent.left, false))
            }
        } else if (
            (grandparent?.kind === 'case-block' && greatGrandparent?.kind === 'if-else-statement' && parent === grandparent.outcome) ||
            (grandparent?.kind === 'if-else-statement' && parent === grandparent.defaultCase)
        ) {
            // if this isn't the very first statement in the block, the value might have changed
            if (current === parent.statements[0]) {
                // TODO: Refinement might also be safe here if:
                //  - The refined expression is const type (but not just readonly! and not const statements!)
        
                const pastCases = (
                    grandparent.kind === 'case-block' && greatGrandparent?.kind === 'if-else-statement'
                        ? greatGrandparent.cases.slice(0, greatGrandparent.cases.indexOf(grandparent))
                        : (grandparent as IfElseStatement).cases
                )
    
                // conditions for all past clauses are false
                for (const { condition } of pastCases) {
                    refinements.push(conditionToRefinement(ctx, condition, false))
                }
                
                // condition for current clause is true (if not default case)
                if (grandparent.kind === 'case-block') {
                    refinements.push(conditionToRefinement(ctx, grandparent.condition, true))
                }
            }
        }

        current = parent
        parent = current.parent
        grandparent = current?.parent?.parent
        greatGrandparent = current?.parent?.parent?.parent
    }

    return refinements
}

function conditionToRefinement(ctx: Pick<Context, "allModules" | "visited" | "canonicalModuleName">, condition: Expression, conditionIsTrue: boolean): Refinement {
    if (condition.kind === "binary-operator") {

        if (condition.op.op === '==' || condition.op.op === '!=') {
            const leftType = inferType(ctx, condition.left)
            const rightType = inferType(ctx, condition.right)

            const refinementKind =
                (condition.op.op === '==') === conditionIsTrue
                    ? "narrowing"
                    : "subtraction";

            const refinement = 
                rightType.kind === 'nil-type' || rightType.kind === 'literal-type' ? {
                    kind: refinementKind,
                    targetExpression: condition.left,
                    type: rightType
                } as const :
                leftType.kind === 'nil-type' || leftType.kind === 'literal-type' ? {
                    kind: refinementKind,
                    targetExpression: condition.right,
                    type: leftType
                } as const :
                undefined;

            if (refinement != null) {
                return refinement
            }
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

export const propertiesOf = memo(function propertiesOf (
    ctx: Pick<Context, "allModules" | "encounteredNames"|"canonicalModuleName">,
    type: TypeExpression
): readonly Attribute[] | undefined {
    const resolvedType = resolveType(ctx, type)

    switch (resolvedType.kind) {
        case "nominal-type": {
            if (resolvedType.inner) {
                return [
                    attribute("value", resolvedType.inner, false)
                ]
            } else {
                return []
            }
        }
        case "object-type": {
            const attrs = [...resolvedType.entries]

            for (const spread of resolvedType.spreads) {
                const resolved = resolve(ctx, spread.name.name, spread)

                if (resolved != null && (resolved.owner.kind === 'type-declaration' || resolved.owner.kind === 'generic-param-type')) {
                    const type = resolved.owner.kind === 'type-declaration' ? resolved.owner.type : resolved.owner
                    if (type.kind === 'object-type') {
                        attrs.push(...(propertiesOf(ctx, type) ?? []))
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
                attribute("length", literalType(resolvedType.members.length), true)
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
        case "union-type": {
            const allProperties = resolvedType.members.map(m => propertiesOf(ctx, m))
            let sharedProperties: readonly Attribute[] | undefined

            for (const props of allProperties) {
                if (sharedProperties == null) {
                    sharedProperties = [...(props ?? [])]
                } else {
                    const newSharedProperties: Attribute[] = []

                    for (const prop of (sharedProperties as readonly Attribute[])) {
                        const matched = props?.find(p => getName(p.name) === getName(prop.name))

                        if (matched) {
                            if (!typesEqual(matched.type, prop.type)) {
                                newSharedProperties.push({
                                    ...prop,
                                    type: unionOf([matched.type, prop.type])
                                })
                            } else {
                                newSharedProperties.push(prop)
                            }
                        }
                    }

                    sharedProperties = newSharedProperties
                }
            }

            return sharedProperties
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
    ctx: Pick<Context, "allModules"|"canonicalModuleName"> & { descendant?: boolean },
    parameterized: TypeExpression, 
    reified: TypeExpression, 
): ReadonlyMap<string, TypeExpression>|undefined {
    const { descendant } = ctx
    ctx = { ...ctx, descendant: true }

    parameterized = resolveType({ ...ctx, preserveNamedTypes: true }, parameterized)
    reified = resolveType(ctx, reified)

    function isGenericParam(type: TypeExpression): type is NamedType {
        if (type.kind === 'named-type') {
            const binding = resolve(ctx, type.name.name, type)
            return binding?.owner.kind === 'generic-param-type'
        }

        return false
    }

    // exact match
    if (isGenericParam(parameterized)) {
        const matches = new Map<string, TypeExpression>();
        matches.set(parameterized.name.name, reified);
        return matches;
    }

    if ((parameterized.kind === "func-type" && reified.kind === "func-type") 
     || (parameterized.kind === "proc-type" && reified.kind === "proc-type")) {
        const parameterizedArgs = parameterized.args
        const reifiedArgs = reified.args
        const matchGroups: (ReadonlyMap<string, TypeExpression> | undefined)[] = []
        
        if (parameterizedArgs.kind === 'args') {
            if (reifiedArgs.kind === 'args') {
                matchGroups.push(
                    ...parameterizedArgs.args
                        .map((arg, index) => [arg.type, reifiedArgs.args[index].type] as const)
                        .filter((pair): pair is readonly [TypeExpression, TypeExpression] => pair[0] != null && pair[1] != null)
                        .map(([parameterized, reified]) =>
                            fitTemplate(ctx, parameterized, reified))
                )
            } else {
                matchGroups.push(fitTemplate(ctx,
                    unionOf(parameterizedArgs.args.map(arg => arg.type).filter(exists)),
                    reifiedArgs.type))
            }
        } else {
            if (reifiedArgs.kind === 'args') {
                matchGroups.push(fitTemplate(ctx,
                    parameterizedArgs.type,
                    tupleOf(reifiedArgs.args.map(arg => arg.type ?? UNKNOWN_TYPE), 'readonly')))
            } else {
                matchGroups.push(fitTemplate(ctx, parameterizedArgs.type, reifiedArgs.type))
            }
        }

        if (descendant && parameterized.kind === 'func-type' && reified.kind === 'func-type' &&
            parameterized.returnType && reified.returnType) {
            matchGroups.push(
                fitTemplate(ctx, parameterized.returnType, reified.returnType)
            )
        }

        if (matchGroups.some(g => g == null)) { // some match errored
            return undefined
        } else { // combine all matches and return
            const matches = new Map<string, TypeExpression>();

            for (const map of matchGroups as ReadonlyMap<string, TypeExpression>[]) {
                for (const [key, value] of map.entries()) {
                    const existing = matches.get(key)
                    if (existing) {
                        if (!subsumationIssues(ctx, existing, value)) {
                            // do nothing
                        } else if (!subsumationIssues(ctx, value, existing)) {
                            matches.set(key, value);
                        } else {
                            return undefined
                        }
                    } else {
                        matches.set(key, value);
                    }
                }
            }
            
            return matches;
        }
    }

    const mutabilityCompatible = (
        parameterized.mutability === undefined || reified.mutability === undefined ||
        parameterized.mutability === reified.mutability ||
        parameterized.mutability === 'readonly' ||
        reified.mutability === 'literal'
    )
    
    if (parameterized.kind === "array-type" && reified.kind === "array-type" && mutabilityCompatible) {
        return fitTemplate(ctx, parameterized.element, reified.element);
    } else if (parameterized.kind === "array-type" && reified.kind === "tuple-type" && mutabilityCompatible) {
        return fitTemplate(ctx, parameterized.element, unionOf(reified.members))
    } else if (parameterized.kind === "tuple-type" && reified.kind === "tuple-type" && mutabilityCompatible && parameterized.members.length === reified.members.length) {
        const all = new Map<string, TypeExpression>()

        for (let i = 0; i < parameterized.members.length; i++) {
            const matches = fitTemplate(ctx, parameterized.members[i], reified.members[i]);

            for (const key in matches) {
                all.set(key, matches.get(key) as TypeExpression)
            }
        }

        return all
    } else if (parameterized.kind === "object-type" && reified.kind === "object-type" && mutabilityCompatible) {
        const all = new Map<string, TypeExpression>()

        for (const entry of parameterized.entries) {
            const other = reified.entries.find(e => getName(entry.name) === getName(e.name))

            if (other) {
                const matches = fitTemplate(ctx, entry.type, other.type);

                for (const key in matches) {
                    all.set(key, matches.get(key) as TypeExpression)
                }
            }
        }

        return all
    } else if (parameterized.kind === "record-type" && reified.kind === "record-type" && mutabilityCompatible) {
        // TODO
    } else if (
        (parameterized.kind === "iterator-type" && reified.kind === "iterator-type") ||
        (parameterized.kind === "plan-type" && reified.kind === "plan-type") ||
        (parameterized.kind === "remote-type" && reified.kind === "remote-type") ||
        (parameterized.kind === "keyof-type" && reified.kind === "keyof-type") ||
        (parameterized.kind === "valueof-type" && reified.kind === "valueof-type") ||
        (parameterized.kind === "elementof-type" && reified.kind === "elementof-type") ||
        (parameterized.kind === "readonly-type" && reified.kind === "readonly-type")
    ) {
        return fitTemplate(ctx, parameterized.inner, reified.inner);
    } else if (parameterized.kind === "union-type") {
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

                matches.set(parameterizedMembersRemaining[0].name.name, resolveType(ctx, {
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
export function invocationFromMethodCall(ctx: Pick<Context, "allModules" | "visited" | "canonicalModuleName">, expr: Expression): Invocation|undefined {
    if (expr.kind === 'invocation' && expr.subject.kind === 'property-accessor' && expr.subject.property.kind === 'plain-identifier') {
        const fnName = expr.subject.property.name
        const subjectType = inferType(ctx, expr.subject.subject)

        if (!propertiesOf(ctx, subjectType)?.some(p => getName(p.name) === fnName)) {
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

export function throws(ctx: Pick<Context, "allModules" | "visited"|"canonicalModuleName">, block: Block): TypeExpression[] {
    const errorTypes: TypeExpression[] = []

    for (const statement of block.statements) {
        switch (statement.kind) {
            case 'invocation': {
                const procType = inferType(ctx, statement.subject)

                if (procType.kind === 'proc-type' && procType.throws) {
                    errorTypes.push(procType.throws)
                }
            } break;
            // case 'await-statement'
            // case 'destructuring-declaration-statement'
            case 'for-loop':
            case 'while-loop':
                errorTypes.push(...throws(ctx, statement.body))
                break;
            case 'try-catch':
                errorTypes.push(...throws(ctx, statement.catchBlock))
                break;
            case 'if-else-statement':
                for (const { outcome } of statement.cases) {
                    errorTypes.push(...throws(ctx, outcome))
                }
                if (statement.defaultCase) {
                    errorTypes.push(...throws(ctx, statement.defaultCase))
                }
                break;
            case 'throw-statement':
                errorTypes.push(inferType(ctx, statement.errorExpression))
                break;
        }
    }

    return errorTypes
}

const identifierToExactString = (ident: PlainIdentifier): ExactStringLiteral => ({
    kind: 'exact-string-literal',
    value: ident.name,
    module: ident.module,
    code: ident.code,
    startIndex: ident.startIndex,
    endIndex: ident.endIndex,
})

export const elementTagToObject = memo((tag: ElementTag): ObjectLiteral => {
    const { parent, module, code, startIndex, endIndex } = tag

    return {
        kind: 'object-literal',
        entries: [
            {
                kind: 'object-entry',
                key: { kind: 'plain-identifier', name: 'tag', ...AST_NOISE },
                value: {
                    kind: 'exact-string-literal',
                    value: tag.tagName.name,
                    module: tag.tagName.module,
                    code: tag.tagName.code,
                    parent: tag.tagName.parent,
                    startIndex: tag.tagName.startIndex,
                    endIndex: tag.tagName.endIndex
                },
                module: tag.tagName.module,
                code: tag.tagName.code,
                parent: tag.tagName.parent,
                startIndex: tag.tagName.startIndex,
                endIndex: tag.tagName.endIndex
            },
            {
                kind: 'object-entry',
                key: { kind: 'plain-identifier', name: 'attributes', ...AST_NOISE },
                value: {
                    kind: 'object-literal',
                    entries: tag.attributes,
                    parent, module, code,
                    startIndex: tag.attributes[0]?.startIndex,
                    endIndex: tag.attributes[tag.children.length - 1]?.endIndex
                },
                parent, module, code, startIndex, endIndex
            },
            {
                kind: 'object-entry',
                key: { kind: 'plain-identifier', name: 'children', ...AST_NOISE },
                value: {
                    kind: 'array-literal',
                    entries: tag.children,
                    parent, module, code,
                    startIndex: tag.children[0]?.startIndex,
                    endIndex: tag.children[tag.children.length - 1]?.endIndex
                },
                parent, module, code, startIndex, endIndex
            }
        ],
        parent, module, code, startIndex, endIndex
    }
})

export function argType(ctx: Pick<Context, "allModules" | "encounteredNames"|"canonicalModuleName">, args: Args | SpreadArgs, index: number): TypeExpression | undefined {
    if (args.kind === 'args') {
        return args.args[index]?.type
    } else {
        const resolved = resolveType(ctx, args.type)

        if (resolved.kind === 'tuple-type') {
            return resolved.members[index]
        } else if (resolved.kind === 'array-type') {
            return maybeOf(resolved.element)
        } else {
            return undefined
        }
    }
}

export function argsBounds(ctx: Pick<Context, "allModules" | "encounteredNames"|"canonicalModuleName">, args: Args | SpreadArgs) {
    if (args.kind === 'args') {
        return {
            min: args.args.filter(a => !a.optional).length,
            max: args.args.length
        }
    } else {
        const resolved = resolveType(ctx, args.type)

        if (resolved.kind === 'tuple-type') {
            return {
                min: resolved.members.length,
                max: resolved.members.length
            }
        }
    }
}