import { log, withoutSourceInfo } from "../utils/debugging.ts";
import { BagelError, isError, syntaxError } from "../errors.ts";
import { memoize, memoize3 } from "../utils/misc.ts";
import { Module, Debug, Block, PlainIdentifier, SourceInfo } from "../_model/ast.ts";
import { ModuleName,ReportError } from "../_model/common.ts";
import { AutorunDeclaration, ConstDeclaration, Declaration, FuncDeclaration, ImportDeclaration, ProcDeclaration, StoreDeclaration, StoreFunction, StoreMember, StoreProcedure, StoreProperty, TestBlockDeclaration, TestExprDeclaration, TypeDeclaration } from "../_model/declarations.ts";
import { ArrayLiteral, BinaryOperator, BooleanLiteral, ElementTag, Expression, Func, Invocation, IfElseExpression, Indexer, JavascriptEscape, LocalIdentifier, NilLiteral, NumberLiteral, ObjectLiteral, ParenthesizedExpression, Pipe, Proc, PropertyAccessor, Range, StringLiteral, SwitchExpression, InlineConst, ExactStringLiteral, Case, Operator, BINARY_OPS, NegationOperator, AsCast, Spread } from "../_model/expressions.ts";
import { Assignment, CaseBlock, ConstDeclarationStatement, ForLoop, IfElseStatement, LetDeclaration, Statement, WhileLoop } from "../_model/statements.ts";
import { ArrayType, FuncType, IndexerType, LiteralType, NamedType, ObjectType, PrimitiveType, ProcType, TupleType, TypeExpression, UnionType, UnknownType, Attribute, Arg, ElementType, GenericType, ParenthesizedType, MaybeType, BoundGenericType, IteratorType, PlanType, GenericFuncType } from "../_model/type-expressions.ts";
import { consume, consumeWhitespace, consumeWhitespaceRequired, err, expec, given, identifierSegment, isNumeric, ParseFunction, parseExact, parseOptional, ParseResult, parseSeries, plainIdentifier } from "./common.ts";


export function parse(module: ModuleName, code: string, reportError: ReportError): Module {
    let index = 0;

    const declarations: Declaration[] = [];
    index = consumeWhitespace(code, index);
    let result = declaration(module, code, index);
    while (result != null && !isError(result)) {
        declarations.push(result.parsed);
        index = result.newIndex;
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

    return {
        kind: "module",
        hasMain: declarations.some(decl => decl.kind === "proc-declaration" && decl.name.name === "main"),
        declarations,
        module,
        code,
        startIndex: 0,
        endIndex: index
    };
}

const declaration: ParseFunction<Declaration> = (module, code, startIndex) =>
    debug(module, code, startIndex)
    ?? importDeclaration(module, code, startIndex)
    ?? _nominalTypeDeclaration(module, code, startIndex)
    ?? typeDeclaration(module, code, startIndex)
    ?? procDeclaration(module, code, startIndex)
    ?? funcDeclaration(module, code, startIndex)
    ?? constDeclaration(module, code, startIndex)
    ?? storeDeclaration(module, code, startIndex)
    ?? autorunDeclaration(module, code, startIndex)
    ?? testExprDeclaration(module, code, startIndex)
    ?? testBlockDeclaration(module, code, startIndex)
    ?? javascriptEscape(module, code, startIndex)

const importDeclaration: ParseFunction<ImportDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, "from"), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(exactStringLiteral(module, code, index), err(code, index, 'Import path'), ({ parsed: path, newIndex: index }) => 
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(consume(code, index, "import"), err(code, index, '"import"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(parseSeries(module, code, index, plainIdentifier, ","), ({ parsed: imports, newIndex: index }) =>
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
        newIndex: index
    })))))))))))

const typeDeclaration: ParseFunction<TypeDeclaration> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("export")(module, code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, 'type'), index => 
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, 'Type name'), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression'), ({ parsed: type, newIndex: index }) => ({
        parsed: {
            kind: "type-declaration",
            name,
            type,
            exported: exported != null,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))))

const _nominalTypeDeclaration: ParseFunction<TypeDeclaration> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("export")(module, code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "nominal"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(consume(code, index, "type"), err(code, index, '"type"'), index => 
    given(consumeWhitespaceRequired(code, index), startOfNameIndex =>
    expec(plainIdentifier(module, code, startOfNameIndex), err(code, startOfNameIndex, 'Type name'), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression'), ({ parsed: inner, newIndex: index }) =>
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
            exported: exported != null,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))))))))


const typeExpression: ParseFunction<TypeExpression> =  memoize3((module, code, startIndex) =>
    TYPE_PARSER.parseStartingFromTier(0)(module, code, startIndex))

const genericType: ParseFunction<GenericType> = (module, code, startIndex) =>
    given(_typeParams(module, code, startIndex), ({ parsed: typeParams, newIndex: index }) =>
    expec(typeExpression(module, code, index), err(code, index, "Type"), ({ parsed: inner, newIndex: index }) => ({
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
        newIndex: index
    })))

const arrayType: ParseFunction<ArrayType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("const")(module, code, index), ({ parsed: constant, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: constant, newIndex: index })))), ({ parsed: constant, newIndex: indexAfterConstant }) =>
    given(TYPE_PARSER.parseBeneath(module, code, indexAfterConstant ?? startIndex, arrayType), ({ parsed: element, newIndex: index }) =>
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
        newIndex: index,
    }))))

const maybeType: ParseFunction<MaybeType> = (module, code, startIndex) =>
    given(TYPE_PARSER.parseBeneath(module, code, startIndex, maybeType), ({ parsed: inner, newIndex: index }) =>
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
        newIndex: index
    })))

const unionType: ParseFunction<UnionType> = (module, code, startIndex) =>
    // TODO: Allow leading |
    given(parseSeries(module, code, startIndex, TYPE_PARSER.beneath(unionType), "|", { leadingDelimiter: "optional", trailingDelimiter: "forbidden" }), ({ parsed: members, newIndex: index }) =>
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
                newIndex: index,
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
        newIndex: index,
    }))

const namedType: ParseFunction<NamedType> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, newIndex: index }) => ({
        parsed: {
            kind: "named-type",
            name,
            module,
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const objectType: ParseFunction<ObjectType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("const")(module, code, index), ({ parsed: constant, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: constant, newIndex: index })))), ({ parsed: constant, newIndex: indexAfterConstant }) =>
    given(consume(code, indexAfterConstant ?? startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _typeSpreadOrEntry, ","), ({ parsed: entries, newIndex: index }) =>
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
        newIndex: index,
    })))))))

const _typeSpreadOrEntry: ParseFunction<NamedType|Attribute> = (module, code, startIndex) => 
    _objectTypeEntry(module, code, startIndex) ?? _objectTypeSpread(module, code, startIndex)

const _objectTypeSpread: ParseFunction<NamedType> = (module, code, startIndex) =>
    given(consume(code, startIndex, '...'), index =>
    expec(namedType(module, code, index), err(code,  index, 'Named type'), ({ parsed, newIndex }) => ({
        parsed, newIndex
    })))

const _objectTypeEntry: ParseFunction<Attribute> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(module, code, index), ({ parsed: type, newIndex: index }) => ({
        parsed: {
            kind: "attribute",
            name,
            type,
            module,
            mutability: undefined,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index,
    }))))))

const indexerType: ParseFunction<IndexerType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("const")(module, code, index), ({ parsed: constant, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: constant, newIndex: index })))), ({ parsed: constant, newIndex: indexAfterConstant }) =>
    given(consume(code, indexAfterConstant ?? startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "["), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression for key'), ({ parsed: keyType, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index =>
    given(consume(code, index, ":"), index =>
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(module, code, index), ({ parsed: valueType, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "indexer-type",
            keyType,
            valueType,
            mutability: constant ? "readonly" : "mutable",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))))))))))

const tupleType: ParseFunction<TupleType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("const")(module, code, index), ({ parsed: constant, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: constant, newIndex: index })))), ({ parsed: constant, newIndex: indexAfterConstant }) =>
    given(consume(code, indexAfterConstant ?? startIndex, "["), index =>
    given(parseSeries(module, code, index, typeExpression, ","), ({ parsed: members, newIndex: index }) =>
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
        newIndex: index,
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
        newIndex: index,
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
        newIndex: index,
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
        newIndex: index,
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
        newIndex: index,
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
        newIndex: index,
    }))

const funcType: ParseFunction<FuncType|GenericFuncType> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, newIndex: indexAfterTypeParams }) =>
    given(consume(code, indexAfterTypeParams ?? startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, arg, ","), ({ parsed: args, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "=>"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Return type'), ({ parsed: returnType, newIndex: index }) => {
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
            newIndex: index
        }
    }))))))))))

// TODO: Generic proc type
const procType: ParseFunction<ProcType> = (module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, arg, ","), ({ parsed: args, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "{}"), index => ({
        parsed: {
            kind: "proc-type",
            args,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))

const _typeParam: ParseFunction<{ name: PlainIdentifier, extends: TypeExpression|undefined }> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, "extends"), index =>
        given(consumeWhitespaceRequired(code, index), index =>
        expec(typeExpression(module, code, index), err(code, index, 'Type expression (extends constraint)'), res => res)))), ({ parsed: extendz, newIndex: indexAfterExtends }) => ({
        parsed: {
            name,
            extends: extendz
        },
        newIndex: indexAfterExtends ?? index
    }))))

const boundGenericType: ParseFunction<BoundGenericType|IteratorType|PlanType> = (module, code, startIndex) =>
    given(TYPE_PARSER.beneath(boundGenericType)(module, code, startIndex), ({ parsed: generic, newIndex: index }) =>
    given(_typeArgs(module, code, index), ({ parsed: typeArgs, newIndex: index }) => 
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
                    newIndex: index
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
                    newIndex: index
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
            newIndex: index
        }))

const parenthesizedType: ParseFunction<ParenthesizedType> = (module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, "Type"), ({ parsed: inner, newIndex: index }) =>
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
        newIndex: index,
    }))))))

const literalType: ParseFunction<LiteralType> = (module, code, startIndex) =>
    given(exactStringLiteral(module, code, startIndex) 
        ?? numberLiteral(module, code, startIndex) 
        ?? booleanLiteral(module, code, startIndex), 
    ({ parsed: value, newIndex: index }) => ({
        parsed: {
            kind: "literal-type",
            value,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
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
        newIndex: index,
    }))

const procDeclaration: ParseFunction<ProcDeclaration> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("export")(module, code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "proc"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(proc(module, code, index), err(code, index, 'Procedure'), ({ parsed: proc, newIndex: index }) => ({
        parsed: {
            kind: "proc-declaration",
            name,
            value: proc,
            exported: exported != null,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))

const funcDeclaration: ParseFunction<FuncDeclaration> = (module, code, startIndex) => 
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("export")(module, code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "func"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(parseExact("memo")(module, code, index), ({ parsed: memo, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: memo, newIndex: index })))), ({ parsed: memo, newIndex: indexAfterMemo }) =>
    given(plainIdentifier(module, code, indexAfterMemo ?? index), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(func(module, code, index), err(code, index, 'Function'), ({ parsed: func, newIndex: index }) => ({
        parsed: {
            kind: "func-declaration",
            name,
            memo: memo != null,
            value: func,
            exported: exported != null,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))))

const constDeclaration: ParseFunction<ConstDeclaration> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("export")(module, code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "const"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, newIndex: index}) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(module, code, index)))), ({ parsed: type, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: value, newIndex: index }) => ({
            parsed: {
                kind: "const-declaration",
                name,
                type,
                value,
                exported: exported != null,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
    })))))))))))

const storeDeclaration: ParseFunction<StoreDeclaration> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("export")(module, code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "store"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, "Store name"), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(parseSeries(module, code, index, storeMember), ({ parsed: members, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "store-declaration",
            name,
            typeParams: [],
            members,
            exported: exported != null,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index
    }))))))))))

const storeMember: ParseFunction<StoreMember> = (module, code, startIndex) =>
    storeProperty(module, code, startIndex)
    ?? storeFunction(module, code, startIndex)
    ?? storeProcedure(module, code, startIndex)

const storeProperty: ParseFunction<StoreProperty> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(_accessModifierWithVisible(module, code, index), ({ parsed: access, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: access, newIndex: index })))), ({ parsed: access, newIndex: index }) =>
    given(plainIdentifier(module, code, index ?? startIndex), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(module, code, index)))), ({ parsed: type, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: value, newIndex: index }) => ({
        parsed: {
            kind: "store-property",
            name,
            type,
            value,
            access: access ?? 'private',
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))))

const storeFunction: ParseFunction<StoreFunction> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(_accessModifier(module, code, index), ({ parsed: access, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: access, newIndex: index })))), ({ parsed: access, newIndex: index }) =>
    given(funcDeclaration(module, code, index ?? startIndex), ({ parsed: { name, value, memo }, newIndex: index }) => ({
        parsed: {
            kind: "store-function",
            memo,
            name,
            value,
            access: access ?? 'private',
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))

const storeProcedure: ParseFunction<StoreProcedure> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(_accessModifier(module, code, index), ({ parsed: access, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: access, newIndex: index })))), ({ parsed: access, newIndex: index }) =>
    given(procDeclaration(module, code, index ?? startIndex), ({ parsed: { name, value }, newIndex: index }) => ({
    parsed: {
        kind: "store-procedure",
        name,
        value,
        access: access ?? 'private',
        module,
        code,
        startIndex,
        endIndex: index,
    },
    newIndex: index,
    })))

const _accessModifierWithVisible: ParseFunction<'private'|'public'|'visible'> = (module, code, startIndex) =>
    _accessModifier(module, code, startIndex)
    ?? given(consume(code, startIndex, "visible"), index => ({
        parsed: "visible",
        newIndex: index
    }))

const _accessModifier: ParseFunction<'private'|'public'> = (_module, code, startIndex) =>
    given(consume(code, startIndex, "private"), index => ({
        parsed: "private",
        newIndex: index
    }))
    ?? given(consume(code, startIndex, "public"), index => ({
        parsed: "public",
        newIndex: index
    }))

const autorunDeclaration: ParseFunction<AutorunDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, "autorun"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Effect"), ({ parsed: effect, newIndex: index }) => ({
        parsed: {
            kind: "autorun-declaration",
            effect,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))

const testExprDeclaration: ParseFunction<TestExprDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, 'test'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, 'expr'), index =>
    given(consumeWhitespace(code, index), index => 
    expec(exactStringLiteral(module, code, index), err(code, index, 'Test name'), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '='), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Test expression'), ({ parsed: expr, newIndex: index }) => ({
        parsed: {
            kind: 'test-expr-declaration',
            name,
            expr,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))))

const testBlockDeclaration: ParseFunction<TestBlockDeclaration> = (module, code, startIndex) => 
    given(consume(code, startIndex, 'test'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, 'block'), index =>
    given(consumeWhitespace(code, index), index => 
    expec(exactStringLiteral(module, code, index), err(code, index, 'Test name'), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Test block'), ({ parsed: block, newIndex: index }) => ({
        parsed: {
            kind: 'test-block-declaration',
            name,
            block,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))

// TODO: Generic proc
const proc: ParseFunction<Proc> = (module, code, startIndex) =>
    given(_args(module, code, startIndex), ({ parsed: args, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlock(module, code, index), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "proc",
            type: {
                kind: "proc-type",
                args,
                module,
                mutability: undefined,
                code,
                startIndex,
                endIndex: index
            },
            body,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index,
    }))))

const statement: ParseFunction<Statement> = (module, code, startIndex) =>
    javascriptEscape(module, code, startIndex)
    ?? letDeclaration(module, code, startIndex)
    ?? constDeclarationStatement(module, code, startIndex)
    ?? ifElseStatement(module, code, startIndex)
    ?? forLoop(module, code, startIndex)
    ?? whileLoop(module, code, startIndex)
    ?? assignment(module, code, startIndex)
    ?? procCall(module, code, startIndex)

const letDeclaration: ParseFunction<LetDeclaration> = (module, code, startIndex) =>
    given(consume(code, startIndex, "let"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, "Variable name"), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(module, code, index)))), ({ parsed: type, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: value, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
            parsed: {
                kind: "let-declaration",
                name,
                value,
                type,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
        }))))))))))))

const constDeclarationStatement: ParseFunction<ConstDeclarationStatement> = (module, code, startIndex) => 
    given(consume(code, startIndex, "const"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, "Constant name"), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(module, code, index)))), ({ parsed: type, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: value, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
            parsed: {
                kind: "const-declaration-statement",
                name,
                value,
                type,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
        }))))))))))))

const assignment: ParseFunction<Assignment> = (module, code, startIndex) =>
    given(invocationAccessorChain(module, code, startIndex) ?? localIdentifier(module, code, startIndex), ({ parsed: target, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "="), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Assignment value"), ({ parsed: value, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => 
        target.kind === "local-identifier" || target.kind === "property-accessor" ? {
            parsed: {
                kind: "assignment",
                target,
                value,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
        } : undefined
    )))))))

const procCall: ParseFunction<Invocation> = (module, code, startIndex) =>
    given(invocationAccessorChain(module, code, startIndex), ({ parsed, newIndex: index }) =>
    expec(consume(code, index, ';'), err(code, index, '";"'), index => 
        parsed.kind === "invocation" ? {
        parsed,
        newIndex: index
        } : undefined))
    

const ifElseStatement: ParseFunction<IfElseStatement> = (module, code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
    given(parseSeries(module, code, index, _conditionAndOutcomeBlock, 'else if', { trailingDelimiter: "forbidden" }), ({ parsed: cases, newIndex: index }) => {
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
                newIndex: index,
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
                newIndex: elseResult.newIndex,
            }
        }
    }))

const _conditionAndOutcomeBlock: ParseFunction<CaseBlock> = (module, code, startIndex) =>
    given(expression(module, code, startIndex), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Block for if clause'), ({ parsed: outcome, newIndex: index }) => ({
        parsed: {
            kind: "case-block",
            condition,
            outcome,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))

const forLoop: ParseFunction<ForLoop> = (module, code, startIndex) =>
    given(consume(code, startIndex, "for"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, 'Item identifier for loop items'), ({ parsed: itemIdentifier, newIndex: index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(consume(code, index, "of"), err(code, index, '"of"'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Iterator expression'), ({ parsed: iterator, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Loop body'), ({ parsed: body, newIndex: index }) => ({
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
        newIndex: index,
    }))))))))))))))

const whileLoop: ParseFunction<WhileLoop> = (module, code, startIndex) =>
    given(consume(code, startIndex, "while"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'While loop condition'), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Loop body'), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "while-loop",
            condition,
            body,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))))))

const parseBlock: ParseFunction<Block> = (module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlockWithoutBraces(module, code, index), ({ parsed, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed,
        newIndex: index,
    }))))))

const parseBlockWithoutBraces: ParseFunction<Block> = (module, code, startIndex) =>
    given(parseSeries(module, code, startIndex, statement), ({ parsed: statements, newIndex: index }) => ({
        parsed: {
            kind: "block",
            statements,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const expression: ParseFunction<Expression> = memoize3((module, code, startIndex) =>
    EXPRESSION_PARSER.parseStartingFromTier(0)(module, code, startIndex))

const func: ParseFunction<Func> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, newIndex: indexAfterTypeParams }) =>
    given(_args(module, code, indexAfterTypeParams ?? startIndex), ({ parsed: args, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(module, code, index)))), ({ parsed: returnType, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    given(consume(code, index, "=>"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Function body'), ({ parsed: body, newIndex: index }) => {
        const funcType: FuncType = {
            kind: "func-type",
            args,
            returnType,
            module,
            mutability: undefined,
            code,
            startIndex,
            endIndex: index
        }

        return {
            parsed: {
                kind: "func",
                type: (
                    typeParams
                        ? {
                            kind: "generic-type",
                            typeParams,
                            inner: funcType,
                            module,
                            mutability: undefined,
                            code,
                            startIndex,
                            endIndex: index
                        }
                        : funcType
                ),
                body,
                module,
                code,
                startIndex,
                endIndex: index
            },
            newIndex: index,
        }
    }))))))))

const _typeParams: ParseFunction<{ name: PlainIdentifier, extends: TypeExpression | undefined }[]> = (module, code, index) =>
    given(consume(code, index, "<"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseSeries(module, code, index, _typeParam, ','), err(code, index, "Type parameters"), ({ parsed: typeParams, newIndex: index }) =>
    given(consumeWhitespace(code, index), index => 
    given(consume(code, index, ">"), index => ({ parsed: typeParams, newIndex: index }))))))

const _args: ParseFunction<Arg[]> = (module, code, startIndex) => 
    _singleArgument(module, code, startIndex) ?? _seriesOfArguments(module, code, startIndex)

const _singleArgument: ParseFunction<Arg[]> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, newIndex: index }) => ({
        parsed: [
            {
                kind: "arg",
                name,
                module,
                code,
                startIndex,
                endIndex: index
            }
        ],
        newIndex: index
    }))

const _seriesOfArguments: ParseFunction<Arg[]> = (module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(parseSeries(module, code, index, arg, ","), ({ parsed: args, newIndex: index }) =>
    given(consume(code, index, ")"), index => ({
        parsed: args,
        newIndex: index
    }))))

const arg: ParseFunction<Arg> = (module, code, startIndex) => 
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index => 
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, ":"), index =>
            given(consumeWhitespace(code, index), index => typeExpression(module, code, index)))), ({ parsed: type, newIndex }) => ({
        parsed: {
            kind: "arg",
            name,
            type,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: newIndex ?? index
    }))))

const inlineConst: ParseFunction<InlineConst> = (module, code, startIndex) =>
    given(consume(code, startIndex, 'const'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consume(code, index, ':'), index =>
        given(consumeWhitespace(code, index), index => 
        expec(typeExpression(module, code, index), err(code, index, "Type"), res => res)))), ({ parsed: type, newIndex: indexAfterType }) =>
    given(consumeWhitespace(code, indexAfterType ?? index), index =>
    given(consume(code, index, '='), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Value"), ({ parsed: value, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ','), err(code, index, '","'), index =>
    given(consumeWhitespace(code, index), index => 
    expec(expression(module, code, index), err(code, index, "Expression"), ({ parsed: next, newIndex: index }) =>({
        parsed: {
            kind: "inline-const",
            name,
            type,
            value,
            next,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))))))))

const pipe: ParseFunction<Pipe> = (module, code, startIndex) => 
    given(parseSeries(module, code, startIndex, EXPRESSION_PARSER.beneath(pipe), "|>", { trailingDelimiter: "forbidden" }), ({ parsed: expressions, newIndex: index }) =>
        expressions.length >= 2
            ? {
                parsed: expressions.slice(1).reduce((acc, expr) => ({
                    kind: "pipe",
                    subject: expr,
                    args: [acc],
                    module,
                    code: expr.code,
                    startIndex: expr.startIndex,
                    endIndex: expr.endIndex
                }), expressions[0]) as Pipe,
                newIndex: index
            }
            : undefined)

const binaryOperator = memoize((tier: number): ParseFunction<BinaryOperator> => memoize3((module, code, startIndex) => 
    given(parseSeries(module, code, startIndex, 
        EXPRESSION_PARSER.beneath(binaryOperator(tier)), 
        _binaryOperatorSymbol(tier), 
        { leadingDelimiter: "forbidden", trailingDelimiter: "forbidden" }
    ), ({ parsed: segments, newIndex: index }) => 
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
                newIndex: index,
            }))
        : undefined
    )))


const asCast: ParseFunction<AsCast> = (module, code, startIndex) =>
    given(EXPRESSION_PARSER.beneath(asCast)(module, code, startIndex), ({ parsed: inner, newIndex: index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, "as"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, '"Type expression"'), ({ parsed: type, newIndex: index }) => ({
        parsed: {
            kind: "as-cast",
            inner,
            type,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index
    }))))))


const negationOperator: ParseFunction<NegationOperator> = memoize3((module, code, startIndex) => 
    given(consume(code, startIndex, "!"), index =>
    expec(EXPRESSION_PARSER.beneath(negationOperator)(module, code, index), err(code, index, "Boolean expression"), ({ parsed: base, newIndex: index }) => ({
        parsed: {
            kind: "negation-operator",
            base,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))

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

const _binaryOperatorSymbol = memoize((tier: number): ParseFunction<Operator> => (module, code, startIndex) => {
    for (const op of BINARY_OPS[tier]) {
        if (code.substr(startIndex, op.length) === op) {
            const endIndex = startIndex + op.length

            return {
                parsed: {
                    kind: "operator",
                    op,
                    module,
                    code,
                    startIndex,
                    endIndex,
                },
                newIndex: endIndex,
            };
        }
    }

    return undefined;
})
    
const indexer: ParseFunction<Indexer> = (module, code, startIndex) =>
    given(EXPRESSION_PARSER.parseBeneath(module, code, startIndex, indexer), ({ parsed: base, newIndex: index }) =>
    given(parseSeries(module, code, index, _indexerExpression), ({ parsed: indexers, newIndex: index }) => 
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
                newIndex: index,
            }
        : undefined))

const _indexerExpression: ParseFunction<Expression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "["), index => 
    expec(expression(module, code, index), err(code, index, 'Indexer expression'),({ parsed: indexer, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: indexer,
        newIndex: index
    }))))

const ifElseExpression: ParseFunction<IfElseExpression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
    given(parseSeries(module, code, index, _case, 'else if', { trailingDelimiter: "forbidden" }), ({ parsed: cases, newIndex: index }) => {
        const elseResultResult = 
            given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
            given(consumeWhitespace(code, index), index =>
            expec(expression(module, code, index), err(code, index, 'Result expression for else clause'), ({ parsed, newIndex: index }) =>
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({ parsed, newIndex: index })))))))));

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
                newIndex: index,
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
                newIndex: elseResultResult.newIndex,
            }
        }
    }))

const _case: ParseFunction<Case> = (module, code, startIndex) =>
    given(expression(module, code, startIndex), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Result expression for if clause'), ({ parsed: outcome, newIndex: index }) => 
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
        newIndex: index
    }))))))))

const switchExpression: ParseFunction<SwitchExpression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "switch"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '('), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Switch expression"), ({ parsed: value, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ')'), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '{'), err(code, index, '"{"'), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _switchCase, ','), ({ parsed: cases, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, _defaultCase), ({ parsed: defaultCase, newIndex: indexAfterDefault }) =>
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
        newIndex: index
    }))))))))))))))))

const _switchCase: ParseFunction<Case> = (module, code, startIndex) =>
    given(consume(code, startIndex, 'case'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Case expression'), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Case result'), ({ parsed: outcome, newIndex: index }) => ({
        parsed: {
            kind: "case",
            condition,
            outcome,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))

const _defaultCase: ParseFunction<Expression> = (module, code, startIndex) =>
    given(consume(code, startIndex, 'default'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Case result'), ({ parsed: outcome, newIndex: index }) => ({
        parsed: outcome,
        newIndex: index
    }))))))


const range: ParseFunction<Range> = (module, code, startIndex) =>
    given(numberLiteral(module, code, startIndex), ({ parsed: firstNumber, newIndex: index }) =>
    given(consume(code, index, ".."), index =>
    expec(numberLiteral(module, code, index), err(code, index, 'Range end'), ({ parsed: secondNumber, newIndex: index }) => ({
        parsed: {
            kind: "range",
            start: firstNumber.value,
            end: secondNumber.value,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))));

const parenthesized: ParseFunction<ParenthesizedExpression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(expression(module, code, index), ({ parsed: inner, newIndex: index }) =>
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
        newIndex: index,
    }))))))

const invocationAccessorChain: ParseFunction<Invocation|PropertyAccessor> = (module, code, startIndex) =>
    given(EXPRESSION_PARSER.parseBeneath(module, code, startIndex, invocationAccessorChain), ({ parsed: subject, newIndex: index }) =>
    given(parseSeries<InvocationArgs|PropertyAccess>(module, code, index, (module, code, index) => 
        _invocationArgs(module, code, index) ?? _propertyAccess(module, code, index)), ({ parsed: gets, newIndex: index }) => 
        gets.length > 0 ? {
            parsed: _getsToInvocationsAndAccesses(subject, gets),
            newIndex: index
        } : undefined))

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
    given(parseOptional(module, code, startIndex, _typeArgs), ({ parsed: typeArgs, newIndex: indexAfterTypeArgs }) =>
    given(consume(code, indexAfterTypeArgs ?? startIndex, "("), index => 
    given(parseSeries(module, code, index, expression, ","), ({ parsed: exprs, newIndex: index }) =>
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
        newIndex: index
    })))))

const _typeArgs: ParseFunction<TypeExpression[]> = (module, code, startIndex) =>
    given(consume(code, startIndex, "<"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, typeExpression, ','), ({ parsed: typeArgs, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ">"), index => ({ parsed: typeArgs, newIndex: index }))))))

type PropertyAccess = SourceInfo & { kind: "property-access", property: PlainIdentifier, optional: boolean }

const _propertyAccess: ParseFunction<PropertyAccess> = (module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, parseExact("?")), ({ parsed: question, newIndex: indexAfterQuestion }) =>
    given(consume(code, indexAfterQuestion ?? startIndex, "."), index =>
    expec(plainIdentifier(module, code, index), err(code, index, "Property name"), ({ parsed: property, newIndex: index }) => ({
        parsed: {
            kind: "property-access",
            property,
            optional: question != null,
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))


const localIdentifier: ParseFunction<LocalIdentifier> = (module, code, startIndex) => 
    given(identifierSegment(code, startIndex), ({ segment: name, newIndex: index }) => ({
        parsed: {
            kind: "local-identifier",
            name,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

// TODO: Support /> closing
export const elementTag: ParseFunction<ElementTag> = (module, code, startIndex) =>
    given(consume(code, startIndex, "<"), index =>
    given(plainIdentifier(module, code, index), ({ parsed: tagName, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _tagAttribute), ({ parsed: attributes, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ">"), err(code, index, '">"'), index => 
    given(parseSeries(module, code, index, (module, code, index) => elementTag(module, code, index) ?? _elementEmbeddedExpression(module, code, index)), ({ parsed: children, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "</"), err(code, index, 'Closing tag'), index => 
    expec(plainIdentifier(module, code, index), err(code, index, "Closing tag name"), ({ parsed: closingTagName, newIndex: index }) =>
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
        newIndex: index,
    }))))))))))))

const _tagAttribute: ParseFunction<[PlainIdentifier, Expression]> = (module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, newIndex: index }) =>
    given(consume(code, index, "="), index =>
    expec(_elementEmbeddedExpression(module, code, index), err(code, index, "Expression"), ({ parsed: expression, newIndex: index }) => ({
        parsed: [ name, expression ],
        newIndex: index,
    }))))

const _elementEmbeddedExpression: ParseFunction<Expression> = (module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Expression"), ({ parsed: expression, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: expression,
        newIndex: index,
    }))))))

export const objectLiteral: ParseFunction<ObjectLiteral> = (module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(parseSeries(module, code, index, _spreadOrEntry, ","), ({ parsed: entries, newIndex: index }) =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-literal",
            entries,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))

const _spreadOrEntry: ParseFunction<[PlainIdentifier, Expression]|Spread> = (module, code, startIndex) =>
    spread(module, code, startIndex)
    ?? _objectEntry(module, code, startIndex)

const _objectEntry = (module: ModuleName, code: string, index: number): ParseResult<[PlainIdentifier, Expression]> | BagelError | undefined =>
    given(plainIdentifier(module, code, index), ({ parsed: key, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(expression(module, code, index), ({ parsed: value, newIndex: index }) => ({
        parsed: [key, value],
        newIndex: index,
    }))))))

const arrayLiteral: ParseFunction<ArrayLiteral> = (module, code, startIndex) =>
    given(consume(code, startIndex, "["), index =>
    given(parseSeries(module, code, index, _expressionOrSpread, ","), ({ parsed: entries, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "array-literal",
            entries,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))

const _expressionOrSpread: ParseFunction<Expression|Spread> = (module, code, startIndex) =>
    spread(module, code, startIndex)
    ?? expression(module, code, startIndex)

const spread: ParseFunction<Spread> = (module, code, startIndex) =>
    given(consume(code, startIndex, '...'), index =>
    expec(expression(module, code, index), err(code, index, 'Spread array'), ({ parsed: expr, newIndex: index }) => ({
        parsed: {
            kind: 'spread',
            expr,
            module,
            code,
            startIndex,
            endIndex: index,

        },
        newIndex: index
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
                    newIndex: index + 1,
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
                    newIndex: index + 1,
                }
            }
        }
    }
}

const exactStringLiteral: ParseFunction<ExactStringLiteral> = (module, code, startIndex) =>
    given(stringLiteral(module, code, startIndex), ({ parsed: literal, newIndex: index }) =>
        literal.kind === 'exact-string-literal' ?
            {
                parsed: literal,
                newIndex: index
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
            newIndex: index,
        }
    }
}

const booleanLiteral: ParseFunction<BooleanLiteral> = (module, code, startIndex) => {

    const indexAfterTrue = consume(code, startIndex, "true");
    if (indexAfterTrue != null) {
        return {
            parsed: {
                kind: "boolean-literal",
                value: true,
                module,
                code,
                startIndex,
                endIndex: indexAfterTrue,
            },
            newIndex: indexAfterTrue,
        }
    }
    
    const indexAfterFalse = consume(code, startIndex, "false");
    if (indexAfterFalse != null) {
        return {
            parsed: {
                kind: "boolean-literal",
                value: false,
                module,
                code,
                startIndex,
                endIndex: indexAfterFalse,
            },
            newIndex: indexAfterFalse,
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
        newIndex: index,
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
            newIndex: index,
        }));
})

const debug: ParseFunction<Debug> = (module, code, startIndex) =>
    given(consume(code, startIndex, '!debug['), index => 
    given(consumeWhitespace(code, index), index =>
    given(expression(module, code, index) ?? declaration(module, code, index), ({ parsed: inner, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ']'), index => ({
        parsed: {
            kind: "debug",
            inner: log(inner, ast => JSON.stringify({ bgl: code.substring(ast.startIndex ?? startIndex, ast.endIndex ?? index), ast: withoutSourceInfo(ast) }, null, 2)),
            module,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))


type ParseTiers<T> = readonly ParseFunction<T>[][]

class TieredParser<T> {
    private readonly nextTierFor

    constructor(private readonly tiers: ParseTiers<T>) {
        this.nextTierFor = new Map<ParseFunction<T>, number>();
    
        for (let i = 0; i < tiers.length; i++) {
            for (const fn of tiers[i]) {
                this.nextTierFor.set(fn, i+1);
            }
        }
    }
    
    public readonly parseStartingFromTier = (tier: number): ParseFunction<T> => (module, code, index) => {
        for (let i = tier; i < this.tiers.length; i++) {
            for (const fn of this.tiers[i]) {
                const result = fn(module, code, index)

                if (result != null) {
                    return result;
                }
            }
        }

        return undefined;
    }

    public readonly beneath = (fn: ParseFunction<T>): ParseFunction<T> => ((module: ModuleName, code: string, index: number) =>
        this.parseStartingFromTier(this.nextTierFor.get(fn) as number)(module, code, index))

    public readonly parseBeneath = (module: ModuleName, code: string, index: number, fn: ParseFunction<T>) =>
        this.beneath(fn)(module, code, index)
}

const EXPRESSION_PARSER = new TieredParser<Expression>([
    [ debug, javascriptEscape, pipe, elementTag ],
    [ func, proc, range ],
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
    [ parenthesized ],
    [ localIdentifier ],
    [ ifElseExpression, switchExpression, inlineConst, booleanLiteral, nilLiteral, objectLiteral, arrayLiteral, 
        stringLiteral, numberLiteral ],
])

const TYPE_PARSER = new TieredParser<TypeExpression>([
    [ genericType ],
    [ unionType ],
    [ boundGenericType ],
    [ maybeType ],
    [ arrayType ],
    [ primitiveType, elementType, funcType, procType, 
        literalType, namedType, indexerType, objectType, parenthesizedType, 
        tupleType, unknownType ],
])