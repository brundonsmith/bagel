import { Module } from "../_model/ast.ts";
import { BOOLEAN_TYPE, NIL_TYPE, REACTION_VIEW_TYPE, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, given, walkParseTree } from "../utils.ts";
import { assignmentError,miscError,cannotFindName, BagelError } from "../errors.ts";
import { propertiesOf, inferType, resolve, subtract } from "./typeinfer.ts";
import { getScopeFor, ParentsMap, ScopesMap } from "../_model/common.ts";
import { display } from "../debugging.ts";


export function typecheck(reportError: (error: BagelError) => void, parents: ParentsMap, scopes: ScopesMap, ast: Module) {
    walkParseTree<void>(undefined, ast, (_, ast) => {
        // console.log('typechecking ', display(ast))
        const scope = getScopeFor(parents, scopes, ast)

        switch(ast.kind) {
            case "const-declaration": {

                // make sure value fits declared type, if there is one
                const valueType = inferType(reportError, parents, scopes, ast.value, true);
                if (ast.type != null && !subsumes(parents, scopes,  ast.type, valueType, true)) {
                    reportError(assignmentError(ast.value, ast.type, valueType));
                }

                // forbid top-level const from being a func (should be a real func declaration) TODO: procs too
                if (ast.value.kind === "func") {
                    const maxPreviewLength = 8
                    const fn = display(ast.value)
                    const sample = fn.substr(0, maxPreviewLength)
                    const truncated = fn.length > maxPreviewLength
                    reportError(miscError(ast, `Top-level const functions should be actual func declarations: func ${ast.name.name}${sample}${truncated ? '...' : ''}`))
                }
            } break;
            case "func-declaration": {
                // forbid top-level funcs with no arguments
                if (ast.value.type.args.length === 0 && ast.value.body.kind !== "javascript-escape") {
                    reportError(miscError(ast, "Top-level function declarations aren't allowed to take zero arguments, because the result will always be the same. Consider making this a constant."))
                }
            } break;
            case "test-expr-declaration": {

                // make sure test value is a boolean
                const valueType = inferType(reportError, parents, scopes, ast.expr, true);
                if (!subsumes(parents, scopes,  BOOLEAN_TYPE, valueType, true)) {
                    reportError(assignmentError(ast.expr, BOOLEAN_TYPE, valueType));
                }
            } break;
            case "func": {

                // make sure each const fits its declared type, if there is one
                for (const c of ast.consts) {
                    const valueType = inferType(reportError, parents, scopes, c.value, true)
                    if (c.type && !subsumes(parents, scopes,  c.type, valueType, true)) {
                        reportError(assignmentError(c.value, c.type, valueType));
                    }
                }

                // make sure body expression fits declared return type, if there is one
                const bodyType = inferType(reportError, parents, scopes, ast.body, true);
                if (ast.type.returnType != null && !subsumes(parents, scopes,  ast.type.returnType, bodyType, true)) {
                    reportError(assignmentError(ast.body, ast.type.returnType, bodyType));
                }
            } break;
            case "binary-operator": {
                // This gets checked in typeinfer
            } break;
            case "pipe":
            case "invocation": {
                const scope = getScopeFor(parents, scopes, ast)
                const subjectType = resolve(scope, inferType(reportError, parents, scopes, ast.subject), true);

                if (subjectType.kind !== "func-type" && subjectType.kind !== "proc-type") {  // check that subject is callable
                    reportError(miscError(ast.subject, "Expression must be a function or procedure to be called"));
                } else if (subjectType.args.length !== ast.args.length) {  // check that the right number of arguments are passed
                    const functionOrProcedure = subjectType.kind === "func-type" ? "Function" : "Procedure"
                    reportError(miscError(ast, `${functionOrProcedure} expected ${subjectType.args.length} arguments but got ${ast.args.length}`));
                } else {  // check that each argument matches the expected type
                    for (let i = 0; i < ast.args.length; i++) {
                        const arg = ast.args[i]
                        const subjectArgType = subjectType.args[i].type ?? UNKNOWN_TYPE

                        const argValueType = inferType(reportError, parents, scopes, arg, true)

                        if (!subsumes(parents, scopes,  subjectArgType, argValueType, true)) {
                            reportError(assignmentError(arg, subjectArgType, argValueType));
                        }
                    }
                }
            } break;
            case "if-else-expression":
            case "if-else-statement":
            case "switch-expression": {
                const valueType = ast.kind === "if-else-expression" || ast.kind === "if-else-statement" ? BOOLEAN_TYPE : inferType(reportError, parents, scopes, ast.value, true);

                for (const { condition } of ast.cases) {
                    const conditionType = inferType(reportError, parents, scopes, condition, true);
                    if (!subsumes(parents, scopes,  valueType, conditionType, true)) {
                        reportError(assignmentError(condition, valueType, conditionType));
                    }
                }
            } break;
            case "indexer": {
                const baseType = inferType(reportError, parents, scopes, ast.subject, true);
                const indexerType = inferType(reportError, parents, scopes, ast.indexer, true);
                
                if (baseType.kind === "object-type" && indexerType.kind === "literal-type") {
                    const key = indexerType.value.value;
                    const valueType = propertiesOf(reportError, parents, scopes, baseType)?.find(entry => entry.name.name === key)?.type;
                    if (valueType == null) {
                        reportError(miscError(ast.indexer, `Property '${key}' doesn't exist on type '${displayForm(baseType)}'`));
                    }
                } else if (baseType.kind === "indexer-type") {
                    if (!subsumes(parents, scopes,  baseType.keyType, indexerType, true)) {
                        reportError(assignmentError(ast.indexer, baseType.keyType, indexerType));
                    }
                } else {
                    reportError(miscError(ast.indexer, `Expression of type '${indexerType}' can't be used to index type '${displayForm(baseType)}'`));
                }
            } break;
            case "property-accessor": {
                const subjectType = inferType(reportError, parents, scopes, ast.subject, true);
                const subjectProperties = ast.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                    ? propertiesOf(reportError, parents, scopes, subtract(parents, scopes, subjectType, NIL_TYPE))
                    : propertiesOf(reportError, parents, scopes, subjectType)

                if (subjectProperties == null) {
                    reportError(miscError(ast.subject, `Can only use dot operator (".") on objects with known properties`));
                } else if (!subjectProperties.some(property => property.name.name === ast.property.name)) {
                    if (subjectType.kind === "class-instance-type") {
                        reportError(miscError(ast.property, `Property '${ast.property.name}' does not exist on class '${subjectType.clazz.name.name}'`));
                    } else {
                        reportError(miscError(ast.property, `Property '${ast.property.name}' does not exist on type '${displayForm(subjectType)}'`));
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
                        const segmentType = inferType(reportError, parents, scopes, segment, true);

                        if (!subsumes(parents, scopes,  STRING_TEMPLATE_INSERT_TYPE, segmentType, true)) {
                            reportError(assignmentError(segment, STRING_TEMPLATE_INSERT_TYPE, segmentType));
                        }
                    }
                }
            } break;

            // not expressions, but should have their contents checked
            case "reaction": {
                const viewType = inferType(reportError, parents, scopes, ast.view, true);

                if (viewType.kind !== "proc-type") {
                    reportError(miscError(ast.view, `Expected procedure in effect clause`));
                } else if (!subsumes(parents, scopes,  REACTION_VIEW_TYPE, viewType, true)) {
                    reportError(assignmentError(ast.view, REACTION_VIEW_TYPE, viewType));
                }

                if (ast.until) {
                    const untilType = inferType(reportError, parents, scopes, ast.until, true);

                    if (untilType.kind !== "boolean-type") {
                        reportError(miscError(ast.until, `Expected boolean expression in until clause`));
                    }
                }
            } break;
            case "let-declaration": {
                const valueType = inferType(reportError, parents, scopes, ast.value, true);

                if (ast.type != null) {
                    if (!subsumes(parents, scopes,  ast.type, valueType, true)) {
                        reportError(assignmentError(ast.value, ast.type, valueType));
                    }
                }
            } break;
            case "assignment": {
                if (ast.target.kind === "local-identifier" && getScopeFor(parents, scopes, ast.target).values[ast.target.name].mutability !== "all") {
                    reportError(miscError(ast.target, `Cannot assign to '${ast.target.name}' because it is not mutable`));
                }
                //  else if(ast.target.kind === "property-accessor" && scope.values[ast.target.]) {
                //    TODO: Have to figure out whether the mutability of any arbitrary base expression
                // }

                const targetType = inferType(reportError, parents, scopes, ast.target, true);
                const valueType = inferType(reportError, parents, scopes, ast.value, true);

                if (!subsumes(parents, scopes,  targetType, valueType, true)) {
                    reportError(assignmentError(ast.value, targetType, valueType));
                }
            } break;
            case "for-loop": {
                // TODO: Disallow shadowing? Not sure

                const iteratorType = inferType(reportError, parents, scopes, ast.iterator, true);
                if (iteratorType.kind !== "iterator-type") {
                    reportError(miscError(ast.iterator, `Expected iterator after "of" in for loop`));
                }
            } break;
            case "while-loop": {
                const conditionType = inferType(reportError, parents, scopes, ast.condition, true);
                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(ast.condition, `Condition for while loop must be boolean`));
                }
            } break;
        }        
    });
}

export function subsumes(parents: ParentsMap, scopes: ScopesMap, destination: TypeExpression, value: TypeExpression, resolveGenerics?: boolean): boolean {
    // console.log('subsumes?\n', { destination: display(destination), value: display(value) })
    const resolvedDestination = resolve(getScopeFor(parents, scopes, destination), destination, resolveGenerics)
    const resolvedValue = resolve(getScopeFor(parents, scopes, value), value, resolveGenerics)
    // console.log('subsumes (resolved)?\n', { resolvedDestination: display(resolvedDestination), resolvedValue: display(resolvedValue) })

    if (resolvedValue.kind === "any-type" || resolvedDestination.kind === "any-type") {
        return true;
    } else if (resolvedDestination.kind === "unknown-type") {
        return true;
    } else if(resolvedValue.kind === "unknown-type") {
        return false;
    } else if (resolvedValue.kind === "javascript-escape-type") {
        return true;
    } else if(resolvedDestination.kind === "number-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "number-literal") {
        return true;
    } else if(resolvedDestination.kind === "string-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "exact-string-literal") {
        return true;
    } else if(resolvedDestination.kind === "boolean-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "boolean-literal") {
        return true;
    } else if(resolvedDestination.kind === "union-type") {
        if (resolvedValue.kind === "union-type") {
            return resolvedValue.members.every(valueMember => 
                resolvedDestination.members.some(destinationMember => 
                    subsumes(parents, scopes, destinationMember, valueMember, resolveGenerics)));
        } else {
            return resolvedDestination.members.some(member => 
                subsumes(parents, scopes, member, resolvedValue, resolveGenerics));
        }
    } else if (resolvedValue.kind === "union-type") {
        return false;
    } else if(deepEquals(resolvedDestination, resolvedValue, ["code", "startIndex", "endIndex", "scope"])) {
        return true;
    } else if (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedDestination.args.every((_, i) => subsumes(parents, scopes, resolvedValue.args[i].type ?? UNKNOWN_TYPE, resolvedDestination.args[i].type ?? UNKNOWN_TYPE, resolveGenerics))
            && subsumes(parents, scopes, resolvedDestination.returnType ?? UNKNOWN_TYPE, resolvedValue.returnType ?? UNKNOWN_TYPE, resolveGenerics)) {
        return true;
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedDestination.args.every((_, i) => subsumes(parents, scopes, resolvedValue.args[i].type ?? UNKNOWN_TYPE, resolvedDestination.args[i].type ?? UNKNOWN_TYPE, resolveGenerics))) {
        return true;
    } else if (resolvedDestination.kind === "array-type" && resolvedValue.kind === "array-type") {
        return subsumes(parents, scopes, resolvedDestination.element, resolvedValue.element, resolveGenerics)
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        const destinationEntries = propertiesOf(() => {}, parents, scopes, resolvedDestination)
        const valueEntries = propertiesOf(() => {}, parents, scopes, resolvedValue)

        return (
            !!destinationEntries?.every(({ name: key, type: destinationValue }) => 
                given(valueEntries?.find(e => deepEquals(e.name, key, ["code", "startIndex", "endIndex"]))?.type, value =>
                    subsumes(parents, scopes,  destinationValue, value, resolveGenerics)))
        );
    } else if (resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") {
        return subsumes(parents, scopes, resolvedDestination.itemType, resolvedValue.itemType, resolveGenerics);
    } else if (resolvedDestination.kind === "plan-type" && resolvedValue.kind === "plan-type") {
        return subsumes(parents, scopes, resolvedDestination.resultType, resolvedValue.resultType, resolveGenerics);
    }

    return false;
}

export function displayForm(typeExpression: TypeExpression): string {
    switch (typeExpression.kind) {
        case "union-type": return typeExpression.members.map(displayForm).join(" | ");
        case "named-type": return typeExpression.name.name;
        case "proc-type": return `${typeExpression.typeParams.length > 0 ? `<${typeExpression.typeParams.map(p => p.name).join(',')}>` : ''}(${typeExpression.args.map(arg => arg.name.name + (arg.type ? `: ${displayForm(arg.type)}` : '')).join(', ')}) {}`;
        case "func-type": return `${typeExpression.typeParams.length > 0 ? `<${typeExpression.typeParams.map(p => p.name).join(',')}>` : ''}(${typeExpression.args.map(arg => arg.name.name + (arg.type ? `: ${displayForm(arg.type)}` : '')).join(', ')}) => ${displayForm(typeExpression.returnType ?? UNKNOWN_TYPE)}`;
        case "object-type": return `{${typeExpression.spreads.map(s => '...' + displayForm(s)).concat(typeExpression.entries.map(({ name, type }) => `${name.name}: ${displayForm(type)}`)).join(', ')}}`;
        case "indexer-type": return `{ [${displayForm(typeExpression.keyType)}]: ${displayForm(typeExpression.valueType)} }`;
        case "array-type": return `${displayForm(typeExpression.element)}[]`;
        case "tuple-type": return `[${typeExpression.members.map(displayForm).join(", ")}]`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `nil`;
        case "literal-type": return JSON.stringify(typeExpression.value.value).replaceAll('"', "'");
        case "nominal-type": return typeExpression.name;
        case "iterator-type": return `Iterator<${displayForm(typeExpression.itemType)}>`;
        case "plan-type": return `Plan<${displayForm(typeExpression.resultType)}>`;
        case "unknown-type": return "unknown";
        case "any-type": return "any";
        case "element-type": return `<element tag>`
        // case "element-type": return `<${typeExpression.tagName}>`;
        case "javascript-escape-type": return "<js escape>";
        case "class-instance-type": return typeExpression.clazz.name.name;
    }
}
