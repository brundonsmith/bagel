import { Module } from "../_model/ast.ts";
import { BOOLEAN_TYPE, ELEMENT_TAG_CHILD_TYPE, FuncType, NIL_TYPE, ProcType, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, given, iterateParseTree } from "../utils.ts";
import { assignmentError,miscError,cannotFindName, BagelError } from "../errors.ts";
import { propertiesOf, inferType, resolve, subtract, fitTemplate } from "./typeinfer.ts";
import { AllParents, AllScopes, getBindingMutability, getScopeFor } from "../_model/common.ts";
import { display } from "../debugging.ts";
import { extendScope } from "./scopescan.ts";


export function typecheck(reportError: (error: BagelError) => void, getModule: (module: string) => Module|undefined, parents: AllParents, scopes: AllScopes, ast2: Module) {
    for (const { current } of iterateParseTree(ast2)) {
        const scope = getScopeFor(reportError, parents, scopes, current)

        switch(current.kind) {
            case "const-declaration": {

                // make sure value fits declared type, if there is one
                const valueType = inferType(reportError, getModule, parents, scopes, current.value, true);
                if (current.type != null && !subsumes(parents, scopes,  current.type, valueType, true)) {
                    reportError(assignmentError(current.value, current.type, valueType));
                }

                // forbid top-level const from being a func (should be a real func declaration) TODO: procs too
                if (current.value.kind === "func") {
                    const maxPreviewLength = 8
                    const fn = display(current.value)
                    const sample = fn.substr(0, maxPreviewLength)
                    const truncated = fn.length > maxPreviewLength
                    reportError(miscError(current, `Top-level const functions should be actual func declarations: func ${current.name.name}${sample}${truncated ? '...' : ''}`))
                }
            } break;
            case "func-declaration": {
                // forbid top-level funcs with no arguments
                // if (ast.value.type.args.length === 0 && ast.value.body.kind !== "javascript-escape") {
                //     reportError(miscError(ast, "Top-level function declarations aren't allowed to take zero arguments, because the result will always be the same. Consider making this a constant."))
                // }
            } break;
            case "test-expr-declaration": {

                // make sure test value is a boolean
                const valueType = inferType(reportError, getModule, parents, scopes, current.expr, true);
                if (!subsumes(parents, scopes,  BOOLEAN_TYPE, valueType, true)) {
                    reportError(assignmentError(current.expr, BOOLEAN_TYPE, valueType));
                }
            } break;
            case "func": {

                // make sure each const fits its declared type, if there is one
                for (const c of current.consts) {
                    const valueType = inferType(reportError, getModule, parents, scopes, c.value, true)
                    if (c.type && !subsumes(parents, scopes,  c.type, valueType, true)) {
                        reportError(assignmentError(c.value, c.type, valueType));
                    }
                }

                // make sure body expression fits declared return type, if there is one
                const bodyType = inferType(reportError, getModule, parents, scopes, current.body, true);
                if (current.type.returnType != null && !subsumes(parents, scopes,  current.type.returnType, bodyType, true)) {
                    reportError(assignmentError(current.body, current.type.returnType, bodyType));
                }
            } break;
            case "binary-operator": {
                // This gets checked in typeinfer
            } break;
            case "negation-operator": {
                const baseType = inferType(reportError, getModule, parents, scopes, current.base, true);
                if (!subsumes(parents, scopes,  BOOLEAN_TYPE, baseType, true)) {
                    reportError(assignmentError(current.base, BOOLEAN_TYPE, baseType));
                }
            } break;
            case "pipe":
            case "invocation": {
                const scope = getScopeFor(reportError, parents, scopes, current)
                
                let subjectType = inferType(reportError, getModule, parents, scopes, current.subject);
                if (current.kind === "invocation") {
                    const scopeWithGenerics = extendScope(scope)

                    // bind type-args for this invocation
                    if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {
                        if (subjectType.typeParams.length > 0) {
                            if (current.typeArgs.length > 0) {
                                if (subjectType.typeParams.length !== current.typeArgs.length) {
                                    reportError(miscError(current, `Expected ${subjectType.typeParams.length} type arguments, but got ${current.typeArgs.length}`))
                                }
    
                                for (let i = 0; i < subjectType.typeParams.length; i++) {
                                    const typeParam = subjectType.typeParams[i]
                                    const typeArg = current.typeArgs?.[i] ?? UNKNOWN_TYPE
    
                                    scopeWithGenerics.types.set(typeParam.name, {
                                        type: typeArg,
                                        isGenericParameter: false,
                                    })
                                }
                            } else {
                                const invocationSubjectType: FuncType|ProcType = {
                                    ...subjectType,
                                    args: subjectType.args.map((arg, index) => ({ ...arg, type: inferType(reportError, getModule, parents, scopes, current.args[index]) }))
                                }
        
                                // attempt to infer params for generic
                                const inferredBindings = fitTemplate(reportError, parents, scopes, subjectType, invocationSubjectType, subjectType.typeParams.map(param => param.name));
        
                                if (inferredBindings.size === subjectType.typeParams.length) {
                                    for (let i = 0; i < subjectType.typeParams.length; i++) {
                                        const typeParam = subjectType.typeParams[i]
                                        const typeArg = inferredBindings.get(typeParam.name) ?? UNKNOWN_TYPE
            
                                        scopeWithGenerics.types.set(typeParam.name, {
                                            type: typeArg,
                                            isGenericParameter: false,
                                        })
                                    }
                                } else {
                                    reportError(miscError(current, `Failed to infer generic type parameters; ${subjectType.typeParams.length} type arguments should be specified explicitly`))
                                }
                            }
                        }
                    }

                    subjectType = resolve(reportError, getModule, scopeWithGenerics, subjectType, true);
                }

                if (subjectType.kind !== "func-type" && subjectType.kind !== "proc-type") {  // check that subject is callable
                    reportError(miscError(current.subject, "Expression must be a function or procedure to be called"));
                } else if (subjectType.args.length !== current.args.length) {  // check that the right number of arguments are passed
                    const functionOrProcedure = subjectType.kind === "func-type" ? "Function" : "Procedure"
                    reportError(miscError(current, `${functionOrProcedure} expected ${subjectType.args.length} arguments but got ${current.args.length}`));
                } else {  // check that each argument matches the expected type
                    for (let i = 0; i < current.args.length; i++) {
                        const arg = current.args[i]
                        const subjectArgType = subjectType.args[i].type ?? UNKNOWN_TYPE

                        const argValueType = inferType(reportError, getModule, parents, scopes, arg, true)

                        if (!subsumes(parents, scopes,  subjectArgType, argValueType, true)) {
                            reportError(assignmentError(arg, subjectArgType, argValueType));
                        }
                    }
                }
            } break;
            case "if-else-expression":
            case "if-else-statement":
            case "switch-expression": {
                const valueType = current.kind === "if-else-expression" || current.kind === "if-else-statement" ? BOOLEAN_TYPE : inferType(reportError, getModule, parents, scopes, current.value, true);

                for (const { condition } of current.cases) {
                    const conditionType = inferType(reportError, getModule, parents, scopes, condition, true);
                    if (!subsumes(parents, scopes,  valueType, conditionType, true)) {
                        reportError(assignmentError(condition, valueType, conditionType));
                    }
                }
            } break;
            case "indexer": {
                const baseType = inferType(reportError, getModule, parents, scopes, current.subject, true);
                const indexerType = inferType(reportError, getModule, parents, scopes, current.indexer, true);
                
                if (baseType.kind === "object-type" && indexerType.kind === "literal-type") {
                    const key = indexerType.value.value;
                    const valueType = propertiesOf(reportError, getModule, parents, scopes, baseType)?.find(entry => entry.name.name === key)?.type;
                    if (valueType == null) {
                        reportError(miscError(current.indexer, `Property '${key}' doesn't exist on type '${displayForm(baseType)}'`));
                    }
                } else if (baseType.kind === "indexer-type") {
                    if (!subsumes(parents, scopes,  baseType.keyType, indexerType, true)) {
                        reportError(assignmentError(current.indexer, baseType.keyType, indexerType));
                    }
                } else {
                    reportError(miscError(current.indexer, `Expression of type '${indexerType}' can't be used to index type '${displayForm(baseType)}'`));
                }
            } break;
            case "property-accessor": {
                const subjectType = inferType(reportError, getModule, parents, scopes, current.subject, true);
                const subjectProperties = current.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                    ? propertiesOf(reportError, getModule, parents, scopes, subtract(parents, scopes, subjectType, NIL_TYPE))
                    : propertiesOf(reportError, getModule, parents, scopes, subjectType)

                if (subjectProperties == null) {
                    reportError(miscError(current.subject, `Can only use dot operator (".") on objects with known properties (value is of type "${displayForm(subjectType)}")`));
                } else if (!subjectProperties.some(property => property.name.name === current.property.name)) {
                    if (subjectType.kind === "class-instance-type") {
                        reportError(miscError(current.property, `Property '${current.property.name}' does not exist on class '${subjectType.clazz.name.name}'`));
                    } else {
                        reportError(miscError(current.property, `Property '${current.property.name}' does not exist on type '${displayForm(subjectType)}'`));
                    }
                }
            } break;
            case "local-identifier": {
                if (!scope.values.has(current.name) && !scope.imports.has(current.name) && !scope.classes.has(current.name)) {
                    reportError(cannotFindName(current));
                }
            } break;
            case "string-literal": {
                for (const segment of current.segments) {
                    if (typeof segment !== "string") {
                        const segmentType = inferType(reportError, getModule, parents, scopes, segment, true);

                        if (!subsumes(parents, scopes,  STRING_TEMPLATE_INSERT_TYPE, segmentType, true)) {
                            reportError(assignmentError(segment, STRING_TEMPLATE_INSERT_TYPE, segmentType));
                        }
                    }
                }
            } break;

            // not expressions, but should have their contents checked
            case "reaction": {
                const dataType = inferType(reportError, getModule, parents, scopes, current.data, true);
                const effectType = inferType(reportError, getModule, parents, scopes, current.effect, true);

                if (dataType.kind !== "func-type") {
                    reportError(miscError(current.data, `Expected function in observe clause`));
                } else if (dataType.args.length > 0) {
                    reportError(miscError(current.data, `Observe function should take no arguments; provided function expects ${dataType.args.length}`));
                }
                
                if (effectType.kind !== "proc-type") {
                    reportError(miscError(current.effect, `Expected procedure in effect clause`));
                } else if (effectType.args.length > 1) {
                    reportError(miscError(current.data, `Effect procedure should take exactly one argument; provided procedure expects ${effectType.args.length}`));
                } else if (dataType.kind === "func-type" && !subsumes(parents, scopes, effectType.args[0].type ?? UNKNOWN_TYPE, dataType.returnType ?? UNKNOWN_TYPE)) {
                    reportError(assignmentError(current.effect, effectType.args[0].type ?? UNKNOWN_TYPE, dataType.returnType ?? UNKNOWN_TYPE));
                }

                if (current.until) {
                    const untilType = inferType(reportError, getModule, parents, scopes, current.until, true);

                    if (untilType.kind !== "boolean-type") {
                        reportError(miscError(current.until, `Expected boolean expression in until clause`));
                    }
                }
            } break;
            case "let-declaration": {
                const valueType = inferType(reportError, getModule, parents, scopes, current.value, true);

                if (current.type != null) {
                    if (!subsumes(parents, scopes,  current.type, valueType, true)) {
                        reportError(assignmentError(current.value, current.type, valueType));
                    }
                }
            } break;
            case "assignment": {
                const resolved = current.target.kind === "local-identifier" ? getScopeFor(reportError, parents, scopes, current.target).values.get(current.target.name) : undefined
                if (current.target.kind === "local-identifier" && resolved != null && getBindingMutability(resolved) !== "assignable") {
                    reportError(miscError(current.target, `Cannot assign to '${current.target.name}' because it's constant`));
                }

                const targetType = inferType(reportError, getModule, parents, scopes, current.target, true);
                const valueType = inferType(reportError, getModule, parents, scopes, current.value, true);

                if (current.target.kind === "property-accessor") {
                    const subjectType = inferType(reportError, getModule, parents, scopes, current.target.subject, true);

                    if (subjectType.mutability !== "mutable") {
                        reportError(miscError(current.target, `Cannot assign to property '${current.target.property.name}' because the target object is constant`));
                    }
                }
                if (!subsumes(parents, scopes,  targetType, valueType, true)) {
                    reportError(assignmentError(current.value, targetType, valueType));
                }
            } break;
            case "for-loop": {
                // TODO: Disallow shadowing? Not sure

                const iteratorType = inferType(reportError, getModule, parents, scopes, current.iterator, true);
                if (iteratorType.kind !== "iterator-type") {
                    reportError(miscError(current.iterator, `Expected iterator after "of" in for loop`));
                }
            } break;
            case "while-loop": {
                const conditionType = inferType(reportError, getModule, parents, scopes, current.condition, true);
                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(current.condition, `Condition for while loop must be boolean`));
                }
            } break;
            case "element-tag": {
                for (const child of current.children) {
                    const childType = inferType(reportError, getModule, parents, scopes, child, true);
                    if (!subsumes(parents, scopes, ELEMENT_TAG_CHILD_TYPE, childType, true)) {
                        reportError(assignmentError(child, ELEMENT_TAG_CHILD_TYPE, childType));
                    }
                }
            } break;
        }        
    }
}

export function subsumes(parents: AllParents, scopes: AllScopes, destination: TypeExpression, value: TypeExpression, resolveGenerics?: boolean): boolean {
    if (destination === value) {
        return true;
    }

    // console.log('subsumes?\n', { destination: display(destination), value: display(value) })
    const resolvedDestination = resolve(() => {}, () => undefined, getScopeFor(undefined, parents, scopes, destination), destination, resolveGenerics)
    const resolvedValue =       resolve(() => {}, () => undefined, getScopeFor(undefined, parents, scopes, value), value, resolveGenerics)
    // console.log('subsumes (resolved)?\n', { resolvedDestination: display(resolvedDestination), resolvedValue: display(resolvedValue) })

    // constants can't be assigned to mutable slots
    if (resolvedDestination.mutability === "mutable" && resolvedValue.mutability !== "mutable") {
        return false;
    }

    if (
        resolvedValue.kind === "javascript-escape-type" || 
        resolvedValue.kind === "any-type" || 
        resolvedDestination.kind === "any-type" || 
        resolvedDestination.kind === "unknown-type"
    ) {
        return true;
    } else if (resolvedValue.kind === "unknown-type") {
        return false;
    } else if (
        (resolvedDestination.kind === "number-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "number-literal") ||
        (resolvedDestination.kind === "string-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "exact-string-literal") ||
        (resolvedDestination.kind === "boolean-type" && resolvedValue.kind === "literal-type" && resolvedValue.value.kind === "boolean-literal")
    ) {
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
    } else if(typesEqual(resolvedDestination, resolvedValue)) {
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
        const destinationEntries = propertiesOf(() => {}, () => undefined, parents, scopes, resolvedDestination)
        const valueEntries =       propertiesOf(() => {}, () => undefined, parents, scopes, resolvedValue)

        return (
            !!destinationEntries?.every(({ name: key, type: destinationValue }) => 
                given(valueEntries?.find(e => e.name.name === key.name)?.type, value =>
                    subsumes(parents, scopes,  destinationValue, value, resolveGenerics)))
        );
    } else if (resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") {
        return subsumes(parents, scopes, resolvedDestination.itemType, resolvedValue.itemType, resolveGenerics);
    } else if (resolvedDestination.kind === "plan-type" && resolvedValue.kind === "plan-type") {
        return subsumes(parents, scopes, resolvedDestination.resultType, resolvedValue.resultType, resolveGenerics);
    }

    return false;
}

export function typesEqual(a: TypeExpression, b: TypeExpression): boolean {
    return deepEquals(a, b, ["id", "code", "startIndex", "endIndex"])
}

export function displayForm(typeExpression: TypeExpression): string {
    let str: string;

    switch (typeExpression.kind) {
        case "union-type": str = '(' + typeExpression.members.map(displayForm).join(" | ") + ')'; break;
        case "named-type": str = typeExpression.name.name; break;
        case "proc-type": str = `${typeExpression.typeParams.length > 0 ? `<${typeExpression.typeParams.map(p => p.name).join(',')}>` : ''}(${typeExpression.args.map(arg => arg.name.name + (arg.type ? `: ${displayForm(arg.type)}` : '')).join(', ')}) {}`; break;
        case "func-type": str = `${typeExpression.typeParams.length > 0 ? `<${typeExpression.typeParams.map(p => p.name).join(',')}>` : ''}(${typeExpression.args.map(arg => arg.name.name + (arg.type ? `: ${displayForm(arg.type)}` : '')).join(', ')}) => ${displayForm(typeExpression.returnType ?? UNKNOWN_TYPE)}`; break;
        case "object-type": str = `{${typeExpression.spreads.map(s => '...' + displayForm(s)).concat(typeExpression.entries.map(({ name, type }) => `${name.name}: ${displayForm(type)}`)).join(', ')}}`; break;
        case "indexer-type": str = `{ [${displayForm(typeExpression.keyType)}]: ${displayForm(typeExpression.valueType)} }`; break;
        case "array-type": str = `${displayForm(typeExpression.element)}[]`; break;
        case "tuple-type": str = `[${typeExpression.members.map(displayForm).join(", ")}]`; break;
        case "string-type": str = `string`; break;
        case "number-type": str = `number`; break;
        case "boolean-type": str = `boolean`; break;
        case "nil-type": str = `nil`; break;
        case "literal-type": str = JSON.stringify(typeExpression.value.value).replaceAll('"', "'"); break;
        case "nominal-type": str = typeExpression.name; break;
        case "iterator-type": str = `Iterator<${displayForm(typeExpression.itemType)}>`; break;
        case "plan-type": str = `Plan<${displayForm(typeExpression.resultType)}>`; break;
        case "unknown-type": str = "unknown"; break;
        case "any-type": str = "any"; break;
        case "element-type": str = `Element`; break;
        // case "element-type": str = `<${typeExpression.tagName}>`;
        case "javascript-escape-type": str = "<js escape>"; break;
        case "class-instance-type": str = typeExpression.clazz.name.name; break;
    }

    const metaStr = typeExpression.mutability == null ? '' : ` [${typeExpression.mutability[0]}]`

    return str + metaStr
}
