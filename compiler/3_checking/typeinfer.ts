import { Refinement, ModuleName, Binding } from "../_model/common.ts";
import { BinaryOp, Case, ElementTag, ExactStringLiteral, Expression, Invocation, isExpression, LocalIdentifier, ObjectEntry, ObjectLiteral } from "../_model/expressions.ts";
import { ArrayType, Attribute, BOOLEAN_TYPE, FALSE_TYPE, FALSY, FuncType, GenericType, JAVASCRIPT_ESCAPE_TYPE, Mutability, NamedType, EMPTY_TYPE, NIL_TYPE, NUMBER_TYPE, ProcType, STRING_TYPE, TRUE_TYPE, TypeExpression, UNKNOWN_TYPE, UnionType, isEmptyType } from "../_model/type-expressions.ts";
import { exists, given } from "../utils/misc.ts";
import { resolveType, subsumationIssues } from "./typecheck.ts";
import { stripSourceInfo } from "../utils/debugging.ts";
import { AST, Block, PlainIdentifier } from "../_model/ast.ts";
import { areSame, expressionsEqual, getName, literalType, mapParseTree, maybeOf, typesEqual, unionOf } from "../utils/ast.ts";
import { getModuleByName } from "../store.ts";
import { ValueDeclaration,FuncDeclaration,ProcDeclaration } from "../_model/declarations.ts";
import { resolve, resolveImport } from "./resolve.ts";
import { JSON_AND_PLAINTEXT_EXPORT_NAME } from "../1_parse/index.ts";
import { computedFn } from "../../lib/ts/reactivity.ts";
import { CaseBlock } from "../_model/statements.ts";

export function inferType(
    ast: Expression,
    visited: readonly AST[] = [],
): TypeExpression {
    const baseType = inferTypeInner(ast, visited)

    let refinedType = baseType
    {
        const refinements = resolveRefinements(ast)

        for (const refinement of refinements ?? []) {
            if (expressionsEqual(refinement.targetExpression, ast)) {
                switch (refinement.kind) {
                    case "subtraction": {
                        refinedType = subtract(refinedType, refinement.type)
                    } break;
                    case "narrowing": {
                        refinedType = narrow(refinedType, refinement.type)
                    } break;
                }
            }
        }
    }

    return refinedType
}

const inferTypeInner = computedFn(function inferTypeInner(
    ast: Expression,
    previouslyVisited: readonly AST[],
): TypeExpression {
    const { parent, module, code, startIndex, endIndex, ..._rest } = ast

    if (previouslyVisited.includes(ast)) {
        return UNKNOWN_TYPE
    }

    const visited = [...previouslyVisited, ast]

    switch(ast.kind) {
        case "js-proc":
        case "js-func":
            return ast.type
        case "proc": {
            // TODO: infer arg types just like we do under func
            const thrown = throws(ast.body)
            const procType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type

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
        case "func": {
            
            // infer callback type based on context
            const typeDictatedByParent = (() => {
                const parent = ast.parent

                if (parent?.kind === "invocation") {
                    const parentSubjectType = resolveType(inferType(parent.subject, visited))
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
                    inferType(ast.body, visited)
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
            const leftType = inferType(ast.left, visited)
            const rightType = inferType(ast.right, visited)
            
            if (ast.op.op === '??') {
                return {
                    kind: "union-type",
                    members: [
                        subtract(leftType, NIL_TYPE),
                        rightType
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else if (ast.op.op === '&&') {
                return {
                    kind: "union-type",
                    members: [
                        rightType,
                        narrow(leftType, FALSY)
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else if (ast.op.op === '||') {
                return {
                    kind: "union-type",
                    members: [
                        subtract(leftType, FALSY),
                        rightType
                    ],
                    mutability: undefined, parent, module, code, startIndex, endIndex
                }
            } else {
                const types = BINARY_OPERATOR_TYPES[ast.op.op]?.find(({ left, right }) =>
                    !subsumationIssues(left, leftType) && 
                    !subsumationIssues(right, rightType))

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
                const binding = resolve(ast.subject.name, ast.subject, true)

                if (binding?.owner.kind === 'type-declaration') {
                    const resolvedType = resolveType(binding.owner.type)

                    if (resolvedType.kind === "nominal-type") {
                        return resolvedType
                    }
                }
            }
            
            // method call
            const inv = invocationFromMethodCall(ast)
            if (inv) {
                return inferType(inv, visited)
            }

            // normal func or proc call
            const subjectType = bindInvocationGenericArgs(ast)
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
                    subject: inferType(ast.subject, visited),
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
                const subjectType = resolveType(inferType(ast.subject, visited));
                const indexType = resolveType(inferType(ast.property, visited));

                const nillable = subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")

                const indexIsNumber = !subsumationIssues(NUMBER_TYPE, indexType)
                const subjectProperties = ast.optional && nillable
                    ? propertiesOf(subtract(subjectType, NIL_TYPE))
                    : propertiesOf(subjectType)
                
                if (subjectProperties && indexType.kind === "literal-type" && indexType.value.kind === "exact-string-literal") {
                    const key = indexType.value.value;
                    const valueType = subjectProperties.find(entry => getName(entry.name) === key)?.type;

                    return valueType ?? UNKNOWN_TYPE;
                } else if (subjectType.kind === "record-type") {
                    if (subsumationIssues(subjectType.keyType, indexType)) {
                        return UNKNOWN_TYPE;
                    } else {
                        return maybeOf(subjectType.valueType)
                    }
                } else if (subjectType.kind === "array-type" && indexIsNumber) {
                    return maybeOf(subjectType.element)
                } else if (subjectType.kind === "tuple-type" && indexIsNumber) {
                    if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                        return subjectType.members[indexType.value.value] ?? NIL_TYPE
                    } else {
                        return {
                            kind: "union-type",
                            members: [ ...subjectType.members, NIL_TYPE ],
                            parent,
                            ...TYPE_AST_NOISE
                        }
                    }
                } else if (subjectType.kind === 'string-type' && indexIsNumber) {
                    return maybeOf(STRING_TYPE)
                } else if (subjectType.kind === 'literal-type' && subjectType.value.kind === 'exact-string-literal' && indexIsNumber) {
                    if (indexType.kind === 'literal-type' && indexType.value.kind === 'number-literal') {
                        const char = subjectType.value.value[indexType.value.value]

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
                        inferType(outcome, visited), visited),
                    ast.defaultCase 
                        ? inferType(ast.defaultCase, visited) 
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
                const type = inferType(ast.inner, visited)
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
            const innerType = inferType(ast.inner, visited);

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
            const binding = resolve(ast.name, ast)

            if (binding) {
                return getBindingType(ast, binding, visited)
            }

            return UNKNOWN_TYPE
        }
        case "element-tag": {
            return inferType(elementTagToObject(ast))
        }
        case "object-literal": {
            const entries = ast.entries.map((entry): Attribute | readonly Attribute[] | ObjectEntry | undefined => {
                if (entry.kind === 'local-identifier') {
                    return attribute(entry.name, resolveType(inferType(entry)), false)
                } else if (entry.kind === 'spread') {
                    const spreadObj = entry.expr
                    const spreadObjType = resolveType(inferType(spreadObj, visited));

                    if (spreadObjType.kind !== 'object-type') {
                        return undefined
                    } else {
                        return spreadObjType.entries
                    }
                } else {
                    const { key, value } = entry

                    if (key.kind === 'plain-identifier' || key.kind === 'exact-string-literal') {
                        const valueType = inferType(value, visited);
    
                        return {
                            kind: "attribute",
                            name: key,
                            type: valueType,
                            optional: false,
                            forceReadonly: false,
                            mutability: undefined,
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
                    entry.kind === 'object-entry' ? inferType(
                        entry.key.kind === 'plain-identifier'
                            ? identifierToExactString(entry.key)
                            : entry.key) :
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
                    entry.kind === 'object-entry' ? inferType(entry.value) :
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
                    const spreadType = resolveType(inferType(entry.expr, visited))

                    if (spreadType.kind === 'array-type') {
                        arraySpreads.push(spreadType)
                    } else if (spreadType.kind === 'tuple-type') {
                        memberTypes.push(...spreadType.members)
                    } else {
                        memberTypes.push(UNKNOWN_TYPE)
                    }
                } else {
                    memberTypes.push(inferType(entry, visited))
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
                    element: resolveType({
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
        case "boolean-literal": return literalType(ast);
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;
        case "instance-of": return BOOLEAN_TYPE;
        case "as-cast": return ast.type;
        case "error-expression":
            return {
                kind: "error-type",
                inner: inferType(ast.inner, visited),
                mutability: undefined,
                parent, module, code, startIndex, endIndex
            }
        default:
            // @ts-expect-error: exhaustiveness
            throw Error(ast.kind)
    }
})

function getBindingType(importedFrom: LocalIdentifier, binding: Binding, visited: readonly AST[]): TypeExpression {
    const { parent, module, ..._rest } = importedFrom

    type MutabilityKind = Mutability['mutability']|undefined

    const decl = binding.owner

    switch (decl.kind) {
        case 'value-declaration':{
            if (decl.type != null) return decl.type

            const valueType = resolveType(inferType(decl.value, visited))
            const mutability: MutabilityKind = given(valueType.mutability, mutability =>
                decl.isConst || (decl.exported === 'expose' && decl.module !== module)
                    ? 'immutable'
                    : mutability
            )

            // if this is a let declaration, its type may need to be made less exact to enable reasonable mutation
            const broadenedValueType = (
                !decl.isConst
                    ? broadenTypeForMutation(valueType)
                    : valueType
            )

            return {
                ...broadenedValueType,
                mutability: mutability === 'literal' ? 'mutable' : mutability
            } as TypeExpression
        }
        case 'func-declaration':
        case 'proc-declaration': {
            return resolveType(inferType(decl.value, visited))
        }
        case 'declaration-statement':
        case 'inline-declaration': {
            if (decl.destination.kind === 'name-and-type' && decl.destination.type != null) return decl.destination.type

            let valueType = resolveType(inferType(decl.value, visited))
            if (decl.awaited) {
                if (valueType.kind === 'plan-type') {
                    valueType = valueType.inner
                } else {
                    valueType = UNKNOWN_TYPE
                }
            }

            const mutability: MutabilityKind = given(valueType.mutability, mutability =>
                decl.kind === 'declaration-statement' && decl.isConst
                    ? 'immutable'
                    : mutability
            )

            // if this is a let declaration, its type may need to be made less exact to enable reasonable mutation
            const broadenedValueType = (
                decl.kind === 'declaration-statement' && !decl.isConst
                    ? broadenTypeForMutation(valueType)
                    : valueType
            )

            if (decl.destination.kind === 'name-and-type') {
                return {
                    ...broadenedValueType,
                    mutability: mutability === 'literal' ? 'mutable' : mutability
                } as TypeExpression
            } else {
                if (decl.destination.destructureKind === 'object' && valueType.kind === 'object-type') {
                    const props = propertiesOf(valueType)
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
            return decl.type ?? resolveType(inferType(decl.expr, visited))
        case 'remote-declaration': {
            const inner = decl.type ?? resolveType(inferType(decl.expr, visited))

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
            const arg = funcOrProcType.args.find(a => a.name.name === binding.identifier.name)

            if (arg?.type) {
                if (arg.optional) {
                    return maybeOf(arg.type)
                } else {
                    return arg.type
                }
            }

            const inferredHolderType = inferType(decl, visited)
            if (inferredHolderType.kind === 'func-type' || inferredHolderType.kind === 'proc-type') {
                const inferredArg = inferredHolderType.args.find(a => a.name.name === binding.identifier.name)
                const declaredType = inferredArg?.type

                if (declaredType) {
                    if (!inferredArg?.optional) {
                        return declaredType
                    } else {
                        return maybeOf(declaredType)
                    }
                }
                
                return UNKNOWN_TYPE
            }
            
            return UNKNOWN_TYPE
        }
        case 'for-loop': {
            const iteratorType = resolveType(inferType(decl.iterator, visited))

            return iteratorType.kind === 'iterator-type'
                ? iteratorType.inner
                : UNKNOWN_TYPE
        }
        case 'try-catch': {
            const thrown = throws(decl.tryBlock)

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
            const otherModule = getModuleByName(decl.module as ModuleName, decl.path.value)

            if (otherModule == null) {
                return {
                    kind: 'object-type',
                    spreads: [],
                    entries: [],
                    mutability: 'immutable',
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
                    entries: exportedDeclarations.map(decl => {
                        const declaredType = decl.kind === 'value-declaration' ? decl.type : decl.value.type

                        return attribute(
                            decl.name.name, 
                            declaredType ?? inferType(decl.value, visited),
                            decl.kind !== 'value-declaration' || decl.isConst || decl.exported === 'expose'
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
                    return inferType(contents.value)
                } else {
                    return UNKNOWN_TYPE
                }
            }
        }
        case 'import-item': {
            const imported = resolveImport(decl)

            if (imported) {
                return getBindingType(importedFrom, { owner: imported, identifier: imported.name }, visited)
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
            throw Error('getDeclType is nonsensical on declaration of type ' + decl?.kind)
    }

    return UNKNOWN_TYPE
}

/**
 * When initializing a mutable variable, sometimes we want to broaden the type
 * a bit to allow for "normal" kinds of mutation
 */
function broadenTypeForMutation(type: TypeExpression): TypeExpression {
    if (type.kind === 'union-type') {
        return distillOverlappingUnionMembers(type)
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
            return { ...type, kind: 'array-type', element: distillOverlappingUnionMembers({ kind: 'union-type', members: type.members.map(broadenTypeForMutation), parent: type.parent, ...TYPE_AST_NOISE }) }
        } else if (type.kind === 'array-type') {
            return { ...type, element: broadenTypeForMutation(type.element) }
        } else if (type.kind === 'object-type') {
            return { ...type, entries: type.entries.map(attribute => ({ ...attribute, type: broadenTypeForMutation(attribute.type) })) }
        } else if (type.kind === 'record-type') {
            return { ...type, keyType: broadenTypeForMutation(type.keyType), valueType: broadenTypeForMutation(type.valueType) }
        }
    }

    return type
}

export function distillOverlappingUnionMembers(type: UnionType): UnionType {
    const indicesToDrop = new Set<number>();

    for (let i = 0; i < type.members.length; i++) {
        for (let j = 0; j < type.members.length; j++) {
            if (i !== j) {
                const a = type.members[i];
                const b = type.members[j];

                if (!subsumationIssues(b, a) && !indicesToDrop.has(j) && resolveType(b).kind !== 'unknown-type') {
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
 */
export function bindInvocationGenericArgs(invocation: Invocation): TypeExpression|undefined {
    const subjectType = resolveType(inferType(invocation.subject))

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
                
                if (typeParam.extends && subsumationIssues(typeParam.extends, typeArg)) {
                    return undefined
                }
            }

            return parameterizedGenericType(
                subjectType, 
                invocation.typeArgs
            )
        } else { // no type arguments (try to infer)
            const funcOrProcType = subjectType.inner

            const invocationSubjectType: FuncType|ProcType = {
                ...funcOrProcType,
                args: funcOrProcType.args.map((arg, index) => ({
                    ...arg,
                    type: inferType(invocation.args[index])
                }))
            }

                    
            // attempt to infer params for generic
            const inferredBindings = fitTemplate(
                funcOrProcType, 
                invocationSubjectType
            );

            if (inferredBindings && inferredBindings.size === subjectType.typeParams.length) {

                // check that inferred type args fit `extends` clauses
                for (const param of subjectType.typeParams) {
                    const inferred = inferredBindings.get(param.name.name)
                    
                    if (param.extends && inferred && subsumationIssues(param.extends, inferred)) {
                        return undefined
                    }
                }
    
                return parameterizedGenericType(
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
export function parameterizedGenericType(generic: GenericType, typeArgs: readonly TypeExpression[]): TypeExpression {
    
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
            const resolved = resolve(ast.name.name, ast)

            if (resolved?.owner.kind === 'generic-param-type' && bindings[resolved.owner.name.name]) {
                return bindings[resolved.owner.name.name]
            }
        }

        return ast
    }) as TypeExpression
}

export function subtract(type: TypeExpression, without: TypeExpression): TypeExpression {
    type = resolveType(type)
    without = resolveType(without)

    if (typesEqual(type, without)) {
        return EMPTY_TYPE
    } else if (without.kind === 'union-type') {
        let t = type

        for (const member of without.members) {
            t = subtract(t, member)
        }

        return t
    } else if (type.kind === "union-type") {
        return {
            ...type,
            members: type.members
                .filter(member => !typesEqual(member, without))
                .map(member => subtract(member, without))
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

function narrow(type: TypeExpression, fit: TypeExpression): TypeExpression {
    type = resolveType(type)
    fit = resolveType(fit)

    if (type.kind === "union-type") {
        return {
            ...type,
            members: type.members.map(member => narrow(member, fit))
        }
    } else if (type.kind === 'unknown-type') {
        return fit
    } else if (!subsumationIssues(fit, type)) {
        return type
    } else {
        return EMPTY_TYPE
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
        if ((parent.kind === 'case' || parent.kind === 'case-block') && 
            (grandparent?.kind === 'if-else-expression' || grandparent?.kind === 'if-else-statement') &&  // we know this, but TS doesn't
            current === parent.outcome) {
            const cases = grandparent.cases as readonly (Case|CaseBlock)[] // HACK

            for (let i = 0; i < cases.indexOf(parent); i++) {
                const condition = cases[i]?.condition

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
        } else if ((parent.kind === 'if-else-expression' || parent.kind === 'if-else-statement') && current === parent.defaultCase) {
            for (const { condition } of parent.cases) {

                // conditions for all past clauses are false
                const refinement = conditionToRefinement(condition, false)
                if (refinement) {
                    refinements.push(refinement)
                }
            }
        } else if (parent.kind === 'switch-case' &&  // || parent.kind === 'switch-statement'
                    grandparent?.kind === 'switch-expression' &&  // we know this, but TS doesn't
                    current === parent.outcome) {
            refinements.push({ kind: 'narrowing', type: parent.type, targetExpression: grandparent.value })
        } else if (parent.kind === 'switch-expression' && current === parent.defaultCase) { // || parent.kind === 'switch-statement') {
            for (const { type } of parent.cases) {

                // conditions for all past clauses are false
                refinements.push({ kind: 'subtraction', type, targetExpression: current })
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

export const propertiesOf = computedFn(function propertiesOf (
    type: TypeExpression
): readonly Attribute[] | undefined {
    const resolvedType = resolveType(type)

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
                const resolved = resolve(spread.name.name, spread)

                if (resolved != null && (resolved.owner.kind === 'type-declaration' || resolved.owner.kind === 'generic-param-type')) {
                    const type = resolved.owner.kind === 'type-declaration' ? resolved.owner.type : resolved.owner
                    if (type.kind === 'object-type') {
                        attrs.push(...(propertiesOf(type) ?? []))
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
            const allProperties = resolvedType.members.map(propertiesOf)
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
    parameterized: TypeExpression, 
    reified: TypeExpression, 
): ReadonlyMap<string, TypeExpression>|undefined {

    function isGenericParam(type: TypeExpression): type is NamedType {
        if (type.kind === 'named-type') {
            const binding = resolve(type.name.name, type)
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
        const matchGroups = [
            ...parameterized.args.map((arg, index) =>
                fitTemplate(arg.type ?? UNKNOWN_TYPE, reified.args[index].type ?? UNKNOWN_TYPE)),
        ]

        if (parameterized.kind === 'func-type' && reified.kind === 'func-type' &&
            parameterized.returnType && reified.returnType) {
            matchGroups.push(
                fitTemplate(parameterized.returnType, reified.returnType)
            )
        }

        if (matchGroups.some(g => g == null)) {
            return undefined
        }

        const matches = new Map<string, TypeExpression>();

        for (const map of matchGroups as ReadonlyMap<string, TypeExpression>[]) {
            for (const [key, value] of map.entries()) {
                if (!isGenericParam(value)) {
                    const existing = matches.get(key)
                    if (existing) {
                        if (subsumationIssues(existing, value)) {
                            return undefined
                        }
                    } else {
                        matches.set(key, value);
                    }
                }
            }
        }
        
        return matches;
    }

    if (parameterized.kind === "array-type" && reified.kind === "array-type") {
        return fitTemplate(parameterized.element, reified.element);
    }

    if (parameterized.kind === "tuple-type" && reified.kind === "tuple-type" && parameterized.members.length === reified.members.length) {
        const all = new Map<string, TypeExpression>()

        for (let i = 0; i < parameterized.members.length; i++) {
            const matches = fitTemplate(parameterized.members[i], reified.members[i]);

            for (const key in matches) {
                all.set(key, matches.get(key) as TypeExpression)
            }
        }

        return all
    }

    if (parameterized.kind === "object-type" && reified.kind === "object-type") {
        const all = new Map<string, TypeExpression>()

        for (const entry of parameterized.entries) {
            const other = reified.entries.find(e => getName(entry.name) === getName(e.name))

            if (other) {
                const matches = fitTemplate(entry.type, other.type);

                for (const key in matches) {
                    all.set(key, matches.get(key) as TypeExpression)
                }
            }
        }

        return all
    }

    if ((parameterized.kind === "iterator-type" && reified.kind === "iterator-type") 
     || (parameterized.kind === "plan-type" && reified.kind === "plan-type") 
     || (parameterized.kind === "remote-type" && reified.kind === "remote-type")) {
        return fitTemplate(parameterized.inner, reified.inner);
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

                matches.set(parameterizedMembersRemaining[0].name.name, resolveType({
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
    if (expr.kind === 'invocation' && expr.subject.kind === 'property-accessor' && expr.subject.property.kind === 'plain-identifier') {
        const fnName = expr.subject.property.name
        const subjectType = inferType(expr.subject.subject)

        if (!propertiesOf(subjectType)?.some(p => getName(p.name) === fnName)) {
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

export function throws(block: Block): TypeExpression[] {
    const errorTypes: TypeExpression[] = []

    for (const statement of block.statements) {
        switch (statement.kind) {
            case 'invocation': {
                const procType = inferType(statement.subject)

                if (procType.kind === 'proc-type' && procType.throws) {
                    errorTypes.push(procType.throws)
                }
            } break;
            // case 'await-statement'
            // case 'destructuring-declaration-statement'
            case 'for-loop':
            case 'while-loop':
                errorTypes.push(...throws(statement.body))
                break;
            case 'try-catch':
                errorTypes.push(...throws(statement.catchBlock))
                break;
            case 'if-else-statement':
                for (const { outcome } of statement.cases) {
                    errorTypes.push(...throws(outcome))
                }
                if (statement.defaultCase) {
                    errorTypes.push(...throws(statement.defaultCase))
                }
                break;
            case 'throw-statement':
                errorTypes.push(inferType(statement.errorExpression))
                break;
        }
    }

    return errorTypes
}

function isAsync(block: Block): boolean {
    for (const statement of block.statements) {
        switch (statement.kind) {
            case 'invocation': {
                return statement.awaited === true
                // const procType = inferType(statement.subject)

                // if (procType.kind === 'proc-type' && procType.isAsync) {
                //     return true
                // }
            }
            case 'for-loop':
            case 'while-loop':
                if (isAsync(statement.body)) return true
                break;
            case 'try-catch':
                if (isAsync(statement.tryBlock) || isAsync(statement.catchBlock)) return true
                break;
            case 'if-else-statement':
                for (const { outcome } of statement.cases) {
                    if (isAsync(outcome)) return true
                }
                if (statement.defaultCase && isAsync(statement.defaultCase)) {
                    return true
                }
                break;
            case 'declaration-statement':
                return statement.awaited;
        }
    }

    return false;
}

const identifierToExactString = (ident: PlainIdentifier): ExactStringLiteral => ({
    kind: 'exact-string-literal',
    value: ident.name,
    module: ident.module,
    code: ident.code,
    startIndex: ident.startIndex,
    endIndex: ident.endIndex,
})

export const elementTagToObject = computedFn((tag: ElementTag): ObjectLiteral => {
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