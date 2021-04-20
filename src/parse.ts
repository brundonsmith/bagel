import { ArrayLiteral, ArrayType, Assignment, AST, BinaryOp, BinaryOperator, BooleanLiteral, ConstDeclaration, Declaration, Expression, ForLoop, Func, Funcall, FuncDeclaration, LocalIdentifier, IfElseExpression, IfElseStatement, IndexerType, JavascriptEscape, KEYWORDS, LetDeclaration, LiteralType, NilLiteral, NominalType, NumberLiteral, ObjectLiteral, ObjectType, ParenthesizedExpression, Pipe, PrimitiveType, Proc, ProcCall, ProcDeclaration, PropertyAccessor, Range, Reaction, Statement, StringLiteral, TupleType, TypeDeclaration, TypeExpression, UnionType, UnknownType, WhileLoop, PlainIdentifier, NamedType } from "./ast";
import { given, consume, consumeWhitespace, consumeWhile, isNumeric, consumeBinaryOp, ParseResult, parseSeries, isSymbolic, parseOptional, ParseFunction } from "./parsing-utils";
import { err, expec, BagelSyntaxError, log, isError, errorMessage } from "./utils";

export function parse(code: string): Declaration[] {
    let index = 0;

    const results: Declaration[] = [];
    index = consumeWhitespace(code, index);
    let result = declaration(code, index);
    while (result != null && !(isError(result))) {
        results.push(result.parsed);
        index = result.newIndex;
        index = consumeWhitespace(code, index);

        result = declaration(code, index);
    }

    
    if (isError(result)) {
        // throw result;
        console.log("Syntax error:", errorMessage(result));
    }

    return results;
}

const declaration: ParseFunction<Declaration> = (code, index) =>
    typeDeclaration(code, index)
    ?? procDeclaration(code, index)
    ?? funcDeclaration(code, index)
    ?? constDeclaration(code, index)

const typeDeclaration: ParseFunction<TypeDeclaration> = (code, index) =>
    given(consume(code, index, "type"), index => 
    given(consumeWhitespace(code, index), index =>
    expec(plainIdentifier(code, index), err(code, index, 'Type name'), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(code, index), err(code, index, 'Type expression'), ({ parsed: type, newIndex: index }) => ({
        parsed: {
            kind: "type-declaration",
            name,
            type,
        },
        newIndex: index,
    }))))))))

const typeExpression: ParseFunction<TypeExpression> = (code, index) =>
    arrayType(code, index)
    ?? nonArrayType(code, index)

const arrayType: ParseFunction<ArrayType> = (code, index) =>
    given(nonArrayType(code, index), ({ parsed: element, newIndex: index }) =>
    given(consume(code, index, "[]"), index => ({
        parsed: {
            kind: "array-type",
            element,
        },
        newIndex: index,
    })))

// required because of the way arrayTypes are written
const nonArrayType: ParseFunction<TypeExpression> = (code, index) =>
    unionType(code, index)
    ?? atomicType(code, index)

const unionType: ParseFunction<UnionType> = (code, index) =>
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

const atomicType: ParseFunction<TypeExpression> = (code, index) =>
    primitiveType(code, index)
    ?? literalType(code, index)
    ?? namedType(code, index)
    ?? objectType(code, index)
    ?? indexerType(code, index)
    ?? tupleType(code, index)
    ?? unknownType(code, index)

const namedType: ParseFunction<NamedType> = (code, index) =>
    given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) => ({
        parsed: {
            kind: "named-type",
            name,
        },
        newIndex: index,
    }))

const objectType: ParseFunction<ObjectType> = (code, index) =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _objectTypeEntry, ","), ({ parsed: entries, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-type",
            entries,
        },
        newIndex: index,
    }))))))

const _objectTypeEntry = (code: string, index: number): ParseResult<[PlainIdentifier, TypeExpression]> | BagelSyntaxError | undefined =>
    given(plainIdentifier(code, index), ({ parsed: key, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(code, index), ({ parsed: value, newIndex: index }) => ({
        parsed: [key, value],
        newIndex: index,
    }))))))

const indexerType: ParseFunction<IndexerType> = (code, index) =>
    given(consume(code, index, "{"), index =>
    given(consume(code, index, "["), index =>
    expec(typeExpression(code, index), err(code, index, 'Type expression for key'), ({ parsed: keyType, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index =>
    given(consume(code, index, ":"), index =>
    given(typeExpression(code, index), ({ parsed: valueType, newIndex: index }) =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "indexer-type",
            keyType,
            valueType,
        },
        newIndex: index,
    }))))))))

const tupleType: ParseFunction<TupleType> = (code, index) =>
    given(consume(code, index, "["), index =>
    given(parseSeries(code, index, typeExpression, ","), ({ parsed: members, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "tuple-type",
            members,
        },
        newIndex: index,
    }))))

const primitiveType: ParseFunction<PrimitiveType> = (code, index) =>
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

const literalType: ParseFunction<LiteralType> = (code, index) =>
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

// const nominalType: ParseFunction<NominalType> = (code, index) =>
//     given(consume(code, index, "nominal"), index => 
//     given(consumeWhitespace(code, index), index =>
//     expec(typeExpression(code, index), ({ parsed: inner, newIndex: index }) => ({
//         parsed: {
//             kind: "nominal-type"
//         }
//     }))))

const unknownType: ParseFunction<UnknownType> = (code, index) =>
    given(consume(code, index, "unknown"), index => ({
        parsed: {
            kind: "unknown-type",
        },
        newIndex: index,
    }))

const procDeclaration: ParseFunction<ProcDeclaration> = (code, index) =>
    given(consume(code, index, "proc"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(proc(code, index), err(code, index, 'Procedure'), ({ parsed: proc, newIndex: index }) => ({
        parsed: {
            kind: "proc-declaration",
            proc,
        },
        newIndex: index,
    }))))

const funcDeclaration: ParseFunction<FuncDeclaration> = (code, index) =>
    given(consume(code, index, "func"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(func(code, index), err(code, index, 'Function'), ({ parsed: func, newIndex: index }) => ({
        parsed: {
            kind: "func-declaration",
            func,
        },
        newIndex: index,
    }))))

const constDeclaration: ParseFunction<ConstDeclaration> = (code, index) =>
    given(consume(code, index, "const"), index =>
    given(consumeWhitespace(code, index), index =>
    given(plainIdentifier(code, index), ({ parsed: name, newIndex: index}) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(code, index, (code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: type, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Expression'), ({ parsed: value, newIndex: index }) => ({
            parsed: {
                kind: "const-declaration",
                name,
                type: type ?? { kind: "unknown-type" },
                value,
            },
            newIndex: index,
    }))))))))))

const expression: ParseFunction<Expression> = (code, index) =>
    javascriptEscape(code, index)
    ?? pipe(code, index)
    ?? beneathPipe(code, index)

const beneathPipe: ParseFunction<Expression> = (code, index) =>
    func(code, index)
    ?? proc(code, index)
    ?? range(code, index)
    ?? binaryOperator(code, index)
    ?? beneathBinaryOperator(code, index)

const beneathBinaryOperator: ParseFunction<Expression> = (code, index) =>
    funcall(code, index)
    ?? beneathFuncall(code, index)

const beneathFuncall: ParseFunction<Expression> = (code, index) =>
    parenthesized(code, index)
    ?? propertyAccessor(code, index)
    ?? beneathPropertyAccessor(code, index)

const beneathPropertyAccessor: ParseFunction<Expression> = (code, index) =>
    localIdentifier(code, index)
    ?? primary(code, index)


// These are the ones where we should immediately know what we have
const primary: ParseFunction<Expression> = (code, index) =>
    ifElseExpression(code, index)
    ?? booleanLiteral(code, index)
    ?? nilLiteral(code, index)
    ?? objectLiteral(code, index)
    ?? arrayLiteral(code, index)
    ?? stringLiteral(code, index)
    ?? numberLiteral(code, index)
    
const proc: ParseFunction<Proc> = (code, index) =>
    given(parseOptional(code, index, plainIdentifier), ({ parsed: name, newIndex }) =>
    given(consume(code, newIndex ?? index, "("), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, statement), ({ parsed: body, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index =>({
        parsed: {
            kind: "proc",
            name,
            type: {
                kind: "proc-type",
                argTypes: args.map(arg => arg.type ?? { kind: "unknown-type" }),
            },
            argNames: args.map(arg => arg.name),
            body,
        },
        newIndex: index,
    })))))))))))

const statement: ParseFunction<Statement> = (code, index) =>
    reaction(code, index)
    ?? javascriptEscape(code, index)
    ?? letDeclaration(code, index)
    ?? ifElseStatement(code, index)
    ?? forLoop(code, index)
    ?? whileLoop(code, index)
    ?? assignment(code, index)
    ?? procCall(code, index)

const reaction: ParseFunction<Reaction> = (code, index) =>
    given(consume(code, index, "reaction"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Data function"), ({ parsed: data, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "triggers"), err(code, index, '"triggers" clause'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Side-effect procedure"), ({ parsed: effect, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
        parsed: {
            kind: "reaction",
            data,
            effect,
        },
        newIndex: index,
    }))))))))))

const letDeclaration: ParseFunction<LetDeclaration> = (code, index) =>
    given(consume(code, index, "let"), index =>
    given(consumeWhitespace(code, index), index =>
    given(localIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(code, index, (code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: type, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Expression'), ({ parsed: value, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
            parsed: {
                kind: "let-declaration",
                name,
                value,
                type: type ?? { kind: "unknown-type" },
            },
            newIndex: index,
        }))))))))))))

const assignment: ParseFunction<Assignment> = (code, index) =>
    given(localIdentifier(code, index) ?? propertyAccessor(code, index), ({ parsed: target, newIndex: index }) =>
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

const procCall: ParseFunction<ProcCall> = (code, index) =>
    given(beneathFuncall(code, index), ({ parsed: proc, newIndex: index }) =>
    given(parseSeries(code, index, _argExpressions), ({ parsed: argLists, newIndex: index }) => 
        argLists.length > 0 ?
            expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
                // @ts-ignore
                parsed: argLists.reduce((proc: Expression, args: Expression[]) => ({
                    kind: "proc-call",
                    proc,
                    args,
                }), proc) as ProcCall,
                newIndex: index,
            }))
        : undefined))

    

const ifElseStatement: ParseFunction<IfElseStatement> = (code, index) =>
    given(consume(code, index, "if"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Condition"), ({ parsed: ifCondition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, statement), ({ parsed: ifResult, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index =>
    given(consumeWhitespace(code, index), index => {
        const elseResultResult = 
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
            given(parseSeries(code, index, statement), ({ parsed, newIndex: index }) =>
            expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({ parsed, newIndex: index }))))));

        if (isError(elseResultResult)) {
            return elseResultResult
        } else if (elseResultResult == null || elseResultResult.parsed.length === 0) {
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

const forLoop: ParseFunction<ForLoop> = (code, index) =>
    given(consume(code, index, "for"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(plainIdentifier(code, index), err(code, index, 'Item identifier for loop items'), ({ parsed: itemIdentifier, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "of"), err(code, index, '"of"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Iterator expression'), ({ parsed: iterator, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(parseSeries(code, index, statement), ({ parsed: body, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "for-loop",
            itemIdentifier,
            iterator,
            body,
        },
        newIndex: index,
    })))))))))))))))))

const whileLoop: ParseFunction<WhileLoop> = (code, index) =>
    given(consume(code, index, "while"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'While loop condition'), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(parseSeries(code, index, statement), ({ parsed: body, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "while-loop",
            condition,
            body,
        },
        newIndex: index,
    })))))))))))))

const func: ParseFunction<Func> = (code, index) =>
    given(parseOptional(code, index, plainIdentifier), ({ parsed: name, newIndex }) =>
    given(consume(code, newIndex ?? index, "("), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(code, index, (code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: returnType, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    given(consume(code, index, "=>"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Function body'), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "func",
            name,
            type: {
                kind: "func-type",
                argTypes: args.map(arg => arg.type ?? { kind: "unknown-type" }),
                returnType: returnType ?? { kind: "unknown-type" },
            },
            argNames: args.map(arg => arg.name),
            body,
        },
        newIndex: index,
    })))))))))))

const _argumentDeclaration = (code: string, index: number): ParseResult<{ name: PlainIdentifier, type?: TypeExpression }> | BagelSyntaxError | undefined => 
    given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
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

const pipe: ParseFunction<Pipe> = (code, index) => 
    given(parseSeries(code, index, beneathPipe, "|>", { trailingDelimiter: "forbidden" }), ({ parsed: expressions, newIndex: index }) =>
        expressions.length >= 2
            ? {
                parsed: {
                    kind: "pipe",
                    expressions,
                },
                newIndex: index,
            }
            : undefined)

const binaryOperator: ParseFunction<BinaryOperator> = (code, index) => 
    given(beneathBinaryOperator(code, index), ({ parsed: left, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    given(consumeBinaryOp(code, index), endOfOpIndex =>
    given(code.substring(index, endOfOpIndex) as BinaryOp, operator =>
    given(consumeWhitespace(code, endOfOpIndex), index =>
    expec(expression(code, index), err(code, index, "Right operand"), ({ parsed: right, newIndex: index }) => ({
        parsed: {
            kind: "binary-operator",
            operator,
            left,
            right,
        },
        newIndex: index,
    })))))))
                            
const funcall: ParseFunction<Funcall> = (code, index) =>
    given(beneathFuncall(code, index), ({ parsed: func, newIndex: index }) =>
    given(parseSeries(code, index, _argExpressions), ({ parsed: argLists, newIndex: index }) => 
        argLists.length > 0 ? 
            {
                // @ts-ignore
                parsed: argLists.reduce((func: Expression, args: Expression[]) => ({
                    kind: "funcall",
                    func,
                    args,
                }), func) as Funcall,
                newIndex: index,
            }
        : undefined))

const _argExpressions: ParseFunction<Expression[]> = (code, index) =>
    given(consume(code, index, "("), index => 
    given(parseSeries(code, index, expression, ","), ({ parsed: args, newIndex: index }) =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: args,
        newIndex: index
    }))))
                
const ifElseExpression: ParseFunction<IfElseExpression> = (code, index) =>
    given(consume(code, index, "if"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Condition"), ({ parsed: ifCondition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Result expression for if clause'), ({ parsed: ifResult, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index =>
    given(consumeWhitespace(code, index), index => {
        const elseResultResult = 
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
            given(consumeWhitespace(code, index), index =>
            expec(expression(code, index), err(code, index, 'Result expression for else clause'), ({ parsed, newIndex: index }) =>
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({ parsed, newIndex: index }))))))));

        
        if (isError(elseResultResult)) {
            return elseResultResult
        } else if (elseResultResult == null) {
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

const range: ParseFunction<Range> = (code, index) =>
    given(numberLiteral(code, index), ({ parsed: firstNumber, newIndex: index }) =>
    given(consume(code, index, ".."), index =>
    expec(numberLiteral(code, index), err(code, index, 'Range end'), ({ parsed: secondNumber, newIndex: index }) => ({
        parsed: {
            kind: "range",
            start: firstNumber.value,
            end: secondNumber.value,
        },
        newIndex: index,
    }))));

const parenthesized: ParseFunction<ParenthesizedExpression> = (code, index) =>
    given(consume(code, index, "("), index =>
    given(expression(code, index), ({ parsed: inner, newIndex: index }) =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "parenthesized-expression",
            inner,
        },
        newIndex: index,
    }))))

const propertyAccessor: ParseFunction<PropertyAccessor> = (code, index) =>
    given(beneathPropertyAccessor(code, index), ({ parsed: base, newIndex: index }) =>
    given(parseSeries(code, index, plainIdentifier, ".", { leadingDelimiter: "required", trailingDelimiter: "forbidden", whitespace: "forbidden" }), ({ parsed: properties, newIndex: index }) => 
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

const localIdentifier: ParseFunction<LocalIdentifier> = (code, index) => 
    given(identifierSegment(code, index), ({ segment: name, newIndex: index }) => ({
        parsed: { kind: "local-identifier", name },
        newIndex: index,
    }))

const plainIdentifier: ParseFunction<PlainIdentifier> = (code, index) => 
    given(identifierSegment(code, index), ({ segment: name, newIndex: index }) => ({
        parsed: { kind: "plain-identifier", name },
        newIndex: index,
    }))

const objectLiteral: ParseFunction<ObjectLiteral> = (code, index) =>
    given(consume(code, index, "{"), index =>
    given(parseSeries(code, index, _objectEntry, ","), ({ parsed: entries, newIndex: index }) =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-literal",
            entries,
        },
        newIndex: index,
    }))))

const _objectEntry = (code: string, index: number): ParseResult<[PlainIdentifier, Expression]> | BagelSyntaxError | undefined =>
    given(plainIdentifier(code, index), ({ parsed: key, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(expression(code, index), ({ parsed: value, newIndex: index }) => ({
        parsed: [key, value],
        newIndex: index,
    }))))))

const arrayLiteral: ParseFunction<ArrayLiteral> = (code, index) =>
    given(consume(code, index, "["), index =>
    given(parseSeries(code, index, expression, ","), ({ parsed: entries, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "array-literal",
            entries,
        },
        newIndex: index,
    }))))

const stringLiteral: ParseFunction<StringLiteral> = (code, index) => {
    const segments: (string|Expression)[] = [];

    if (code[index] === "'") {
        index++;
        let currentSegmentStart = index;

        while (code[index] !== "'") {
            if (code[index] === "$" && code[index+1] === "{") {
                if (index - currentSegmentStart > 0) {
                    segments.push(code.substring(currentSegmentStart, index));
                }
                index += 2;

                const expressionResult = expression(code, index);
                if (isError(expressionResult)) {
                    return expressionResult;
                } else if (expressionResult == null) {
                    return err(code, index, "Expression");
                } else {
                    segments.push(expressionResult.parsed);
                    index = expressionResult.newIndex;

                    const closeBraceResult = consume(code, index, "}");
                    if (closeBraceResult == null) {
                        return err(code, index, '"}"');
                    } else {
                        index = closeBraceResult;
                        currentSegmentStart = index;
                    }
                }
            } else {
                index++;
            }
        }

        segments.push(code.substring(currentSegmentStart, index));

        return {
            parsed: { kind: "string-literal", segments },
            newIndex: index + 1,
        }
    }
}

const numberLiteral: ParseFunction<NumberLiteral> = (code, index) => {
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

const booleanLiteral: ParseFunction<BooleanLiteral> = (code, index) => {

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

const nilLiteral: ParseFunction<NilLiteral> = (code, index) => {
    const indexAfter = consume(code, index, "nil");
    if (indexAfter != null) {
        return {
            parsed: { kind: "nil-literal" },
            newIndex: indexAfter,
        }
    }
}

const javascriptEscape: ParseFunction<JavascriptEscape> = (code, index) =>
    given(consume(code, index, "js#"), jsStartIndex =>
    given(consumeWhile(code, jsStartIndex, ch => ch !== "#"), jsEndIndex =>
    expec(consume(code, jsEndIndex, "#"), err(code, index, '"#"'), index => ({
        parsed: {
            kind: "javascript-escape",
            js: code.substring(jsStartIndex, jsEndIndex),
        },
        newIndex: index,
    }))))

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