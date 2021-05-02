import { AST, LocalIdentifier, Module, PlainIdentifier, Proc, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE, REACTION_DATA_TYPE, REACTION_EFFECT_TYPE } from "./ast";
import { ModulesStore, Scope } from "./modules-store";
import { lineAndColumn } from "./parsing-utils";
import { deepEquals, DeepReadonly, given, walkParseTree } from "./utils";

export function typecheck(modulesStore: ModulesStore, ast: Module, reportError: (error: BagelTypeError) => void) {
    walkParseTree<DeepReadonly<Scope>>(modulesStore.getScopeFor(ast), ast, (scope, ast) => {
        switch(ast.kind) {
            case "block": {
                return modulesStore.getScopeFor(ast);
            };
            case "const-declaration": {
                const constType = ast.type;
                const valueType = modulesStore.getTypeOf(ast.value);

                if (!subsumes(scope, constType, valueType)) {
                    reportError(assignmentError(ast.value, constType, valueType));
                }

                return scope;
            };
            case "func": {
                const funcScope = modulesStore.getScopeFor(ast);
                const bodyType = modulesStore.getTypeOf(ast.body);

                if (ast.type.returnType.kind !== "unknown-type" && !subsumes(funcScope, ast.type.returnType, bodyType)) {
                    reportError(assignmentError(ast.body, ast.type.returnType, bodyType));
                }
                
                return funcScope;
            };
            case "pipe": {
                let inputType = modulesStore.getTypeOf(ast.expressions[0]);

                for (const expr of ast.expressions.slice(1)) {
                    const typeOfPipe = modulesStore.getTypeOf(expr);

                    if (typeOfPipe?.kind !== "func-type") {
                        reportError(miscError(ast, `Each transformation in pipeline expression must be a function`));
                    } else if (!subsumes(scope, typeOfPipe.argTypes[0], inputType)) {
                        reportError(assignmentError(ast, typeOfPipe.argTypes[0], inputType));
                    } else {
                        inputType = typeOfPipe.returnType;
                    }
                }

                return scope;
            };
            case "binary-operator": {
                if (modulesStore.getTypeOf(ast).kind === "unknown-type") {
                    const leftType = modulesStore.getTypeOf(ast.left);
                    const rightType = modulesStore.getTypeOf(ast.right);

                    reportError(miscError(ast, `Operator '${ast.operator}' cannot be applied to types '${serialize(leftType)}' and '${serialize(rightType)}'`));
                }

                return scope;
            };
            case "funcall": {
                const funcType = modulesStore.getTypeOf(ast.func);

                if (funcType.kind !== "func-type") {
                    reportError(miscError(ast, "Expression must be a function to be called"));
                } else {
                    // TODO: infer what types arguments are allowed to be based on function body

                    const argValueTypes = ast.args.map(arg => modulesStore.getTypeOf(arg));

                    for (let index = 0; index < argValueTypes.length; index++) {
                        const argValueType = argValueTypes[index];
                        if (!subsumes(scope, funcType.argTypes[index], argValueType)) {
                            reportError(assignmentError(ast.args[index], funcType.argTypes[index], argValueType));
                        }
                    }
                }

                return scope;
            };
            case "indexer": {
                const baseType = modulesStore.getTypeOf(ast.base);
                const indexerType = modulesStore.getTypeOf(ast.indexer);
                
                if (baseType.kind === "object-type" && indexerType.kind === "literal-type" && indexerType.value.kind === "string-literal" && indexerType.value.segments.length === 1) {
                    const key = indexerType.value.segments[0];
                    const valueType = baseType.entries.find(entry => entry[0].name === key)?.[1];
                    if (valueType == null) {
                        reportError(miscError(ast.indexer, `Property '${key}' doesn't exist on type '${serialize(baseType)}'`));
                    }
                } else if (baseType.kind === "indexer-type") {
                    if (!subsumes(scope, baseType.keyType, indexerType)) {
                        reportError(assignmentError(ast.indexer, baseType.keyType, indexerType));
                    }
                } else {
                    reportError(miscError(ast.indexer, `Expression of type '${indexerType}' can't be used to index type '${serialize(baseType)}'`));
                }

                return scope;
            };
            case "if-else-expression": {
                const ifConditionType = modulesStore.getTypeOf(ast.ifCondition);
                if (ifConditionType?.kind !== "boolean-type") {
                    reportError(miscError(ast, "Condition for if expression must be boolean"));
                }

                return scope;
            };
            case "property-accessor": {
                const baseType = modulesStore.getTypeOf(ast.base);

                let lastPropType = baseType;
                for (const prop of ast.properties) {
                    if (lastPropType.kind !== "object-type") {
                        reportError(miscError(prop, `Can only use dot operator (".") on objects with known properties`));
                        return scope;
                    }

                    const valueType = lastPropType.entries.find(entry => entry[0].name === prop.name)?.[1];
                    if (valueType == null) {
                        reportError(miscError(prop, `Property '${prop.name}' doesn't exist on type '${serialize(baseType)}'`));
                        return scope;
                    }

                    lastPropType = valueType;
                }
                
                return scope;
            };
            case "local-identifier": {
                if (scope.values[ast.name] == null) {
                    reportError(cannotFindName(ast));
                }

                return scope;
            };
            case "string-literal": {
                for (const segment of ast.segments) {
                    if (typeof segment !== "string") {
                        const segmentType = modulesStore.getTypeOf(segment);

                        if (!subsumes(scope, STRING_TEMPLATE_INSERT_TYPE, segmentType)) {
                            reportError(assignmentError(segment, STRING_TEMPLATE_INSERT_TYPE, segmentType));
                        }
                    }
                }

                return scope;
            };

            // not expressions, but should have their contents checked
            case "reaction": {
                const dataType = modulesStore.getTypeOf(ast.data);
                if (dataType.kind !== "func-type") {
                    reportError(miscError(ast.data, `Expected function in reaction clause`));
                } else if (!subsumes(scope, REACTION_DATA_TYPE, dataType)) {
                    reportError(assignmentError(ast.data, REACTION_DATA_TYPE, dataType));
                }

                const effectType = modulesStore.getTypeOf(ast.data);
                if (effectType.kind !== "proc-type") {
                    reportError(miscError(ast.data, `Expected procedure in effect clause`));
                } else if (!subsumes(scope, REACTION_EFFECT_TYPE, effectType)) {
                    reportError(assignmentError(ast.data, REACTION_EFFECT_TYPE, effectType));
                }

                // TODO: This may become generalized later by generics/inverted inference
                if (dataType.kind === "func-type" && effectType.kind === "proc-type" && !subsumes(scope, effectType.argTypes[0], dataType.returnType)) {
                    reportError(assignmentError((ast.effect as Proc).argNames[0], effectType.argTypes[0], dataType.returnType));
                }

                return scope;
            };
            case "let-declaration": {
                const valueType = modulesStore.getTypeOf(ast.value);

                if (ast.type != null) {
                    const declaredType = ast.type;

                    if (!subsumes(scope, declaredType, valueType)) {
                        reportError(assignmentError(ast.value, declaredType, valueType));
                    }
                }
                
                return scope;
            };
            case "assignment": {
                // TODO: Check we're not assigning to a const

                const targetType = modulesStore.getTypeOf(ast.target);
                const valueType = modulesStore.getTypeOf(ast.value);

                if (!subsumes(scope, targetType, valueType)) {
                    reportError(assignmentError(ast.value, targetType, valueType));
                }

                return scope;
            };
            case "proc-call": {
                const procType = modulesStore.getTypeOf(ast.proc);

                if (procType.kind !== "proc-type") {
                    // console.log(procType)
                    reportError(miscError(ast.proc, `Expression must be a procedure to be called`));
                } else {
                    const argValueTypes = ast.args.map(arg => modulesStore.getTypeOf(arg));
    
                    for (let index = 0; index < argValueTypes.length; index++) {
                        const argValueType = argValueTypes[index];
                        if (!subsumes(scope, procType.argTypes[index], argValueType)) {
                            reportError(assignmentError(ast.args[index], procType.argTypes[index], argValueType));
                        }
                    }
                }

                return scope;
            };
            case "if-else-statement": {
                const conditionType = modulesStore.getTypeOf(ast.ifCondition);

                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(ast.ifCondition, `Condition for if statement must be boolean`));
                }

                return scope;
            };
            case "for-loop": {
                // TODO: Disallow shadowing? Not sure

                const iteratorType = modulesStore.getTypeOf(ast.iterator);
                if (iteratorType.kind !== "iterator-type") {
                    reportError(miscError(ast.iterator, `Expected iterator after "of" in for loop`));
                }

                return scope;
            };
            case "while-loop": {
                const conditionType = modulesStore.getTypeOf(ast.condition);
                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(ast.condition, `Condition for while loop must be boolean`));
                }
                
                return scope;
            };
            default:
                return scope;
        }        
    });
}

export function subsumes(scope: DeepReadonly<Scope>, destination: TypeExpression, value: TypeExpression): boolean {
    const resolvedDestination = resolve(scope, destination);
    const resolvedValue = resolve(scope, value);

    if (resolvedDestination == null || resolvedValue == null) {
        return false;
    }

    if (resolvedDestination.kind === "unknown-type") {
        return true;
    } else if(resolvedValue.kind === "unknown-type") {
        return false;
    } else if(resolvedDestination.kind === "union-type") {
        if (resolvedValue.kind === "union-type") {
            return resolvedValue.members.every(valueMember => 
                resolvedDestination.members.some(destinationMember => 
                    subsumes(scope, destinationMember, valueMember)));
        } else {
            return resolvedDestination.members.some(member => 
                subsumes(scope, member, resolvedValue));
        }
    } else if (resolvedValue.kind === "union-type") {
        return false;
    } else if(deepEquals(resolvedDestination, resolvedValue, ["code", "startIndex", "endIndex"])) {
        return true;
    } else if (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedValue.argTypes.every((valueArg, index) => subsumes(scope, valueArg, resolvedDestination.argTypes[index]))
            && subsumes(scope, resolvedDestination.returnType, resolvedValue.returnType)) {
        return true;
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedValue.argTypes.every((valueArg, index) => subsumes(scope, valueArg, resolvedDestination.argTypes[index]))) {
        return true;
    } else if (resolvedDestination.kind === "array-type" && resolvedValue.kind === "array-type") {
        return subsumes(scope, resolvedDestination.element, resolvedValue.element)
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        return resolvedDestination.entries.every(([key, destinationValue]) => 
            given(resolvedValue.entries.find(e => deepEquals(e[0], key, ["code", "startIndex", "endIndex"]))?.[1], value => subsumes(scope, destinationValue, value)));
    } else if (resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") {
        return subsumes(scope, resolvedDestination.itemType, resolvedValue.itemType);
    } else if (resolvedValue.kind === "javascript-escape-type") {
        return true;
    }

    return false;
}

function resolve(scope: DeepReadonly<Scope>, type: DeepReadonly<TypeExpression>): DeepReadonly<TypeExpression> | undefined {
    if (type.kind === "named-type") {
        const namedType = scope.types[type.name.name];
        return given(namedType, namedType => resolve(scope, namedType));
    } else if(type.kind === "union-type") {
        const memberTypes = type.members.map(member => resolve(scope, member));
        if (memberTypes.some(member => member == null)) {
            return undefined;
        } else {
            return {
                kind: "union-type",
                members: memberTypes as DeepReadonly<TypeExpression>[],
            };
        }
    } else if(type.kind === "object-type") {
        const entries: [PlainIdentifier, DeepReadonly<TypeExpression>][] = type.entries.map(([ key, valueType ]) => 
            [key, resolve(scope, valueType as DeepReadonly<TypeExpression>)] as [PlainIdentifier, DeepReadonly<TypeExpression>]);

        return {
            kind: "object-type",
            entries,
        }
    } else if(type.kind === "array-type") {
        return given(resolve(scope, type.element), element => ({
            kind: "array-type",
            element,
        }));
    } else {
        // TODO: Recurse on ProcType, FuncType, IndexerType, TupleType
        return type;
    }
}

function serialize(typeExpression: TypeExpression): string {
    switch (typeExpression.kind) {
        case "union-type": return typeExpression.members.map(serialize).join(" | ");
        case "named-type": return typeExpression.name.name;
        case "proc-type": return `(${typeExpression.argTypes.map(serialize).join(", ")}) { }`;
        case "func-type": return `(${typeExpression.argTypes.map(serialize).join(", ")}) => ${serialize(typeExpression.returnType)}`;
        case "object-type": return `{ ${typeExpression.entries.map(([ key, value ]) => `${key.name}: ${serialize(value)}`)} }`;
        case "indexer-type": return `{ [${serialize(typeExpression.keyType)}]: ${serialize(typeExpression.valueType)} }`;
        case "array-type": return `${serialize(typeExpression.element)}[]`;
        case "tuple-type": return `[${typeExpression.members.map(serialize).join(", ")}]`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `nil`;
        case "literal-type": return String(typeExpression.value);
        case "nominal-type": return typeExpression.name;
        case "iterator-type": return `Iterator<${typeExpression.itemType}>`;
        case "promise-type": return `Promise<${typeExpression.resultType}>`;
        case "unknown-type": return "unknown";
        case "javascript-escape-type": return "#js#"
    }
}

export type BagelTypeError =
    | BagelAssignableToError
    | BagelCannotFindNameError
    | BagelMiscTypeError

export type BagelAssignableToError = {
    kind: "bagel-assignable-to-error",
    ast: AST,
    destination: TypeExpression,
    value: TypeExpression,
    stack?: string|undefined,
}

export type BagelCannotFindNameError = {
    kind: "bagel-cannot-find-name-error",
    ast: LocalIdentifier,
}

export type BagelMiscTypeError = {
    kind: "bagel-misc-type-error",
    ast: AST|undefined,
    message: string,
}

export function errorMessage(error: BagelTypeError): string {
    const lineAndColumnMsg = given(given(error.ast, ast => lineAndColumn(ast.code, ast.startIndex)), ({ line, column }) => `${line}:${column} `) ?? ``;
    
    switch (error.kind) {
        case "bagel-assignable-to-error":
            return lineAndColumnMsg + `Type '${serialize(error.value)}' is not assignable to type '${serialize(error.destination)}'`;
        case "bagel-cannot-find-name-error":
            return lineAndColumnMsg + `Cannot find name '${error.ast.name}'`;
        case "bagel-misc-type-error":
            return lineAndColumnMsg + error.message;
    }
}

// export function isError(x: unknown): x is BagelTypeError {
//     return x != null && typeof x === "object" && ((x as any).kind === "bagel-assignable-to-error" || (x as any).kind === "bagel-misc-type-error");
// }

export function assignmentError(ast: AST, destination: TypeExpression, value: TypeExpression): BagelAssignableToError {
    return { kind: "bagel-assignable-to-error", ast, destination, value, stack: undefined };
}

export function cannotFindName(ast: LocalIdentifier): BagelCannotFindNameError {
    return { kind: "bagel-cannot-find-name-error", ast };
}

export function miscError(ast: AST|undefined, message: string): BagelMiscTypeError {
    return { kind: "bagel-misc-type-error", ast, message }
}
