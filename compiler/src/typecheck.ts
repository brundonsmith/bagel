import { AST, BinaryOp, Declaration, FuncType, LocalIdentifier, NamedType, NilLiteral, PlainIdentifier, TypeExpression, UnknownType } from "./ast";
import { deepEquals, given } from "./utils";

type NamedTypes = Map<string, TypeExpression>;
type NamedValues = Map<string, TypeExpression>;

export function typecheckFile(declarations: Declaration[]): (TypeExpression|BagelTypeError)[] {
    const namedTypes: NamedTypes = new Map();
    const namedValues: NamedValues = new Map();

    return declarations.map(ast => {
        switch(ast.kind) {
            case "type-declaration":
                namedTypes.set(ast.name.name, ast.type);
                return ast.type;
            case "func-declaration": {
                const type = typecheck(namedTypes, namedValues, ast.func);
                if (isError(type)) {
                    return type;
                }

                namedValues.set((ast.func.name?.name as string), type);
                return type;
            }
            case "proc-declaration": {
                const type = typecheck(namedTypes, namedValues, ast.proc);
                if (isError(type)) {
                    return type;
                }

                namedValues.set((ast.proc.name?.name as string), type);
                return type;
            }
            case "const-declaration": {
                const valueType = typecheck(namedTypes, namedValues, ast.value);
                
                if (isError(valueType)) {
                    return valueType;
                } else if (ast.type.kind === "unknown-type") {
                    namedValues.set(ast.name.name, valueType);
                    return valueType;
                } else {
                    if (!subsumes(namedTypes, namedValues, ast.type, valueType)) {
                        return assignmentError(ast, ast.type, valueType);
                    } else {
                        namedValues.set(ast.name.name, ast.type); 
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

function typecheck(namedTypes: NamedTypes, namedValues: NamedValues, ast: AST): TypeExpression | BagelTypeError {
    switch(ast.kind) {
        case "proc": {
            if (ast.type.kind === "unknown-type") {
                return {
                    kind: "proc-type",
                    argTypes: new Array(ast.argNames.length).fill({ kind: "unknown-type" }),
                }
            } else {
                return ast.type;
            }
        };
        // case "assignment": return "";
        case "func": {
            if (ast.type.kind === "unknown-type") {
                const returnType = typecheck(namedTypes, namedValues, ast.body);

                if (isError(returnType)) {
                    return returnType;
                }
                
                return {
                    kind: "func-type",
                    argTypes: new Array(ast.argNames.length).fill({ kind: "unknown-type" }),
                    returnType,
                }
            } else {
                return ast.type;
            }
        };
        case "funcall": {
            const funcType = typecheck(namedTypes, namedValues, ast.func);

            if (isError(funcType)) {
                return funcType;
            }

            if (funcType.kind !== "func-type") {
                return miscError(ast, "This expression is not callable");
            }

            // TODO: infer what types arguments are allowed to be based on function body

            const argValueTypes = ast.args.map(arg => typecheck(namedTypes, namedValues, arg));

            const argError = argValueTypes.find(isError);
            if (argError != null) {
                return argError;
            }

            for (let index = 0; index < argValueTypes.length; index++) {
                const argValueType = argValueTypes[index];
                if (isError(argValueType)) {
                    return argValueType;
                }
                if (!subsumes(namedTypes, namedValues, (funcType as FuncType).argTypes[index], argValueType)) {
                    return assignmentError(ast.args[index], (funcType as FuncType).argTypes[index], argValueType);
                }
            }

            return (funcType as FuncType).returnType;
        };
        case "pipe": {
            let inputType = typecheck(namedTypes, namedValues, ast.expressions[0]);
            for (const expr of ast.expressions.slice(1)) {
                if (isError(inputType)) {
                    return inputType;
                }

                const typeOfPipe = typecheck(namedTypes, namedValues, expr);

                if (typeOfPipe?.kind !== "func-type") {
                    return miscError(ast, `Each transformation in pipeline expression must be a function`);
                }
                if (!subsumes(namedTypes, namedValues, typeOfPipe.argTypes[0], inputType)) {
                    return assignmentError(ast, typeOfPipe.argTypes[0], inputType);
                }

                inputType = typeOfPipe.returnType;
            }

            return inputType;
        };
        case "binary-operator": {
            const leftType = typecheck(namedTypes, namedValues, ast.left);
            if (isError(leftType)) {
                return leftType;
            }

            const rightType = typecheck(namedTypes, namedValues, ast.right);
            if (isError(rightType)) {
                return rightType;
            }

            for (const types of BINARY_OPERATOR_TYPES[ast.operator]) {
                const { left, right, output } = types;

                if (subsumes(namedTypes, namedValues, left, leftType) && subsumes(namedTypes, namedValues, right, rightType)) {
                    return output;
                }
            }

            return miscError(ast, `Operator ${ast.operator} cannot be applied to types ${serialize(leftType)} and ${serialize(rightType)}`);
        };
        case "if-else-expression": {
            const ifConditionType = typecheck(namedTypes, namedValues, ast.ifCondition);
            if (ifConditionType?.kind !== "primitive-type" || ifConditionType?.type !== "boolean") {
                return miscError(ast, "Condition in if expression must be boolean");
            }

            const ifType = typecheck(namedTypes, namedValues, ast.ifResult);
            if (isError(ifType)) {
                return ifType;
            }

            if (ast.elseResult == null) {
                return {
                    kind: "union-type",
                    members: [ ifType, { kind: "primitive-type", type: "nil" } ],
                };
            } else {
                const elseType = typecheck(namedTypes, namedValues, ast.elseResult);
                if (isError(elseType)) {
                    return elseType;
                }

                return {
                    kind: "union-type",
                    members: [ ifType, elseType ],
                };
            }
        };
        // case "range": return { kind: "primitive-type", type: "number" };  TODO: Iterator type
        case "parenthesized-expression": return typecheck(namedTypes, namedValues, ast.inner);
        case "local-identifier": return namedValues.get(ast.name) ?? miscError(ast, `Cannot find name '${ast.name}'`);
        case "property-accessor": {
            const type = typecheck(namedTypes, namedValues, ast.base);
            if (isError(type)) {
                return type;
            }

            let currentType: TypeExpression|BagelTypeError = type;

            for(const prop of ast.properties) {
                if (isError(currentType)) {
                    return currentType;
                }
                if (currentType.kind !== "object-type") {
                    return miscError(ast, "Properties can only be accessed on objects");
                }

                currentType = currentType.entries.find(entry => deepEquals(entry[0], prop))?.[1] 
                    ?? miscError(ast, `Property '${prop.name}' does not exist on type ${currentType}`);
            }

            return currentType;
        };
        case "object-literal": {
            const entryTypes = ast.entries.map(([key, value]) => [key, typecheck(namedTypes, namedValues, value)]);

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
            const entriesTypes = ast.entries.map(entry => typecheck(namedTypes, namedValues, entry));

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
        case "indexer": {
            const baseType = typecheck(namedTypes, namedValues, ast.base);
            if (isError(baseType)) {
                return baseType;
            }

            const indexerType = typecheck(namedTypes, namedValues, ast.indexer);
            if (isError(indexerType)) {
                return indexerType;
            }

            if (baseType.kind === "array-type" && indexerType.kind === "primitive-type" && indexerType.type === "number") {
                return baseType.element;
            } else if (baseType.kind === "object-type") {
                if (indexerType.kind === "primitive-type" && indexerType.type === "string") {
                    return {
                        kind: "union-type",
                        members: baseType.entries.map(entry => entry[1])
                    };
                }
                // TODO: Literal (primitive) types for specific properties
            } else if (baseType?.kind === "indexer-type") {
                if (!subsumes(namedTypes, namedValues, baseType.keyType, indexerType)) {
                    return assignmentError(ast, baseType.keyType, indexerType);
                }

                return baseType.valueType;
            }
        }
        case "string-literal": return {
            kind: "primitive-type",
            type: "string",
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
    }
    
    return miscError(ast, "Failed to typecheck");
}

export function subsumes(namedTypes: NamedTypes, namedValues: NamedValues, destination: TypeExpression, value: TypeExpression): boolean {
    const resolvedDestination = resolve(namedTypes, destination);
    const resolvedValue = resolve(namedTypes, value);

    if (isError(resolvedDestination) || isError(resolvedValue)) {
        return false;
    }

    if (resolvedDestination.kind === "unknown-type" || resolvedValue.kind === "unknown-type") {
        return false;
    } else if(resolvedDestination.kind === "union-type") {
        if (resolvedValue.kind === "union-type") {
            return resolvedValue.members.every(valueMember => 
                resolvedDestination.members.some(destinationMember => 
                    subsumes(namedTypes, namedValues, destinationMember, valueMember)));
        } else {
            return resolvedDestination.members.some(member => 
                subsumes(namedTypes, namedValues, member, resolvedValue));
        }
    } else if (resolvedValue.kind === "union-type") {
        return false;
    } else if(deepEquals(resolvedDestination, resolvedValue)) {
        return true;
    } else if (resolvedDestination.kind === "func-type" && resolvedValue.kind === "func-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedValue.argTypes.every((valueArg, index) => subsumes(namedTypes, namedValues, valueArg, resolvedDestination.argTypes[index]))
            && subsumes(namedTypes, namedValues, resolvedDestination.returnType, resolvedValue.returnType)) {
        return true;
    } else if (resolvedDestination.kind === "proc-type" && resolvedValue.kind === "proc-type" 
            // NOTE: Value and destination are flipped on purpose for args!
            && resolvedValue.argTypes.every((valueArg, index) => subsumes(namedTypes, namedValues, valueArg, resolvedDestination.argTypes[index]))) {
        return true;
    } else if (resolvedDestination.kind === "array-type" && resolvedValue.kind === "array-type") {
        return subsumes(namedTypes, namedValues, resolvedDestination.element, resolvedValue.element)
    } else if (resolvedDestination.kind === "object-type" && resolvedValue.kind === "object-type") {
        return resolvedDestination.entries.every(([key, destinationValue]) => 
            given(resolvedValue.entries.find(e => deepEquals(e[0], key))?.[1], value => subsumes(namedTypes, namedValues, destinationValue, value)));
    }

    return false;
}

function resolve(namedTypes: NamedTypes, type: TypeExpression): TypeExpression | BagelTypeError {
    if (type.kind === "named-type") {
        const namedType = namedTypes.get(type.name.name);
        if (namedType == null) {
            return miscError(undefined, `Cannot find name '${type.name.name}'`);
        }

        return resolve(namedTypes, namedType);
    } else if(type.kind === "union-type") {
        const members = type.members.map(member => resolve(namedTypes, member));

        const memberErr = members.find(isError);
        if (memberErr != null) {
            return memberErr;
        }

        return {
            kind: "union-type",
            members: members as TypeExpression[],
        }
    } else if(type.kind === "object-type") {
        const entries = type.entries.map(([ key, valueType ]) => [key, resolve(namedTypes, valueType)]);

        const entryErr = entries.find(entry => isError(entry[1])) as [PlainIdentifier, BagelTypeError] | undefined;
        if (entryErr != null) {
            return entryErr[1];
        }

        return {
            kind: "object-type",
            entries: entries as [PlainIdentifier, TypeExpression][],
        }
    } else if(type.kind === "array-type") {
        const element = resolve(namedTypes, type.element);

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
    | BagelMiscTypeError

export type BagelAssignableToError = {
    kind: "bagel-assignable-to-error",
    ast: AST,
    destination: TypeExpression,
    value: TypeExpression,
    stack?: string|undefined,
}

export type BagelMiscTypeError = {
    kind: "bagel-misc-type-error",
    ast: AST|undefined,
    message: string,
}

export function errorMessage(error: BagelTypeError): string {
    switch (error.kind) {
        case "bagel-assignable-to-error": return `${serialize(error.value)} is not assignable to ${serialize(error.destination)}`;
        case "bagel-misc-type-error": return error.message;
    }
}

export function isError(x: unknown): x is BagelTypeError {
    return x != null && typeof x === "object" && ((x as any).kind === "bagel-assignable-to-error" || (x as any).kind === "bagel-misc-type-error");
}

export function assignmentError(ast: AST, destination: TypeExpression, value: TypeExpression): BagelAssignableToError {
    return { kind: "bagel-assignable-to-error", ast, destination, value, stack: undefined };
}

export function miscError(ast: AST|undefined, message: string): BagelMiscTypeError {
    return { kind: "bagel-misc-type-error", ast, message }
}