import { Module } from "../_model/ast.ts";
import { PlainIdentifier } from "../_model/common.ts";
import { BinaryOp, Expression, isExpression } from "../_model/expressions.ts";
import { BOOLEAN_TYPE, ITERATOR_OF_NUMBERS_TYPE, JAVASCRIPT_ESCAPE_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, TypeExpression, UnionType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, walkParseTree } from "../utils.ts";
import { ModulesStore, Scope } from "./modules-store.ts";
import { BagelTypeError, miscError, resolve, subsumes } from "./typecheck.ts";
import { ClassMember } from "../_model/declarations.ts";

export function typeinfer(reportError: (error: BagelTypeError) => void, modulesStore: ModulesStore, ast: Module): void {
    walkParseTree<Scope>(modulesStore.getScopeFor(ast), ast, (scope, ast) => {
        if (modulesStore.astTypes.get(ast) == null && isExpression(ast)) {
            inferTypeAndStore(reportError, modulesStore, scope, ast)
        }
  
        if (ast.kind === "reaction") {
            // TODO: Might be best to transform the reaction ast under the hood 
            // to a proc call taking a function and proc, to leverage the same
            // type inference mechanism for arguments that will be used 
            // elsewhere 
            const dataType = inferTypeAndStore(reportError, modulesStore, scope, ast.data)
            const effectType = inferTypeAndStore(reportError, modulesStore, scope, ast.effect)

            if (dataType.kind === "func-type" && effectType.kind === "proc-type" && effectType.args[0]?.type.kind === "unknown-type") {
                effectType.args[0].type = dataType.returnType;
            }
        } else if (ast.kind === "computation") {
            inferTypeAndStore(reportError, modulesStore, scope, ast.expression)
        } else if (ast.kind === "for-loop") {
            const iteratorType = inferTypeAndStore(reportError, modulesStore, scope, ast.iterator)

            if (iteratorType.kind === "iterator-type") {
                modulesStore.astTypes.set(ast.itemIdentifier, iteratorType.itemType)
            }
        } else if (ast.kind === "invocation") {
            let subjectType = inferTypeAndStore(reportError, modulesStore, scope, ast.subject);

            if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {

                // bind type-args for this invocation
                // HACK: this is really scopescanning...
                if (subjectType.typeParams.length > 0) {
                    if (subjectType.typeParams.length !== ast.typeArgs.length) {
                        reportError(miscError(ast, `Expected ${subjectType.typeParams.length} type arguments, but got ${ast.typeArgs.length}`))
                    }

                    const scope = modulesStore.getScopeFor(ast)
                    for (let i = 0; i < subjectType.typeParams.length; i++) {
                        const typeParam = subjectType.typeParams[i]
                        const typeArg = ast.typeArgs[i]


                        scope.types[typeParam.name] = typeArg
                    }

                    // HACK: re-evaluate type with new scope contents
                    subjectType = resolve(scope, subjectType) ?? subjectType;
                    modulesStore.astTypes.set(ast.subject, subjectType)
                    if (subjectType.kind === "func-type") {
                        modulesStore.astTypes.set(ast, subjectType.returnType)
                    }
                }
            }

            if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {

                // infer callback argument types based on context
                for (let i = 0; i < Math.min(subjectType.args.length, ast.args.length); i++) {
                    const subjectTypeArg = subjectType.args[i]
                    const argExpr = ast.args[i]

                    if ((subjectTypeArg.type.kind === "func-type" && argExpr.kind === "func") 
                        || (subjectTypeArg.type.kind === "proc-type" && argExpr.kind === "proc")) {

                        for (let j = 0; j < Math.min(subjectTypeArg.type.args.length, argExpr.type.args.length); j++) {
                            if (argExpr.type.args[j].type.kind === "unknown-type") {
                                modulesStore.astTypes.set(argExpr.type.args[j].name, subjectTypeArg.type.args[j].type);
                            }
                        }
                    }
                }

            }
        }

        return modulesStore.scopeFor.get(ast) ?? scope;
    });
}

function inferTypeAndStore(
    reportError: (error: BagelTypeError) => void, 
    modulesStore: ModulesStore,  
    scope: Scope,
    ast: Expression|ClassMember,
): TypeExpression {
    const type = handleSingletonUnion(
        distillUnion(scope, 
            flattenUnions(
                inferType(reportError, modulesStore, scope, ast))));
    modulesStore.astTypes.set(ast, type);
    return type;
}

function inferType(
    reportError: (error: BagelTypeError) => void, 
    modulesStore: ModulesStore, 
    scope: Scope,
    ast: Expression|ClassMember, 
): TypeExpression {
    switch(ast.kind) {
        case "proc": {
            return ast.type;
        }
        case "func": {
            return {
                ...ast.type,

                // if no return-type is declared, try inferring the type from the inner expression
                returnType: ast.type.returnType.kind === "unknown-type" 
                    ? inferTypeAndStore(reportError, modulesStore, modulesStore.getScopeFor(ast), ast.body) 
                    : ast.type.returnType,
            }
        }
        case "pipe": {
            const lastPipeExpression = ast.expressions[ast.expressions.length - 1];
            const lastStageType = inferTypeAndStore(reportError, modulesStore, scope, lastPipeExpression);

            if (lastStageType.kind === "func-type") {
                return lastStageType.returnType;
            } else {
                // reportError(miscError(lastPipeExpression, `Expected function in pipe expression, got '${lastStageType.kind}'`))
                return UNKNOWN_TYPE;
            }
        }
        case "binary-operator": {
            const leftType = inferTypeAndStore(reportError, modulesStore, scope, ast.left);
            const rightType = inferTypeAndStore(reportError, modulesStore, scope, ast.right);

            for (const types of BINARY_OPERATOR_TYPES[ast.operator]) {
                const { left, right, output } = types;

                if (subsumes(scope, left, leftType) && subsumes(scope, right, rightType)) {
                    return output;
                }
            }

            return UNKNOWN_TYPE;
        }
        case "invocation": {
            const funcType = inferTypeAndStore(reportError, modulesStore, scope, ast.subject);

            if (funcType.kind === "func-type") {
                return funcType.returnType;
            } else {
                return UNKNOWN_TYPE;
            }
        }
        case "indexer": {
            const baseType = inferTypeAndStore(reportError, modulesStore, scope, ast.base);
            const indexerType = inferTypeAndStore(reportError, modulesStore, scope, ast.indexer);
            
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
        case "if-else-expression": {
            const ifType = inferTypeAndStore(reportError, modulesStore, scope, ast.ifResult);

            if (ast.elseResult == null) {
                return {
                    kind: "union-type",
                    members: [ ifType, NIL_TYPE ],
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined,
                };
            } else {
                const elseType = inferTypeAndStore(reportError, modulesStore, scope, ast.elseResult);

                return {
                    kind: "union-type",
                    members: [ ifType, elseType ],
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined,
                };
            }
        }
        case "switch-expression": {
            const valueType = inferTypeAndStore(reportError, modulesStore, scope, ast.value)

            const caseTypes = ast.cases.map(({ outcome }) => 
                inferTypeAndStore(reportError, modulesStore, scope, outcome))

            const unionType: UnionType = {
                kind: "union-type",
                members: caseTypes,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };

            if (!subsumes(scope, unionType, valueType)) {
                unionType.members.push(
                    ast.defaultCase 
                        ? inferTypeAndStore(reportError, modulesStore, scope, ast.defaultCase) 
                        : NIL_TYPE
                )
            }
            
            return unionType
        }
        case "range": return ITERATOR_OF_NUMBERS_TYPE;
        case "parenthesized-expression": return inferTypeAndStore(reportError, modulesStore, scope, ast.inner);
        case "property-accessor": {
            const baseType = inferTypeAndStore(reportError, modulesStore, scope, ast.base);

            let lastPropType = baseType;
            for (const prop of ast.properties) {
                if (lastPropType.kind === "object-type") {
                    const valueType = lastPropType.entries.find(entry => entry[0].name === prop.name)?.[1];
                    if (valueType == null) {
                        return UNKNOWN_TYPE;
                    }
    
                    lastPropType = valueType;
                } else if (lastPropType.kind === "class-type") {
                    const member = lastPropType.clazz.members.find(({ name }) => name.name === prop.name);
                    if (member == null) {
                        return UNKNOWN_TYPE;
                    }

                    const valueType = inferTypeAndStore(reportError, modulesStore, scope, member);
                    if (valueType == null) {
                        return UNKNOWN_TYPE;
                    }
    
                    lastPropType = valueType;
                } else {
                    return UNKNOWN_TYPE;
                }
            }
            
            return lastPropType;
        }
        case "local-identifier": {
            const descriptor = scope.values[ast.name];

            if (descriptor == null) {
                return UNKNOWN_TYPE;
            } else if (descriptor.declaredType) {
                return descriptor.declaredType;
            } else if (descriptor.initialValue != null) {
                return inferTypeAndStore(reportError, modulesStore, scope, descriptor.initialValue);
            } else {
                return UNKNOWN_TYPE;
            }
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
                [key, inferTypeAndStore(reportError, modulesStore, scope, value)] as [PlainIdentifier, TypeExpression]);

            return {
                kind: "object-type",
                entries,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "array-literal": {
            const entries = ast.entries.map(entry => inferTypeAndStore(reportError, modulesStore, scope, entry));

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
            clazz: scope.classes[ast.clazz.name],
            code: ast.clazz.code,
            startIndex: ast.clazz.startIndex,
            endIndex: ast.clazz.endIndex
        };
        case "class-property": return ast.type ?? inferTypeAndStore(reportError, modulesStore, scope, ast.value);
        case "class-function": return inferTypeAndStore(reportError, modulesStore, scope, ast.func);
        case "class-procedure": return inferTypeAndStore(reportError, modulesStore, scope, ast.proc);
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
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
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

                    if (subsumes(scope, b, a) && !indicesToDrop.has(j)) {
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