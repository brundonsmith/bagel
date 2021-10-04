import { getScopeFor, PlainIdentifier, Scope } from "../_model/common.ts";
import { BinaryOp, Expression } from "../_model/expressions.ts";
import { BOOLEAN_TYPE, ITERATOR_OF_NUMBERS_TYPE, JAVASCRIPT_ESCAPE_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, TypeExpression, UnionType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, given } from "../utils.ts";
import { ModulesStore } from "./modules-store.ts";
import { subsumes } from "./typecheck.ts";
import { ClassMember } from "../_model/declarations.ts";
import { BagelError } from "../errors.ts";

export function inferType(
    reportError: (error: BagelError) => void, 
    modulesStore: ModulesStore,
    ast: Expression|ClassMember,
    preserveGenerics?: boolean,
): TypeExpression {
    return resolve(modulesStore,
        handleSingletonUnion(
            distillUnion(modulesStore,
                flattenUnions(
                    inferTypeInner(reportError, modulesStore, ast, !!preserveGenerics)))), preserveGenerics);
}

function inferTypeInner(
    reportError: (error: BagelError) => void, 
    modulesStore: ModulesStore,
    ast: Expression|ClassMember,
    preserveGenerics: boolean,
): TypeExpression {
    const scope = getScopeFor(modulesStore, ast)

    switch(ast.kind) {
        case "proc":
        case "func": {
            let args = ast.type.args
            
            // infer callback argument types based on context
            const parent = modulesStore.parentAst.get(ast)
            if (parent?.kind === "invocation") {
                const parentSubjectType = inferType(reportError, modulesStore, parent.subject, preserveGenerics)
                const thisArgIndex = parent.args.findIndex(a => a === ast)

                if (parentSubjectType.kind === "func-type" || parentSubjectType.kind === "proc-type") {
                    const thisArgParentType = parentSubjectType.args[thisArgIndex]?.type

                    if (thisArgParentType && thisArgParentType.kind === ast.type.kind) {
                        args = ast.type.args.map((arg, i) => 
                            arg.type == null
                                ? { ...arg, type: thisArgParentType.args[i].type }
                                : arg)
                    }
                }
            }

            if (ast.kind === "proc") {
                return {
                    ...ast.type,
                    args,
                }
            } else {

                // console.log({ returnType: ast.type.returnType })
                
                // if no return-type is declared, try inferring the type from the inner expression
                const returnType = ast.type.returnType ??
                    inferType(reportError, modulesStore, ast.body, true)

                // console.log({ inferredReturnType: returnType })
                
                return {
                    ...ast.type,
                    args,
                    returnType, 
                }
            }

        }
        case "binary-operator": {
            const leftType = inferType(reportError, modulesStore, ast.args[0], preserveGenerics);
            const rightType = inferType(reportError, modulesStore, ast.args[1], preserveGenerics);

            for (const types of BINARY_OPERATOR_TYPES[ast.operator]) {
                const { left, right, output } = types;

                if (subsumes(scope, left, leftType) && subsumes(scope, right, rightType)) {
                    return output;
                }
            }

            return UNKNOWN_TYPE;
        }
        case "pipe":
        case "invocation": {
            // console.log('---------begin invocation-------------')
            // console.log({ preserveGenerics, subject: displaySource(ast.subject) })
            let subjectType = inferType(reportError, modulesStore, ast.subject, true);
            // console.log({ subjectType })
            subjectType = resolve(scope, subjectType, false);
            // console.log({ resolvedSubjectType: subjectType })
            // console.log({ ...modulesStore.getScopeFor(ast).types })


            if (subjectType.kind === "func-type") {
                return subjectType.returnType ?? UNKNOWN_TYPE;
            } else {
                return UNKNOWN_TYPE;
            }
        }
        case "indexer": {
            const baseType = inferType(reportError, modulesStore, ast.subject, preserveGenerics);
            const indexerType = inferType(reportError, modulesStore, ast.indexer, preserveGenerics);
            
            if (baseType.kind === "object-type" && indexerType.kind === "literal-type" && indexerType.value.kind === "string-literal" && indexerType.value.segments.length === 1) {
                const key = indexerType.value.segments[0];
                const valueType = baseType.entries.find(entry => entry[0].name === key)?.[1];

                return valueType ?? UNKNOWN_TYPE;
            } else if (baseType.kind === "indexer-type") {
                if (!subsumes(scope, baseType.keyType, indexerType)) {
                    return UNKNOWN_TYPE;
                } else {
                    return {
                        kind: "union-type",
                        members: [ baseType.valueType, NIL_TYPE ],
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
            const valueType = ast.kind === "if-else-expression" ? BOOLEAN_TYPE : inferType(reportError, modulesStore, ast.value, preserveGenerics)

            const caseTypes = ast.cases.map(({ outcome }) => 
                inferType(reportError, modulesStore,outcome, preserveGenerics))

            const unionType: UnionType = {
                kind: "union-type",
                members: caseTypes,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };

            if (!subsumes(scope, unionType, valueType)) {
                return {
                    ...unionType,
                    members: [
                        ...unionType.members,
                        ast.defaultCase 
                            ? inferType(reportError, modulesStore, ast.defaultCase, preserveGenerics) 
                            : NIL_TYPE
                    ]
                }
            }
            
            return unionType
        }
        case "range": return ITERATOR_OF_NUMBERS_TYPE;
        case "parenthesized-expression": return inferType(reportError, modulesStore, ast.inner, preserveGenerics);
        case "property-accessor": {
            const subjectType = inferType(reportError, modulesStore, ast.subject, preserveGenerics);
            
            if (subjectType.kind === "object-type") {
                return subjectType.entries.find(entry => entry[0].name === ast.property.name)?.[1] ?? UNKNOWN_TYPE
            } else if (subjectType.kind === "class-type") {
                const member = subjectType.clazz.members.find(member => member.name.name === ast.property.name)
                if (member) {
                    if (member.kind === "class-function" || member.kind === "class-procedure") {
                        return inferType(reportError, modulesStore,member.value, preserveGenerics)
                    } else {
                        return member.type ?? inferType(reportError, modulesStore,member.value, preserveGenerics)
                    }
                }
            }
            
            return UNKNOWN_TYPE
        }
        case "local-identifier": {
            const valueDescriptor = getScopeFor(modulesStore, ast).values[ast.name]
            // console.log({ value: valueDescriptor.initialValue, uninferredType: (valueDescriptor?.initialValue as any).type, thingType: valueDescriptor?.declaredType 
            //     ?? given(valueDescriptor?.initialValue, initialValue => inferType(reportError, modulesStore, initialValue, preserveGenerics))
            //     ?? UNKNOWN_TYPE })

            return valueDescriptor?.declaredType 
                ?? given(valueDescriptor?.initialValue, initialValue => inferType(reportError, modulesStore, initialValue, preserveGenerics))
                ?? UNKNOWN_TYPE
        }
        case "element-tag": {
            return {
                kind: "element-type",
                // tagName: ast.tagName,
                // attributes: ast.attributes
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "object-literal": {
            const entries = ast.entries.map(([key, value]) => 
                [key, inferType(reportError, modulesStore,value, preserveGenerics)] as [PlainIdentifier, TypeExpression]);

            return {
                kind: "object-type",
                entries,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "array-literal": {
            const entries = ast.entries.map(entry => inferType(reportError, modulesStore, entry, preserveGenerics));

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
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined,
                    },
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "class-construction": return {
            kind: "class-type",
            clazz: getScopeFor(modulesStore, ast).classes[ast.clazz.name],
            code: ast.clazz.code,
            startIndex: ast.clazz.startIndex,
            endIndex: ast.clazz.endIndex
        };
        case "class-property":
        case "class-function":
        case "class-procedure": return (ast.kind === "class-property" ? ast.type : undefined) ?? inferType(reportError, modulesStore, ast.value, preserveGenerics);
        case "string-literal": return STRING_TYPE;
        case "number-literal": return NUMBER_TYPE;
        case "boolean-literal": return BOOLEAN_TYPE;
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;
    }
}

export function resolve(modulesStoreOrScope: ModulesStore|Scope, type: TypeExpression, preserveGenerics?: boolean): TypeExpression {
    if (type.kind === "named-type") {
        const resolutionScope = modulesStoreOrScope instanceof ModulesStore
            ? getScopeFor(modulesStoreOrScope, type)
            : modulesStoreOrScope

        // console.log({ type })

        if (resolutionScope.types[type.name.name]) {
            if (!resolutionScope.types[type.name.name].isGenericParameter || !preserveGenerics) {
                return resolve(modulesStoreOrScope, resolutionScope.types[type.name.name].type)
            } else {
                return type
            }
        } else if (resolutionScope.classes[type.name.name]) {
            return {
                kind: "class-type",
                clazz: resolutionScope.classes[type.name.name],
                code: type.code,
                startIndex: type.startIndex,
                endIndex: type.endIndex
            }
        }
    } else if(type.kind === "union-type") {
        const memberTypes = type.members.map(member => resolve(modulesStoreOrScope, member));
        if (memberTypes.some(member => member == null)) {
            return UNKNOWN_TYPE;
        } else {
            return {
                kind: "union-type",
                members: memberTypes as TypeExpression[],
                code: type.code,
                startIndex: type.startIndex,
                endIndex: type.endIndex,
            };
        }
    } else if(type.kind === "object-type") {
        const entries: [PlainIdentifier, TypeExpression][] = type.entries.map(([ key, valueType ]) => 
            [key, resolve(modulesStoreOrScope, valueType as TypeExpression)] as [PlainIdentifier, TypeExpression]);

        return {
            kind: "object-type",
            entries,
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        }
    } else if(type.kind === "array-type") {
        const element = resolve(modulesStoreOrScope, type.element)

        return {
            kind: "array-type",
            element,
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    } else if(type.kind === "func-type") {
        return {
            kind: "func-type",
            typeParams: type.typeParams,
            args: type.args.map(({ name, type }) => ({ name, type: given(type, t => resolve(modulesStoreOrScope, t, true) ?? t) })),
            returnType: given(type.returnType, returnType => resolve(modulesStoreOrScope, returnType, true) ?? returnType),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    } else if(type.kind === "proc-type") {
        return {
            kind: "proc-type",
            typeParams: type.typeParams,
            args: type.args.map(({ name, type }) => ({ name, type: given(type, t => resolve(modulesStoreOrScope, t) ?? t) })),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    }

    // TODO: Recurse onIndexerType, TupleType, etc
    return type;
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
function distillUnion(modulesStore: ModulesStore, type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        const indicesToDrop = new Set<number>();

        for (let i = 0; i < type.members.length; i++) {
            for (let j = 0; j < type.members.length; j++) {
                if (i !== j) {
                    const a = type.members[i];
                    const b = type.members[j];

                    if (subsumes(getScopeFor(modulesStore, type), b, a) && !indicesToDrop.has(j)) {
                        indicesToDrop.add(i);
                    }
                }
            }
        }

        return {
            kind: "union-type",
            members: type.members.filter((_, index) => !indicesToDrop.has(index)),
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

function unknownFallback(type: TypeExpression, fallback: Expression): TypeExpression|Expression {
    if (type.kind === "unknown-type") {
        return fallback;
    } else {
        return type;
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
    "==": [
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
