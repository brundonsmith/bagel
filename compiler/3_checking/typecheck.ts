import { Module } from "../_model/ast.ts";
import { BOOLEAN_TYPE, ELEMENT_TAG_CHILD_TYPE, FuncType, ITERATOR_OF_ANY, NIL_TYPE, NUMBER_TYPE, ProcType, STRING_TEMPLATE_INSERT_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, given, iterateParseTree } from "../utils.ts";
import { assignmentError,miscError } from "../errors.ts";
import { propertiesOf, inferType, subtract, parameterizedGenericType, fitTemplate, unpackGeneric } from "./typeinfer.ts";
import { getBindingMutability, GetParent, GetBinding, ReportError, GetModule } from "../_model/common.ts";
import { display } from "../debugging.ts";


export function typecheck(reportError: ReportError, getModule: GetModule, getParent: GetParent, getBinding: GetBinding, ast: Module) {
    for (const { current } of iterateParseTree(ast)) {

        switch(current.kind) {
            case "const-declaration": {

                // make sure value fits declared type, if there is one
                const valueType = inferType(reportError, getModule, getParent, getBinding, current.value);
                if (current.type != null && !subsumes(getParent, getBinding,  current.type, valueType)) {
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
                const valueType = inferType(reportError, getModule, getParent, getBinding, current.expr);
                if (!subsumes(getParent, getBinding,  BOOLEAN_TYPE, valueType)) {
                    reportError(assignmentError(current.expr, BOOLEAN_TYPE, valueType));
                }
            } break;
            case "func": {
                // make sure body expression fits declared return type, if there is one
                const bodyType = inferType(reportError, getModule, getParent, getBinding, current.body);
                if (current.type.returnType != null && !subsumes(getParent, getBinding,  current.type.returnType, bodyType)) {
                    reportError(assignmentError(current.body, current.type.returnType, bodyType));
                }
            } break;
            case "binary-operator": {
                // This gets checked in typeinfer
            } break;
            case "negation-operator": {
                const baseType = inferType(reportError, getModule, getParent, getBinding, current.base);
                if (!subsumes(getParent, getBinding,  BOOLEAN_TYPE, baseType)) {
                    reportError(assignmentError(current.base, BOOLEAN_TYPE, baseType));
                }
            } break;
            case "pipe":
            case "invocation": {
                
                let subjectType = resolveType(getBinding, inferType(reportError, getModule, getParent, getBinding, current.subject))
                if (current.kind === "invocation") {

                    // bind type-args for this invocation
                    if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {
                        if (subjectType.typeParams.length > 0) {
                            if (current.typeArgs.length > 0) { // explicit type arguments
                                if (subjectType.typeParams.length !== current.typeArgs.length) {
                                    reportError(miscError(current, `Expected ${subjectType.typeParams.length} type arguments, but got ${current.typeArgs.length}`))
                                }

                                subjectType = parameterizedGenericType(
                                    reportError, 
                                    getBinding, 
                                    subjectType, 
                                    current.typeArgs
                                )

                                // check that type args satisfy any `extends` clauses
                                for (let i = 0; i < subjectType.typeParams.length; i++) {
                                    const typeParam = subjectType.typeParams[i]
                                    const typeArg = current.typeArgs[i] as TypeExpression

                                    if (typeParam.extends && !subsumes(getParent, getBinding, typeParam.extends, typeArg)) {
                                        reportError(assignmentError(typeArg, typeParam.extends, typeArg))
                                    }
                                }
                            } else {
                                const invocationSubjectType: FuncType|ProcType = {
                                    ...subjectType,
                                    args: subjectType.args.map((arg, index) => ({ ...arg, type: inferType(reportError, getModule, getParent, getBinding, current.args[index]) }))
                                }
        
                                // attempt to infer params for generic
                                const inferredBindings = fitTemplate(reportError, getParent, getBinding, subjectType, invocationSubjectType, subjectType.typeParams.map(param => param.name.name));
        
                                if (inferredBindings.size === subjectType.typeParams.length) {
                                    subjectType = parameterizedGenericType(
                                        reportError, 
                                        getBinding, 
                                        subjectType, 
                                        subjectType.typeParams.map(param =>
                                            inferredBindings.get(param.name.name) ?? UNKNOWN_TYPE)
                                    )
                                } else {
                                    reportError(miscError(current, `Failed to infer generic type parameters; ${subjectType.typeParams.length} type arguments should be specified explicitly`))
                                }
                            }
                        }
                    }
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

                        const argValueType = inferType(reportError, getModule, getParent, getBinding, arg)
                        if (!subsumes(getParent, getBinding,  subjectArgType, argValueType)) {
                            reportError(assignmentError(arg, subjectArgType, argValueType));
                        }
                    }
                }
            } break;
            case "if-else-expression":
            case "if-else-statement":
            case "switch-expression": {
                const valueType = current.kind === "if-else-expression" || current.kind === "if-else-statement" ? BOOLEAN_TYPE : inferType(reportError, getModule, getParent, getBinding, current.value);

                for (const { condition } of current.cases) {
                    const conditionType = inferType(reportError, getModule, getParent, getBinding, condition);
                    if (!subsumes(getParent, getBinding,  valueType, conditionType)) {
                        reportError(assignmentError(condition, valueType, conditionType));
                    }
                }
            } break;
            case "indexer": {
                const baseType = resolveType(getBinding, inferType(reportError, getModule, getParent, getBinding, current.subject))
                const indexerType = resolveType(getBinding, inferType(reportError, getModule, getParent, getBinding, current.indexer))
                
                if (baseType.kind === "object-type" && indexerType.kind === "literal-type") {
                    const key = indexerType.value.value;
                    const valueType = propertiesOf(reportError, getModule, getParent, getBinding, baseType)?.find(entry => entry.name.name === key)?.type;
                    if (valueType == null) {
                        reportError(miscError(current.indexer, `Property '${key}' doesn't exist on type '${displayForm(baseType)}'`));
                    }
                } else if (baseType.kind === "indexer-type") {
                    if (!subsumes(getParent, getBinding,  baseType.keyType, indexerType)) {
                        reportError(assignmentError(current.indexer, baseType.keyType, indexerType));
                    }
                } else if (baseType.kind === "array-type") {
                    if (!subsumes(getParent, getBinding,  NUMBER_TYPE, indexerType)) {
                        reportError(miscError(current.indexer, `Expression of type '${displayForm(indexerType)}' can't be used to index type '${displayForm(baseType)}'`));
                    }
                } else if (baseType.kind === "tuple-type") {
                    if (!subsumes(getParent, getBinding,  NUMBER_TYPE, indexerType)) {
                        reportError(miscError(current.indexer, `Expression of type '${displayForm(indexerType)}' can't be used to index type '${displayForm(baseType)}'`));
                    } else if (indexerType.kind === 'literal-type' && indexerType.value.kind === 'number-literal') {
                        if (indexerType.value.value < 0 || indexerType.value.value >= baseType.members.length) {
                            reportError(miscError(current.indexer, `Index ${indexerType.value.value} is out of range on type '${displayForm(baseType)}'`));
                        }
                    }
                } else {
                    reportError(miscError(current.indexer, `Expression of type '${displayForm(indexerType)}' can't be used to index type '${displayForm(baseType)}'`));
                }
            } break;
            case "property-accessor": {
                const subjectType = resolveType(getBinding, inferType(reportError, getModule, getParent, getBinding, current.subject))
                const subjectProperties = current.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                    ? propertiesOf(reportError, getModule, getParent, getBinding, subtract(getParent, getBinding, subjectType, NIL_TYPE))
                    : propertiesOf(reportError, getModule, getParent, getBinding, subjectType)

                if (subjectProperties == null) {
                    reportError(miscError(current.subject, `Can only use dot operator (".") on objects with known properties (value is of type "${displayForm(subjectType)}")`));
                } else if (!subjectProperties.some(property => property.name.name === current.property.name)) {
                    if (subjectType.kind === "store-type") {
                        reportError(miscError(current.property, `Property '${current.property.name}' does not exist on store '${subjectType.store.name.name}'`));
                    } else {
                        reportError(miscError(current.property, `Property '${current.property.name}' does not exist on type '${displayForm(subjectType)}'`));
                    }
                }
            } break;
            case "string-literal": {
                // check that all template insertions are allowed to be inserted
                for (const segment of current.segments) {
                    if (typeof segment !== "string") {
                        const segmentType = inferType(reportError, getModule, getParent, getBinding, segment);
                        if (!subsumes(getParent, getBinding,  STRING_TEMPLATE_INSERT_TYPE, segmentType)) {
                            reportError(assignmentError(segment, STRING_TEMPLATE_INSERT_TYPE, segmentType));
                        }
                    }
                }
            } break;
            case "as-cast": {
                const innerType = inferType(reportError, getModule, getParent, getBinding, current.inner)
                if (!subsumes(getParent, getBinding, current.type, innerType)) {
                    reportError(miscError(current, `Expression of type ${displayForm(innerType)} cannot be expanded to type ${displayForm(current.type)}`))
                }
            } break;
            case "reaction": {
                const dataType = resolveType(getBinding, inferType(reportError, getModule, getParent, getBinding, current.data))
                const effectType = resolveType(getBinding, inferType(reportError, getModule, getParent, getBinding, current.effect))

                if (dataType.kind !== "func-type") {
                    reportError(miscError(current.data, `Expected function in observe clause`));
                } else if (dataType.args.length > 0) {
                    reportError(miscError(current.data, `Observe function should take no arguments; provided function expects ${dataType.args.length}`));
                }
                
                if (effectType.kind !== "proc-type") {
                    reportError(miscError(current.effect, `Expected procedure in effect clause`));
                } else if (effectType.args.length > 1) {
                    reportError(miscError(current.data, `Effect procedure should take exactly one argument; provided procedure expects ${effectType.args.length}`));
                } else if (dataType.kind === "func-type" && !subsumes(getParent, getBinding, effectType.args[0].type ?? UNKNOWN_TYPE, dataType.returnType ?? UNKNOWN_TYPE)) {
                    reportError(assignmentError(current.effect, effectType.args[0].type ?? UNKNOWN_TYPE, dataType.returnType ?? UNKNOWN_TYPE));
                }

                if (current.until) {
                    const untilType = inferType(reportError, getModule, getParent, getBinding, current.until);
                    if (!subsumes(getParent, getBinding,  BOOLEAN_TYPE, untilType)) {
                        reportError(miscError(current.until, `Expected boolean expression in until clause`));
                    }
                }
            } break;
            case "local-identifier": {
                // make sure we err if identifier can't be resolved, even if it isn't used
                getBinding(reportError, current)
            } break;
            case "inline-const":
            case "let-declaration":
            case "const-declaration-statement": {
                if (current.type != null) {
                const valueType = inferType(reportError, getModule, getParent, getBinding, current.value);
                    if (!subsumes(getParent, getBinding,  current.type, valueType)) {
                        reportError(assignmentError(current.value, current.type, valueType));
                    }
                }
            } break;
            case "assignment": {
                const resolved = current.target.kind === "local-identifier" ? getBinding(reportError, current.target) : undefined
                if (current.target.kind === "local-identifier" && resolved != null && resolved.kind !== 'type-binding' && getBindingMutability(resolved) !== "assignable") {
                    reportError(miscError(current.target, `Cannot assign to '${current.target.name}' because it's constant`));
                }


                if (current.target.kind === "property-accessor") {
                    const subjectType = resolveType(getBinding, inferType(reportError, getModule, getParent, getBinding, current.target.subject))
                    if (subjectType.mutability !== "mutable") {
                        reportError(miscError(current.target, `Cannot assign to property '${current.target.property.name}' because the target object is constant`));
                    }
                }

                const targetType = inferType(reportError, getModule, getParent, getBinding, current.target);
                const valueType = inferType(reportError, getModule, getParent, getBinding, current.value);
                if (!subsumes(getParent, getBinding,  targetType, valueType)) {
                    reportError(assignmentError(current.value, targetType, valueType));
                }
            } break;
            case "for-loop": {
                const iteratorType = inferType(reportError, getModule, getParent, getBinding, current.iterator);
                if (!subsumes(getParent, getBinding,  ITERATOR_OF_ANY, iteratorType)) {
                    reportError(miscError(current.iterator, `Expected iterator after "of" in for loop`));
                }
            } break;
            case "while-loop": {
                const conditionType = inferType(reportError, getModule, getParent, getBinding, current.condition);
                if (conditionType.kind !== "boolean-type") {
                    reportError(miscError(current.condition, `Condition for while loop must be boolean`));
                }
            } break;
            case "element-tag": {
                for (const child of current.children) {
                    const childType = inferType(reportError, getModule, getParent, getBinding, child);
                    if (!subsumes(getParent, getBinding, ELEMENT_TAG_CHILD_TYPE, childType)) {
                        reportError(assignmentError(child, ELEMENT_TAG_CHILD_TYPE, childType));
                    }
                }
            } break;
        }        
    }
}

export function subsumes(getParent: GetParent, getBinding: GetBinding, destination: TypeExpression, value: TypeExpression): boolean {
    if (destination === value) {
        return true;
    }

    const resolvedDestination = resolveType(getBinding, destination)
    const resolvedValue = resolveType(getBinding, value)

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
                    subsumes(getParent, getBinding, destinationMember, valueMember)));
        } else {
            return resolvedDestination.members.some(member => 
                subsumes(getParent, getBinding, member, resolvedValue));
        }
    } else if (resolvedValue.kind === "union-type") {
        return resolvedValue.members.every(member =>
            subsumes(getParent, getBinding, resolvedDestination, member));
    } else if(typesEqual(resolvedDestination, resolvedValue)) {
        return true;
    } else if (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedDestination.args.every((_, i) => subsumes(getParent, getBinding, resolvedValue.args[i].type ?? UNKNOWN_TYPE, resolvedDestination.args[i].type ?? UNKNOWN_TYPE))
            && subsumes(getParent, getBinding, resolvedDestination.returnType ?? UNKNOWN_TYPE, resolvedValue.returnType ?? UNKNOWN_TYPE)) {
        return true;
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedDestination.args.every((_, i) => subsumes(getParent, getBinding, resolvedValue.args[i].type ?? UNKNOWN_TYPE, resolvedDestination.args[i].type ?? UNKNOWN_TYPE))) {
        return true;
    } else if (resolvedDestination.kind === "array-type") {
        if (resolvedValue.kind === "array-type") {
            return subsumes(getParent, getBinding, resolvedDestination.element, resolvedValue.element)
        }
        if (resolvedValue.kind === 'tuple-type') {
            return resolvedValue.members.every(member =>
                subsumes(getParent, getBinding, resolvedDestination.element, member))
        }
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        const destinationEntries = propertiesOf(() => {}, () => undefined, getParent, getBinding, resolvedDestination)
        const valueEntries =       propertiesOf(() => {}, () => undefined, getParent, getBinding, resolvedValue)

        return (
            !!destinationEntries?.every(({ name: key, type: destinationValue }) => 
                given(valueEntries?.find(e => e.name.name === key.name)?.type, value =>
                    subsumes(getParent, getBinding,  destinationValue, value)))
        );
    } else if (resolvedDestination.kind === "iterator-type" && resolvedValue.kind === "iterator-type") {
        return subsumes(getParent, getBinding, resolvedDestination.itemType, resolvedValue.itemType);
    } else if (resolvedDestination.kind === "plan-type" && resolvedValue.kind === "plan-type") {
        return subsumes(getParent, getBinding, resolvedDestination.resultType, resolvedValue.resultType);
    }

    return false;
}

export function resolveType(getBinding: GetBinding, type: TypeExpression): TypeExpression {
    let resolved: TypeExpression|undefined = type

    while (resolved?.kind === 'named-type' || resolved?.kind === 'generic-param-type') {
        if (resolved.kind === 'named-type') {
            const binding = getBinding(() => {}, resolved.name)

            resolved = binding?.kind === 'type-binding' ? binding.type : undefined
        }
        if (resolved?.kind === 'generic-param-type') {
            resolved = resolved.extends
        }
    }

    return resolved ?? UNKNOWN_TYPE
}

export function typesEqual(a: TypeExpression, b: TypeExpression): boolean {
    return deepEquals(a, b, ["module", "code", "startIndex", "endIndex"])
}

export function displayForm(typeExpression: TypeExpression): string {
    let str: string;

    switch (typeExpression.kind) {
        case "union-type": str = '(' + typeExpression.members.map(displayForm).join(" | ") + ')'; break;
        case "named-type":
        case "generic-param-type": str = typeExpression.name.name; break;
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
        case "store-type": str = typeExpression.store.name.name; break;
    }

    const metaStr = typeExpression.mutability == null ? '' : ` [${typeExpression.mutability[0]}]`

    return str + metaStr
}
