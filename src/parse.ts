import { ArrayLiteral, AST, BinaryOp, BinaryOperator, BooleanLiteral, ConstDeclaration, Declaration, Expression, Func, Funcall, FuncDeclaration, Identifier, IfElseExpression, NilLiteral, NumberLiteral, ObjectLiteral, Pipe, Proc, ProcDeclaration, Range, Statement, StringLiteral } from "./ast";
import { consume, consumeWhitespace, consumeWhile, isNumeric, isSymbolic, consumeBinaryOp, isAlpha, ParseResult, parseSeries } from "./parsing-utils";
import { given, log } from "./utils";

export function parse(code: string): AST[] {
    let index = 0;

    const results: AST[] = [];
    for (let result = ast(code, index); result != null; result = ast(code, index)) {
        results.push(result.parsed);
        index = result.newIndex;
    }

    return results;
}

function ast(code: string, index: number): ParseResult<AST> | undefined {
    index = consumeWhitespace(code, index);
    return declaration(code, index)
        ?? expression(code, index);
}

function declaration(code: string, index: number): ParseResult<Declaration> | undefined {
    return procDeclaration(code, index)
        ?? funcDeclaration(code, index)
        ?? constDeclaration(code, index);
}

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
                                },
                                newIndex: index,
                            }))))))))

function expression(code: string, index: number): ParseResult<Expression> | undefined {
    index = consumeWhitespace(code, index);
    return proc(code, index)
        ?? func(code, index)
        ?? pipe(code, index)
        ?? binaryOperator(code, index)
        ?? unary(code, index);
}

function unary(code: string, index: number): ParseResult<Expression> | undefined {
    return funcall(code, index)
        ?? ifElseExpression(code, index)
        ?? range(code, index)
        ?? identifier(code, index)
        ?? objectLiteral(code, index)
        ?? arrayLiteral(code, index)
        ?? stringLiteral(code, index) 
        ?? numberLiteral(code, index)
        ?? booleanLiteral(code, index)
        ?? nilLiteral(code, index);
}

function proc(code: string, index: number): ParseResult<Proc> | undefined {
    const indexAfterIdentifier = consumeWhile(code, index, isSymbolic);
    const name = indexAfterIdentifier > index 
        ? code.substring(index, indexAfterIdentifier) 
        : undefined;

    return given(consume(code, indexAfterIdentifier, "("), index =>
        given(parseSeries(code, index, identifier, ","), ({ items: args, newIndex: index }) =>
            given(consume(code, index, ")"), index =>
                given(consumeWhitespace(code, index), index =>
                    given(consume(code, index, "{"), index =>
                        given(parseSeries(code, index, statement), ({ items: body, newIndex: index }) => 
                            given(consume(code, index, "}"), index =>({
                                parsed: {
                                    kind: "proc",
                                    name,
                                    args: args.map(a => ({ name: a })),
                                    body,
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
        given(parseSeries(code, index, identifier, ","), ({ items: args, newIndex: index }) =>
            given(consume(code, index, ")"), index =>
                given(consumeWhitespace(code, index), index =>
                    given(consume(code, index, "=>"), index =>
                        given(expression(code, index), ({ parsed: body, newIndex: index }) => ({
                            parsed: {
                                kind: "func",
                                name,
                                args: args.map(a => ({ name: a })),
                                body,
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
        given(parseSeries(code, index, _entry, ","), ({ items: entries, newIndex: index }) =>
            given(consume(code, index, "}"), index => ({
                parsed: {
                    kind: "object-literal",
                    entries: Object.fromEntries(entries)
                },
                newIndex: index,
            }))))

const _entry = (code: string, index: number): ParseResult<[Identifier, Expression]> | undefined =>
    given(identifier(code, index), ({ parsed: key, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
            given(consume(code, index, ":"), index => 
                given(consumeWhitespace(code, index), index =>
                    given(expression(code, index), ({ parsed: value, newIndex: index }) => ({
                        parsed: [key, value],
                        newIndex: index,
                    }))))))

const arrayLiteral = (code: string, index: number): ParseResult<ArrayLiteral> | undefined =>
    given(consume(code, index, "{"), index =>
        given(parseSeries(code, index, expression, ","), ({ items: entries, newIndex: index }) =>
            given(consume(code, index, "}"), index => ({
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

    while (isAlpha(code[index])) {
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