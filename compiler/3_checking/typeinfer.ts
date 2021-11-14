import { AllParents, AllScopes, DeclarationDescriptor, getScopeFor, Scope, TypeDeclarationDescriptor } from "../_model/common.ts";
import { BinaryOp, Expression, isExpression } from "../_model/expressions.ts";
import { Attribute, BOOLEAN_TYPE, ITERATOR_OF_NUMBERS_TYPE, JAVASCRIPT_ESCAPE_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, TypeExpression, UnionType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, given, memoize4 } from "../utils.ts";
import { displayForm, subsumes } from "./typecheck.ts";
import { ClassDeclaration, ClassMember, memberDeclaredType } from "../_model/declarations.ts";
import { BagelError, miscError } from "../errors.ts";
import { withoutSourceInfo } from "../debugging.ts";
import { extendScope } from "./scopescan.ts";

export function inferType(
    reportError: (error: BagelError) => void, 
    parents: AllParents,
    scopes: AllScopes,
    ast: Expression|ClassMember,
    resolveGenerics?: boolean,
): TypeExpression {
    const baseType = inferTypeInner(reportError, parents, scopes, ast)

    let refinedType = baseType
    {
        const scope = getScopeFor(parents, scopes, ast)
        for (const refinement of scope.refinements ?? []) {
            switch (refinement.kind) {
                case "subtraction": {
                    refinedType = subtract(parents, scopes, refinedType, refinement.type)
                } break;
                case "narrowing": {
                    refinedType = narrow(parents, scopes, refinedType, refinement.type)
                } break;
            }
        }
    }

    return resolve([parents, scopes],
        simplify(parents, scopes, refinedType), resolveGenerics);
}

const inferTypeInner = memoize4((
    reportError: (error: BagelError) => void, 
    parents: AllParents,
    scopes: AllScopes,
    ast: Expression|ClassMember,
): TypeExpression => {
    switch(ast.kind) {
        case "proc":
            return ast.type
        case "func": {
            // if no return-type is declared, try inferring the type from the inner expression
            const returnType = ast.type.returnType ??
                inferType(reportError, parents, scopes, ast.body)

            return {
                ...ast.type,
                returnType,
            }

        }
        case "binary-operator": {
            let leftType = inferType(reportError, parents, scopes, ast.base);

            for (const [op, expr] of ast.ops) {
                const rightType = inferType(reportError, parents, scopes, expr);

                const types = BINARY_OPERATOR_TYPES[op.op].find(({ left, right }) =>
                    subsumes(parents, scopes, left, leftType) && subsumes(parents, scopes, right, rightType))

                if (types == null) {
                    reportError(miscError(op, `Operator '${op.op}' cannot be applied to types '${displayForm(leftType)}' and '${displayForm(rightType)}'`));

                    if (BINARY_OPERATOR_TYPES[op.op].length === 1) {
                        return BINARY_OPERATOR_TYPES[op.op][0].output
                    } else {
                        return UNKNOWN_TYPE
                    }
                }

                leftType = types.output;
            }

            return leftType;
        }
        case "negation-operator": return BOOLEAN_TYPE;
        case "pipe":
        case "invocation": {
            const scope = getScopeFor(parents, scopes, ast)

            let subjectType = inferType(reportError, parents, scopes, ast.subject);
            if (ast.kind === "invocation") {
                const scopeWithGenerics = extendScope(scope)

                // bind type-args for this invocation
                if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {
                    if (subjectType.typeParams.length > 0) {
                        if (subjectType.typeParams.length !== ast.typeArgs.length) {
                            reportError(miscError(ast, `Expected ${subjectType.typeParams.length} type arguments, but got ${ast.typeArgs.length}`))
                        }

                        for (let i = 0; i < subjectType.typeParams.length; i++) {
                            const typeParam = subjectType.typeParams[i]
                            const typeArg = ast.typeArgs?.[i] ?? UNKNOWN_TYPE

                            scopeWithGenerics.types.set(typeParam.name, {
                                type: typeArg,
                                isGenericParameter: false,
                            })
                        }
                    }
                }

                subjectType = resolve(scopeWithGenerics, subjectType);
            }

            if (subjectType.kind === "func-type") {
                return subjectType.returnType ?? UNKNOWN_TYPE;
            } else {
                return UNKNOWN_TYPE;
            }
        }
        case "indexer": {
            const baseType = inferType(reportError, parents, scopes, ast.subject);
            const indexerType = inferType(reportError, parents, scopes, ast.indexer);
            
            if (baseType.kind === "object-type" && indexerType.kind === "literal-type" && indexerType.value.kind === "exact-string-literal") {
                const key = indexerType.value.value;
                const valueType = propertiesOf(reportError, parents, scopes, baseType)?.find(entry => entry.name.name === key)?.type;

                return valueType ?? UNKNOWN_TYPE;
            } else if (baseType.kind === "indexer-type") {
                if (!subsumes(parents, scopes, baseType.keyType, indexerType)) {
                    return UNKNOWN_TYPE;
                } else {
                    return {
                        kind: "union-type",
                        members: [ baseType.valueType, NIL_TYPE ],
                        mutability: undefined,
                        id: Symbol(),
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined,
                    };
                }
            } else if (baseType.kind === "array-type" && indexerType.kind === "number-type") {
                return baseType.element;
            }

            return UNKNOWN_TYPE;
        }
        case "if-else-expression":
        case "switch-expression": {
            const valueType = ast.kind === "if-else-expression" ? BOOLEAN_TYPE : inferType(reportError, parents, scopes, ast.value)

            const caseTypes = ast.cases.map(({ outcome }) => 
                inferType(reportError, parents, scopes, outcome))

            const unionType: UnionType = {
                kind: "union-type",
                members: caseTypes,
                mutability: undefined,
                id: Symbol(),
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };

            if (!subsumes(parents, scopes, unionType, valueType)) {
                return {
                    ...unionType,
                    members: [
                        ...unionType.members,
                        ast.defaultCase 
                            ? inferType(reportError, parents, scopes, ast.defaultCase) 
                            : NIL_TYPE
                    ]
                }
            }
            
            return unionType
        }
        case "range": return ITERATOR_OF_NUMBERS_TYPE;
        case "debug": {
            if (isExpression(ast.inner)) {
                const type = inferType(reportError, parents, scopes, ast.inner)
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
            return inferType(reportError, parents, scopes, ast.inner);
        case "property-accessor": {
            const subjectType = inferType(reportError, parents, scopes, ast.subject);
            const nilTolerantSubjectType = ast.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(parents, scopes, subjectType, NIL_TYPE)
                : subjectType;
            const propertyType = propertiesOf(reportError, parents, scopes, nilTolerantSubjectType)?.find(entry => entry.name.name === ast.property.name)?.type

            if (ast.optional && propertyType) {
                return {
                    kind: "union-type",
                    members: [propertyType, NIL_TYPE],
                    mutability: undefined,
                    id: Symbol(),
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined
                }
            } else {
                const mutability = (
                    propertyType?.mutability == null ? undefined :
                    propertyType.mutability === "mutable" && subjectType.mutability === "mutable" ? "mutable" :
                    subjectType.mutability === "absolute-const" ? "absolute-const" :
                    "const"
                )
    
                return (
                    given(propertyType, t => ({ ...t, mutability }) as TypeExpression) 
                        ?? UNKNOWN_TYPE
                )
            }
        }
        case "local-identifier": {
            const valueDescriptor = getScopeFor(parents, scopes, ast).values.get(ast.name)

            const type = valueDescriptor?.declaredType 
                ?? given(valueDescriptor?.initialValue, initialValue => inferType(reportError, parents, scopes, initialValue))
                ?? UNKNOWN_TYPE

            const mutability = (
                type.mutability == null ? undefined :
                valueDescriptor?.mutability === "absolute-none" ? "absolute-const" :
                valueDescriptor?.mutability === "none" ? "const" :
                type.mutability
            )

            return {
                ...type,
                mutability,
            } as TypeExpression
        }
        case "element-tag": {
            return {
                kind: "element-type",
                // tagName: ast.tagName,
                // attributes: ast.attributes
                mutability: undefined,
                id: Symbol(),
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "object-literal": {
            const entries: Attribute[] = ast.entries.map(([name, value]) => {
                const type = inferType(reportError, parents, scopes, value);
                return {
                    kind: "attribute",
                    name,
                    type, 
                    mutability: undefined,
                    id: Symbol(),
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined,
                }
            });

            return {
                kind: "object-type",
                spreads: [],
                entries,
                mutability: "mutable",
                id: Symbol(),
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "array-literal": {
            const entries = ast.entries.map(entry => inferType(reportError, parents, scopes, entry));

            // NOTE: This could be slightly better where different element types overlap each other
            const uniqueEntryTypes = entries.filter((el, index, arr) => 
                arr.findIndex(other => deepEquals(el, other)) === index);

            return {
                kind: "array-type",
                element: uniqueEntryTypes.length === 1
                    ? uniqueEntryTypes[0]
                    : {
                        kind: "union-type",
                        members: uniqueEntryTypes,
                        mutability: undefined,
                        id: Symbol(),
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined,
                    },
                mutability: "mutable",
                id: Symbol(),
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "class-construction": {
            const clazz = getScopeFor(parents, scopes, ast).classes.get(ast.clazz.name)
            if (clazz == null) {
                return UNKNOWN_TYPE
            }
            
            return {
                kind: "class-instance-type",
                clazz,
                internal: false,
                mutability: "mutable",
                id: Symbol(),
                code: ast.clazz.code,
                startIndex: ast.clazz.startIndex,
                endIndex: ast.clazz.endIndex
            };
        }
        case "class-property":
        case "class-function":
        case "class-procedure": return (ast.kind === "class-property" ? ast.type : undefined) ?? inferType(reportError, parents, scopes, ast.value);
        case "string-literal": return STRING_TYPE;
        case "exact-string-literal": return STRING_TYPE;
        case "number-literal": return NUMBER_TYPE;
        case "boolean-literal": return BOOLEAN_TYPE;
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;
        default:
            // @ts-expect-error
            throw Error(ast.kind)
    }
})

export function resolve(contextOrScope: [AllParents, AllScopes]|Scope, type: TypeExpression, resolveGenerics?: boolean): TypeExpression {
    if (type.kind === "named-type") {
        const resolutionScope = Array.isArray(contextOrScope)
            ? getScopeFor(contextOrScope[0], contextOrScope[1], type)
            : contextOrScope

        if (resolutionScope.types.get(type.name.name)) {
            const resolvedType = resolutionScope.types.get(type.name.name) as TypeDeclarationDescriptor
            if (!resolvedType.isGenericParameter || resolveGenerics) {
                return resolve(contextOrScope, resolvedType.type, resolveGenerics)
            } else {
                return type
            }
        } else if (resolutionScope.classes.get(type.name.name)) {
            const clazz = resolutionScope.classes.get(type.name.name) as ClassDeclaration

            return {
                kind: "class-instance-type",
                clazz,
                internal: false,
                mutability: "mutable",
                id: Symbol(),
                code: type.code,
                startIndex: type.startIndex,
                endIndex: type.endIndex
            }
        }
    } else if(type.kind === "union-type") {
        const memberTypes = type.members.map(member => resolve(contextOrScope, member, resolveGenerics));
        if (memberTypes.some(member => member == null)) {
            return UNKNOWN_TYPE;
        } else {
            return {
                kind: "union-type",
                members: memberTypes as TypeExpression[],
                mutability: undefined,
                id: Symbol(),
                code: type.code,
                startIndex: type.startIndex,
                endIndex: type.endIndex,
            };
        }
    } else if(type.kind === "object-type") {
        const entries = type.entries.map(({ type, ...rest }) => 
            ({ ...rest, type: resolve(contextOrScope, type, resolveGenerics) }))

        return {
            ...type,
            entries,
        }
    } else if(type.kind === "array-type") {
        const element = resolve(contextOrScope, type.element, resolveGenerics)

        return {
            ...type,
            element,
        };
    } else if(type.kind === "func-type") {
        return {
            kind: "func-type",
            typeParams: type.typeParams,
            args: type.args.map(({ name, type }) => ({ name, type: given(type, t => resolve(contextOrScope, t, resolveGenerics)) })),
            returnType: given(type.returnType, returnType => resolve(contextOrScope, returnType, resolveGenerics)),
            mutability: undefined,
            id: Symbol(),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    } else if(type.kind === "proc-type") {
        return {
            kind: "proc-type",
            typeParams: type.typeParams,
            args: type.args.map(({ name, type }) => ({ name, type: given(type, t => resolve(contextOrScope, t, resolveGenerics)) })),
            mutability: undefined,
            id: Symbol(),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    } else if(type.kind === "iterator-type") {
        return {
            kind: "iterator-type",
            itemType: resolve(contextOrScope, type.itemType, resolveGenerics),
            mutability: undefined,
            id: Symbol(),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    } else if(type.kind === "plan-type") {
        return {
            kind: "plan-type",
            resultType: resolve(contextOrScope, type.resultType, resolveGenerics),
            mutability: undefined,
            id: Symbol(),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    }

    // TODO: Recurse onIndexerType, TupleType, etc
    return type;
}

export function simplify(parents: AllParents, scopes: AllScopes, type: TypeExpression): TypeExpression {
    return handleSingletonUnion(
        distillUnion(parents, scopes,
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
            id: type.id,
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
function distillUnion(parents: AllParents, scopes: AllScopes, type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        const indicesToDrop = new Set<number>();

        for (let i = 0; i < type.members.length; i++) {
            for (let j = 0; j < type.members.length; j++) {
                if (i !== j) {
                    const a = type.members[i];
                    const b = type.members[j];

                    if (subsumes(parents, scopes, b, a) && !indicesToDrop.has(j)) {
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
            id: type.id,
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
    if (type.kind === "union-type" && type.members.length === 1) {
        return type.members[0];
    } else {
        return type;
    }
}

export function subtract(parents: AllParents, scopes: AllScopes, type: TypeExpression, without: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        return simplify(parents, scopes, {
            ...type,
            members: type.members.filter(member => !subsumes(parents, scopes, without, member))
        })
    } else { // TODO: There's probably more we can do here
        return type
    }
}

function narrow(parents: AllParents, scopes: AllScopes, type: TypeExpression, fit: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        return simplify(parents, scopes, {
            ...type,
            members: type.members.filter(member => subsumes(parents, scopes, fit, member))
        })
    } else { // TODO: There's probably more we can do here
        return type
    }
}

const BINARY_OPERATOR_TYPES: { [key in BinaryOp]: { left: TypeExpression, right: TypeExpression, output: TypeExpression }[] } = {
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
    "==": [ // TODO: Should require left and right to be the same type, even though that type can be anything!
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: BOOLEAN_TYPE }
    ],
    "!=": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: BOOLEAN_TYPE }
    ],
    "??": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: UNKNOWN_TYPE }
    ],
    // "??": {
    //     inputs: { kind: "union-type", members: [ { kind: "primitive-type", type: "nil" }, ] },
    //     output: BOOLEAN_TYPE
    // },
}

export function propertiesOf(
    reportError: (error: BagelError) => void, 
    parents: AllParents,
    scopes: AllScopes,
    type: TypeExpression
): readonly Attribute[] | undefined {
    const AST_NOISE = { code: undefined, startIndex: undefined, endIndex: undefined }
    const TYPE_AST_NOISE = { mutability: undefined, ...AST_NOISE }

    switch (type.kind) {
        case "object-type": {
            const attrs = [...type.entries]

            for (const spread of type.spreads) {
                const resolved = resolve([parents, scopes], spread)
        
                if (resolved.kind !== "object-type") {
                    reportError(miscError(spread, `${displayForm(resolved)} is not an object type; can only spread object types into object types`))
                } else {
                    attrs.push(...(propertiesOf(reportError, parents, scopes, resolved) ?? []))
                }
            }

            return attrs
        }
        case "array-type":
        // case "tuple-type":
            if (type.mutability === "mutable") {
                return [
                    {
                        kind: "attribute",
                        name: { kind: "plain-identifier", name: "push", id: Symbol(), ...AST_NOISE },
                        type: {
                            kind: "proc-type",
                            typeParams: [],
                            args: [{
                                name: { kind: "plain-identifier", name: "el", id: Symbol(), ...AST_NOISE },
                                type: type.element
                            }],
                            id: Symbol(),
                            ...TYPE_AST_NOISE
                        },
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    },
                ]
            } else {
                return []
            }
        case "class-instance-type": {
            
            const memberToAttribute = (member: ClassMember): Attribute => {

                const memberType = memberDeclaredType(member) && memberDeclaredType(member)?.kind !== "func-type"
                    ? memberDeclaredType(member) as TypeExpression
                    : inferType(reportError, parents, scopes, member.value);

                const mutability = (
                    memberType.mutability == null ? undefined :
                    memberType.mutability === "mutable" && member.kind === "class-property" && (type.internal || member.access !== "visible") ? "mutable"
                    : "const"
                )

                return {
                    kind: "attribute",
                    name: member.name,
                    type: { ...memberType, mutability } as TypeExpression,
                    id: member.id,
                    ...TYPE_AST_NOISE
                }
            }

            if (type.internal) {
                return type.clazz.members
                    .map(memberToAttribute)
            } else {
                return type.clazz.members
                    .filter(member => member.access !== "private")
                    .map(memberToAttribute)
            }
        }
        case "iterator-type": {
            const { code: _, startIndex: _1, endIndex: _2, ...item } = type.itemType
            const itemType = { ...item, ...AST_NOISE }

            const iteratorProps: readonly Attribute[] = [
                {
                    kind: "attribute",
                    name: { kind: "plain-identifier", name: "filter", id: Symbol(), ...AST_NOISE },
                    type: {
                        kind: "func-type",
                        typeParams: [],
                        args: [{
                            name: { kind: "plain-identifier", name: "fn", id: Symbol(), ...AST_NOISE },
                            type: {
                                kind: "func-type",
                                typeParams: [],
                                args: [{ name: { kind: "plain-identifier", name: "el", id: Symbol(), ...AST_NOISE }, type: itemType }],
                                returnType: BOOLEAN_TYPE,
                                id: Symbol(),
                                ...TYPE_AST_NOISE
                            }
                        }],
                        returnType: {
                            kind: "iterator-type",
                            itemType,
                            id: Symbol(),
                            ...TYPE_AST_NOISE
                        },
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    },
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                },
                {
                    kind: "attribute",
                    name: { kind: "plain-identifier", name: "map", id: Symbol(), ...AST_NOISE },
                    type: {
                        kind: "func-type",
                        typeParams: [
                            { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }
                        ],
                        args: [{
                            name: { kind: "plain-identifier", name: "fn", id: Symbol(), ...AST_NOISE },
                            type: {
                                kind: "func-type",
                                args: [{ name: { kind: "plain-identifier", name: "el", id: Symbol(), ...AST_NOISE }, type: itemType }],
                                returnType: { kind: "named-type", id: Symbol(), name: { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }, ...TYPE_AST_NOISE },
                                typeParams: [],
                                id: Symbol(),
                                ...TYPE_AST_NOISE
                            }
                        }],
                        returnType: {
                            kind: "iterator-type",
                            itemType: { kind: "named-type", id: Symbol(), name: { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }, ...TYPE_AST_NOISE },
                            id: Symbol(),
                            ...TYPE_AST_NOISE
                        },
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    },
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                },
                {
                    kind: "attribute",
                    name: { kind: "plain-identifier", name: "array", id: Symbol(), ...AST_NOISE },
                    type: {
                        kind: "func-type",
                        typeParams: [],
                        args: [],
                        returnType: { kind: "array-type", element: itemType, mutability: "mutable", id: Symbol(), ...AST_NOISE },
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    },
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                }
            ]

            return iteratorProps
        }
        case "plan-type": {
            const { code: _, startIndex: _1, endIndex: _2, ...result } = type.resultType
            const resultType = { ...result, ...AST_NOISE }

            const planProps: readonly Attribute[] = [
                {
                    kind: "attribute",
                    name: { kind: "plain-identifier", name: "then", id: Symbol(), ...AST_NOISE },
                    type: {
                        kind: "func-type",
                        typeParams: [
                            { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }
                        ],
                        args: [{
                            name: { kind: "plain-identifier", name: "fn", id: Symbol(), ...AST_NOISE },
                            type: {
                                kind: "func-type",
                                args: [{ name: { kind: "plain-identifier", name: "el", id: Symbol(), ...AST_NOISE }, type: resultType }],
                                returnType: { kind: "named-type", id: Symbol(), name: { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }, ...TYPE_AST_NOISE },
                                typeParams: [],
                                id: Symbol(),
                                ...TYPE_AST_NOISE
                            }
                        }],
                        returnType: {
                            kind: "plan-type",
                            resultType: { kind: "named-type", id: Symbol(), name: { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }, ...TYPE_AST_NOISE },
                            id: Symbol(),
                            ...TYPE_AST_NOISE
                        },
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    },
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                },
            ]

            return planProps
        }
    }
}