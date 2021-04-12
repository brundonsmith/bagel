import { ArrayLiteral, ArrayType, Assignment, AST, BinaryOp, BinaryOperator, BooleanLiteral, ConstDeclaration, Declaration, Expression, ForLoop, Func, Funcall, FuncDeclaration, Identifier, IfElseExpression, IfElseStatement, IndexerType, KEYWORDS, LetDeclaration, LiteralType, NamedType, NilLiteral, NumberLiteral, ObjectLiteral, ObjectType, ParenthesizedExpression, Pipe, PrimitiveType, Proc, ProcCall, ProcDeclaration, PropertyAccessor, Range, Statement, StringLiteral, TupleType, TypeDeclaration, TypeExpression, UnionType, UnknownType, WhileLoop } from "./ast";
import { consume, consumeWhitespace, consumeWhile, isNumeric, consumeBinaryOp, ParseResult, parseSeries, isSymbolic, parseOptional } from "./parsing-utils";
import { given, log } from "./utils";

export function parse(code: string): Declaration[] {
    let index = 0;

    const results: Declaration[] = [];
    index = consumeWhitespace(code, index);
    for (let result = declaration(code, index); result != null; result = declaration(code, index)) {
        results.push(result.parsed);
        index = result.newIndex;
        index = consumeWhitespace(code, index);
    }

    return results;
}

// function ast(code: string, index: number): ParseResult<AST> | undefined {
//     index = consumeWhitespace(code, index);
//     return declaration(code, index)
//         ?? expression(code, index);
// }

const declaration = (code: string, index: number): ParseResult<Declaration> | undefined =>
    typeDeclaration(code, index)
    ?? procDeclaration(code, index)
    ?? funcDeclaration(code, index)
    ?? constDeclaration(code, index)

const typeDeclaration = (code: string, index: number): ParseResult<TypeDeclaration> | undefined =>
    given(consume(code, index, "type"), index => 
        given(consumeWhitespace(code, index), index =>
            given(identifier(code, index), ({ parsed: name, newIndex: index }) =>
                given(consumeWhitespace(code, index), index =>
                    given(consume(code, index, "="), index =>
                        given(consumeWhitespace(code, index), index =>
                            given(typeExpression(code, index), ({ parsed: type, newIndex: index }) => ({
                                parsed: {
                                    kind: "type-declaration",
                                    name,
                                    type,
                                },
                                newIndex: index,
                            }))))))))

const typeExpression = (code: string, index: number): ParseResult<TypeExpression> | undefined =>
    arrayType(code, index)
    ?? nonArrayType(code, index)

const arrayType = (code: string, index: number): ParseResult<ArrayType> | undefined =>
    given(nonArrayType(code, index), ({ parsed: element, newIndex: index }) =>
        given(consume(code, index, "[]"), index => ({
            parsed: {
                kind: "array-type",
                element,
            },
            newIndex: index,
        })))

// required because of the way arrayTypes are written
const nonArrayType = (code: string, index: number): ParseResult<TypeExpression> | undefined =>
    unionType(code, index)
    ?? atomicType(code, index)

const unionType = (code: string, index: number): ParseResult<UnionType> | undefined =>
    // TODO: Allow leading |
    given(parseSeries(code, index, atomicType, "|", { leadingDelimiter: "optional", trailingDelimiter: "forbidden" }), ({ parsed: members, newIndex: index }) =>
        members.length >= 2
            ? {
                parsed: {
                    kind: "union-type",
                    members,
                },
                newIndex: index,
            }
            : undefined)

const atomicType = (code: string, index: number): ParseResult<TypeExpression> | undefined =>
    primitiveType(code, index)
    ?? literalType(code, index)
    ?? namedType(code, index)
    ?? objectType(code, index)
    ?? indexerType(code, index)
    ?? tupleType(code, index)
    ?? unknownType(code, index)

const namedType = (code: string, index: number): ParseResult<NamedType> | undefined =>
    given(identifier(code, index), ({ parsed: name, newIndex: index }) => ({
        parsed: {
            kind: "named-type",
            name,
        },
        newIndex: index,
    }))

const objectType = (code: string, index: number): ParseResult<ObjectType> | undefined =>
    given(consume(code, index, "{"), index =>
        given(consumeWhitespace(code, index), index =>
            given(parseSeries(code, index, _objectTypeEntry, ","), ({ parsed: entries, newIndex: index }) =>
                given(consumeWhitespace(code, index), index =>
                    given(consume(code, index, "}"), index => ({
                        parsed: {
                            kind: "object-type",
                            entries,
                        },
                        newIndex: index,
                    }))))))

const _objectTypeEntry = (code: string, index: number): ParseResult<[Identifier, TypeExpression]> | undefined =>
    given(identifier(code, index), ({ parsed: key, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
            given(consume(code, index, ":"), index => 
                given(consumeWhitespace(code, index), index =>
                    given(typeExpression(code, index), ({ parsed: value, newIndex: index }) => ({
                        parsed: [key, value],
                        newIndex: index,
                    }))))))
        
const indexerType = (code: string, index: number): ParseResult<IndexerType> | undefined =>
    given(consume(code, index, "{"), index =>
        given(consume(code, index, "["), index =>
            given(typeExpression(code, index), ({ parsed: keyType, newIndex: index }) =>
                given(consume(code, index, "]"), index =>
                    given(consume(code, index, ":"), index =>
                        given(typeExpression(code, index), ({ parsed: valueType, newIndex: index }) =>
                            given(consume(code, index, "}"), index => ({
                                parsed: {
                                    kind: "indexer-type",
                                    keyType,
                                    valueType,
                                },
                                newIndex: index,
                            }))))))))

const tupleType = (code: string, index: number): ParseResult<TupleType> | undefined =>
    given(consume(code, index, "["), index =>
        given(parseSeries(code, index, typeExpression, ","), ({ parsed: members, newIndex: index }) =>
            given(consume(code, index, "]"), index => ({
                parsed: {
                    kind: "tuple-type",
                    members,
                },
                newIndex: index,
            }))))

const primitiveType = (code: string, index: number): ParseResult<PrimitiveType> | undefined =>
    given(consume(code, index, "string"), index => ({
        parsed: {
            kind: "primitive-type",
            type: "string",
        },
        newIndex: index,
    }))
    ?? given(consume(code, index, "number"), index => ({
        parsed: {
            kind: "primitive-type",
            type: "number",
        },
        newIndex: index,
    }))
    ?? given(consume(code, index, "boolean"), index => ({
        parsed: {
            kind: "primitive-type",
            type: "boolean",
        },
        newIndex: index,
    }))
    ?? given(consume(code, index, "nil"), index => ({
        parsed: {
            kind: "primitive-type",
            type: "nil",
        },
        newIndex: index,
    }))

const literalType = (code: string, index: number): ParseResult<LiteralType> | undefined =>
    given(stringLiteral(code, index) 
        ?? numberLiteral(code, index) 
        ?? booleanLiteral(code, index), 
    ({ parsed: value, newIndex: index }) => ({
        parsed: {
            kind: "literal-type",
            value,
        },
        newIndex: index,
    }))

const unknownType = (code: string, index: number): ParseResult<UnknownType> | undefined =>
    given(consume(code, index, "unknown"), index => ({
        parsed: {
            kind: "unknown-type",
        },
        newIndex: index,
    }))

const procDeclaration = (code: string, index: number): ParseResult<ProcDeclaration> | undefined =>
    given(consume(code, index, "proc"), index =>
        given(consumeWhitespace(code, index), index =>
            given(proc(code, index), ({ parsed: proc, newIndex: index }) => ({
                parsed: {
                    kind: "proc-declaration",
                    proc,
                },
                newIndex: index,
            }))))

const funcDeclaration = (code: string, index: number): ParseResult<FuncDeclaration> | undefined =>
    given(consume(code, index, "func"), index =>
        given(consumeWhitespace(code, index), index =>
            given(func(code, index), ({ parsed: func, newIndex: index }) => ({
                parsed: {
                    kind: "func-declaration",
                    func,
                },
                newIndex: index,
            }))))

const constDeclaration = (code: string, index: number): ParseResult<ConstDeclaration> | undefined =>
    given(consume(code, index, "const"), index =>
        given(consumeWhitespace(code, index), index =>
            given(identifier(code, index), ({ parsed: name, newIndex: index}) =>
                given(consumeWhitespace(code, index), index =>
                    given(parseOptional(code, index, (code, index) =>
                        given(consume(code, index, ":"), index =>
                            given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: type, newIndex }) =>
                    given(consumeWhitespace(code, newIndex ?? index), index =>
                        given(consume(code, index, "="), index =>
                            given(consumeWhitespace(code, index), index =>
                                given(expression(code, index), ({ parsed: value, newIndex: index }) => ({
                                    parsed: {
                                        kind: "const-declaration",
                                        name,
                                        type: type ?? { kind: "unknown-type" },
                                        value,
                                    },
                                    newIndex: index,
                                }))))))))))

const expression = (code: string, index: number): ParseResult<Expression> | undefined =>
    proc(code, index)
    ?? func(code, index)
    ?? pipe(code, index)
    ?? binaryOperator(code, index)
    ?? beneathBinaryOperator(code, index)

const beneathBinaryOperator = (code: string, index: number): ParseResult<Expression> | undefined =>
    propertyAccessor(code, index)
    ?? funcall(code, index)
    ?? ifElseExpression(code, index)
    ?? range(code, index)
    ?? parenthesized(code, index)
    ?? identifier(code, index)
    ?? objectLiteral(code, index)
    ?? arrayLiteral(code, index)
    ?? stringLiteral(code, index)
    ?? numberLiteral(code, index)
    ?? booleanLiteral(code, index)
    ?? nilLiteral(code, index)

const beneathPropertyAccessor = (code: string, index: number): ParseResult<Expression> | undefined =>
    funcall(code, index)
    ?? beneathFuncall(code, index)

const beneathFuncall = (code: string, index: number): ParseResult<Expression> | undefined =>
    ifElseExpression(code, index)
    ?? range(code, index)
    ?? parenthesized(code, index)
    ?? identifier(code, index)
    ?? objectLiteral(code, index)
    ?? arrayLiteral(code, index)
    ?? stringLiteral(code, index)
    ?? numberLiteral(code, index)
    ?? booleanLiteral(code, index)
    ?? nilLiteral(code, index)

function proc(code: string, index: number): ParseResult<Proc> | undefined {
    const nameResult = identifier(code, index);

    return given(consume(code, nameResult?.newIndex ?? index, "("), index =>
        given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
            given(consume(code, index, ")"), index =>
                given(consumeWhitespace(code, index), index =>
                    given(consume(code, index, "{"), index =>
                        given(consumeWhitespace(code, index), index =>
                            given(parseSeries(code, index, statement), ({ parsed: body, newIndex: index }) => 
                                given(consumeWhitespace(code, index), index =>
                                    given(consume(code, index, "}"), index =>({
                                        parsed: {
                                            kind: "proc",
                                            name: nameResult?.parsed,
                                            type: {
                                                kind: "proc-type",
                                                argTypes: args.map(arg => arg.type ?? { kind: "unknown-type" }),
                                            },
                                            argNames: args.map(arg => arg.name),
                                            body,
                                        },
                                        newIndex: index,
                                    }))))))))))
}

const statement = (code: string, index: number): ParseResult<Statement> | undefined =>
    letDeclaration(code, index)
    ?? assignment(code, index)
    ?? procCall(code, index)
    ?? ifElseStatement(code, index)
    ?? forLoop(code, index)
    ?? whileLoop(code, index)

const letDeclaration = (code: string, index: number): ParseResult<LetDeclaration> | undefined =>
    given(consume(code, index, "let"), index =>
        given(consumeWhitespace(code, index), index =>
            given(identifier(code, index), ({ parsed: name, newIndex: index }) =>
                given(consumeWhitespace(code, index), index =>
                    given(parseOptional(code, index, (code, index) =>
                        given(consume(code, index, ":"), index =>
                            given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: type, newIndex }) =>
                    given(consumeWhitespace(code, newIndex ?? index), index =>
                        given(consume(code, index, "="), index =>
                            given(consumeWhitespace(code, index), index =>
                                given(expression(code, index), ({ parsed: value, newIndex: index }) =>
                                    given(consumeWhitespace(code, index), index =>
                                        given(consume(code, index, ";"), index => ({
                                                parsed: {
                                                    kind: "let-declaration",
                                                    name,
                                                    value,
                                                    type: type ?? { kind: "unknown-type" },
                                                },
                                                newIndex: index,
                                            }))))))))))))

const assignment = (code: string, index: number): ParseResult<Assignment> | undefined =>
    given(identifier(code, index) ?? propertyAccessor(code, index), ({ parsed: target, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "="), index =>
                given(consumeWhitespace(code, index), index =>
                    given(expression(code, index), ({ parsed: value, newIndex: index }) => 
                        given(consumeWhitespace(code, index), index =>
                            given(consume(code, index, ";"), index => ({
                                parsed: {
                                    kind: "assignment",
                                    target,
                                    value,
                                },
                                newIndex: index,
                            }))))))))

const procCall = (code: string, index: number): ParseResult<ProcCall> | undefined =>
    given(expression(code, index), ({ parsed: proc, newIndex: index }) =>
        given(consume(code, index, "("), index => 
            given(parseSeries(code, index, expression, ","), ({ parsed: args, newIndex: index }) =>
                given(consume(code, index, ")"), index =>
                    given(consumeWhitespace(code, index), index =>
                        given(consume(code, index, ";"), index => ({
                            parsed: {
                                kind: "proc-call",
                                proc,
                                args,
                            },
                            newIndex: index,
                        })))))))

const ifElseStatement = (code: string, index: number): ParseResult<IfElseStatement> | undefined =>
    given(consume(code, index, "if"), index =>
        given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "("), index =>
                given(consumeWhitespace(code, index), index =>
                    given(expression(code, index), ({ parsed: ifCondition, newIndex: index }) =>
                        given(consumeWhitespace(code, index), index =>
                            given(consume(code, index, ")"), index =>
                                given(consumeWhitespace(code, index), index =>
                                    given(consume(code, index, "{"), index =>
                                        given(consumeWhitespace(code, index), index =>
                                            given(parseSeries(code, index, statement), ({ parsed: ifResult, newIndex: index }) => 
                                                given(consumeWhitespace(code, index), index =>
                                                    given(consume(code, index, "}"), index =>
                                                        given(consumeWhitespace(code, index), index => {
                                                            const elseResultResult = given(consume(code, index, "else"), index => 
                                                                given(consumeWhitespace(code, index), index =>
                                                                    given(consume(code, index, "{"), index =>
                                                                        given(parseSeries(code, index, statement), ({ parsed, newIndex: index }) =>
                                                                            given(consume(code, index, "}"), index => ({ parsed, newIndex: index }))))));

                                                            if (elseResultResult == null || elseResultResult.parsed.length === 0) {
                                                                return {
                                                                    parsed: {
                                                                        kind: "if-else-statement",
                                                                        ifCondition,
                                                                        ifResult,
                                                                    },
                                                                    newIndex: index,
                                                                }
                                                            } else {
                                                                return  {
                                                                    parsed: {
                                                                        kind: "if-else-statement",
                                                                        ifCondition,
                                                                        ifResult,
                                                                        elseResult: elseResultResult.parsed,
                                                                    },
                                                                    newIndex: elseResultResult.newIndex,
                                                                }
                                                            }
                                                        }))))))))))))))

const forLoop = (code: string, index: number): ParseResult<ForLoop> | undefined =>
    given(consume(code, index, "for"), index =>
        given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "("), index =>
                given(consumeWhitespace(code, index), index =>
                    given(identifier(code, index), ({ parsed: itemIdentifier, newIndex: index }) =>
                        given(consumeWhitespace(code, index), index =>
                            given(consume(code, index, "of"), index =>
                                given(consumeWhitespace(code, index), index =>
                                    given(expression(code, index), ({ parsed: iterator, newIndex: index }) =>
                                        given(consumeWhitespace(code, index), index =>
                                            given(consume(code, index, ")"), index =>
                                                given(consumeWhitespace(code, index), index =>
                                                    given(consume(code, index, "{"), index =>
                                                        given(parseSeries(code, index, statement), ({ parsed: body, newIndex: index }) =>
                                                            given(consumeWhitespace(code, index), index =>
                                                                given(consume(code, index, "}"), index => ({
                                                                    parsed: {
                                                                        kind: "for-loop",
                                                                        itemIdentifier,
                                                                        iterator,
                                                                        body,
                                                                    },
                                                                    newIndex: index,
                                                                })))))))))))))))))

const whileLoop = (code: string, index: number): ParseResult<WhileLoop> | undefined =>
    given(consume(code, index, "while"), index =>
        given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "("), index =>
                given(consumeWhitespace(code, index), index =>
                    given(expression(code, index), ({ parsed: condition, newIndex: index }) =>
                        given(consumeWhitespace(code, index), index =>
                            given(consume(code, index, ")"), index =>
                                given(consumeWhitespace(code, index), index =>
                                    given(consume(code, index, "{"), index =>
                                        given(parseSeries(code, index, statement), ({ parsed: body, newIndex: index }) =>
                                            given(consumeWhitespace(code, index), index =>
                                                given(consume(code, index, "}"), index => ({
                                                    parsed: {
                                                        kind: "while-loop",
                                                        condition,
                                                        body,
                                                    },
                                                    newIndex: index,
                                                })))))))))))))

function func(code: string, index: number): ParseResult<Func> | undefined {
    const nameResult = identifier(code, index);

    return given(consume(code, nameResult?.newIndex ?? index, "("), index =>
        given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
            given(consume(code, index, ")"), index =>
                given(consumeWhitespace(code, index), index =>
                    given(parseOptional(code, index, (code, index) =>
                        given(consume(code, index, ":"), index =>
                            given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: returnType, newIndex }) =>
                    given(consumeWhitespace(code, newIndex ?? index), index =>
                        given(consume(code, index, "=>"), index =>
                            given(consumeWhitespace(code, index), index =>
                                given(expression(code, index), ({ parsed: body, newIndex: index }) => ({
                                    parsed: {
                                        kind: "func",
                                        name: nameResult?.parsed,
                                        type: {
                                            kind: "func-type",
                                            argTypes: args.map(arg => arg.type ?? { kind: "unknown-type" }),
                                            returnType: returnType ?? { kind: "unknown-type" },
                                        },
                                        argNames: args.map(arg => arg.name),
                                        body,
                                    },
                                    newIndex: index,
                                }))))))))))
}

const _argumentDeclaration = (code: string, index: number): ParseResult<{ name: Identifier, type?: TypeExpression }> | undefined => 
    given(identifier(code, index), ({ parsed: name, newIndex: index }) =>
        given(consumeWhitespace(code, index), index => 
            given(parseOptional(code, index, (code, index) =>
                given(consume(code, index, ":"), index =>
                    given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: type, newIndex }) => ({
                parsed: {
                    name,
                    type,
                },
                newIndex: newIndex ?? index
            }))))

const pipe = (code: string, index: number): ParseResult<Pipe> | undefined => 
    given(parseSeries(code, index, beneathBinaryOperator, "|>", { trailingDelimiter: "forbidden" }), ({ parsed: expressions, newIndex: index }) =>
        expressions.length >= 2
            ? {
                parsed: {
                    kind: "pipe",
                    expressions,
                },
                newIndex: index,
            }
            : undefined)

const binaryOperator = (code: string, index: number): ParseResult<BinaryOperator> | undefined => 
    given(beneathBinaryOperator(code, index), ({ parsed: left, newIndex: index }) => 
        given(consumeWhitespace(code, index), index =>
            given(consumeBinaryOp(code, index), endOfOpIndex =>
            given(code.substring(index, endOfOpIndex) as BinaryOp, operator =>
            given(consumeWhitespace(code, endOfOpIndex), index =>
                given(expression(code, index), ({ parsed: right, newIndex: index }) => ({
                    parsed: {
                        kind: "binary-operator",
                        operator,
                        left,
                        right,
                    },
                    newIndex: index,
                })))))))
                            
const funcall = (code: string, index: number): ParseResult<Funcall> | undefined =>
    given(beneathFuncall(code, index), ({ parsed: func, newIndex: index }) =>
        given(consume(code, index, "("), index => 
            given(parseSeries(code, index, expression, ","), ({ parsed: args, newIndex: index }) =>
                given(consume(code, index, ")"), index => ({
                    parsed: {
                        kind: "funcall",
                        func,
                        args,
                    },
                    newIndex: index,
                })))))
                
const ifElseExpression = (code: string, index: number): ParseResult<IfElseExpression> | undefined =>
    given(consume(code, index, "if"), index =>
        given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "("), index =>
                given(consumeWhitespace(code, index), index =>
                    given(expression(code, index), ({ parsed: ifCondition, newIndex: index }) =>
                        given(consumeWhitespace(code, index), index =>
                            given(consume(code, index, ")"), index =>
                                given(consumeWhitespace(code, index), index =>
                                    given(consume(code, index, "{"), index =>
                                        given(consumeWhitespace(code, index), index =>
                                            given(expression(code, index), ({ parsed: ifResult, newIndex: index }) => 
                                                given(consumeWhitespace(code, index), index =>
                                                    given(consume(code, index, "}"), index =>
                                                        given(consumeWhitespace(code, index), index => {
                                                            const elseResultResult = given(consume(code, index, "else"), index => 
                                                                given(consumeWhitespace(code, index), index =>
                                                                    given(consume(code, index, "{"), index =>
                                                                        given(expression(code, index), ({ parsed, newIndex: index }) =>
                                                                            given(consume(code, index, "}"), index => ({ parsed, newIndex: index }))))));

                                                            if (elseResultResult == null) {
                                                                return {
                                                                    parsed: {
                                                                        kind: "if-else-expression",
                                                                        ifCondition,
                                                                        ifResult,
                                                                    },
                                                                    newIndex: index,
                                                                }
                                                            } else {
                                                                return  {
                                                                    parsed: {
                                                                        kind: "if-else-expression",
                                                                        ifCondition,
                                                                        ifResult,
                                                                        elseResult: elseResultResult.parsed,
                                                                    },
                                                                    newIndex: elseResultResult.newIndex,
                                                                }
                                                            }
                                                        }))))))))))))))

const range = (code: string, index: number): ParseResult<Range> | undefined =>
    given(numberLiteral(code, index), ({ parsed: firstNumber, newIndex: index }) =>
        given(consume(code, index, ".."), index =>
            given(numberLiteral(code, index), ({ parsed: secondNumber, newIndex: index }) => ({
                parsed: {
                    kind: "range",
                    start: firstNumber.value,
                    end: secondNumber.value,
                },
                newIndex: index,
            }))));

const parenthesized = (code: string, index: number): ParseResult<ParenthesizedExpression> | undefined =>
    given(consume(code, index, "("), index =>
        given(expression(code, index), ({ parsed: inner, newIndex: index }) =>
            given(consume(code, index, ")"), index => ({
                parsed: {
                    kind: "parenthesized-expression",
                    inner,
                },
                newIndex: index,
            }))))

const propertyAccessor = (code: string, index: number): ParseResult<PropertyAccessor> | undefined =>
    given(beneathPropertyAccessor(code, index), ({ parsed: base, newIndex: index }) =>
        given(parseSeries(code, index, identifier, ".", { leadingDelimiter: "required", trailingDelimiter: "forbidden", whitespace: "forbidden" }), ({ parsed: properties, newIndex: index }) => 
            properties.length > 0
                ? {
                    parsed: {
                        kind: "property-accessor",
                        base,
                        properties,
                    },
                    newIndex: index
                }
                : undefined))

function identifier(code: string, index: number): ParseResult<Identifier> | undefined {
    let nameResult = identifierSegment(code, index);
    if (nameResult = identifierSegment(code, index)) {
        return {
            parsed: { kind: "identifier", name: nameResult.segment },
            newIndex: nameResult.newIndex,
        }
    } else {
        return undefined;
    }
}

const objectLiteral = (code: string, index: number): ParseResult<ObjectLiteral> | undefined =>
    given(consume(code, index, "{"), index =>
        given(parseSeries(code, index, _objectEntry, ","), ({ parsed: entries, newIndex: index }) =>
            given(consume(code, index, "}"), index => ({
                parsed: {
                    kind: "object-literal",
                    entries,
                },
                newIndex: index,
            }))))

const _objectEntry = (code: string, index: number): ParseResult<[Identifier, Expression]> | undefined =>
    given(identifier(code, index), ({ parsed: key, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
            given(consume(code, index, ":"), index => 
                given(consumeWhitespace(code, index), index =>
                    given(expression(code, index), ({ parsed: value, newIndex: index }) => ({
                        parsed: [key, value],
                        newIndex: index,
                    }))))))

const arrayLiteral = (code: string, index: number): ParseResult<ArrayLiteral> | undefined =>
    given(consume(code, index, "["), index =>
        given(parseSeries(code, index, expression, ","), ({ parsed: entries, newIndex: index }) =>
            given(consume(code, index, "]"), index => ({
                parsed: {
                    kind: "array-literal",
                    entries,
                },
                newIndex: index,
            }))))

function stringLiteral(code: string, index: number): ParseResult<StringLiteral> | undefined {
    if (code[index] === "'") {
        index++;

        const contentsStart = index;

        while (code[index] !== "'") {
            index++;
        }

        return {
            parsed: { kind: "string-literal", value: code.substring(contentsStart, index) },
            newIndex: index + 1,
        }
    }
}

function numberLiteral(code: string, index: number): ParseResult<NumberLiteral> | undefined {
    if (isNumeric(code[index])) {
        const numberStart = index;

        index++;
        while (isNumeric(code[index])) {
            index++;
        }

        return {
            parsed: { kind: "number-literal", value: Number(code.substring(numberStart, index)) },
            newIndex: index,
        }
    }
}

function booleanLiteral(code: string, index: number): ParseResult<BooleanLiteral> | undefined {

    const indexAfterTrue = consume(code, index, "true");
    if (indexAfterTrue != null) {
        return {
            parsed: { kind: "boolean-literal", value: true },
            newIndex: indexAfterTrue,
        }
    }
    
    const indexAfterFalse = consume(code, index, "false");
    if (indexAfterFalse != null) {
        return {
            parsed: { kind: "boolean-literal", value: false },
            newIndex: indexAfterFalse,
        }
    }
}

function nilLiteral(code: string, index: number): ParseResult<NilLiteral> | undefined {
    const indexAfter = consume(code, index, "nil");
    if (indexAfter != null) {
        return {
            parsed: { kind: "nil-literal" },
            newIndex: indexAfter,
        }
    }
}

function identifierSegment(code: string, index: number): { segment: string, newIndex: number} | undefined {
    const startIndex = index;

    while (isSymbolic(code[index], index - startIndex)) {
        index++;
    }

    const segment = code.substring(startIndex, index);

    for (const keyword of KEYWORDS) {
        if (segment === keyword) {
            return undefined;
        }
    }

    if (index - startIndex > 0) {
        return { segment, newIndex: index };
    }
}

function consumeComments(code: string, index: number): number {
    if (code[0] === "/") {
        if (code[1] === "/") {
            return consumeWhile(code, index, ch => ch !== "\n");
        } else if (code[1] === "*") {
            // TODO
        }
    }

    return index;
}