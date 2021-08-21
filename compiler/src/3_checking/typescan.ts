import { Module } from "../_model/ast";
import { PlainIdentifier } from "../_model/common";
import { BinaryOp, Expression, Func, isExpression, LocalIdentifier } from "../_model/expressions";
import { BOOLEAN_TYPE, FuncType, ITERATOR_OF_NUMBERS_TYPE, JAVASCRIPT_ESCAPE_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions";
import { deepEquals, DeepReadonly, walkParseTree } from "../utils";
import { ModulesStore, Scope } from "./modules-store";
import { BagelTypeError, miscError, subsumes } from "./typecheck";

export function typescan(reportError: (error: BagelTypeError) => void, modulesStore: ModulesStore, ast: Module): void {
    walkParseTree<DeepReadonly<Scope>>(modulesStore.getScopeFor(ast), ast, (scope, ast) => {
        if (modulesStore.astTypes.get(ast) == null && isExpression(ast)) {
            determineTypeAndCache(reportError, modulesStore, ast, scope)
        } else if (ast.kind === "reaction") {
            // TODO: Might be best to ransform the reaction ast under the hood 
            // to a proc call taking a function and proc, to leverage the same
            // type inference mechanism for arguments that will be used 
            // elsewhere 
            const dataType = determineTypeAndCache(reportError, modulesStore, ast.data, scope)
            const effectType = determineTypeAndCache(reportError, modulesStore, ast.effect, scope)

            if (dataType.kind === "func-type" && effectType.kind === "proc-type" && effectType.argTypes[0].kind === "unknown-type") {
                effectType.argTypes[0] = dataType.returnType;
            }
        } else if (ast.kind === "computation") {
            determineTypeAndCache(reportError, modulesStore, ast.expression, scope)
        }

        return modulesStore.scopeFor.get(ast) ?? scope;
    });
}

function determineTypeAndCache(
    reportError: (error: BagelTypeError) => void, 
    modulesStore: ModulesStore, 
    ast: Expression, 
    scope: DeepReadonly<Scope>
): TypeExpression {
    const type = handleSingletonUnion(distillUnion(scope, flattenUnions(determineType(reportError, modulesStore, ast, scope))));
    modulesStore.astTypes.set(ast, type);
    return type;
}

function determineType(
    reportError: (error: BagelTypeError) => void, 
    modulesStore: ModulesStore, 
    ast: Expression, 
    scope: DeepReadonly<Scope>
): TypeExpression {
    switch(ast.kind) {
        case "proc": {
            return ast.type;
        };
        case "func": {
            return {
                ...ast.type,

                // if no return-type is declared, try inferring the type from the inner expression
                returnType: ast.type.returnType.kind === "unknown-type" 
                    ? determineTypeAndCache(reportError, modulesStore, ast.body, modulesStore.getScopeFor(ast)) 
                    : ast.type.returnType,
            }
        };
        case "pipe": {
            const lastPipeExpression = ast.expressions[ast.expressions.length - 1];
            const lastStageType = determineTypeAndCache(reportError, modulesStore, lastPipeExpression, scope);

            if (lastStageType.kind === "func-type") {
                return lastStageType.returnType;
            } else {
                // reportError(miscError(lastPipeExpression, `Expected function in pipe expression, got '${lastStageType.kind}'`))
                return UNKNOWN_TYPE;
            }
        };
        case "binary-operator": {
            const leftType = determineTypeAndCache(reportError, modulesStore, ast.left, scope);
            const rightType = determineTypeAndCache(reportError, modulesStore, ast.right, scope);

            for (const types of BINARY_OPERATOR_TYPES[ast.operator]) {
                const { left, right, output } = types;

                if (subsumes(scope, left, leftType) && subsumes(scope, right, rightType)) {
                    return output;
                }
            }

            return UNKNOWN_TYPE;
        };
        case "funcall": {
            const funcType = determineTypeAndCache(reportError, modulesStore, ast.func, scope);

            if (funcType.kind === "func-type") {
                return funcType.returnType;
            } else {
                return UNKNOWN_TYPE;
            }
        };
        case "indexer": {
            const baseType = determineTypeAndCache(reportError, modulesStore, ast.base, scope);
            const indexerType = determineTypeAndCache(reportError, modulesStore, ast.indexer, scope);
            
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
            const ifType = determineTypeAndCache(reportError, modulesStore, ast.ifResult, scope);

            if (ast.elseResult == null) {
                return {
                    kind: "union-type",
                    members: [ ifType, NIL_TYPE ],
                };
            } else {
                const elseType = determineTypeAndCache(reportError, modulesStore, ast.elseResult, scope);

                return {
                    kind: "union-type",
                    members: [ ifType, elseType ],
                };
            }
        };
        case "range": return ITERATOR_OF_NUMBERS_TYPE;
        case "parenthesized-expression": return determineTypeAndCache(reportError, modulesStore, ast.inner, scope);
        case "property-accessor": {
            const baseType = determineTypeAndCache(reportError, modulesStore, ast.base, scope);

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
                return determineTypeAndCache(reportError, modulesStore, descriptor.initialValue, scope);
            } else {
                return UNKNOWN_TYPE;
            }
        };
        case "element-tag": {
            return {
                kind: "element-type",
                tagName: ast.tagName,
                attributes: ast.attributes
            };
        };
        case "object-literal": {
            const entries = ast.entries.map(([key, value]) => 
                [key, determineTypeAndCache(reportError, modulesStore, value, scope)] as [PlainIdentifier, TypeExpression]);

            return {
                kind: "object-type",
                entries,
            };
        };
        case "array-literal": {
            const entries = ast.entries.map(entry => determineTypeAndCache(reportError, modulesStore, entry, scope));

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
        };
        case "string-literal": return STRING_TYPE;
        case "number-literal": return NUMBER_TYPE;
        case "boolean-literal": return BOOLEAN_TYPE;
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;

        throw Error();
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

function distillUnion(scope: Scope, type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        const indicesToDrop = new Set<number>();

        for (let i = 0; i < type.members.length; i++) {
            for (let j = 0; j < type.members.length; j++) {
                if (i !== j) {
                    const a = type.members[i];
                    const b = type.members[j];

                    if (subsumes(scope, type.members[j], type.members[i]) && !indicesToDrop.has(j)) {
                        indicesToDrop.add(i);
                    }
                }
            }
        }

        return {
            kind: "union-type",
            members: type.members.filter((_, index) => !indicesToDrop.has(index)),
        }
    } else {
        return type;
    }
}

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