import { Module } from "../_model/ast.ts";
import { BOOLEAN_TYPE, FuncType, ProcType, REACTION_DATA_TYPE, REACTION_UNTIL_TYPE, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, given, walkParseTree } from "../utils.ts";
import { ModulesStore } from "./modules-store.ts";
import { assignmentError,miscError,cannotFindName, BagelError } from "../errors.ts";
import { inferType, resolve } from "./typeinfer.ts";
import { display, getScopeFor, Scope } from "../_model/common.ts";


export function typecheck(reportError: (error: BagelError) => void, modulesStore: ModulesStore, ast: Module) {
    walkParseTree<void>(undefined, ast, (_, ast) => {
        const scope = getScopeFor(modulesStore, ast)

        switch(ast.kind) {
            case "const-declaration": {
                // console.log('-----------------------------checking const decl----------------------------')
                const valueType = inferType(reportError, modulesStore, ast.value);

                if (ast.type != null && !subsumes(scope, ast.type, valueType)) {
                    reportError(assignmentError(ast.value, ast.type, valueType));
                }
            } break;
            case "func": {
                // console.log('-----------------------------checking func----------------------------')
                const bodyType = inferType(reportError, modulesStore, ast.body);

                for (const c of ast.consts) {
                    const valueType = inferType(reportError, modulesStore, c.value)
                    if (c.type && !subsumes(scope, c.type, valueType)) {
                        reportError(assignmentError(c.value, c.type, valueType));
                    }
                }

                if (ast.type.returnType != null && !subsumes(scope, ast.type.returnType, bodyType)) {
                    reportError(assignmentError(ast.body, ast.type.returnType, bodyType));
                }
            } break;
            case "binary-operator": {
                if (inferType(reportError, modulesStore, ast).kind === "unknown-type") {
                    // TODO: Once generics are fully functional, use `type` property here
                    const leftType = inferType(reportError, modulesStore, ast.args[0]);
                    const rightType = inferType(reportError, modulesStore, ast.args[1]);

                    reportError(miscError(ast, `Operator '${ast.operator}' cannot be applied to types '${displayForm(leftType)}' and '${displayForm(rightType)}'`));
                }
            } break;
            case "pipe":
            case "invocation": {
                const subjectType = inferType(reportError, modulesStore, ast.subject);

                if (subjectType.kind !== "func-type" && subjectType.kind !== "proc-type") {
                    reportError(miscError(ast.subject, "Expression must be a function or procedure to be called"));
                } else if (subjectType.args.length !== ast.args.length) {
                    const functionOrProcedure = subjectType.kind === "func-type" ? "Function" : "Procedure"
                    reportError(miscError(ast, `${functionOrProcedure} expected ${subjectType.args.length} arguments but got ${ast.args.length}`));
                } else {
                    for (let i = 0; i < ast.args.length; i++) {
                        const arg = ast.args[i]
                        const subjectArgType = subjectType.args[i].type ?? UNKNOWN_TYPE

                        const argValueType = inferType(reportError, modulesStore, arg)

                        if (!subsumes(scope, subjectArgType, argValueType)) {
                            reportError(assignmentError(arg, subjectArgType, argValueType));
                        }
                    }
                }
            } break;
            case "if-else-expression":
            case "switch-expression": {
                const valueType = ast.kind === "if-else-expression" ? BOOLEAN_TYPE : inferType(reportError, modulesStore, ast.value);

                for (const { condition } of ast.cases) {
                    const conditionType = inferType(reportError, modulesStore, condition);
                    if (!subsumes(scope, valueType, conditionType)) {
                        reportError(assignmentError(condition, valueType, conditionType));
                    }
                }
            } break;
            case "indexer": {
                const baseType = inferType(reportError, modulesStore, ast.subject);
                const indexerType = inferType(reportError, modulesStore, ast.indexer);
                
                if (baseType.kind === "object-type" && indexerType.kind === "literal-type" && indexerType.value.kind === "string-literal" && indexerType.value.segments.length === 1) {
                    const key = indexerType.value.segments[0];
                    const valueType = baseType.entries.find(entry => entry[0].name === key)?.[1];
                    if (valueType == null) {
                        reportError(miscError(ast.indexer, `Property '${key}' doesn't exist on type '${displayForm(baseType)}'`));
                    }
                } else if (baseType.kind === "indexer-type") {
                    if (!subsumes(scope, baseType.keyType, indexerType)) {
                        reportError(assignmentError(ast.indexer, baseType.keyType, indexerType));
                    }
                } else {
                    reportError(miscError(ast.indexer, `Expression of type '${indexerType}' can't be used to index type '${displayForm(baseType)}'`));
                }
            } break;
            case "property-accessor": {
                const subjectType = inferType(reportError, modulesStore, ast.subject);
                
                if (subjectType.kind !== "object-type" && subjectType.kind !== "class-type") {
                    reportError(miscError(ast.subject, `Can only use dot operator (".") on objects with known properties`));
                } else if (subjectType.kind === "object-type") {
                    const propertyExists = subjectType.entries.some(member => member[0].name === ast.property.name)

                    if (!propertyExists) {
                        reportError(miscError(ast.property, `Property '${ast.property.name}' does not exist on type '${displayForm(subjectType)}'`));
                    }
                } else {
                    const propertyExists = subjectType.clazz.members.some(member => member.name.name === ast.property.name)

                    if (!propertyExists) {
                        reportError(miscError(ast.property, `Property '${ast.property.name}' does not exist on class '${subjectType.clazz.name.name}'`));
                    }
                }
            } break;
            case "local-identifier": {
                // console.log({ name: ast.name, scope: scope.values })
                if (scope.values[ast.name] == null && scope.classes[ast.name] == null) {
                    reportError(cannotFindName(ast));
                }
            } break;
            case "string-literal": {
                for (const segment of ast.segments) {
                    if (typeof segment !== "string") {
                        const segmentType = inferType(reportError, modulesStore, segment);

                        if (!subsumes(scope, STRING_TEMPLATE_INSERT_TYPE, segmentType)) {
                            reportError(assignmentError(segment, STRING_TEMPLATE_INSERT_TYPE, segmentType));
                        }
                    }
                }
            } break;

            // not expressions, but should have their contents checked
            case "reaction": {
                const dataType = inferType(reportError, modulesStore, ast.data);
                if (dataType.kind !== "func-type") {
                    reportError(miscError(ast.data, `Expected function in reaction clause`));
                } else if (!subsumes(scope, REACTION_DATA_TYPE, dataType)) {
                    reportError(assignmentError(ast.data, REACTION_DATA_TYPE, dataType));
                }

                const effectType = inferType(reportError, modulesStore, ast.effect);
                const requiredEffectType: ProcType = {
                    kind: 'proc-type',
                    args: [{
                        name: { kind: "plain-identifier", name: "_", code: undefined, startIndex: undefined, endIndex: undefined}, 
                        type: (dataType as FuncType).returnType
                    }],
                    typeParams: [],
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined,
                };
                if (effectType.kind !== "proc-type") {
                    reportError(miscError(ast.effect, `Expected procedure in effect clause`));
                } else if (!subsumes(scope, requiredEffectType, effectType)) {
                    reportError(assignmentError(ast.effect, requiredEffectType, effectType));
                }

                if (ast.until) {
                    const untilType = inferType(reportError, modulesStore, ast.until);
                    if (untilType.kind !== "func-type") {
                        reportError(miscError(ast.data, `Expected function in until clause`));
                    } else if (!subsumes(scope, REACTION_UNTIL_TYPE, untilType)) {
                        reportError(assignmentError(ast.data, REACTION_UNTIL_TYPE, untilType));
                    }
                }

                // TODO: This may become generalized later by generics/inverted inference
                if (effectType.kind !== "proc-type" || effectType.args.length !== 1) {
                    reportError(miscError(ast.data, `Expected procedure taking one argument`));
                } else if (dataType.kind === "func-type" && effectType.kind === "proc-type" && !subsumes(scope, effectType.args[0].type ?? UNKNOWN_TYPE, effectType.args[0].type ?? UNKNOWN_TYPE)) {
                    reportError(assignmentError(effectType.args[0].name, effectType.args[0].type ?? UNKNOWN_TYPE, dataType.returnType ?? UNKNOWN_TYPE));
                }
            } break;
            case "let-declaration": {
                const valueType = inferType(reportError, modulesStore, ast.value);

                if (ast.type != null) {
                    if (!subsumes(scope, ast.type, valueType)) {
                        reportError(assignmentError(ast.value, ast.type, valueType));
                    }
                }
            } break;
            case "assignment": {
                if (ast.target.kind === "local-identifier" && getScopeFor(modulesStore, ast.target).values[ast.target.name].mutability !== "all") {
                    reportError(miscError(ast.target, `Cannot assign to '${ast.target.name}' because it is not mutable`));
                }
                //  else if(ast.target.kind === "property-accessor" && scope.values[ast.target.]) {
                //    TODO: Have to figure out whether the mutability of any arbitrary base expression
                // }

                const targetType = inferType(reportError, modulesStore, ast.target);
                const valueType = inferType(reportError, modulesStore, ast.value);

                if (!subsumes(scope, targetType, valueType)) {
                    reportError(assignmentError(ast.value, targetType, valueType));
                }
            } break;
            case "if-else-statement": {
                const conditionType = inferType(reportError, modulesStore, ast.ifCondition);

                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(ast.ifCondition, `Condition for if statement must be boolean`));
                }
            } break;
            case "for-loop": {
                // TODO: Disallow shadowing? Not sure

                const iteratorType = inferType(reportError, modulesStore, ast.iterator);
                if (iteratorType.kind !== "iterator-type") {
                    reportError(miscError(ast.iterator, `Expected iterator after "of" in for loop`));
                }
            } break;
            case "while-loop": {
                const conditionType = inferType(reportError, modulesStore, ast.condition);
                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(ast.condition, `Condition for while loop must be boolean`));
                }
            } break;
        }        
    });
}

export function subsumes(scope: Scope, destination: TypeExpression, value: TypeExpression): boolean {
    const resolvedDestination = resolve(scope, destination)
    const resolvedValue = resolve(scope, value)

    if (resolvedDestination.kind === "unknown-type") {
        return true;
    } else if(resolvedValue.kind === "unknown-type") {
        return false;
    } else if (resolvedValue.kind === "javascript-escape-type") {
        return true;
    } else if(resolvedDestination.kind === "number-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "number-literal") {
        return true;
    } else if(resolvedDestination.kind === "string-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "string-literal") {
        return true;
    } else if(resolvedDestination.kind === "boolean-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "boolean-literal") {
        return true;
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
    } else if(deepEquals(resolvedDestination, resolvedValue, ["code", "startIndex", "endIndex", "scope"])) {
        return true;
    } else if (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedDestination.args.every((_, i) => subsumes(scope, resolvedValue.args[i].type ?? UNKNOWN_TYPE, resolvedDestination.args[i].type ?? UNKNOWN_TYPE))
            && subsumes(scope, resolvedDestination.returnType ?? UNKNOWN_TYPE, resolvedValue.returnType ?? UNKNOWN_TYPE)) {
        return true;
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedDestination.args.every((_, i) => subsumes(scope, resolvedValue.args[i].type ?? UNKNOWN_TYPE, resolvedDestination.args[i].type ?? UNKNOWN_TYPE))) {
        return true;
    } else if (resolvedDestination.kind === "array-type" && resolvedValue.kind === "array-type") {
        return subsumes(scope, resolvedDestination.element, resolvedValue.element)
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        return resolvedDestination.entries.every(([key, destinationValue]) => 
            given(resolvedValue.entries.find(e => deepEquals(e[0], key, ["code", "startIndex", "endIndex", "scope"]))?.[1], value => subsumes(scope, destinationValue, value)));
    } else if (resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") {
        return subsumes(scope, resolvedDestination.itemType, resolvedValue.itemType);
    }

    return false;
}

export function displayForm(typeExpression: TypeExpression): string {
    switch (typeExpression.kind) {
        case "union-type": return typeExpression.members.map(displayForm).join(" | ");
        case "named-type": return typeExpression.name.name;
        case "proc-type": return `(${typeExpression.args.map(arg => arg.name.name + (arg.type ? `: ${displayForm(arg.type)}` : '')).join(', ')}) {}`;
        case "func-type": return `(${typeExpression.args.map(arg => arg.name.name + (arg.type ? `: ${displayForm(arg.type)}` : '')).join(', ')}) => ${displayForm(typeExpression.returnType ?? UNKNOWN_TYPE)}`;
        case "object-type": return `{ ${typeExpression.entries.map(([ key, value ]) => `${key.name}: ${displayForm(value)}`)} }`;
        case "indexer-type": return `{ [${displayForm(typeExpression.keyType)}]: ${displayForm(typeExpression.valueType)} }`;
        case "array-type": return `${displayForm(typeExpression.element)}[]`;
        case "tuple-type": return `[${typeExpression.members.map(displayForm).join(", ")}]`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `nil`;
        case "literal-type": return JSON.stringify(typeExpression.value.kind === "string-literal" 
                                        ? typeExpression.value.segments.join('') 
                                        : typeExpression.value.value).replaceAll('"', "'");
        case "nominal-type": return typeExpression.name;
        case "iterator-type": return `Iterator<${displayForm(typeExpression.itemType)}>`;
        case "plan-type": return `Plan<${displayForm(typeExpression.resultType)}>`;
        case "unknown-type": return "unknown";
        case "element-type": return `<element tag>`
        // case "element-type": return `<${typeExpression.tagName}>`;
        case "javascript-escape-type": return "<js escape>";
        case "class-type": return typeExpression.clazz.name.name;
    }
}
