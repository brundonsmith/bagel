import { ArrayLiteral, ArrayType, Assignment, AST, BinaryOp, BinaryOperator, BooleanLiteral, ConstDeclaration, Declaration, Expression, ForLoop, Func, Funcall, FuncDeclaration, LocalIdentifier, IfElseExpression, IfElseStatement, IndexerType, JavascriptEscape, KEYWORDS, LetDeclaration, LiteralType, NilLiteral, NominalType, NumberLiteral, ObjectLiteral, ObjectType, ParenthesizedExpression, Pipe, Proc, ProcCall, ProcDeclaration, PropertyAccessor, Range, Reaction, Statement, StringLiteral, TupleType, TypeDeclaration, TypeExpression, UnionType, UnknownType, WhileLoop, PlainIdentifier, NamedType, Indexer, ImportDeclaration, PrimitiveType, FuncType, Module, Block, BOOLEAN_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, UNKNOWN_TYPE } from "./ast";
import { given, consume, consumeWhitespace, consumeWhile, isNumeric, parseBinaryOp, ParseResult, parseSeries, isSymbolic, parseOptional, ParseFunction, err, expec, BagelSyntaxError, isError, errorMessage } from "./parsing-utils";

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
        declarations
    };
}

const declaration: ParseFunction<Declaration> = (code, index) =>
    importDeclaration(code, index)
    ?? typeDeclaration(code, index)
    ?? procDeclaration(code, index)
    ?? funcDeclaration(code, index)
    ?? constDeclaration(code, index)

const importDeclaration: ParseFunction<ImportDeclaration> = (code, index) =>
    given(consume(code, index, "from"), index =>
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
            imports: imports.map(name => ({ name })),
            path,
        },
        newIndex: index
    })))))))))))

const typeDeclaration: ParseFunction<TypeDeclaration> = (code, index) => {
    const indexAfterExport = given(consume(code, index, "export"), index =>
        consumeWhitespace(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? index, "type"), index => 
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
            returnType
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

const unknownType: ParseFunction<UnknownType> = (code, index) =>
    given(consume(code, index, "unknown"), index => ({
        parsed: {
            kind: "unknown-type",
        },
        newIndex: index,
    }))

const procDeclaration: ParseFunction<ProcDeclaration> = (code, index) => {
    const indexAfterExport = given(consume(code, index, "export"), index =>
        consumeWhitespace(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? index, "proc"), index =>
        given(consumeWhitespace(code, index), index =>
        expec(proc(code, index), err(code, index, 'Procedure'), ({ parsed: proc, newIndex: index }) => ({
            parsed: {
                kind: "proc-declaration",
                proc,
                exported,
            },
            newIndex: index,
        }))))
}

const funcDeclaration: ParseFunction<FuncDeclaration> = (code, index) => {
    const indexAfterExport = given(consume(code, index, "export"), index =>
        consumeWhitespace(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? index, "func"), index =>
        given(consumeWhitespace(code, index), index =>
        expec(func(code, index), err(code, index, 'Function'), ({ parsed: func, newIndex: index }) => ({
            parsed: {
                kind: "func-declaration",
                func,
                exported,
            },
            newIndex: index,
        }))))
}

const constDeclaration: ParseFunction<ConstDeclaration> = (code, index) => {
    const indexAfterExport = given(consume(code, index, "export"), index =>
        consumeWhitespace(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? index, "const"), index =>
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
                    type: type ?? UNKNOWN_TYPE,
                    value,
                    exported,
                },
                newIndex: index,
        }))))))))))
}

const proc: ParseFunction<Proc> = (code, index) =>
    given(parseOptional(code, index, plainIdentifier), ({ parsed: name, newIndex }) =>
    given(consume(code, newIndex ?? index, "("), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlock(code, index), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "proc",
            name,
            type: {
                kind: "proc-type",
                argTypes: args.map(arg => arg.type ?? UNKNOWN_TYPE),
            },
            argNames: args.map(arg => arg.name),
            body,
        },
        newIndex: index,
    })))))))

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
                type: type ?? UNKNOWN_TYPE,
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
    given(parseBeneath(code, index, funcall), ({ parsed: proc, newIndex: index }) =>
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
    }))))))))))

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
    expec(parseBlock(code, index), err(code, index, 'Loop body'), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "for-loop",
            itemIdentifier,
            iterator,
            body,
        },
        newIndex: index,
    }))))))))))))))

const whileLoop: ParseFunction<WhileLoop> = (code, index) =>
    given(consume(code, index, "while"), index =>
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
            condition,
            body,
        },
        newIndex: index,
    }))))))))))

const parseBlock: ParseFunction<Block> = (code, index) =>
    given(consume(code, index, "{"), index =>
    given(parseSeries(code, index, statement), ({ parsed: statements, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "block",
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
                argTypes: args.map(arg => arg.type ?? UNKNOWN_TYPE),
                returnType: returnType ?? UNKNOWN_TYPE,
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
    given(parseSeries(code, index, parseStartingFromTier(NEXT_TIER.get(pipe)), "|>", { trailingDelimiter: "forbidden" }), ({ parsed: expressions, newIndex: index }) =>
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
    given(parseBeneath(code, index, binaryOperator), ({ parsed: left, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    given(parseBinaryOp(code, index), ({ parsed: operator, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Right operand"), ({ parsed: right, newIndex: index }) => ({
        parsed: {
            kind: "binary-operator",
            operator,
            left,
            right,
        },
        newIndex: index,
    }))))))

const funcall: ParseFunction<Funcall> = (code, index) =>
    given(parseBeneath(code, index, funcall), ({ parsed: func, newIndex: index }) =>
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

const indexer: ParseFunction<Indexer> = (code, index) =>
    given(parseBeneath(code, index, indexer), ({ parsed: base, newIndex: index }) =>
    given(parseSeries(code, index, _indexerExpression), ({ parsed: indexers, newIndex: index }) => 
        indexers.length > 0 ? 
            {
                parsed: indexers.reduce((base: Expression, indexer: Expression) => ({
                    kind: "indexer",
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
    })))))))))))))

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
    given(parseBeneath(code, index, propertyAccessor), ({ parsed: base, newIndex: index }) =>
    given(parseSeries(code, index, plainIdentifier, ".", { leadingDelimiter: "required", trailingDelimiter: "forbidden" }), ({ parsed: properties, newIndex: index }) => 
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
    given(consume(code, index, "js#"), jsStartIndex => {
        let jsEndIndex = jsStartIndex;

        while (code[jsEndIndex] !== "#" || code[jsEndIndex+1] !== "j" || code[jsEndIndex+2] !== "s") {
            jsEndIndex++;
        }

        return expec(consume(code, jsEndIndex, "#js"), err(code, index, '"#js"'), index => ({
            parsed: {
                kind: "javascript-escape",
                js: code.substring(jsStartIndex, jsEndIndex),
            },
            newIndex: index,
        }));
})

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
