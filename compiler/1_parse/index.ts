import { log, stripSourceInfo } from "../utils/debugging.ts";
import { BagelError, isError, syntaxError } from "../errors.ts";
import { memoize, memoize3 } from "../utils/misc.ts";
import { Module, Debug, Block, PlainIdentifier, SourceInfo } from "../_model/ast.ts";
import { ModuleName,ReportError } from "../_model/common.ts";
import { AutorunDeclaration, ValueDeclaration, Declaration, FuncDeclaration, ImportDeclaration, ProcDeclaration, TestBlockDeclaration, TestExprDeclaration, TypeDeclaration, ImportAllDeclaration, RemoteDeclaration, DeriveDeclaration } from "../_model/declarations.ts";
import { ArrayLiteral, BinaryOperator, BooleanLiteral, ElementTag, Expression, Func, Invocation, IfElseExpression, Indexer, JavascriptEscape, LocalIdentifier, NilLiteral, NumberLiteral, ObjectLiteral, ParenthesizedExpression, Proc, PropertyAccessor, Range, StringLiteral, SwitchExpression, InlineConstGroup, InlineConstDeclaration, ExactStringLiteral, Case, Operator, BINARY_OPS, NegationOperator, AsCast, Spread, SwitchCase, InlineDestructuringDeclaration } from "../_model/expressions.ts";
import { Assignment, CaseBlock, ValueDeclarationStatement, ForLoop, IfElseStatement, Statement, WhileLoop, AwaitStatement, DestructuringDeclarationStatement } from "../_model/statements.ts";
import { ArrayType, FuncType, RecordType, LiteralType, NamedType, ObjectType, PrimitiveType, ProcType, TupleType, TypeExpression, UnionType, UnknownType, Attribute, Arg, ElementType, GenericType, ParenthesizedType, MaybeType, BoundGenericType, IteratorType, PlanType, GenericFuncType, GenericProcType, TypeParam, RemoteType } from "../_model/type-expressions.ts";
import { consume, consumeWhitespace, consumeWhitespaceRequired, err, expec, given, identifierSegment, isNumeric, ParseFunction, parseExact, parseOptional, ParseResult, parseSeries, plainIdentifier, parseKeyword, TieredParser } from "./common.ts";
import { iterateParseTree, setParents } from "../utils/ast.ts";

export function parse(module: ModuleName, code: string, reportError: ReportError): Module {
    let index = 0;

    const declarations: Declaration[] = [];
    index = consumeWhitespace(code, index);
    let result = declaration(module, code, index);
    while (result != null && !isError(result)) {
        declarations.push(result.parsed);
        index = result.index;
        index = consumeWhitespace(code, index);

        result = declaration(module, code, index);
    }

    if (isError(result)) {
        reportError(result);
    } else if (index < code.length) {
        reportError({
            kind: "bagel-syntax-error",
            ast: undefined,
            code,
            index,
            message: `Failed to parse entire file`,
            stack: undefined,
        });
    }

    const moduleAst: Module = {
        kind: "module",
        hasMain: declarations.some(decl => decl.kind === "proc-declaration" && decl.name.name === "main"),
        declarations,
        module,
        code,
        startIndex: 0,
        endIndex: index
    };

    setParents(moduleAst)

    return moduleAst
}

const declaration: ParseFunction<Declaration> = (module, code, startIndex) =>
    debug(module, code, startIndex)
    ?? importAllDeclaration(module, code, startIndex)
    ?? importDeclaration(module, code, startIndex)
    ?? _nominalTypeDeclaration(module, code, startIndex)
    ?? typeDeclaration(module, code, startIndex)
    ?? procDeclaration(module, code, startIndex)
    ?? funcDeclaration(module, code, startIndex)
    ?? valueDeclaration(module, code, startIndex)
    ?? deriveOrRemoteDelcaration(module, code, startIndex)
    ?? autorunDeclaration(module, code, startIndex)
    ?? testExprDeclaration(module, code, startIndex)
    ?? testBlockDeclaration(module, code, startIndex)
    ?? javascriptEscape(module, code, startIndex)

const importAllDeclaration: ParseFunction<ImportAllDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, "import"), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(exactStringLiteral(module, code, index), err(code, index, 'Import path'), ({ parsed: path, index }) => 
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(consume(code, index, "as"), err(code, index, '"as"'), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(plainIdentifier(module, code, index), err(code, index, '"Name"'), ({ parsed: alias, index }) => ({
        parsed: {
            kind: "import-all-declaration",
            alias,
            path,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))

const importDeclaration: ParseFunction<ImportDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, "from"), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(exactStringLiteral(module, code, index), err(code, index, 'Import path'), ({ parsed: path, index }) => 
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(consume(code, index, "import"), err(code, index, '"import"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(parseSeries(module, code, index, plainIdentifier, ","), ({ parsed: imports, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "import-declaration",
            imports: imports.map(i => ({
                kind: "import-item",
                name: i,
                module,
                code: i.code,
                startIndex: i.startIndex,
                endIndex: i.endIndex,
            })),
            path,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))))))))

const typeDeclaration: ParseFunction<TypeDeclaration> = (module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'export'), ({ parsed: exported, index }) =>
    given(consume(code, index, 'type'), index => 
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, 'Type name'), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression'), ({ parsed: type, index }) => ({
        parsed: {
            kind: "type-declaration",
            name,
            type,
            exported,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))))))

const _nominalTypeDeclaration: ParseFunction<TypeDeclaration> = (module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'export'), ({ parsed: exported, index }) =>
    given(consume(code, index, "nominal"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(consume(code, index, "type"), err(code, index, '"type"'), index => 
    given(consumeWhitespaceRequired(code, index), startOfNameIndex =>
    expec(plainIdentifier(module, code, startOfNameIndex), err(code, startOfNameIndex, 'Type name'), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression'), ({ parsed: inner, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "type-declaration",
            name,
            type: {
                kind:"nominal-type",
                name: Symbol(name.name),
                inner,
                mutability: undefined,
                module: inner.module,
                code: inner.code,
                startIndex: startOfNameIndex,
                endIndex: index
            },
            exported,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))))))))))


const typeExpression: ParseFunction<TypeExpression> =  memoize3((module, code, startIndex) =>
    TYPE_PARSER.parseStartingFromTier(0)(module, code, startIndex))

const genericType: ParseFunction<GenericType> = (module, code, startIndex) =>
    given(_typeParams(module, code, startIndex), ({ parsed: typeParams, index }) =>
    expec(typeExpression(module, code, index), err(code, index, "Type"), ({ parsed: inner, index }) => ({
        parsed: {
            kind: "generic-type",
            typeParams,
            inner,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))

const arrayType: ParseFunction<ArrayType> = (module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'const'), ({ parsed: constant, index }) =>
    given(TYPE_PARSER.parseBeneath(module, code, index, arrayType), ({ parsed: element, index }) =>
    given(consume(code, index, "[]"), index => ({
        parsed: {
            kind: "array-type",
            element,
            mutability: constant ? "readonly" : "mutable",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))

const maybeType: ParseFunction<MaybeType> = (module, code, startIndex) =>
    given(TYPE_PARSER.parseBeneath(module, code, startIndex, maybeType), ({ parsed: inner, index }) =>
    given(consume(code, index, "?"), index => ({
        parsed: {
            kind: "maybe-type",
            inner,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))

const unionType: ParseFunction<UnionType> = (module, code, startIndex) =>
    given(parseSeries(module, code, startIndex, TYPE_PARSER.beneath(unionType), "|", { leadingDelimiter: "optional", trailingDelimiter: "forbidden" }), ({ parsed: members, index }) =>
        members.length >= 2
            ? {
                parsed: {
                    kind: "union-type",
                    members,
                    module,
                    mutability: undefined,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index,
            }
            : undefined)

const elementType: ParseFunction<ElementType> = (module, code, startIndex) =>
    given(consume(code, startIndex, "Element"), index => ({
        parsed: {
            kind: "element-type",
            module,
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))

const namedType: ParseFunction<NamedType> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) => ({
        parsed: {
            kind: "named-type",
            name,
            module,
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))

const objectType: ParseFunction<ObjectType> = (module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'const'), ({ parsed: constant, index }) =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _typeSpreadOrEntry, ","), ({ parsed: entries, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-type",
            spreads: entries.filter((e): e is NamedType => e.kind === "named-type"),
            entries: entries.filter((e): e is Attribute => e.kind === "attribute"),
            module,
            mutability: constant ? "readonly" : "mutable",
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))))

const _typeSpreadOrEntry: ParseFunction<NamedType|Attribute> = (module, code, startIndex) => 
    _objectTypeEntry(module, code, startIndex) ?? _objectTypeSpread(module, code, startIndex)

const _objectTypeSpread: ParseFunction<NamedType> = (module, code, startIndex) =>
    given(consume(code, startIndex, '...'), index =>
    expec(namedType(module, code, index), err(code,  index, 'Named type'), res => res))

const _objectTypeEntry: ParseFunction<Attribute> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, parseExact("?")), ({ parsed: optional, index: indexAfterQuestionMark }) =>
    given(consume(code, indexAfterQuestionMark ?? index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(module, code, index), ({ parsed: type, index }) => ({
        parsed: {
            kind: "attribute",
            name,
            type,
            optional: optional != null,
            forceReadonly: false,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index,
    })))))))

const recordType: ParseFunction<RecordType> = (module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'const'), ({ parsed: constant, index }) =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "["), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression for key'), ({ parsed: keyType, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index =>
    given(consume(code, index, ":"), index =>
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(module, code, index), ({ parsed: valueType, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "record-type",
            keyType,
            valueType,
            mutability: constant ? "readonly" : "mutable",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))))))))))))

const tupleType: ParseFunction<TupleType> = (module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'const'), ({ parsed: constant, index }) =>
    given(consume(code, index, "["), index =>
    given(parseSeries(module, code, index, typeExpression, ","), ({ parsed: members, index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "tuple-type",
            members,
            mutability: constant ? "readonly" : "mutable",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))

const primitiveType: ParseFunction<PrimitiveType> = (module, code, startIndex) =>
    given(consume(code, startIndex, "string"), index => ({
        parsed: {
            kind: "string-type",
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))
    ?? given(consume(code, startIndex, "number"), index => ({
        parsed: {
            kind: "number-type",
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))
    ?? given(consume(code, startIndex, "boolean"), index => ({
        parsed: {
            kind: "boolean-type",
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))
    ?? given(consume(code, startIndex, "nil"), index => ({
        parsed: {
            kind: "nil-type",
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))
    ?? given(consume(code, startIndex, "unknown"), index => ({
        parsed: {
            kind: "unknown-type",
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))

const funcType: ParseFunction<FuncType|GenericFuncType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, index: indexAfterTypeParams }) =>
    given(consume(code, indexAfterTypeParams ?? startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, arg, ","), ({ parsed: args, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "=>"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Return type'), ({ parsed: returnType, index }) => {
        const funcType: FuncType = {
            kind: "func-type",
            args,
            returnType,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index
        }
        
        return {
            parsed: (
                typeParams
                    ? {
                        kind: "generic-type",
                        typeParams,
                        inner: funcType,
                        mutability: undefined,
                        module,
                        code,
                        startIndex,
                        endIndex: index
                    }
                    : funcType
            ),
            index
        }
    }))))))))))

const procType: ParseFunction<ProcType|GenericProcType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, index: indexAfterTypeParams }) =>
    given(consume(code, indexAfterTypeParams ?? startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, arg, ","), ({ parsed: args, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "{}"), index => {
        const procType: ProcType = {
            kind: "proc-type",
            args,
            invalidatesParent: false,
            isAsync: undefined,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index
        }
        
        return {
            parsed: (
                typeParams
                    ? {
                        kind: "generic-type",
                        typeParams,
                        inner: procType,
                        mutability: undefined,
                        module,
                        code,
                        startIndex,
                        endIndex: index
                    }
                    : procType
            ),
            index
        }
    }))))))))

const _typeParam: ParseFunction<TypeParam> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, "extends"), index =>
        given(consumeWhitespaceRequired(code, index), index =>
        expec(typeExpression(module, code, index), err(code, index, 'Type expression (extends constraint)'), res => res)))), ({ parsed: extendz, index: indexAfterExtends }) => ({
        parsed: {
            name,
            extends: extendz
        },
        index: indexAfterExtends ?? index
    }))))

const boundGenericType: ParseFunction<BoundGenericType|IteratorType|PlanType|RemoteType> = (module, code, startIndex) =>
    given(TYPE_PARSER.beneath(boundGenericType)(module, code, startIndex), ({ parsed: generic, index }) =>
    given(_typeArgs(module, code, index), ({ parsed: typeArgs, index }) => 
        generic.kind === 'named-type' && generic.name.name === 'Iterator' ?
            (typeArgs.length !== 1
                ? syntaxError(code, index, `Iterator types must have exactly one type parameter; found ${typeArgs.length}`)
                : {
                    parsed: {
                        kind: "iterator-type",
                        inner: typeArgs[0],
                        mutability: undefined,
                        module,
                        code,
                        startIndex,
                        endIndex: index,
                    },
                    index
                })
        : generic.kind === 'named-type' && generic.name.name === 'Plan' ?
            (typeArgs.length !== 1
                ? syntaxError(code, index, `Plan types must have exactly one type parameter; found ${typeArgs.length}`)
                : {
                    parsed: {
                        kind: "plan-type",
                        inner: typeArgs[0],
                        mutability: undefined,
                        module,
                        code,
                        startIndex,
                        endIndex: index,
                    },
                    index
                })
        : generic.kind === 'named-type' && generic.name.name === 'Remote' ?
            (typeArgs.length !== 1
                ? syntaxError(code, index, `Remote types must have exactly one type parameter; found ${typeArgs.length}`)
                : {
                    parsed: {
                        kind: "remote-type",
                        inner: typeArgs[0],
                        mutability: undefined,
                        module,
                        code,
                        startIndex,
                        endIndex: index,
                    },
                    index
                })
        : {
            parsed: {
                kind: "bound-generic-type",
                generic,
                typeArgs,
                mutability: undefined,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index
        }))

const parenthesizedType: ParseFunction<ParenthesizedType> = (module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, "Type"), ({ parsed: inner, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: 'parenthesized-type',
            inner,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))))

const literalType: ParseFunction<LiteralType> = (module, code, startIndex) =>
    given(exactStringLiteral(module, code, startIndex) 
        ?? numberLiteral(module, code, startIndex) 
        ?? booleanLiteral(module, code, startIndex), 
    ({ parsed: value, index }) => ({
        parsed: {
            kind: "literal-type",
            value,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))

const unknownType: ParseFunction<UnknownType> = (module, code, startIndex) =>
    given(consume(code, startIndex, "unknown"), index => ({
        parsed: {
            kind: "unknown-type",
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))

const procDeclaration: ParseFunction<ProcDeclaration> = (module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'export'), ({ parsed: exported, index }) =>
    given(parseKeyword(code, index, 'js'), ({ parsed: js, index }) =>
    given(consume(code, index, "proc"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(parseKeyword(code, index, 'action'), ({ parsed: action, index }) =>
    given(plainIdentifier(module, code, index), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_procHeader(module, code, index), ({ parsed: type, index }) => 
    given(consumeWhitespace(code, index), index =>
    js 
        ? expec(consume(code, index, "{#"), err(code, index, '"{#"'), jsStartIndex => {
            let jsEndIndex = index;

            while (code[jsEndIndex] !== "#" || code[jsEndIndex+1] !== "}") {
                jsEndIndex++;
            }

            const endIndex = jsEndIndex + 2

            return {
                parsed: {
                    kind: 'proc-declaration',
                    name,
                    action,
                    value: {
                        kind: "js-proc",
                        type,
                        body: code.substring(jsStartIndex, jsEndIndex),
                        module,
                        code,
                        startIndex,
                        endIndex
                    },
                    exported,
                    module,
                    code,
                    startIndex,
                    endIndex
                },
                index: endIndex
            }
        })
        : expec(parseBlock(module, code, index), err(code, index, 'Procedure body'), ({ parsed: body, index }) => ({
            parsed: {
                kind: 'proc-declaration',
                name,
                action,
                value: {
                    kind: "proc",
                    type: {
                        ...type,
                        isAsync: [...iterateParseTree(body)].some(({ current }) => current.kind === 'await-statement')
                    },
                    body,
                    module,
                    code,
                    startIndex,
                    endIndex: index
                },
                exported,
                module,
                code,
                startIndex,
                endIndex: index
            },
            index,
        })))))))))))

const funcDeclaration: ParseFunction<FuncDeclaration> = (module, code, startIndex) => 
    given(parseKeyword(code, startIndex, 'export'), ({ parsed: exported, index }) =>
    given(parseKeyword(code, index, 'js'), ({ parsed: js, index }) =>
    given(consume(code, index, "func"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(parseKeyword(code, index, 'memo'), ({ parsed: memo, index }) =>
    given(plainIdentifier(module, code, index), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_funcHeader(module, code, index), ({ parsed: type, index }) => 
    given(consumeWhitespace(code, index), index =>
    js 
        ? expec(consume(code, index, "{#"), err(code, index, '"{#"'), jsStartIndex => {
            let jsEndIndex = index;

            while (code[jsEndIndex] !== "#" || code[jsEndIndex+1] !== "}") {
                jsEndIndex++;
            }

            const endIndex = jsEndIndex + 2
            
            return {
                parsed: {
                    kind: "func-declaration",
                    name,
                    memo,
                    value: {
                        kind: "js-func",
                        type,
                        body: code.substring(jsStartIndex, jsEndIndex),
                        module,
                        code,
                        startIndex,
                        endIndex,
                    },
                    exported,
                    module,
                    code,
                    startIndex,
                    endIndex,
                },
                index: endIndex,
            }
        })
        : expec(expression(module, code, index), err(code, index, 'Function body'), ({ parsed: body, index }) => ({
            parsed: {
                kind: "func-declaration",
                name,
                memo,
                value: {
                    kind: "func",
                    type,
                    body,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                exported,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
        })))))))))))

const valueDeclaration: ParseFunction<ValueDeclaration> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("export")(module, code, index) ?? parseExact("expose")(module, code, index), ({ parsed: exported, index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, index })))), ({ parsed: exported, index: indexAfterExport }) =>
    given(parseExact("const")(module, code, indexAfterExport ?? startIndex) ?? parseExact("let")(module, code, indexAfterExport ?? startIndex), ({ parsed: kind, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, index}) =>
    given(consumeWhitespace(code, index), index =>
    given(_maybeTypeAnnotation(module, code, index), ({ parsed: type, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: value, index }) => ({
            parsed: {
                kind: "value-declaration",
                name,
                type,
                value,
                isConst: kind === 'const',
                exported,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
    })))))))))))

const deriveOrRemoteDelcaration: ParseFunction<DeriveDeclaration|RemoteDeclaration> = (module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'export'), ({ parsed: exported, index }) =>
    given(parseExact("derive")(module, code, index) ?? parseExact("remote")(module, code, index), ({ parsed: kind, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_maybeTypeAnnotation(module, code, index), ({ parsed: type, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(func(module, code, index), ({ parsed: fn, index }) => ({
        parsed: {
            kind: kind === 'derive' ? 'derive-declaration' : 'remote-declaration',
            name,
            type,
            fn,
            exported,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))))))

const _maybeTypeAnnotation: ParseFunction<TypeExpression|undefined> = (module, code, startIndex) =>{
    const result = (
        given(consume(code, startIndex, ":"), index =>
        given(consumeWhitespace(code, index), index => 
        expec(typeExpression(module, code, index), err(code, index, 'Type'), res => res)))
    )

    if (isError(result)) {
        return result
    }
    
    return {
        parsed: result?.parsed,
        index: result?.index ?? startIndex
    }
}

const autorunDeclaration: ParseFunction<AutorunDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, "autorun"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Effect"), ({ parsed: effect, index }) => ({
        parsed: {
            kind: "autorun-declaration",
            effect,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))

const testExprDeclaration: ParseFunction<TestExprDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, 'test'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, 'expr'), index =>
    given(consumeWhitespace(code, index), index => 
    expec(exactStringLiteral(module, code, index), err(code, index, 'Test name'), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '='), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Test expression'), ({ parsed: expr, index }) => ({
        parsed: {
            kind: 'test-expr-declaration',
            name,
            expr,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))))

const testBlockDeclaration: ParseFunction<TestBlockDeclaration> = (module, code, startIndex) => 
    given(consume(code, startIndex, 'test'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, 'block'), index =>
    given(consumeWhitespace(code, index), index => 
    expec(exactStringLiteral(module, code, index), err(code, index, 'Test name'), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Test block'), ({ parsed: block, index }) => ({
        parsed: {
            kind: 'test-block-declaration',
            name,
            block,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))

const proc: ParseFunction<Proc> = (module, code, startIndex) =>
    given(_procHeader(module, code, startIndex), ({ parsed: type, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlock(module, code, index), ({ parsed: body, index }) => ({
        parsed: {
            kind: "proc",
            type: {
                ...type,
                isAsync: [...iterateParseTree(body)].some(({ current }) => current.kind === 'await-statement')
            },
            body,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index,
    }))))

const _procHeader: ParseFunction<ProcType|GenericProcType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, index: indexAfterTypeParams }) =>
    given(_seriesOfArguments(module, code, indexAfterTypeParams ?? startIndex), ({ parsed: args, index }) => {
        const procType: ProcType = {
            kind: "proc-type",
            args,
            invalidatesParent: false,
            isAsync: undefined,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index
        }

        return {
            parsed: (
                typeParams
                    ? {
                        kind: "generic-type",
                        typeParams,
                        inner: procType,
                        mutability: undefined,
                        module,
                        code,
                        startIndex,
                        endIndex: index
                    }
                    : procType
            ),
            index
        }
    }))

const statement: ParseFunction<Statement> = (module, code, startIndex) =>
    javascriptEscape(module, code, startIndex)
    ?? valueDeclarationStatement(module, code, startIndex)
    ?? ifElseStatement(module, code, startIndex)
    ?? forLoop(module, code, startIndex)
    ?? whileLoop(module, code, startIndex)
    ?? assignment(module, code, startIndex)
    ?? procCall(module, code, startIndex)
    ?? awaitStatement(module, code, startIndex)

const valueDeclarationStatement: ParseFunction<ValueDeclarationStatement|DestructuringDeclarationStatement> = (module, code, startIndex) => 
    given(parseExact("const")(module, code, startIndex) ?? parseExact("let")(module, code, startIndex), ({ parsed: kind, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(_declarationTarget(module, code, index), err(code, index, "Constant name or spread"), ({ parsed: target, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: value, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
            parsed: 
                target.kind === 'const'
                    ? {
                        kind: "value-declaration-statement",
                        name: target.name,
                        type: target.type,
                        value,
                        isConst: kind === 'const',
                        module,
                        code,
                        startIndex,
                        endIndex: index,
                    }
                    : {
                        kind: "destructuring-declaration-statement",
                        properties: target.properties,
                        spread: target.spread,
                        destructureKind: target.destructureKind,
                        value,
                        module,
                        code,
                        startIndex,
                        endIndex: index
                    },
            index,
        }))))))))))

const assignment: ParseFunction<Assignment> = (module, code, startIndex) =>
    given(invocationAccessorChain(module, code, startIndex) ?? indexer(module, code, startIndex) ?? localIdentifier(module, code, startIndex), ({ parsed: target, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "="), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Assignment value"), ({ parsed: value, index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => 
        target.kind === "local-identifier" || target.kind === "property-accessor" || target.kind === 'indexer' ? {
            parsed: {
                kind: "assignment",
                target,
                value,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
        } : undefined
    )))))))

const awaitStatement: ParseFunction<AwaitStatement> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(consume(code, index, "const"), index =>
        given(consumeWhitespaceRequired(code, index), index =>
        given(plainIdentifier(module, code, index), ({ parsed: name, index }) =>
        given(_maybeTypeAnnotation(module, code, index), ({ parsed: type, index }) =>
        given(consumeWhitespace(code, index), index =>
        given(consume(code, index, "="), index =>
        given(consumeWhitespace(code, index), index => ({ parsed: { name, type }, index }))))))))), ({ parsed: assignToInfo, index }) =>
    given(consume(code, index ?? startIndex, "await"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(expression(module, code, index), ({ parsed: plan, index }) =>
    expec(consume(code, index, ';'), err(code, index, '";"'), index => ({
        parsed: {
            kind: 'await-statement',
            name: assignToInfo?.name,
            type: assignToInfo?.type,
            noAwait: false,
            plan,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    }))))))

const procCall: ParseFunction<Invocation> = (module, code, startIndex) =>
    given(invocationAccessorChain(module, code, startIndex), ({ parsed, index }) =>
    expec(consume(code, index, ';'), err(code, index, '";"'), index => 
        parsed.kind === "invocation" ? {
            parsed,
            index
        } : undefined))
    

const ifElseStatement: ParseFunction<IfElseStatement> = (module, code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
    given(parseSeries(module, code, index, _conditionAndOutcomeBlock, 'else if', { trailingDelimiter: "forbidden" }), ({ parsed: cases, index }) => {
        const elseResult = 
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(parseBlock(module, code, index), err(code, index, 'Else block'), result => result)));

        if (isError(elseResult)) {
            return elseResult
        } else if (elseResult == null) {
            return {
                parsed: {
                    kind: "if-else-statement",
                    cases,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index,
            }
        } else {
            return  {
                parsed: {
                    kind: "if-else-statement",
                    cases,
                    defaultCase: elseResult.parsed,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index: elseResult.index,
            }
        }
    }))

const _conditionAndOutcomeBlock: ParseFunction<CaseBlock> = (module, code, startIndex) =>
    given(expression(module, code, startIndex), ({ parsed: condition, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Block for if clause'), ({ parsed: outcome, index }) => ({
        parsed: {
            kind: "case-block",
            condition,
            outcome,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))

const forLoop: ParseFunction<ForLoop> = (module, code, startIndex) =>
    given(consume(code, startIndex, "for"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, 'Item identifier for loop items'), ({ parsed: itemIdentifier, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(consume(code, index, "of"), err(code, index, '"of"'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Iterator expression'), ({ parsed: iterator, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Loop body'), ({ parsed: body, index }) => ({
        parsed: {
            kind: "for-loop",
            itemIdentifier,
            iterator,
            body,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))))))))

const whileLoop: ParseFunction<WhileLoop> = (module, code, startIndex) =>
    given(consume(code, startIndex, "while"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'While loop condition'), ({ parsed: condition, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Loop body'), ({ parsed: body, index }) => ({
        parsed: {
            kind: "while-loop",
            condition,
            body,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))))

const parseBlock: ParseFunction<Block> = (module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlockWithoutBraces(module, code, index), ({ parsed, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed,
        index,
    }))))))

const parseBlockWithoutBraces: ParseFunction<Block> = (module, code, startIndex) =>
    given(parseSeries(module, code, startIndex, statement), ({ parsed: statements, index }) => ({
        parsed: {
            kind: "block",
            statements,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))

const expression: ParseFunction<Expression> = memoize3((module, code, startIndex) =>
    EXPRESSION_PARSER.parseStartingFromTier(0)(module, code, startIndex))

const func: ParseFunction<Func> = (module, code, startIndex) =>
    given(_funcHeader(module, code, startIndex), ({ parsed: type, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Function body'), ({ parsed: body, index }) => ({
        parsed: {
            kind: "func",
            type,
            body,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index,
    }))))

const _funcHeader: ParseFunction<FuncType|GenericFuncType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, index: indexAfterTypeParams }) =>
    given(_funcArgs(module, code, indexAfterTypeParams ?? startIndex), ({ parsed: args, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_maybeTypeAnnotation(module, code, index), ({ parsed: returnType, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "=>"), index => {
        const funcType: FuncType = {
            kind: "func-type",
            args,
            returnType,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index
        }

        return {
            parsed: typeParams
                ? {
                    kind: "generic-type",
                    typeParams,
                    inner: funcType,
                    mutability: undefined,
                    module,
                    code,
                    startIndex,
                    endIndex: index
                }
                : funcType,
            index
        }
    }))))))


const _typeParams: ParseFunction<{ name: PlainIdentifier, extends: TypeExpression | undefined }[]> = (module, code, index) =>
    given(consume(code, index, "<"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseSeries(module, code, index, _typeParam, ','), err(code, index, "Type parameters"), ({ parsed: typeParams, index }) =>
    given(consumeWhitespace(code, index), index => 
    given(consume(code, index, ">"), index => ({ parsed: typeParams, index }))))))

const _funcArgs: ParseFunction<Arg[]> = (module, code, startIndex) => 
    _singleArgument(module, code, startIndex) ?? _seriesOfArguments(module, code, startIndex)

const _singleArgument: ParseFunction<Arg[]> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) => ({
        parsed: [
            {
                kind: "arg",
                name,
                optional: false,
                module,
                code,
                startIndex,
                endIndex: index
            }
        ],
        index
    }))

const _seriesOfArguments: ParseFunction<Arg[]> = (module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(parseSeries(module, code, index, arg, ","), ({ parsed: args, index }) =>
    given(consume(code, index, ")"), index => ({
        parsed: args,
        index
    }))))

const arg: ParseFunction<Arg> = (module, code, startIndex) => 
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index => 
    given(parseOptional(module, code, index, parseExact('?')), ({ parsed: question, index: indexAfterQuestionMark }) =>
    given(_maybeTypeAnnotation(module, code, indexAfterQuestionMark ?? index), ({ parsed: type, index }) => ({
        parsed: {
            kind: "arg",
            name,
            type,
            optional: question != null,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))))

const inlineConstGroup: ParseFunction<InlineConstGroup> = (module, code, startIndex) =>
    given(parseSeries(module, code, startIndex, inlineConstDeclaration), ({ parsed: declarations, index }) =>
    declarations.length > 0 ?
        given(consumeWhitespace(code, index), index => 
        expec(expression(module, code, index), err(code, index, "Expression"), ({ parsed: inner, index }) => ({
            parsed: {
                kind: "inline-const-group",
                declarations,
                inner,
                module,
                code,
                startIndex,
                endIndex: index
            },
            index
        })))
    : undefined)

const inlineConstDeclaration: ParseFunction<InlineConstDeclaration|InlineDestructuringDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, 'const'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(_declarationTarget(module, code, index), ({ parsed: target, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, '='), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseKeyword(code, index, 'await'), ({ parsed: awaited, index }) =>
    expec(expression(module, code, index), err(code, index, "Value"), ({ parsed: value, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ','), err(code, index, '","'), index => ({
        parsed: 
            target.kind === 'const'
                ? {
                    kind: 'inline-const-declaration',
                    name: target.name,
                    type: target.type,
                    awaited,
                    value,
                    module,
                    code,
                    startIndex,
                    endIndex: index
                }
                : {
                    kind: 'inline-destructuring-declaration',
                    properties: target.properties,
                    spread: target.spread,
                    destructureKind: target.destructureKind,
                    awaited,
                    value,
                    module,
                    code,
                    startIndex,
                    endIndex: index
                },
        index
    })))))))))))

const _declarationTarget: ParseFunction<
    | { kind: 'const', name: PlainIdentifier, type: TypeExpression|undefined }
    | { 
        kind: 'destructure',
        properties: PlainIdentifier[],
        spread: PlainIdentifier|undefined,
        destructureKind: 'array'|'object',
    }
> = (module, code, startIndex) =>
    _nameAndType(module, code, startIndex) ?? _destructure(module, code, startIndex)

const _nameAndType: ParseFunction<{ kind: 'const', name: PlainIdentifier, type: TypeExpression|undefined }> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_maybeTypeAnnotation(module, code, index), ({ parsed: type, index }) => ({
        parsed: {
            kind: 'const',
            name,
            type
        },
        index
    }))))

const _destructure: ParseFunction<{ 
    kind: 'destructure',
    properties: PlainIdentifier[],
    spread: PlainIdentifier|undefined,
    destructureKind: 'array'|'object',
}> = (module, code, startIndex) =>
    given(parseExact('{')(module, code, startIndex) ?? parseExact('[')(module, code, startIndex), ({ parsed: destructureChar, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, plainIdentifier, ','), ({ parsed: properties, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(destructureChar === '{' ? consume(code, index, '}') : consume(code, index, ']'), err(code, index, destructureChar === '{' ? '"}"' : '"]"'), index => ({
        parsed: {
            kind: 'destructure',
            properties,
            spread: undefined,
            destructureKind: destructureChar === '{' ? 'object' : 'array'
        },
        index
    }))))))



const binaryOperator = memoize((tier: number): ParseFunction<BinaryOperator> => memoize3((module, code, startIndex) => 
    given(parseSeries(module, code, startIndex, 
        EXPRESSION_PARSER.beneath(binaryOperator(tier)), 
        _binaryOperatorSymbol(tier), 
        { leadingDelimiter: "forbidden", trailingDelimiter: "forbidden" }
    ), ({ parsed: segments, index }) => 
        segments.length >= 3 ? 
            given(_segmentsToOps(segments), ({ base, ops }) => ({
                parsed: {
                    kind: "binary-operator",
                    base,
                    ops,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index,
            }))
        : undefined
    )))

const _binaryOperatorSymbol = memoize((tier: number): ParseFunction<Operator> => (module, code, startIndex) => {
    for (const op of BINARY_OPS[tier]) {
        const endIndex = startIndex + op.length
        
        if (code.substring(startIndex, endIndex) === op) {
            return {
                parsed: {
                    kind: "operator",
                    op,
                    module,
                    code,
                    startIndex,
                    endIndex,
                },
                index: endIndex,
            };
        }
    }

    return undefined;
})

const _segmentsToOps = (segments: (Operator|Expression)[]): BagelError | { base: Expression, ops: readonly [readonly [Operator, Expression], ...readonly [Operator, Expression][]] } => {
    const [base, firstOp, firstExpr] = segments

    if (base.kind === "operator") {
        return err(base.code, base.startIndex, "Expression")
    }

    if (firstOp.kind !== "operator") {
        return err(firstOp.code, firstOp.startIndex, "Operator")
    }

    if (firstExpr.kind === "operator") {
        return err(firstExpr.code, firstExpr.startIndex, "Expression")
    }

    const ops: [readonly [Operator, Expression], ...readonly [Operator, Expression][]] = [[firstOp, firstExpr] as const]

    for (let i = 3; i < segments.length; i += 2) {
        const op = segments[i]
        const expr = segments[i+1]

        if (op.kind !== "operator") {
            return err(op.code, op.startIndex, "Operator")
        }
        if (expr.kind === "operator") {
            return err(expr.code, expr.startIndex, "Expression")
        }

        ops.push([
            op,
            expr
        ])
    }

    return { base, ops }
}
    

const asCast: ParseFunction<AsCast> = (module, code, startIndex) =>
    given(EXPRESSION_PARSER.beneath(asCast)(module, code, startIndex), ({ parsed: inner, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, "as"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, '"Type expression"'), ({ parsed: type, index }) => ({
        parsed: {
            kind: "as-cast",
            inner,
            type,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    }))))))


const negationOperator: ParseFunction<NegationOperator> = memoize3((module, code, startIndex) => 
    given(consume(code, startIndex, "!"), index =>
    expec(EXPRESSION_PARSER.beneath(negationOperator)(module, code, index), err(code, index, "Boolean expression"), ({ parsed: base, index }) => ({
        parsed: {
            kind: "negation-operator",
            base,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))
    
const indexer: ParseFunction<Indexer> = (module, code, startIndex) =>
    given(EXPRESSION_PARSER.parseBeneath(module, code, startIndex, indexer), ({ parsed: base, index }) =>
    given(parseSeries(module, code, index, _indexerExpression), ({ parsed: indexers, index }) => 
        indexers.length > 0 ? 
            {
                parsed: indexers.reduce((subject: Expression, indexer: Expression) => ({
                    kind: "indexer",
                    subject,
                    indexer,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                }), base) as Indexer,
                index,
            }
        : undefined))

const _indexerExpression: ParseFunction<Expression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "["), index => 
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Indexer expression'),({ parsed: indexer, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: indexer,
        index
    }))))))

const ifElseExpression: ParseFunction<IfElseExpression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
    given(parseSeries(module, code, index, _case, 'else if', { trailingDelimiter: "forbidden" }), ({ parsed: cases, index }) => {
        const elseResultResult = 
            given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
            given(consumeWhitespace(code, index), index =>
            expec(expression(module, code, index), err(code, index, 'Result expression for else clause'), ({ parsed, index }) =>
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({ parsed, index })))))))));

        if (isError(elseResultResult)) {
            return elseResultResult;
        } else if (elseResultResult == null) {
            return {
                parsed: {
                    kind: "if-else-expression",
                    cases,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index,
            }
        } else {
            return  {
                parsed: {
                    kind: "if-else-expression",
                    cases,
                    defaultCase: elseResultResult.parsed,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index: elseResultResult.index,
            }
        }
    }))

const _case: ParseFunction<Case> = (module, code, startIndex) =>
    given(expression(module, code, startIndex), ({ parsed: condition, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Result expression for if clause'), ({ parsed: outcome, index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "case",
            condition,
            outcome,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))

const switchExpression: ParseFunction<SwitchExpression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "switch"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Switch expression"), ({ parsed: value, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '{'), err(code, index, '"{"'), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, switchCase, ','), ({ parsed: cases, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, _defaultCase), ({ parsed: defaultCase, index: indexAfterDefault }) =>
    given(consumeWhitespace(code, indexAfterDefault ?? index), index =>
    expec(consume(code, index, '}'), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "switch-expression",
            value,
            cases,
            defaultCase,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))))))

const switchCase: ParseFunction<SwitchCase> = (module, code, startIndex) =>
    given(consume(code, startIndex, 'case'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Case expression'), ({ parsed: condition, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Case result'), ({ parsed: outcome, index }) => ({
        parsed: {
            kind: "switch-case",
            condition,
            outcome,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))

const _defaultCase: ParseFunction<Expression> = (module, code, startIndex) =>
    given(consume(code, startIndex, 'default'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Case result'), ({ parsed: outcome, index }) => ({
        parsed: outcome,
        index
    }))))))


const range: ParseFunction<Range> = (module, code, startIndex) =>
    given(EXPRESSION_PARSER.parseBeneath(module, code, startIndex, range), ({ parsed: start, index }) =>
    given(consume(code, index, ".."), index =>
    expec(EXPRESSION_PARSER.parseBeneath(module, code, index, range), err(code, index, 'Range end'), ({ parsed: end, index }) => ({
        parsed: {
            kind: "range",
            start,
            end,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))));

const parenthesized: ParseFunction<ParenthesizedExpression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(expression(module, code, index), ({ parsed: inner, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "parenthesized-expression",
            inner,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))))

const invocationAccessorChain: ParseFunction<Invocation|PropertyAccessor> = (module, code, startIndex) =>
    given(EXPRESSION_PARSER.parseBeneath(module, code, startIndex, invocationAccessorChain), ({ parsed: subject, index }) =>
    given(parseSeries<InvocationArgs|PropertyAccess>(module, code, index, (module, code, index) => 
        _invocationArgs(module, code, index) ?? _propertyAccess(module, code, index)), ({ parsed: gets, index }) => 
        gets.length > 0 ? {
            parsed: _getsToInvocationsAndAccesses(subject, gets),
            index
        } : undefined))

type PropertyAccess = SourceInfo & { kind: "property-access", property: PlainIdentifier, optional: boolean }

const _propertyAccess: ParseFunction<PropertyAccess> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, parseExact("?")), ({ parsed: question, index: indexAfterQuestion }) =>
    given(consume(code, indexAfterQuestion ?? startIndex, "."), index =>
    expec(plainIdentifier(module, code, index), err(code, index, "Property name"), ({ parsed: property, index }) => ({
        parsed: {
            kind: "property-access",
            property,
            optional: question != null,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))
        
const _getsToInvocationsAndAccesses = (subject: Expression, gets: (InvocationArgs|PropertyAccess)[]): Invocation|PropertyAccessor => {
    let current: Invocation|PropertyAccessor = _oneGetToInvocationOrAccess(subject, gets[0])

    for (let i = 1; i < gets.length; i++) {
        current = _oneGetToInvocationOrAccess(current, gets[i])
    }

    return current
}

const _oneGetToInvocationOrAccess = (subject: Expression, get: InvocationArgs|PropertyAccess): Invocation|PropertyAccessor => {
    if (get.kind === "invocation-args") {
        return {
            kind: "invocation",
            subject,
            typeArgs: get.typeArgs,
            args: get.exprs,
            module: get.module,
            code: get.code,
            startIndex: subject.startIndex,
            endIndex: get.endIndex
        }
    } else {
        return {
            kind: "property-accessor",
            subject,
            property: get.property,
            optional: get.optional,
            module: get.module,
            code: get.code,
            startIndex: subject.startIndex,
            endIndex: get.endIndex
        }
    }
}
    
type InvocationArgs = SourceInfo & { kind: "invocation-args", exprs: Expression[], typeArgs: TypeExpression[] }

const _invocationArgs: ParseFunction<InvocationArgs> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeArgs), ({ parsed: typeArgs, index: indexAfterTypeArgs }) =>
    given(consume(code, indexAfterTypeArgs ?? startIndex, "("), index => 
    given(parseSeries(module, code, index, expression, ","), ({ parsed: exprs, index }) =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "invocation-args",
            exprs,
            typeArgs: typeArgs ?? [],
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))))

const _typeArgs: ParseFunction<TypeExpression[]> = (module, code, startIndex) =>
    given(consume(code, startIndex, "<"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, typeExpression, ','), ({ parsed: typeArgs, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ">"), index => ({ parsed: typeArgs, index }))))))


const localIdentifier: ParseFunction<LocalIdentifier> = (module, code, startIndex) => 
    given(identifierSegment(code, startIndex), ({ segment: name, index }) => ({
        parsed: {
            kind: "local-identifier",
            name,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))

// TODO: Support /> closing
export const elementTag: ParseFunction<ElementTag> = (module, code, startIndex) =>
    given(consume(code, startIndex, "<"), index =>
    given(plainIdentifier(module, code, index), ({ parsed: tagName, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _tagAttribute), ({ parsed: attributes, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ">"), err(code, index, '">"'), index => 
    given(parseSeries(module, code, index, (module, code, index) => elementTag(module, code, index) ?? _elementEmbeddedExpression(module, code, index)), ({ parsed: children, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "</"), err(code, index, 'Closing tag'), index => 
    expec(plainIdentifier(module, code, index), err(code, index, "Closing tag name"), ({ parsed: closingTagName, index }) =>
    // TODO: Check that closing tag matches opening tag
    expec(consume(code, index, ">"), err(code, index, '">"'), index => ({
        parsed: {
            kind: "element-tag",
            tagName,
            attributes,
            children,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))))))))))

const _tagAttribute: ParseFunction<[PlainIdentifier, Expression]> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) =>
    given(consume(code, index, "="), index =>
    expec(_elementEmbeddedExpression(module, code, index), err(code, index, "Expression"), ({ parsed: expression, index }) => ({
        parsed: [ name, expression ],
        index,
    }))))

const _elementEmbeddedExpression: ParseFunction<Expression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Expression"), ({ parsed: expression, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: expression,
        index,
    }))))))

export const objectLiteral: ParseFunction<ObjectLiteral> = (module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(parseSeries(module, code, index, _spreadOrEntry, ","), ({ parsed: entries, index }) =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-literal",
            entries,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))

const _spreadOrEntry: ParseFunction<[PlainIdentifier, Expression]|Spread> = (module, code, startIndex) =>
    spread(module, code, startIndex)
    ?? _objectEntry(module, code, startIndex)

const _objectEntry = (module: ModuleName, code: string, index: number): ParseResult<[PlainIdentifier, Expression]> | BagelError | undefined =>
    given(plainIdentifier(module, code, index), ({ parsed: key, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(expression(module, code, index), ({ parsed: value, index }) => ({
        parsed: [key, value],
        index,
    }))))))

const arrayLiteral: ParseFunction<ArrayLiteral> = (module, code, startIndex) =>
    given(consume(code, startIndex, "["), index =>
    given(parseSeries(module, code, index, _expressionOrSpread, ","), ({ parsed: entries, index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "array-literal",
            entries,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))

const _expressionOrSpread: ParseFunction<Expression|Spread> = (module, code, startIndex) =>
    spread(module, code, startIndex)
    ?? expression(module, code, startIndex)

const spread: ParseFunction<Spread> = (module, code, startIndex) =>
    given(consume(code, startIndex, '...'), index =>
    expec(expression(module, code, index), err(code, index, 'Spread array'), ({ parsed: expr, index }) => ({
        parsed: {
            kind: 'spread',
            expr,
            module,
            code,
            startIndex,
            endIndex: index,

        },
        index
    })))


const stringLiteral: ParseFunction<StringLiteral|ExactStringLiteral> = (module, code, startIndex) => {
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

                const expressionResult = expression(module, code, index);
                if (isError(expressionResult)) {
                    return expressionResult;
                } else if (expressionResult == null) {
                    return err(code, index, "Expression");
                } else {
                    segments.push(expressionResult.parsed);
                    index = expressionResult.index;

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

            if (segments.length === 1 && typeof segments[0] === 'string') {
                return {
                    parsed: {
                        kind: "exact-string-literal",
                        value: segments[0],
                        module,
                        code,
                        startIndex,
                        endIndex: index + 1,
                    },
                    index: index + 1,
                }
            } else {
                return {
                    parsed: {
                        kind: "string-literal",
                        segments,
                        module,
                        code,
                        startIndex,
                        endIndex: index + 1,
                    },
                    index: index + 1,
                }
            }
        }
    }
}

const exactStringLiteral: ParseFunction<ExactStringLiteral> = (module, code, startIndex) =>
    given(stringLiteral(module, code, startIndex), ({ parsed: literal, index }) =>
        literal.kind === 'exact-string-literal' ?
            {
                parsed: literal,
                index
            }
        : undefined)

const numberLiteral: ParseFunction<NumberLiteral> = (module, code, startIndex) => {
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
                value: Number(code.substring(numberStart, index)),
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
        }
    }
}

const booleanLiteral: ParseFunction<BooleanLiteral> = (module, code, startIndex) => {

    {
        const index = consume(code, startIndex, "true");
        if (index != null) {
            return {
                parsed: {
                    kind: "boolean-literal",
                    value: true,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index,
            }
        }
    }
    
    {
        const index = consume(code, startIndex, "false");
        if (index != null) {
            return {
                parsed: {
                    kind: "boolean-literal",
                    value: false,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index,
            }
        }
    }
}

const nilLiteral: ParseFunction<NilLiteral> = (module, code, startIndex) => 
    given(consume(code, startIndex, "nil"), index => ({
        parsed: {
            kind: "nil-literal",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))

const javascriptEscape: ParseFunction<JavascriptEscape> = (module, code, startIndex) =>
    given(consume(code, startIndex, "js#"), jsStartIndex => {
        let jsEndIndex = jsStartIndex;

        while (code[jsEndIndex] !== "#" || code[jsEndIndex+1] !== "j" || code[jsEndIndex+2] !== "s") {
            jsEndIndex++;
        }

        return expec(consume(code, jsEndIndex, "#js"), err(code, jsEndIndex, '"#js"'), index => ({
            parsed: {
                kind: "javascript-escape",
                js: code.substring(jsStartIndex, jsEndIndex),
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
        }));
})

const debug: ParseFunction<Debug> = (module, code, startIndex) =>
    given(consume(code, startIndex, '!debug['), index => 
    given(consumeWhitespace(code, index), index =>
    given(expression(module, code, index) ?? declaration(module, code, index), ({ parsed: inner, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ']'), index => {
        stripSourceInfo(inner)

        return {
            parsed: {
                kind: "debug",
                inner: log(inner, ast => JSON.stringify({ bgl: code.substring(ast.startIndex ?? startIndex, ast.endIndex ?? index), ast }, null, 2)),
                module,
                code,
                startIndex,
                endIndex: index
            },
            index
        }
    })))))

const EXPRESSION_PARSER = new TieredParser<Expression>([
    [ debug, javascriptEscape, elementTag ],
    [ func, proc ],
    [ asCast ],
    [ binaryOperator(0) ],
    [ binaryOperator(1) ],
    [ binaryOperator(2) ],
    [ binaryOperator(3) ],
    [ binaryOperator(4) ],
    [ binaryOperator(5) ],
    [ binaryOperator(6) ],
    [ negationOperator ],
    [ indexer ],
    [ invocationAccessorChain ],
    [ range ],
    [ parenthesized ],
    [ localIdentifier ],
    [ ifElseExpression, switchExpression, inlineConstGroup, booleanLiteral, nilLiteral, objectLiteral, arrayLiteral, 
        stringLiteral, numberLiteral ],
])

const TYPE_PARSER = new TieredParser<TypeExpression>([
    [ genericType ],
    [ unionType ],
    [ boundGenericType ],
    [ maybeType ],
    [ arrayType ],
    [ primitiveType, elementType, funcType, procType, 
        literalType, namedType, recordType, objectType, parenthesizedType, 
        tupleType, unknownType ],
])