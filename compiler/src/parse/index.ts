import { Module } from "../model/ast";
import { Block, PlainIdentifier } from "../model/common";
import { ConstDeclaration, Declaration, FuncDeclaration, ImportDeclaration, ProcDeclaration, TypeDeclaration } from "../model/declarations";
import { ArrayLiteral, BinaryOperator, BooleanLiteral, ElementTag, Expression, Func, Funcall, IfElseExpression, Indexer, JavascriptEscape, LocalIdentifier, NilLiteral, NumberLiteral, ObjectLiteral, ParenthesizedExpression, Pipe, Proc, PropertyAccessor, Range, StringLiteral } from "../model/expressions";
import { Assignment, ForLoop, IfElseStatement, LetDeclaration, ProcCall, Reaction, Statement, WhileLoop } from "../model/statements";
import { ArrayType, BOOLEAN_TYPE, FuncType, IndexerType, LiteralType, NamedType, NIL_TYPE, NUMBER_TYPE, ObjectType, PrimitiveType, STRING_TYPE, TupleType, TypeExpression, UnionType, UnknownType, UNKNOWN_TYPE } from "../model/type-expressions";
import { BagelSyntaxError, consume, consumeWhile, consumeWhitespace, err, errorMessage, expec, given, identifierSegment, isError, isNumeric, parseBinaryOp, ParseFunction, parseOptional, ParseResult, parseSeries, plainIdentifier } from "./common";

export function parse(code: string): Module {
    let index = 0;

    const declarations: Declaration[] = [];
    index = consumeWhitespace(code, index);
    let result = declaration(code, index);
    while (result != null && !(isError(result))) {
        declarations.push(result.parsed);
        index = result.newIndex;
        index = consumeWhitespace(code, index);

        result = declaration(code, index);
    }

    
    if (isError(result)) {
        // throw result;
        console.log("Syntax error:", errorMessage(result));
    }

    memo.delete(code);

    return {
        kind: "module",
        code,
        startIndex: 0,
        endIndex: index,
        declarations
    };
}

const declaration: ParseFunction<Declaration> = (code, index) =>
    importDeclaration(code, index)
    ?? typeDeclaration(code, index)
    ?? procDeclaration(code, index)
    ?? funcDeclaration(code, index)
    ?? constDeclaration(code, index)

const importDeclaration: ParseFunction<ImportDeclaration> = (code, startIndex) =>
    given(consume(code, startIndex, "from"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(stringLiteral(code, index), err(code, index, 'Import path'), ({ parsed: path, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "import"), err(code, index, '"import"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(parseSeries(code, index, plainIdentifier, ","), ({ parsed: imports, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "import-declaration",
            code,
            startIndex,
            endIndex: index,
            imports: imports.map(name => ({ name })),
            path,
        },
        newIndex: index
    })))))))))))

const typeDeclaration: ParseFunction<TypeDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespace(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? startIndex, "type"), index => 
        given(consumeWhitespace(code, index), index =>
        expec(plainIdentifier(code, index), err(code, index, 'Type name'), ({ parsed: name, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
        expec(consume(code, index, "="), err(code, index, '"="'), index =>
        given(consumeWhitespace(code, index), index =>
        expec(typeExpression(code, index), err(code, index, 'Type expression'), ({ parsed: type, newIndex: index }) => ({
            parsed: {
                kind: "type-declaration",
                code,
                startIndex,
                endIndex: index,
                name,
                type,
                exported,
            },
            newIndex: index,
        }))))))))
}

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
    ?? funcType(code, index)
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
        parsed: STRING_TYPE,
        newIndex: index,
    }))
    ?? given(consume(code, index, "number"), index => ({
        parsed: NUMBER_TYPE,
        newIndex: index,
    }))
    ?? given(consume(code, index, "boolean"), index => ({
        parsed: BOOLEAN_TYPE,
        newIndex: index,
    }))
    ?? given(consume(code, index, "nil"), index => ({
        parsed: NIL_TYPE,
        newIndex: index,
    }))

const funcType: ParseFunction<FuncType> = (code, index) =>
    given(consume(code, index, "("), index  =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, typeExpression, ","), ({ parsed: argTypes, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "=>"), err(code, index, '"=>"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(code, index), err(code, index, 'Return type'), ({ parsed: returnType, newIndex: index }) => ({
        parsed: {
            kind: "func-type",
            argTypes,
            returnType,
            typeParams: [],

        },
        newIndex: index
    }))))))))))

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

const unknownType: ParseFunction<UnknownType> = (code, startIndex) =>
    given(consume(code, startIndex, "unknown"), index => ({
        parsed: {
            kind: "unknown-type",
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const procDeclaration: ParseFunction<ProcDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespace(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? startIndex, "proc"), index =>
        given(consumeWhitespace(code, index), index =>
        given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
        expec(proc(code, index), err(code, index, 'Procedure'), ({ parsed: proc, newIndex: index }) => ({
            parsed: {
                kind: "proc-declaration",
                name,
                code,
                startIndex,
                endIndex: index,
                proc,
                exported,
            },
            newIndex: index,
        }))))))
}

const funcDeclaration: ParseFunction<FuncDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespace(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? startIndex, "func"), index =>
        given(consumeWhitespace(code, index), index =>
        given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
        expec(func(code, index), err(code, index, 'Function'), ({ parsed: func, newIndex: index }) => ({
            parsed: {
                kind: "func-declaration",
                name,
                code,
                startIndex,
                endIndex: index,
                func,
                exported,
            },
            newIndex: index,
        }))))))
}

const constDeclaration: ParseFunction<ConstDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespace(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? startIndex, "const"), index =>
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
                    code,
                    startIndex,
                    endIndex: index,
                    name,
                    type: type ?? UNKNOWN_TYPE,
                    value,
                    exported,
                },
                newIndex: index,
        }))))))))))
}

const proc: ParseFunction<Proc> = (code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlock(code, index), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "proc",
            code,
            startIndex,
            endIndex: index,
            type: {
                kind: "proc-type",
                argTypes: args.map(arg => arg.type ?? UNKNOWN_TYPE),
            },
            argNames: args.map(arg => arg.name),
            body,
        },
        newIndex: index,
    }))))))

const statement: ParseFunction<Statement> = (code, startIndex) =>
    reaction(code, startIndex)
    ?? javascriptEscape(code, startIndex)
    ?? letDeclaration(code, startIndex)
    ?? ifElseStatement(code, startIndex)
    ?? forLoop(code, startIndex)
    ?? whileLoop(code, startIndex)
    ?? assignment(code, startIndex)
    ?? procCall(code, startIndex)

const reaction: ParseFunction<Reaction> = (code, startIndex) =>
    given(consume(code, startIndex, "reaction"), index =>
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
            code,
            startIndex,
            endIndex: index,
            data,
            effect,
        },
        newIndex: index,
    }))))))))))

const letDeclaration: ParseFunction<LetDeclaration> = (code, startIndex) =>
    given(consume(code, startIndex, "let"), index =>
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
                code,
                startIndex,
                endIndex: index,
                name,
                value,
                type: type ?? UNKNOWN_TYPE,
            },
            newIndex: index,
        }))))))))))))

const assignment: ParseFunction<Assignment> = (code, startIndex) =>
    given(localIdentifier(code, startIndex) ?? propertyAccessor(code, startIndex), ({ parsed: target, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "="), index =>
    given(consumeWhitespace(code, index), index =>
    given(expression(code, index), ({ parsed: value, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ";"), index => ({
        parsed: {
            kind: "assignment",
            code,
            startIndex,
            endIndex: index,
            target,
            value,
        },
        newIndex: index,
    }))))))))

const procCall: ParseFunction<ProcCall> = (code, startIndex) =>
    given(parseBeneath(code, startIndex, funcall), ({ parsed: proc, newIndex: index }) =>
    given(parseSeries(code, index, _argExpressions), ({ parsed: argLists, newIndex: index }) => 
        argLists.length > 0 ?
            expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
                // @ts-ignore
                parsed: argLists.reduce((proc: Expression, args: Expression[]) => ({
                    kind: "proc-call",
                    code,
                    startIndex,
                    endIndex: index,
                    proc,
                    args,
                }), proc) as ProcCall,
                newIndex: index,
            }))
        : undefined))

    

const ifElseStatement: ParseFunction<IfElseStatement> = (code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Condition"), ({ parsed: ifCondition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(code, index), err(code, index, 'If block'), ({ parsed: ifResult, newIndex: index }) => 
    given(consumeWhitespace(code, index), index => {
        const elseResultResult = 
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(parseBlock(code, index), err(code, index, 'Else block'), result => result)));

        if (isError(elseResultResult)) {
            return elseResultResult
        } else if (elseResultResult == null) {
            return {
                parsed: {
                    kind: "if-else-statement",
                    code,
                    startIndex,
                    endIndex: index,
                    ifCondition,
                    ifResult,
                },
                newIndex: index,
            }
        } else {
            return  {
                parsed: {
                    kind: "if-else-statement",
                    code,
                    startIndex,
                    endIndex: index,
                    ifCondition,
                    ifResult,
                    elseResult: elseResultResult.parsed,
                },
                newIndex: elseResultResult.newIndex,
            }
        }
    }))))))))))

const forLoop: ParseFunction<ForLoop> = (code, startIndex) =>
    given(consume(code, startIndex, "for"), index =>
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
    expec(parseBlock(code, index), err(code, index, 'Loop body'), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "for-loop",
            code,
            startIndex,
            endIndex: index,
            itemIdentifier,
            iterator,
            body,
        },
        newIndex: index,
    }))))))))))))))

const whileLoop: ParseFunction<WhileLoop> = (code, startIndex) =>
    given(consume(code, startIndex, "while"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'While loop condition'), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(code, index), err(code, index, 'Loop body'), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "while-loop",
            code,
            startIndex,
            endIndex: index,
            condition,
            body,
        },
        newIndex: index,
    }))))))))))

const parseBlock: ParseFunction<Block> = (code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(parseSeries(code, index, statement), ({ parsed: statements, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "block",
            code,
            startIndex,
            endIndex: index,
            statements,
        },
        newIndex: index,
    })))))


const expressionPrecedenceTiers: () => ParseFunction<Expression>[][] = () => [
    [ javascriptEscape, pipe ],
    [ func, proc, range, binaryOperator ],
    [ funcall ],
    [ indexer ],
    [ parenthesized, propertyAccessor ],
    [ localIdentifier ],
    [ ifElseExpression, booleanLiteral, nilLiteral, objectLiteral, arrayLiteral, 
        stringLiteral, numberLiteral ],
];

class ParseMemo {
    private memo = new Map<string, Map<ParseFunction<Expression>, Map<number, ParseResult<Expression>>>>();

    memoize(fn: ParseFunction<Expression>, code: string, index: number, result: ParseResult<Expression>|BagelSyntaxError|undefined) {
        if (result != null && !isError(result)) {
            if (!this.memo.has(code)) {
                this.memo.set(code, new Map());
            }
            if (!this.memo.get(code)?.has(fn)) {
                this.memo.get(code)?.set(fn, new Map());
            }
            
            this.memo.get(code)?.get(fn)?.set(index, result);
        }
    }

    get(fn: ParseFunction<Expression>, code: string, index: number) {
        return this.memo.get(code)?.get(fn)?.get(index);
    }

    delete(code: string) {
        this.memo.delete(code);
    }

    cachedOrParse<T extends Expression>(fn: ParseFunction<T>): ParseFunction<T> {
        return (code: string, index: number): ParseResult<T>|BagelSyntaxError|undefined => {
            const cached = this.get(fn, code, index);

            if (cached != null) {
                return cached as ParseResult<T>;
            } else {
                const result = fn(code, index);
                this.memoize(fn, code, index, result);
                return result;
            }
        }
    }
}
const memo = new ParseMemo();

const expression: ParseFunction<Expression> = 
    memo.cachedOrParse((code, index) => parseStartingFromTier(0)(code, index))

const func: ParseFunction<Func> = (code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
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
            code,
            startIndex,
            endIndex: index,
            type: {
                kind: "func-type",
                argTypes: args.map(arg => arg.type ?? UNKNOWN_TYPE),
                returnType: returnType ?? UNKNOWN_TYPE,
                typeParams: [],
            },
            argNames: args.map(arg => arg.name),
            body,
        },
        newIndex: index,
    }))))))))))

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

const pipe: ParseFunction<Pipe> = (code, startIndex) => 
    given(parseSeries(code, startIndex, parseStartingFromTier(NEXT_TIER.get(pipe)), "|>", { trailingDelimiter: "forbidden" }), ({ parsed: expressions, newIndex: index }) =>
        expressions.length >= 2
            ? {
                parsed: {
                    kind: "pipe",
                    code,
                    startIndex,
                    endIndex: index,
                    expressions,
                },
                newIndex: index,
            }
            : undefined)

const binaryOperator: ParseFunction<BinaryOperator> = (code, startIndex) => 
    given(parseBeneath(code, startIndex, binaryOperator), ({ parsed: left, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    given(parseBinaryOp(code, index), ({ parsed: operator, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Right operand"), ({ parsed: right, newIndex: index }) => ({
        parsed: {
            kind: "binary-operator",
            code,
            startIndex,
            endIndex: index,
            operator,
            left,
            right,
        },
        newIndex: index,
    }))))))

const funcall: ParseFunction<Funcall> = (code, startIndex) =>
    given(parseBeneath(code, startIndex, funcall), ({ parsed: func, newIndex: index }) =>
    given(parseSeries(code, index, _argExpressions), ({ parsed: argLists, newIndex: index }) => 
        argLists.length > 0 ? 
            {
                // @ts-ignore
                parsed: argLists.reduce((func: Expression, args: Expression[]) => ({
                    kind: "funcall",
                    code,
                    startIndex,
                    endIndex: index,
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

const indexer: ParseFunction<Indexer> = (code, startIndex) =>
    given(parseBeneath(code, startIndex, indexer), ({ parsed: base, newIndex: index }) =>
    given(parseSeries(code, index, _indexerExpression), ({ parsed: indexers, newIndex: index }) => 
        indexers.length > 0 ? 
            {
                parsed: indexers.reduce((base: Expression, indexer: Expression) => ({
                    kind: "indexer",
                    code,
                    startIndex,
                    endIndex: index,
                    base,
                    indexer,
                }), base) as Indexer,
                newIndex: index,
            }
        : undefined))

const _indexerExpression: ParseFunction<Expression> = (code, index) =>
    given(consume(code, index, "["), index => 
    expec(expression(code, index), err(code, index, 'Indexer expression'),({ parsed: indexer, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: indexer,
        newIndex: index
    }))))

const ifElseExpression: ParseFunction<IfElseExpression> = (code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
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
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => {
        const elseResultResult = 
            given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
            given(consumeWhitespace(code, index), index =>
            expec(expression(code, index), err(code, index, 'Result expression for else clause'), ({ parsed, newIndex: index }) =>
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({ parsed, newIndex: index })))))))));

        if (isError(elseResultResult)) {
            return elseResultResult;
        } else if (elseResultResult == null) {
            return {
                parsed: {
                    kind: "if-else-expression",
                    code,
                    startIndex,
                    endIndex: index,
                    ifCondition,
                    ifResult,
                },
                newIndex: index,
            }
        } else {
            return  {
                parsed: {
                    kind: "if-else-expression",
                    code,
                    startIndex,
                    endIndex: index,
                    ifCondition,
                    ifResult,
                    elseResult: elseResultResult.parsed,
                },
                newIndex: elseResultResult.newIndex,
            }
        }
    })))))))))))))

const range: ParseFunction<Range> = (code, startIndex) =>
    given(numberLiteral(code, startIndex), ({ parsed: firstNumber, newIndex: index }) =>
    given(consume(code, index, ".."), index =>
    expec(numberLiteral(code, index), err(code, index, 'Range end'), ({ parsed: secondNumber, newIndex: index }) => ({
        parsed: {
            kind: "range",
            code,
            startIndex,
            endIndex: index,
            start: firstNumber.value,
            end: secondNumber.value,
        },
        newIndex: index,
    }))));

const parenthesized: ParseFunction<ParenthesizedExpression> = (code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(expression(code, index), ({ parsed: inner, newIndex: index }) =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "parenthesized-expression",
            code,
            startIndex,
            endIndex: index,
            inner,
        },
        newIndex: index,
    }))))

const propertyAccessor: ParseFunction<PropertyAccessor> = (code, startIndex) =>
    given(parseBeneath(code, startIndex, propertyAccessor), ({ parsed: base, newIndex: index }) =>
    given(parseSeries(code, index, plainIdentifier, ".", { leadingDelimiter: "required", trailingDelimiter: "forbidden" }), ({ parsed: properties, newIndex: index }) => 
        properties.length > 0
            ? {
                parsed: {
                    kind: "property-accessor",
                    code,
                    startIndex,
                    endIndex: index,
                    base,
                    properties,
                },
                newIndex: index
            }
            : undefined))

const localIdentifier: ParseFunction<LocalIdentifier> = (code, startIndex) => 
    given(identifierSegment(code, startIndex), ({ segment: name, newIndex: index }) => ({
        parsed: {
            kind: "local-identifier",
            code,
            startIndex,
            endIndex: index,
            name,
        },
        newIndex: index,
    }))

// TODO: Support /> closing
export const elementTag: ParseFunction<ElementTag> = (code, startIndex) =>
    given(consume(code, startIndex, "<"), index =>
    given(plainIdentifier(code, index), ({ parsed: tagName, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _tagAttribute), ({ parsed: attributes, newIndex: index }) =>
    expec(consume(code, index, ">"), err(code, index, '">"'), index => 
    given(parseSeries(code, index, (code, index) => elementTag(code, index) ?? _elementEmbeddedExpression(code, index)), ({ parsed: children, newIndex: index }) =>
    expec(consume(code, index, "</"), err(code, index, 'Closing tag'), index => 
    expec(plainIdentifier(code, index), err(code, index, "Closing tag name"), ({ parsed: closingTagName, newIndex: index }) =>
    // TODO: Check that closing tag matches opening tag
    expec(consume(code, index, ">"), err(code, index, '">"'), index => ({
        parsed: {
            kind: "element-tag",
            code,
            startIndex,
            endIndex: index,
            tagName,
            attributes,
            children,
        },
        newIndex: index,
    }))))))))))

const _tagAttribute: ParseFunction<[PlainIdentifier, Expression]> = (code, index) =>
    given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
    given(consume(code, index, "="), index =>
    expec(_elementEmbeddedExpression(code, index), err(code, index, "Expression"), ({ parsed: expression, newIndex: index }) => ({
        parsed: [ name, expression ],
        newIndex: index,
    }))))

const _elementEmbeddedExpression: ParseFunction<Expression> = (code, index) =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Expression"), ({ parsed: expression, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: expression,
        newIndex: index,
    }))))))

export const objectLiteral: ParseFunction<ObjectLiteral> = (code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(parseSeries(code, index, _objectEntry, ","), ({ parsed: entries, newIndex: index }) =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-literal",
            code,
            startIndex,
            endIndex: index,
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

const arrayLiteral: ParseFunction<ArrayLiteral> = (code, startIndex) =>
    given(consume(code, startIndex, "["), index =>
    given(parseSeries(code, index, expression, ","), ({ parsed: entries, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "array-literal",
            code,
            startIndex,
            endIndex: index,
            entries,
        },
        newIndex: index,
    }))))

const stringLiteral: ParseFunction<StringLiteral> = (code, startIndex) => {
    const segments: (string|Expression)[] = [];
    let index = startIndex;

    if (code[index] === "'") {
        index++;
        let currentSegmentStart = index;

        while (index < code.length && code[index] !== "'") {
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

        if (index > code.length) {
            return err(code, index, '"\'"');
        } else {
            segments.push(code.substring(currentSegmentStart, index));

            return {
                parsed: {
                    kind: "string-literal",
                    code,
                    startIndex,
                    endIndex: index,
                    segments,
                },
                newIndex: index + 1,
            }
        }
    }
}

const numberLiteral: ParseFunction<NumberLiteral> = (code, startIndex) => {
    let index = startIndex;
    if (isNumeric(code[index])) {
        const numberStart = index;

        index++;
        while (isNumeric(code[index])) {
            index++;
        }

        return {
            parsed: {
                kind: "number-literal",
                code,
                startIndex,
                endIndex: index,
                value: Number(code.substring(numberStart, index)),
            },
            newIndex: index,
        }
    }
}

const booleanLiteral: ParseFunction<BooleanLiteral> = (code, startIndex) => {

    const indexAfterTrue = consume(code, startIndex, "true");
    if (indexAfterTrue != null) {
        return {
            parsed: {
                kind: "boolean-literal",
                code,
                startIndex,
                endIndex: indexAfterTrue,
                value: true,
            },
            newIndex: indexAfterTrue,
        }
    }
    
    const indexAfterFalse = consume(code, startIndex, "false");
    if (indexAfterFalse != null) {
        return {
            parsed: {
                kind: "boolean-literal",
                code,
                startIndex,
                endIndex: indexAfterFalse,
                value: false
            },
            newIndex: indexAfterFalse,
        }
    }
}

const nilLiteral: ParseFunction<NilLiteral> = (code, startIndex) => {
    const index = consume(code, startIndex, "nil");
    if (index != null) {
        return {
            parsed: {
                kind: "nil-literal",
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
        }
    }
}

const javascriptEscape: ParseFunction<JavascriptEscape> = (code, startIndex) =>
    given(consume(code, startIndex, "js#"), jsStartIndex => {
        let jsEndIndex = jsStartIndex;

        while (code[jsEndIndex] !== "#" || code[jsEndIndex+1] !== "j" || code[jsEndIndex+2] !== "s") {
            jsEndIndex++;
        }

        return expec(consume(code, jsEndIndex, "#js"), err(code, jsEndIndex, '"#js"'), index => ({
            parsed: {
                kind: "javascript-escape",
                code,
                startIndex,
                endIndex: index,
                js: code.substring(jsStartIndex, jsEndIndex),
            },
            newIndex: index,
        }));
})

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

const EXPRESSION_PRECEDENCE_TIERS = expressionPrecedenceTiers();
const NEXT_TIER = (() => {
    const map = new Map();

    for (let i = 0; i < EXPRESSION_PRECEDENCE_TIERS.length; i++) {
        for (const fn of EXPRESSION_PRECEDENCE_TIERS[i]) {
            map.set(fn, i+1);
        }
    }

    return map;
})();

const parseStartingFromTier = (tier: number): ParseFunction<Expression> => (code, index) => {
    for (let i = tier; i < EXPRESSION_PRECEDENCE_TIERS.length; i++) {
        for (const fn of EXPRESSION_PRECEDENCE_TIERS[i]) {
            const result = fn(code, index);

            if (result != null) {
                return result;
            }
        }
    }

    return undefined;
}

const parseBeneath = (code: string, index: number, fn: ParseFunction<Expression>) =>
    parseStartingFromTier(NEXT_TIER.get(fn))(code, index)
