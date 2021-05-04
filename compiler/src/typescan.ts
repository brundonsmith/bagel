import { BinaryOp, BOOLEAN_TYPE, Expression, isExpression, ITERATOR_OF_NUMBERS_TYPE, JAVASCRIPT_ESCAPE_TYPE, Module, NIL_TYPE, NUMBER_TYPE, PlainIdentifier, STRING_TYPE, TypeExpression, UNKNOWN_TYPE } from "./ast";
import { ModulesStore, Scope } from "./modules-store";
import { subsumes } from "./typecheck";
import { deepEquals, DeepReadonly, walkParseTree } from "./utils";

export function typescan(modulesStore: ModulesStore, ast: Module): void {
    walkParseTree<DeepReadonly<Scope>>(modulesStore.getScopeFor(ast), ast, (scope, ast) => {
        if (modulesStore.astTypes.get(ast) == null && isExpression(ast)) {
            const type = determineType(modulesStore, ast, scope);
            modulesStore.astTypes.set(ast, type);
        }

        return modulesStore.scopeFor.get(ast) ?? scope;
    });
}

function determineType(modulesStore: ModulesStore, ast: Expression, scope: DeepReadonly<Scope>): TypeExpression {
    switch(ast.kind) {
        case "proc": {
            return ast.type;
        };
        case "func": {
            return {
                ...ast.type,
                returnType: ast.type.returnType.kind === "unknown-type" 
                    ? determineType(modulesStore, ast.body, modulesStore.getScopeFor(ast)) 
                    : ast.type.returnType,
            }
        };
        case "pipe": {
            return determineType(modulesStore, ast.expressions[ast.expressions.length - 1], scope);
        };
        case "binary-operator": {
            const leftType = determineType(modulesStore, ast.left, scope);
            const rightType = determineType(modulesStore, ast.right, scope);

            for (const types of BINARY_OPERATOR_TYPES[ast.operator]) {
                const { left, right, output } = types;

                if (subsumes(scope, left, leftType) && subsumes(scope, right, rightType)) {
                    return output;
                }
            }

            return UNKNOWN_TYPE;
        };
        case "funcall": {
            const funcType = determineType(modulesStore, ast.func, scope);

            if (funcType.kind === "func-type") {
                return funcType.returnType;
            } else {
                return UNKNOWN_TYPE;
            }
        };
        case "indexer": {
            const baseType = determineType(modulesStore, ast.base, scope);
            const indexerType = determineType(modulesStore, ast.indexer, scope);
            
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
                        members: [ baseType.valueType, NIL_TYPE ]
                    };
                }
            } else if (baseType.kind === "array-type" && indexerType.kind === "number-type") {
                return baseType.element;
            }

            return UNKNOWN_TYPE;
        };
        case "if-else-expression": {
            const ifType = determineType(modulesStore, ast.ifResult, scope);

            if (ast.elseResult == null) {
                return {
                    kind: "union-type",
                    members: [ ifType, NIL_TYPE ],
                };
            } else {
                const elseType = determineType(modulesStore, ast.elseResult, scope);

                return {
                    kind: "union-type",
                    members: [ ifType, elseType ],
                };
            }
        };
        case "range": return ITERATOR_OF_NUMBERS_TYPE;
        case "parenthesized-expression": return determineType(modulesStore, ast.inner, scope);
        case "property-accessor": {
            const baseType = determineType(modulesStore, ast.base, scope);

            let lastPropType = baseType;
            for (const prop of ast.properties) {
                if (lastPropType.kind !== "object-type") {
                    return UNKNOWN_TYPE;
                }

                const valueType = lastPropType.entries.find(entry => entry[0].name === prop.name)?.[1];
                if (valueType == null) {
                    return UNKNOWN_TYPE;
                }

                lastPropType = valueType;
            }
            
            return lastPropType;
        };
        case "local-identifier": {
            const descriptor = scope.values[ast.name];

            if (descriptor == null) {
                return UNKNOWN_TYPE;
            } else if (descriptor.declaredType.kind !== "unknown-type") {
                return descriptor.declaredType;
            } else if (descriptor.initialValue != null) {
                return determineType(modulesStore, descriptor.initialValue, scope);
            } else {
                return UNKNOWN_TYPE;
            }
        };
        case "object-literal": {
            const entries = ast.entries.map(([key, value]) => 
                [key, determineType(modulesStore, value, scope)] as [PlainIdentifier, TypeExpression]);

            return {
                kind: "object-type",
                entries,
            };
        };
        case "array-literal": {
            const entries = ast.entries.map(entry => determineType(modulesStore, entry, scope));

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
                    },
            };
        }
        case "string-literal": return STRING_TYPE;
        case "number-literal": return NUMBER_TYPE;
        case "boolean-literal": return BOOLEAN_TYPE;
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;
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
    "??": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: UNKNOWN_TYPE }
    ],
    // "??": {
    //     inputs: { kind: "union-type", members: [ { kind: "primitive-type", type: "nil" }, ] },
    //     output: BOOLEAN_TYPE
    // },
}

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
        }
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