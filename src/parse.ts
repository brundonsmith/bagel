import { ArrayLiteral, ArrayType, AST, BinaryOp, BinaryOperator, BooleanLiteral, ConstDeclaration, Declaration, Expression, Func, Funcall, FuncDeclaration, Identifier, IfElseExpression, IndexerType, LiteralType, NamedType, NilLiteral, NumberLiteral, ObjectLiteral, ObjectType, ParenthesizedExpression, Pipe, PrimitiveType, Proc, ProcDeclaration, Range, Statement, StringLiteral, TupleType, TypeDeclaration, TypeExpression, UnionType, UnknownType } from "./ast";
import { consume, consumeWhitespace, consumeWhile, isNumeric, isSymbol, consumeBinaryOp, isAlpha, ParseResult, parseSeries, isSymbolic } from "./parsing-utils";
import { given, log } from "./utils";

export function parse(code: string): AST[] {
    let index = 0;

    const results: AST[] = [];
    index = consumeWhitespace(code, index);
    for (let result = ast(code, index); result != null; result = ast(code, index)) {
        results.push(result.parsed);
        index = result.newIndex;
        index = consumeWhitespace(code, index);
    }

    return results;
}

function ast(code: string, index: number): ParseResult<AST> | undefined {
    index = consumeWhitespace(code, index);
    return declaration(code, index)
        ?? expression(code, index);
}

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
    given(parseSeries(code, index, atomicType, "|", true), ({ items: members, newIndex: index }) =>
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
            given(parseSeries(code, index, _objectTypeEntry, ","), ({ items: entries, newIndex: index }) =>
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
        given(parseSeries(code, index, typeExpression, ","), ({ items: members, newIndex: index }) =>
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
                    given(consume(code, index, "="), index =>
                        given(consumeWhitespace(code, index), index =>
                            given(expression(code, index), ({ parsed: value, newIndex: index }) => ({
                                parsed: {
                                    kind: "const-declaration",
                                    name,
                                    value,
                                    type: { kind: "unknown-type" }, // TODO: Parse for this
                                },
                                newIndex: index,
                            }))))))))

const expression = (code: string, index: number): ParseResult<Expression> | undefined =>
    proc(code, index)
    ?? func(code, index)
    ?? pipe(code, index)
    ?? binaryOperator(code, index)
    ?? unary(code, index)

const unary = (code: string, index: number): ParseResult<Expression> | undefined =>
    funcall(code, index)
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

function proc(code: string, index: number): ParseResult<Proc> | undefined {
    const indexAfterIdentifier = consumeWhile(code, index, isSymbolic);
    const name = indexAfterIdentifier > index 
        ? code.substring(index, indexAfterIdentifier) 
        : undefined;

    return given(consume(code, indexAfterIdentifier, "("), index =>
        given(parseSeries(code, index, identifier, ","), ({ items: argNames, newIndex: index }) =>
            given(consume(code, index, ")"), index =>
                given(consumeWhitespace(code, index), index =>
                    given(consume(code, index, "{"), index =>
                        given(parseSeries(code, index, statement), ({ items: body, newIndex: index }) => 
                            given(consume(code, index, "}"), index =>({
                                parsed: {
                                    kind: "proc",
                                    name,
                                    argNames,
                                    body,
                                    type: { kind: "unknown-type" }, // TODO: Parse for this
                                },
                                newIndex: index,
                            }))))))))
}

function statement(code: string, index: number): ParseResult<Statement> | undefined {
    return undefined;
}

function func(code: string, index: number): ParseResult<Func> | undefined {
    const indexAfterIdentifier = consumeWhile(code, index, isSymbolic);
    const name = indexAfterIdentifier > index 
        ? code.substring(index, indexAfterIdentifier) 
        : undefined;

    return given(consume(code, indexAfterIdentifier, "("), index =>
        given(parseSeries(code, index, identifier, ","), ({ items: argNames, newIndex: index }) =>
            given(consume(code, index, ")"), index =>
                given(consumeWhitespace(code, index), index =>
                    given(consume(code, index, "=>"), index =>
                        given(expression(code, index), ({ parsed: body, newIndex: index }) => ({
                            parsed: {
                                kind: "func",
                                name,
                                argNames,
                                body,
                                type: { kind: "unknown-type" }, // TODO: Parse for this
                            },
                            newIndex: index,
                        })))))))
}

const pipe = (code: string, index: number): ParseResult<Pipe> | undefined => 
    given(parseSeries(code, index, unary, "|>", true), ({ items: expressions, newIndex: index }) =>
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
    given(unary(code, index), ({ parsed: left, newIndex: index }) => 
        given(consumeWhitespace(code, index), index =>
            given(consumeBinaryOp(code, index), endOfOpIndex =>
            given(code.substring(index, endOfOpIndex) as BinaryOp, operator =>
            given(consumeWhitespace(code, endOfOpIndex), index =>
                given(expression(code, index), ({ parsed: right, newIndex: index }) => ({
                    parsed: {
                        kind: "binary-operator",
                        left,
                        right,
                        operator,
                    },
                    newIndex: index,
                })))))))
                            
const funcall = (code: string, index: number): ParseResult<Funcall> | undefined =>
    given(identifier(code, index), ({ parsed: func, newIndex: index }) =>
        given(consume(code, index, "("), index => 
            given(parseSeries(code, index, expression, ","), ({ items: args, newIndex: index }) =>
                given(consume(code, index, ")"), index => ({
                    parsed: {
                        kind: "funcall",
                        func,
                        args,
                    },
                    newIndex: index,
                })))))
                
const ifElseExpression = (code: string, index: number): ParseResult<IfElseExpression> | undefined =>
    given(consume(code, index, "if("), index =>
        given(expression(code, index), ({ parsed: ifCondition, newIndex: index }) =>
            given(consume(code, index, ")"), index =>
                given(expression(code, index), ({ parsed: ifResult, newIndex: index }) => {
                    const elseResult = given(consume(code, index, "else"), index => expression(code, index));

                    if (elseResult == null) {
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
                                elseResult: elseResult.parsed,
                            },
                            newIndex: elseResult.newIndex,
                        }
                    }
                }))))

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
        given(parseSeries(code, index, _objectEntry, ","), ({ items: entries, newIndex: index }) =>
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
        given(parseSeries(code, index, expression, ","), ({ items: entries, newIndex: index }) =>
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

    while (isSymbolic(code[index], index)) {
        index++;
    }

    if (index - startIndex > 0) {
        return { segment: code.substring(startIndex, index), newIndex: index };
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