import { AST, BinaryOp, Declaration, FuncType, Identifier, NilLiteral, TypeExpression, UnknownType } from "./ast";
import { Type, STRING, NUMBER, BOOLEAN, canBeAssignedTo } from "./types";
import { deepEquals, given } from "./utils";

type NamedTypes = Map<string, TypeExpression>;
type NamedValues = Map<string, TypeExpression>;

export function typecheckFile(declarations: Declaration[]): boolean {
    const namedTypes: NamedTypes = new Map();
    const namedValues: NamedValues = new Map();

    for(const ast of declarations) {
        switch(ast.kind) {
            case "type-declaration":
                namedTypes.set(ast.name.name, ast.type);
                break;
            case "func-declaration": {
                const type = typecheck(namedTypes, namedValues, ast.func);
                if (type == null) {
                    return false;
                }

                namedValues.set((ast.func.name as string), type);
            } break;
            case "proc-declaration": {
                const type = typecheck(namedTypes, namedValues, ast.proc);
                if (type == null) {
                    return false;
                }

                namedValues.set((ast.proc.name as string), type);
            } break;
            case "const-declaration": {
                const type = typecheck(namedTypes, namedValues, ast.value);
                if (type == null) {
                    return false;
                }

                namedValues.set(ast.name.name, type);
            } break;
        }
    }

    return true;
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
        // case "pipe": return compilePipe(ast.expressions, ast.expressions.length - 1);
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
        case "identifier": return namedValues.get(ast.name);
        case "object-literal": {
            const entryTypes = ast.entries.map(([key, value]) => [key, typecheck(namedTypes, namedValues, value)]);

            if (entryTypes.some(([_, value]) => value == null)) {
                return undefined;
            } else {
                return {
                    kind: "object-type",
                    entries: entryTypes as [Identifier, TypeExpression][],
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

function subsumes(namedTypes: NamedTypes, namedValues: NamedValues, destination: TypeExpression, value: TypeExpression): boolean {
    const resolvedDestination = resolve(namedTypes, namedValues, destination);
    const resolvedValue = resolve(namedTypes, namedValues, value);

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
    }

    return false;
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

function resolve(namedTypes: NamedTypes, namedValues: NamedValues, type: TypeExpression): TypeExpression | undefined {
    // TODO: recurse
    if (type.kind === "named-type") {
        return namedTypes.get(type.name.name);
    } else {
        return type;
    }
}
