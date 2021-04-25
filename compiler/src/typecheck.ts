import { AST, BinaryOp, Declaration, FuncType, LocalIdentifier, NamedType, NilLiteral, PlainIdentifier, Proc, ProcType, TypeExpression, UnknownType } from "./ast";
import { deepEquals, given } from "./utils";

type Scope = {
    types: {[key: string]: TypeExpression},
    values: {[key: string]: TypeExpression},
}

function extendScope(scope: Scope): Scope {
    return {
        types: Object.create(scope.types, {}),
        values: Object.create(scope.values, {}),
    }
}

export function typecheckFile(declarations: Declaration[]): (TypeExpression|BagelTypeError)[] {
    const scope: Scope = {
        types: {},
        values: {},
    };

    return declarations.map(ast => {
        switch(ast.kind) {
            case "import-declaration":
                return { kind: "unknown-type" }; // TODO
            case "type-declaration":
                scope.types[ast.name.name] = ast.type;
                return ast.type;
            case "func-declaration": {
                const type = typecheck(scope, ast.func);
                if (isError(type)) {
                    return type;
                }

                scope.values[ast.func.name?.name as string] = type;
                return type;
            }
            case "proc-declaration": {
                const type = typecheck(scope, ast.proc);
                if (isError(type)) {
                    return type;
                }

                scope.values[ast.proc.name?.name as string] = type;
                return type;
            }
            case "const-declaration": {
                const valueType = typecheck(scope, ast.value);
                
                if (isError(valueType)) {
                    return valueType;
                } else if (ast.type.kind === "unknown-type") {
                    scope.values[ast.name?.name as string] = valueType;
                    return valueType;
                } else {
                    if (!subsumes(scope, ast.type, valueType)) {
                        return assignmentError(ast, ast.type, valueType);
                    } else {
                        scope.values[ast.name?.name as string] = ast.type;
                        return ast.type;
                    }
                }

            }
        }
    })
}

const BINARY_OPERATOR_TYPES: { [key in BinaryOp]: { left: TypeExpression, right: TypeExpression, output: TypeExpression }[] } = {
    "+": [
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "number" } },
        { left: { kind: "primitive-type", type: "string" }, right: { kind: "primitive-type", type: "string" }, output: { kind: "primitive-type", type: "string" } },
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "string" }, output: { kind: "primitive-type", type: "string" } },
        { left: { kind: "primitive-type", type: "string" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "string" } },
    ],
    "-": [
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "number" } }
    ],
    "*": [
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "number" } }
    ],
    "/": [
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "number" } }
    ],
    "<": [
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "boolean" } }
    ],
    ">": [
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "boolean" } }
    ],
    "<=": [
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "boolean" } }
    ],
    ">=": [
        { left: { kind: "primitive-type", type: "number" }, right: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "boolean" } }
    ],
    "&&": [
        { left: { kind: "primitive-type", type: "boolean" }, right: { kind: "primitive-type", type: "boolean" }, output: { kind: "primitive-type", type: "boolean" } }
    ],
    "||": [
        { left: { kind: "primitive-type", type: "boolean" }, right: { kind: "primitive-type", type: "boolean" }, output: { kind: "primitive-type", type: "boolean" } }
    ],
    "==": [
        { left: { kind: "unknown-type" }, right: { kind: "unknown-type" }, output: { kind: "primitive-type", type: "boolean" } }
    ],
    "??": [
        { left: { kind: "unknown-type" }, right: { kind: "unknown-type" }, output: { kind: "unknown-type" } }
    ],
    // "??": {
    //     inputs: { kind: "union-type", members: [ { kind: "primitive-type", type: "nil" }, ] },
    //     output: { kind: "primitive-type", type: "boolean" }
    // },
}

function typecheck(scope: Scope, ast: AST): TypeExpression | BagelTypeError {
    switch(ast.kind) {
        case "proc": {
            const bodyScope = extendScope(scope);
            for (let i = 0; i < ast.argNames.length; i++) {
                bodyScope.values[ast.argNames[i].name] = ast.type.argTypes[i];
            }

            for (const statement of ast.body) {
                const statementType = typecheck(bodyScope, statement);

                if (isError(statementType)) {
                    return statementType;
                }
            }

            return {
                kind: "proc-type",
                argTypes: new Array(ast.argNames.length).fill({ kind: "unknown-type" }),
            }
        };
        case "func": {
            const bodyScope = extendScope(scope);
            for (let i = 0; i < ast.argNames.length; i++) {
                bodyScope.values[ast.argNames[i].name] = ast.type.argTypes[i];
            }

            const bodyType = typecheck(bodyScope, ast.body);

            if (isError(bodyType)) {
                return bodyType;
            }

            if (ast.type.returnType.kind !== "unknown-type" && !subsumes(scope, ast.type.returnType, bodyType)) {
                return assignmentError(ast.body, ast.type.returnType, bodyType);
            }
            
            return {
                ...ast.type,
                returnType: ast.type.returnType.kind === "unknown-type" ? bodyType : ast.type.returnType,
            }
        };
        case "pipe": {
            let inputType = typecheck(scope, ast.expressions[0]);
            for (const expr of ast.expressions.slice(1)) {
                if (isError(inputType)) {
                    return inputType;
                }

                const typeOfPipe = typecheck(scope, expr);

                if (typeOfPipe?.kind !== "func-type") {
                    return miscError(ast, `Each transformation in pipeline expression must be a function`);
                }
                if (!subsumes(scope, typeOfPipe.argTypes[0], inputType)) {
                    return assignmentError(ast, typeOfPipe.argTypes[0], inputType);
                }

                inputType = typeOfPipe.returnType;
            }

            return inputType;
        };
        case "binary-operator": {
            const leftType = typecheck(scope, ast.left);
            if (isError(leftType)) {
                return leftType;
            }

            const rightType = typecheck(scope, ast.right);
            if (isError(rightType)) {
                return rightType;
            }

            for (const types of BINARY_OPERATOR_TYPES[ast.operator]) {
                const { left, right, output } = types;

                if (subsumes(scope, left, leftType) && subsumes(scope, right, rightType)) {
                    return output;
                }
            }

            return miscError(ast, `Operator ${ast.operator} cannot be applied to types ${serialize(leftType)} and ${serialize(rightType)}`);
        };
        case "funcall": {
            const funcType = typecheck(scope, ast.func);

            if (isError(funcType)) {
                return funcType;
            }

            if (funcType.kind !== "func-type") {
                return miscError(ast, "Expression must be a function to be called");
            }

            // TODO: infer what types arguments are allowed to be based on function body

            const argValueTypes = ast.args.map(arg => typecheck(scope, arg));

            const argError = argValueTypes.find(isError);
            if (argError != null) {
                return argError;
            }

            for (let index = 0; index < argValueTypes.length; index++) {
                const argValueType = argValueTypes[index];
                if (isError(argValueType)) {
                    return argValueType;
                }
                if (!subsumes(scope, funcType.argTypes[index], argValueType)) {
                    return assignmentError(ast.args[index], funcType.argTypes[index], argValueType);
                }
            }

            return funcType.returnType;
        };
        case "indexer": {
            const baseType = typecheck(scope, ast.base);
            if (isError(baseType)) {
                return baseType;
            }

            const indexerType = typecheck(scope, ast.indexer);
            if (isError(indexerType)) {
                return indexerType;
            }

            if (baseType.kind === "object-type" && indexerType.kind === "literal-type" && indexerType.value.kind === "string-literal" && indexerType.value.segments.length === 1) {
                const key = indexerType.value.segments[0];
                const valueType = baseType.entries.find(entry => entry[0].name === key)?.[1];
                if (valueType == null) {
                    return miscError(ast.indexer, `Property "${key}" doesn't exist on type ${serialize(baseType)}`);
                }

                return valueType;
            } else if (baseType.kind === "indexer-type") {
                if (!subsumes(scope, baseType.keyType, indexerType)) {
                    return assignmentError(ast.indexer, baseType.keyType, indexerType);
                }

                return {
                    kind: "union-type",
                    members: [ baseType.valueType, { kind: "primitive-type", type: "nil" } ]
                };
            } else if (baseType.kind === "array-type" && indexerType.kind === "primitive-type" && indexerType.type === "number") {
                return baseType.element;
            }

            return miscError(ast.indexer, `Expression of type ${indexerType} can't be used to index type ${serialize(baseType)}`);
        };
        case "if-else-expression": {
            const ifConditionType = typecheck(scope, ast.ifCondition);
            if (ifConditionType?.kind !== "primitive-type" || ifConditionType?.type !== "boolean") {
                return miscError(ast, "Condition for if expression must be boolean");
            }

            const ifType = typecheck(scope, ast.ifResult);
            if (isError(ifType)) {
                return ifType;
            }

            if (ast.elseResult == null) {
                return {
                    kind: "union-type",
                    members: [ ifType, { kind: "primitive-type", type: "nil" } ],
                };
            } else {
                const elseType = typecheck(scope, ast.elseResult);
                if (isError(elseType)) {
                    return elseType;
                }

                return {
                    kind: "union-type",
                    members: [ ifType, elseType ],
                };
            }
        };
        case "range": return { kind: "unknown-type" }; // TODO: Iterator type
        case "parenthesized-expression": return typecheck(scope, ast.inner);
        case "property-accessor": {
            const baseType = typecheck(scope, ast.base);
            if (isError(baseType)) {
                return baseType;
            }

            let lastPropType = baseType;
            for (const prop of ast.properties) {
                if (lastPropType.kind !== "object-type") {
                    return miscError(prop, `Can only use dot operator (".") on objects with known properties`);
                }

                const valueType = lastPropType.entries.find(entry => entry[0].name === prop.name)?.[1];
                if (valueType == null) {
                    return miscError(prop, `Property "${prop.name}" doesn't exist on type ${serialize(baseType)}`);
                }

                lastPropType = valueType;
            }
            
            return lastPropType;
        };
        case "local-identifier": return scope.values[ast.name] ?? cannotFindName(ast);
        case "object-literal": {
            const entryTypes = ast.entries.map(([key, value]) => [key, typecheck(scope, value)]);

            const entryErr = entryTypes.find(([_, value]) => isError(value)) as [PlainIdentifier, BagelTypeError] | undefined;
            if (entryErr != null) {
                return entryErr[1];
            } else {
                return {
                    kind: "object-type",
                    entries: entryTypes as [PlainIdentifier, TypeExpression][],
                };
            }
        };
        case "array-literal": {
            const entriesTypes = ast.entries.map(entry => typecheck(scope, entry));

            const entryErr = entriesTypes.find(isError);
            if (entryErr != null) {
                return entryErr;
            }

            // NOTE: This could be slightly better where different element types overlap each other
            const uniqueEntryTypes = entriesTypes.filter((el, index, arr) => arr.findIndex(other => deepEquals(el, other)) === index) as TypeExpression[];

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
        case "string-literal": {
            for (const segment of ast.segments) {
                if (typeof segment !== "string") {
                    const segmentType = typecheck(scope, segment);
                    if (isError(segmentType)) {
                        return segmentType;
                    }

                    if (!subsumes(scope, STRING_TEMPLATE_TYPE, segmentType)) {
                        return assignmentError(segment, STRING_TEMPLATE_TYPE, segmentType);
                    }
                }
            }

            return {
                kind: "primitive-type",
                type: "string",
            }
        };
        case "number-literal": return {
            kind: "primitive-type",
            type: "number",
        };
        case "boolean-literal": return {
            kind: "primitive-type",
            type: "boolean",
        };
        case "nil-literal": return {
            kind: "primitive-type",
            type: "nil",
        };

        // not expressions, but should have their contents checked
        case "reaction": {
            const dataType = typecheck(scope, ast.data);
            if (isError(dataType)) {
                return dataType;
            }
            if (!subsumes(scope, REACTION_DATA_TYPE, dataType)) {
                return assignmentError(ast.data, REACTION_DATA_TYPE, dataType);
            }
            if (dataType.kind !== "func-type") {
                return miscError(ast.data, `Expected function in reaction clause`);
            }

            const effectType = typecheck(scope, ast.data);
            if (isError(effectType)) {
                return effectType;
            }
            if (!subsumes(scope, REACTION_EFFECT_TYPE, effectType)) {
                return assignmentError(ast.data, REACTION_EFFECT_TYPE, effectType);
            }
            if (effectType.kind !== "proc-type") {
                return miscError(ast.data, `Expected procedure in effect clause`);
            }

            // TODO: This may become generalized later by generics/inverted inference
            if (!subsumes(scope, effectType.argTypes[0], dataType.returnType)) {
                return assignmentError((ast.effect as Proc).argNames[0], effectType.argTypes[0], dataType.returnType);
            }

            return { kind: "unknown-type" };
        };
        case "let-declaration": {
            const valueType = typecheck(scope, ast.value);
            if (isError(valueType)) {
                return valueType;
            }

            if (ast.type != null) {
                const declaredType = resolve(scope, ast.type);
                if (isError(declaredType)) {
                    return declaredType;
                }

                if (!subsumes(scope, declaredType, valueType)) {
                    return assignmentError(ast.value, declaredType, valueType);
                }

                scope.values[ast.name.name] = declaredType;
            } else {
                scope.values[ast.name.name] = valueType;
            }
            
            return { kind: "unknown-type" };
        };
        case "assignment": {
            // TODO: Check we're not assigning to a const

            const targetType = typecheck(scope, ast.target);
            if (isError(targetType)) {
                return targetType;
            }

            const valueType = typecheck(scope, ast.value);
            if (isError(valueType)) {
                return valueType;
            }

            if (!subsumes(scope, targetType, valueType)) {
                return assignmentError(ast.value, targetType, valueType);
            }

            return { kind: "unknown-type" };
        };
        case "proc-call": {
            const procType = typecheck(scope, ast.proc);
            if (isError(procType)) {
                return procType;
            }
            if (procType.kind !== "proc-type") {
                return miscError(ast.proc, `Expression must be a procedure to be called`);
            }

            const argValueTypes = ast.args.map(arg => typecheck(scope, arg));

            const argError = argValueTypes.find(isError);
            if (argError != null) {
                return argError;
            }

            for (let index = 0; index < argValueTypes.length; index++) {
                const argValueType = argValueTypes[index];
                if (isError(argValueType)) {
                    return argValueType;
                }
                if (!subsumes(scope, procType.argTypes[index], argValueType)) {
                    return assignmentError(ast.args[index], procType.argTypes[index], argValueType);
                }
            }

            return { kind: "unknown-type" };
        };
        case "if-else-statement": {
            const conditionType = typecheck(scope, ast.ifCondition);
            if (isError(conditionType)) {
                return conditionType;
            }
            if (conditionType.kind !== "primitive-type" || conditionType.type !== "boolean") {
                return miscError(ast.ifCondition, `Condition for if statement must be boolean`);
            }

            for (const statement of ast.ifResult) {
                const statementType = typecheck(scope, statement);
                if (isError(statementType)) {
                    return statementType;
                }
            }

            if (ast.elseResult != null) {
                for (const statement of ast.elseResult) {
                    const statementType = typecheck(scope, statement);
                    if (isError(statementType)) {
                        return statementType;
                    }
                }
            }
            
            return { kind: "unknown-type" };
        };
        case "for-loop": {
            // TODO: Disallow shadowing? Not sure

            const iteratorType = typecheck(scope, ast.iterator);
            if (isError(iteratorType)) {
                return iteratorType;
            }

            // TODO: Check that it's an iterator type (once we know how that's represented)

            scope.values[ast.itemIdentifier.name] = { kind: "unknown-type" }; // TODO: Get the item type from the iterator

            for (const statement of ast.body) {
                const statementType = typecheck(scope, statement);
                if (isError(statementType)) {
                    return statementType;
                }
            }

            return { kind: "unknown-type" };
        };
        case "while-loop": {
            const conditionType = typecheck(scope, ast.condition);
            if (isError(conditionType)) {
                return conditionType;
            }
            if (conditionType.kind !== "primitive-type" || conditionType.type !== "boolean") {
                return miscError(ast.condition, `Condition for while loop must be boolean`);
            }

            for (const statement of ast.body) {
                const statementType = typecheck(scope, statement);
                if (isError(statementType)) {
                    return statementType;
                }
            }
            
            return { kind: "unknown-type" };
        };

        // nonsense; should be handled elsewhere or ignored
        case "import-declaration":
        case "type-declaration":
        case "proc-declaration":
        case "func-declaration":
        case "const-declaration":
        case "plain-identifier":
            return { kind: "unknown-type" };
    }
    
    return miscError(ast, "Failed to typecheck");
}

const STRING_TEMPLATE_TYPE: TypeExpression = {
    kind: "union-type",
    members: [
        { kind: "primitive-type", type: "string" },
        { kind: "primitive-type", type: "number" },
        { kind: "primitive-type", type: "boolean" },
    ]
}

const REACTION_DATA_TYPE: TypeExpression = {
    kind: "func-type",
    argTypes: [],
    returnType: {
        kind: "unknown-type"
    },
}
const REACTION_EFFECT_TYPE: TypeExpression = {
    kind: "proc-type",
    argTypes: [
        { kind: "unknown-type" }
    ],
}

export function subsumes(scope: Scope, destination: TypeExpression, value: TypeExpression): boolean {
    const resolvedDestination = resolve(scope, destination);
    const resolvedValue = resolve(scope, value);

    if (isError(resolvedDestination) || isError(resolvedValue)) {
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
    } else if(deepEquals(resolvedDestination, resolvedValue)) {
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
            given(resolvedValue.entries.find(e => deepEquals(e[0], key))?.[1], value => subsumes(scope, destinationValue, value)));
    }

    return false;
}

function resolve(scope: Scope, type: TypeExpression): TypeExpression | BagelTypeError {
    if (type.kind === "named-type") {
        const namedType = scope.types[type.name.name];
        if (namedType == null) {
            return miscError(undefined, `Cannot find name '${type.name.name}'`);
        }

        return resolve(scope, namedType);
    } else if(type.kind === "union-type") {
        const members = type.members.map(member => resolve(scope, member));

        const memberErr = members.find(isError);
        if (memberErr != null) {
            return memberErr;
        }

        return {
            kind: "union-type",
            members: members as TypeExpression[],
        }
    } else if(type.kind === "object-type") {
        const entries = type.entries.map(([ key, valueType ]) => [key, resolve(scope, valueType)]);

        const entryErr = entries.find(entry => isError(entry[1])) as [PlainIdentifier, BagelTypeError] | undefined;
        if (entryErr != null) {
            return entryErr[1];
        }

        return {
            kind: "object-type",
            entries: entries as [PlainIdentifier, TypeExpression][],
        }
    } else if(type.kind === "array-type") {
        const element = resolve(scope, type.element);

        if (isError(element)) {
            return element;
        }

        return {
            kind: "array-type",
            element: element as TypeExpression,
        }
    } else {
        // TODO: Recurse on ProcType, FuncType, IndexerType, TupleType
        return type;
    }
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
        case "primitive-type": return typeExpression.type;
        case "literal-type": return String(typeExpression.value);
        case "nominal-type": return typeExpression.name;
        case "unknown-type": return "unknown";
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
    switch (error.kind) {
        case "bagel-assignable-to-error": return `${serialize(error.value)} is not assignable to ${serialize(error.destination)}`;
        case "bagel-cannot-find-name-error": return `Cannot find name '${error.ast.name}'`;
        case "bagel-misc-type-error": return error.message;
    }
}

export function isError(x: unknown): x is BagelTypeError {
    return x != null && typeof x === "object" && ((x as any).kind === "bagel-assignable-to-error" || (x as any).kind === "bagel-misc-type-error");
}

export function assignmentError(ast: AST, destination: TypeExpression, value: TypeExpression): BagelAssignableToError {
    return { kind: "bagel-assignable-to-error", ast, destination, value, stack: undefined };
}

export function cannotFindName(ast: LocalIdentifier): BagelCannotFindNameError {
    return { kind: "bagel-cannot-find-name-error", ast };
}

export function miscError(ast: AST|undefined, message: string): BagelMiscTypeError {
    return { kind: "bagel-misc-type-error", ast, message }
}