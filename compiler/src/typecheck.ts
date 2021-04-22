import { AST, BinaryOp, Declaration, FuncType, LocalIdentifier, NamedType, NilLiteral, PlainIdentifier, TypeExpression, UnknownType } from "./ast";
import { deepEquals, given } from "./utils";

type NamedTypes = Map<string, TypeExpression>;
type NamedValues = Map<string, TypeExpression>;

export function typecheckFile(declarations: Declaration[]): (TypeExpression|undefined)[] {
    const namedTypes: NamedTypes = new Map();
    const namedValues: NamedValues = new Map();

    return declarations.map(ast => {
        switch(ast.kind) {
            case "type-declaration":
                namedTypes.set(ast.name.name, ast.type);
                return ast.type;
            case "func-declaration": {
                const type = typecheck(namedTypes, namedValues, ast.func);
                if (type == null) {
                    return undefined;
                }

                namedValues.set((ast.func.name?.name as string), type);
                return type;
            }
            case "proc-declaration": {
                const type = typecheck(namedTypes, namedValues, ast.proc);
                if (type == null) {
                    return undefined;
                }

                namedValues.set((ast.proc.name?.name as string), type);
                return type;
            }
            case "const-declaration": {
                const valueType = typecheck(namedTypes, namedValues, ast.value);
                
                if (valueType == null) {
                    return undefined;
                } else if (ast.type.kind === "unknown-type") {
                    namedValues.set(ast.name.name, valueType);
                    return valueType;
                } else {
                    if (!subsumes(namedTypes, namedValues, ast.type, valueType)) {
                        return undefined;
                    } else {
                        namedValues.set(ast.name.name, ast.type); 
                        return ast.type;
                    }
                }

            }
        }
    })
}

const BINARY_OPERATOR_TYPES: {[key in BinaryOp]: {inputs: TypeExpression, output: TypeExpression}} = {
    "+": { inputs: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "number" } },
    "-": { inputs: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "number" } },
    "*": { inputs: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "number" } },
    "/": { inputs: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "number" } },
    "<": { inputs: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "boolean" } },
    ">": { inputs: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "boolean" } },
    "<=": { inputs: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "boolean" } },
    ">=": { inputs: { kind: "primitive-type", type: "number" }, output: { kind: "primitive-type", type: "boolean" } },
    "&&": { inputs: { kind: "primitive-type", type: "boolean" }, output: { kind: "primitive-type", type: "boolean" } },
    "||": { inputs: { kind: "primitive-type", type: "boolean" }, output: { kind: "primitive-type", type: "boolean" } },
    "??": { inputs: { kind: "unknown-type" }, output: { kind: "unknown-type" } },
    // "??": {
    //     inputs: { kind: "union-type", members: [ { kind: "primitive-type", type: "nil" }, ] },
    //     output: { kind: "primitive-type", type: "boolean" }
    // },
}

function typecheck(namedTypes: NamedTypes, namedValues: NamedValues, ast: AST): TypeExpression | undefined {
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

                if (returnType == null) {
                    return undefined;
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

            if (funcType == null || funcType.kind !== "func-type") {
                return undefined;
            }

            // TODO: infer what types arguments are allowed to be based on function body

            const argTypes = ast.args.map(arg => typecheck(namedTypes, namedValues, arg));

            if (argTypes.some((t, index) => t == null || !subsumes(namedTypes, namedValues, (funcType as FuncType).argTypes[index], t))) {
                return undefined;
            } else {
                return (funcType as FuncType).returnType;
            }
        };
        case "pipe": {
            let inputType = typecheck(namedTypes, namedValues, ast.expressions[0]);
            for (const expr of ast.expressions.slice(1)) {
                if (inputType == null) {
                    return undefined;
                }

                const typeOfPipe = typecheck(namedTypes, namedValues, expr);

                if (typeOfPipe?.kind !== "func-type" || !subsumes(namedTypes, namedValues, typeOfPipe.argTypes[0], inputType)) {
                    return undefined;
                }

                inputType = typeOfPipe.returnType;
            }

            return inputType;
        };
        case "binary-operator": {
            return given(typecheck(namedTypes, namedValues, ast.left), leftType =>
                given(typecheck(namedTypes, namedValues, ast.right), rightType => {
                    const { inputs, output } = BINARY_OPERATOR_TYPES[ast.operator];

                    if (!subsumes(namedTypes, namedValues, inputs, leftType) || !subsumes(namedTypes, namedValues, inputs, rightType)) {
                        return undefined;
                    }

                    return output;
                }));
        };
        case "if-else-expression": {
            const ifConditionType = typecheck(namedTypes, namedValues, ast.ifCondition);
            if (ifConditionType?.kind !== "primitive-type" || ifConditionType?.type !== "boolean") {
                return undefined;
            }

            return given(typecheck(namedTypes, namedValues, ast.ifResult), ifType => {
                if (ast.elseResult == null) {
                    return {
                        kind: "union-type",
                        members: [ ifType, { kind: "primitive-type", type: "nil" } ],
                    };
                } else {
                    return given(typecheck(namedTypes, namedValues, ast.elseResult), elseType => ({
                        kind: "union-type",
                        members: [ ifType, elseType ],
                    }));
                }
            });
        };
        case "range": return undefined; //{ kind: "primitive-type", type: "number" };  TODO: Iterator type
        case "parenthesized-expression": return typecheck(namedTypes, namedValues, ast.inner);
        case "local-identifier": return namedValues.get(ast.name);
        case "property-accessor": {
            return given(typecheck(namedTypes, namedValues, ast.base), type => {
                let currentType: TypeExpression|undefined = type;

                for(const prop of ast.properties) {
                    if (currentType == null || currentType.kind !== "object-type") {
                        return undefined;
                    }

                    currentType = currentType.entries.find(entry => deepEquals(entry[0], prop))?.[1];
                }

                return currentType;
            })
        };
        case "object-literal": {
            const entryTypes = ast.entries.map(([key, value]) => [key, typecheck(namedTypes, namedValues, value)]);

            if (entryTypes.some(([_, value]) => value == null)) {
                return undefined;
            } else {
                return {
                    kind: "object-type",
                    entries: entryTypes as [PlainIdentifier, TypeExpression][],
                };
            }
        };
        case "array-literal": {
            const entriesTypes = ast.entries.map(entry => typecheck(namedTypes, namedValues, entry));

            if (entriesTypes.some(t => t == null)) {
                return undefined;
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
        case "string-literal":  return {
            kind: "primitive-type",
            type: "string",
        };
        case "number-literal":  return {
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
        
    return undefined;
}

export function subsumes(namedTypes: NamedTypes, namedValues: NamedValues, destination: TypeExpression, value: TypeExpression): boolean {
    const resolvedDestination = resolve(namedTypes, destination);
    const resolvedValue = resolve(namedTypes, value);

    if (resolvedDestination == null || resolvedValue == null) {
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

function resolve(namedTypes: NamedTypes, type: TypeExpression): TypeExpression | undefined {
    if (type.kind === "named-type") {
        return given(namedTypes.get(type.name.name), named => resolve(namedTypes, named));
    } else if(type.kind === "union-type") {
        const members = type.members.map(member => resolve(namedTypes, member));

        if (members.some(member => member == null)) {
            return undefined;
        }

        return {
            kind: "union-type",
            members: members as TypeExpression[],
        }
    } else if(type.kind === "object-type") {
        const entries = type.entries.map(([ key, valueType ]) => [key, resolve(namedTypes, valueType)]);

        if (entries.some(entry => entry[1] == null)) {
            return undefined;
        }

        return {
            kind: "object-type",
            entries: entries as [PlainIdentifier, TypeExpression][],
        }
    } else if(type.kind === "array-type") {
        const element = resolve(namedTypes, type.element);

        if (element == null) {
            return undefined;
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
