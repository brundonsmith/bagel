import { AST, Module } from "../_model/ast.ts";
import { PlainIdentifier } from "../_model/common.ts";
import { ImportDeclaration, ImportItem } from "../_model/declarations.ts";
import { Expression, LocalIdentifier, Proc } from "../_model/expressions.ts";
import { FuncType, ProcType, REACTION_DATA_TYPE, REACTION_UNTIL_TYPE, STRING_TEMPLATE_INSERT_TYPE, TypeExpression } from "../_model/type-expressions.ts";
import { deepEquals, DeepReadonly, given, sOrNone, walkParseTree, wasOrWere } from "../utils.ts";
import { ModulesStore, Scope } from "./modules-store.ts";


export function typecheck(modulesStore: ModulesStore, ast: Module, reportError: (error: BagelTypeError) => void) {
    walkParseTree<DeepReadonly<Scope>>(modulesStore.getScopeFor(ast), ast, (scope, ast) => {
        switch(ast.kind) {
            case "block": {
                return modulesStore.getScopeFor(ast);
            }
            case "const-declaration": {
                const constType = ast.type;
                const valueType = modulesStore.getTypeOf(ast.value);

                if (!subsumes(scope, constType, valueType)) {
                    reportError(assignmentError(ast.value, constType, valueType));
                }

                return scope;
            }
            case "func": {
                const funcScope = modulesStore.getScopeFor(ast);
                const bodyType = modulesStore.getTypeOf(ast.body);

                if (ast.type.returnType.kind !== "unknown-type" && !subsumes(funcScope, ast.type.returnType, bodyType)) {
                    reportError(assignmentError(ast.body, ast.type.returnType, bodyType));
                }
                
                return funcScope;
            }
            case "pipe": {
                let inputType = modulesStore.getTypeOf(ast.expressions[0]);

                for (const expr of ast.expressions.slice(1)) {
                    const typeOfPipe = modulesStore.getTypeOf(expr);

                    if (typeOfPipe?.kind !== "func-type") {
                        reportError(miscError(expr, `Each transformation in pipeline expression must be a function: found '${typeOfPipe.kind}'`));
                    } else if (typeOfPipe.argType == null) {
                        reportError(miscError(expr, `Pipeline function expected to take an argument, but takes no arguments`));
                    } else if (!subsumes(scope, typeOfPipe.argType, inputType)) {
                        reportError(assignmentError(ast, typeOfPipe.argType, inputType));
                    } else {
                        inputType = typeOfPipe.returnType;
                    }
                }

                return scope;
            }
            case "binary-operator": {
                if (modulesStore.getTypeOf(ast).kind === "unknown-type") {
                    const leftType = modulesStore.getTypeOf(ast.left);
                    const rightType = modulesStore.getTypeOf(ast.right);

                    reportError(miscError(ast, `Operator '${ast.operator}' cannot be applied to types '${displayForm(leftType)}' and '${displayForm(rightType)}'`));
                }

                return scope;
            }
            case "funcall": {
                const funcType = modulesStore.getTypeOf(ast.func);

                if (funcType.kind !== "func-type") {
                    reportError(miscError(ast, "Expression must be a function to be called"));
                } else if (funcType.argType == null && ast.arg != null) {
                    reportError(miscError(ast, `Too many arguments passed to function`));
                } else if (funcType.argType != null && ast.arg == null) {
                    reportError(miscError(ast, `Function expected argument of type ${displayForm(funcType.argType)}`));
                } else {
                    const arg = ast.arg as Expression
                    // TODO: infer what types arguments are allowed to be based on function body
                    const argValueType = modulesStore.getTypeOf(arg as Expression)

                    if (funcType.argType != null && !subsumes(scope, funcType.argType, argValueType)) {
                        reportError(assignmentError(arg, funcType.argType, argValueType));
                    }
                }

                return scope;
            }
            case "indexer": {
                const baseType = modulesStore.getTypeOf(ast.base);
                const indexerType = modulesStore.getTypeOf(ast.indexer);
                
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

                return scope;
            }
            case "if-else-expression": {
                const ifConditionType = modulesStore.getTypeOf(ast.ifCondition);
                if (ifConditionType?.kind !== "boolean-type") {
                    reportError(miscError(ast, "Condition for if expression must be boolean"));
                }

                return scope;
            }
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
                        reportError(miscError(prop, `Property '${prop.name}' doesn't exist on type '${displayForm(baseType)}'`));
                        return scope;
                    }

                    lastPropType = valueType;
                }
                
                return scope;
            }
            case "local-identifier": {
                if (scope.values[ast.name] == null) {
                    reportError(cannotFindName(ast));
                }

                return scope;
            }
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
            }

            // not expressions, but should have their contents checked
            case "reaction": {
                const dataType = modulesStore.getTypeOf(ast.data);
                if (dataType.kind !== "func-type") {
                    reportError(miscError(ast.data, `Expected function in reaction clause`));
                } else if (!subsumes(scope, REACTION_DATA_TYPE, dataType)) {
                    reportError(assignmentError(ast.data, REACTION_DATA_TYPE, dataType));
                }

                const effectType = modulesStore.getTypeOf(ast.effect);
                const requiredEffectType: ProcType = {
                    kind: 'proc-type',
                    argType: (dataType as FuncType).returnType,
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
                    const untilType = modulesStore.getTypeOf(ast.until);
                    if (untilType.kind !== "func-type") {
                        reportError(miscError(ast.data, `Expected function in until clause`));
                    } else if (!subsumes(scope, REACTION_UNTIL_TYPE, untilType)) {
                        reportError(assignmentError(ast.data, REACTION_UNTIL_TYPE, untilType));
                    }
                }

                // TODO: This may become generalized later by generics/inverted inference
                if (effectType.kind !== "proc-type" || effectType.argType == null || (ast.effect as Proc).argName == null) {
                    reportError(miscError(ast.data, `Expected procedure taking one argument`));
                } else if (dataType.kind === "func-type" && effectType.kind === "proc-type" && !subsumes(scope, effectType.argType as TypeExpression, dataType.returnType)) {
                    reportError(assignmentError((ast.effect as Proc).argName as PlainIdentifier, effectType.argType, dataType.returnType));
                }

                return scope;
            }
            case "let-declaration": {
                // console.log(JSON.stringify(scope, null, 2))
                // console.log(JSON.stringify(ast, null, 2))
                const valueType = modulesStore.getTypeOf(ast.value);

                if (ast.type != null) {
                    const declaredType = ast.type;

                    if (!subsumes(scope, declaredType, valueType)) {
                        reportError(assignmentError(ast.value, declaredType, valueType));
                    }
                }
                
                return scope;
            }
            case "assignment": {
                if (ast.target.kind === "local-identifier" && scope.values[ast.target.name].mutability !== "all") {
                    reportError(miscError(ast.target, `Cannot assign to '${ast.target.name}' because it is not mutable`));
                }
                //  else if(ast.target.kind === "property-accessor" && scope.values[ast.target.]) {
                //    TODO: Have to figure out whether the mutability of any arbitrary base expression
                // }

                const targetType = modulesStore.getTypeOf(ast.target);
                const valueType = modulesStore.getTypeOf(ast.value);

                if (!subsumes(scope, targetType, valueType)) {
                    reportError(assignmentError(ast.value, targetType, valueType));
                }

                return scope;
            }
            case "proc-call": {
                const procType = modulesStore.getTypeOf(ast.proc);

                // TODO: Proc call has to finish applying arguments to be valid; 
                // partial-application of a proc would actually be an 
                // expression (oh boy)

                if (procType.kind !== "proc-type") {
                    reportError(miscError(ast.proc, `Expression must be a procedure to be called`));
                } else if (procType.argType == null && ast.arg != null) {
                    reportError(miscError(ast, `Too many arguments passed to procedure`));
                } else if (procType.argType != null && ast.arg == null) {
                    reportError(miscError(ast, `Procedure expected argument of type ${displayForm(procType.argType)}`));
                } else {
                    const arg = ast.arg as Expression
                    const argValueType =  modulesStore.getTypeOf(arg);
    
                    if (procType.argType != null && !subsumes(scope, procType.argType, argValueType)) {
                        reportError(assignmentError(arg, procType.argType, argValueType));
                    }
                }

                return scope;
            }
            case "if-else-statement": {
                const conditionType = modulesStore.getTypeOf(ast.ifCondition);

                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(ast.ifCondition, `Condition for if statement must be boolean`));
                }

                return scope;
            }
            case "for-loop": {
                // TODO: Disallow shadowing? Not sure

                const iteratorType = modulesStore.getTypeOf(ast.iterator);
                if (iteratorType.kind !== "iterator-type") {
                    reportError(miscError(ast.iterator, `Expected iterator after "of" in for loop`));
                }

                return scope;
            }
            case "while-loop": {
                const conditionType = modulesStore.getTypeOf(ast.condition);
                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(ast.condition, `Condition for while loop must be boolean`));
                }
                
                return scope;
            }
            default:
                return scope;
        }        
    });
}

export function subsumes(scope: DeepReadonly<Scope>, destination: TypeExpression, value: TypeExpression): boolean {
    const resolvedDestination = resolve(scope, destination);
    const resolvedValue = resolve(scope, value);

    // console.log({ resolvedDestination, resolvedValue })

    if (resolvedDestination == null || resolvedValue == null) {
        return false;
    } else if (resolvedValue.kind === "javascript-escape-type") {
        return true;
    } else if (resolvedDestination.kind === "unknown-type") {
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
            && (resolvedValue.argType == null && resolvedDestination.argType == null
                || (resolvedValue.argType != null && resolvedDestination.argType != null && subsumes(scope, resolvedValue.argType, resolvedDestination.argType)))
            && subsumes(scope, resolvedDestination.returnType, resolvedValue.returnType)) {
        return true;
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && (resolvedValue.argType == null && resolvedDestination.argType == null
                || (resolvedValue.argType != null && resolvedDestination.argType != null && subsumes(scope, resolvedValue.argType, resolvedDestination.argType)))) {
        return true;
    } else if (resolvedDestination.kind === "array-type" && resolvedValue.kind === "array-type") {
        return subsumes(scope, resolvedDestination.element, resolvedValue.element)
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        return resolvedDestination.entries.every(([key, destinationValue]) => 
            given(resolvedValue.entries.find(e => deepEquals(e[0], key, ["code", "startIndex", "endIndex"]))?.[1], value => subsumes(scope, destinationValue, value)));
    } else if (resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") {
        return subsumes(scope, resolvedDestination.itemType, resolvedValue.itemType);
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
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
    } else if(type.kind === "object-type") {
        const entries: [PlainIdentifier, DeepReadonly<TypeExpression>][] = type.entries.map(([ key, valueType ]) => 
            [key, resolve(scope, valueType as DeepReadonly<TypeExpression>)] as [PlainIdentifier, DeepReadonly<TypeExpression>]);

        return {
            kind: "object-type",
            entries,
            code: undefined,
            startIndex: undefined,
            endIndex: undefined,
        }
    } else if(type.kind === "array-type") {
        return given(resolve(scope, type.element), element => ({
            kind: "array-type",
            element,
            code: undefined,
            startIndex: undefined,
            endIndex: undefined,
        }));
    } else {
        // TODO: Recurse on ProcType, FuncType, IndexerType, TupleType
        return type;
    }
}

function displayForm(typeExpression: TypeExpression): string {
    switch (typeExpression.kind) {
        case "union-type": return typeExpression.members.map(displayForm).join(" | ");
        case "named-type": return typeExpression.name.name;
        // TODO: proc-type and func-type should display to users as (arg0, arg1, arg2) instead of (arg0) => (arg1) => (arg2)
        case "proc-type": return `(${typeExpression.argType ? displayForm(typeExpression.argType) : ''}) {}`;
        case "func-type": return `(${typeExpression.argType ? displayForm(typeExpression.argType) : ''}) => ${displayForm(typeExpression.returnType)}`;
        case "object-type": return `{ ${typeExpression.entries.map(([ key, value ]) => `${key.name}: ${displayForm(value)}`)} }`;
        case "indexer-type": return `{ [${displayForm(typeExpression.keyType)}]: ${displayForm(typeExpression.valueType)} }`;
        case "array-type": return `${displayForm(typeExpression.element)}[]`;
        case "tuple-type": return `[${typeExpression.members.map(displayForm).join(", ")}]`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `nil`;
        case "literal-type": return String(typeExpression.value);
        case "nominal-type": return typeExpression.name;
        case "iterator-type": return `Iterator<${displayForm(typeExpression.itemType)}>`;
        case "promise-type": return `Promise<${displayForm(typeExpression.resultType)}>`;
        case "unknown-type": return "unknown";
        case "element-type": return `<element tag>`
        // case "element-type": return `<${typeExpression.tagName}>`;
        case "javascript-escape-type": return "<js escape>";
    }
}

export type BagelTypeError =
    | BagelAssignableToError
    | BagelCannotFindNameError
    | BagelMiscTypeError
    | BagelCannotFindModuleError
    | BagelCannotFindExportError

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

export type BagelCannotFindModuleError = {
    kind: "bagel-cannot-find-module-error",
    ast: ImportDeclaration
}

export type BagelCannotFindExportError = {
    kind: "bagel-cannot-find-export-error",
    ast: ImportItem,
    importDeclaration: ImportDeclaration
}

export function errorMessage(error: BagelTypeError): string {
    switch (error.kind) {
        case "bagel-assignable-to-error":
            return `Type '${displayForm(error.value)}' is not assignable to type '${displayForm(error.destination)}'`;
        case "bagel-cannot-find-name-error":
            return `Cannot find name '${error.ast.name}'`;
        case "bagel-misc-type-error":
            return error.message;
        case "bagel-cannot-find-module-error":
            return `Failed to resolve module '${error.ast.path.segments[0]}'`
        case "bagel-cannot-find-export-error":
            return `Module '${error.importDeclaration.path.segments[0]}' has no export named ${error.ast.name.name}`
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

export function cannotFindModule(ast: ImportDeclaration): BagelCannotFindModuleError {
    return { kind: "bagel-cannot-find-module-error", ast }
}

export function cannotFindExport(ast: ImportItem, importDeclaration: ImportDeclaration): BagelCannotFindExportError {
    return { kind: "bagel-cannot-find-export-error", ast, importDeclaration }
}