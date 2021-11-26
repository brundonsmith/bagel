import { log, withoutSourceInfo } from "../debugging.ts";
import { BagelError, isError } from "../errors.ts";
import { memoize, memoize2 } from "../utils.ts";
import { Module, Debug } from "../_model/ast.ts";
import { Block, PlainIdentifier, SourceInfo } from "../_model/common.ts";
import { ClassDeclaration, ClassFunction, ClassMember, ClassProcedure, ClassProperty, ConstDeclaration, Declaration, FuncDeclaration, ImportDeclaration, ProcDeclaration, TestBlockDeclaration, TestExprDeclaration, TypeDeclaration } from "../_model/declarations.ts";
import { ArrayLiteral, BinaryOperator, BooleanLiteral, ClassConstruction, ElementTag, Expression, Func, Invocation, IfElseExpression, Indexer, JavascriptEscape, LocalIdentifier, NilLiteral, NumberLiteral, ObjectLiteral, ParenthesizedExpression, Pipe, Proc, PropertyAccessor, Range, StringLiteral, SwitchExpression, InlineConst, ExactStringLiteral, Case, Operator, BINARY_OPS, NegationOperator } from "../_model/expressions.ts";
import { Assignment, ConstDeclarationStatement, ForLoop, IfElseStatement, LetDeclaration, Reaction, Statement, WhileLoop } from "../_model/statements.ts";
import { ArrayType, FuncType, IndexerType, IteratorType, LiteralType, NamedType, ObjectType, PrimitiveType, ProcType, PlanType, TupleType, TypeExpression, UnionType, UnknownType, Attribute, Arg, ElementType } from "../_model/type-expressions.ts";
import { consume, consumeWhitespace, consumeWhitespaceRequired, err, expec, given, identifierSegment, isNumeric, ParseFunction, parseExact, parseOptional, ParseResult, parseSeries, plainIdentifier } from "./common.ts";


export function parse(code: string, reportError: (error: BagelError) => void): Module {
    let index = 0;

    const declarations: Declaration[] = [];
    index = consumeWhitespace(code, index);
    let result = declaration(code, index);
    while (result != null && !isError(result)) {
        declarations.push(result.parsed);
        index = result.newIndex;
        index = consumeWhitespace(code, index);

        result = declaration(code, index);
    }

    
    if (isError(result)) {
        reportError(result);
    } else if (index < code.length) {
        reportError({
            kind: "bagel-syntax-error",
            code,
            index,
            message: `Failed to parse entire file`,
            stack: undefined,
        });
    }

    // Move consts to the bottom so that all other declarations will be available to them
    declarations.sort((a, b) =>
        a.kind === "const-declaration" && b.kind !== "const-declaration" ? 1 :
        a.kind !== "const-declaration" && b.kind === "const-declaration" ? -1 :
        0)

    return {
        kind: "module",
        hasMain: declarations.some(decl => decl.kind === "proc-declaration" && decl.name.name === "main"),
        declarations,
        id: Symbol(),
        code,
        startIndex: 0,
        endIndex: index
    };
}

const declaration: ParseFunction<Declaration> = (code, index) =>
    debug(code, index)
    ?? importDeclaration(code, index)
    ?? typeDeclaration(code, index)
    ?? procDeclaration(code, index)
    ?? funcDeclaration(code, index)
    ?? constDeclaration(code, index)
    ?? classDeclaration(code, index)
    ?? testExprDeclaration(code, index)
    ?? testBlockDeclaration(code, index)
    ?? javascriptEscape(code, index)

const importDeclaration: ParseFunction<ImportDeclaration> = (code, startIndex) =>
    given(consume(code, startIndex, "from"), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(exactStringLiteral(code, index), err(code, index, 'Import path'), ({ parsed: path, newIndex: index }) => 
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(consume(code, index, "import"), err(code, index, '"import"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(parseSeries(code, index, plainIdentifier, ","), ({ parsed: imports, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "import-declaration",
            imports: imports.map(i => ({
                kind: "import-item",
                name: i,
                id: Symbol(),
                code: i.code,
                startIndex: i.startIndex,
                endIndex: i.endIndex,
            })),
            path,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index
    })))))))))))

const typeDeclaration: ParseFunction<TypeDeclaration> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("export")(code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "type"), index => 
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(code, index), err(code, index, 'Type name'), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(code, index), err(code, index, 'Type expression'), ({ parsed: type, newIndex: index }) => ({
        parsed: {
            kind: "type-declaration",
            name,
            type,
            exported: exported != null,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))))

const typeExpression: ParseFunction<TypeExpression> = (code, index) =>
    arrayType(code, index)
    ?? nonArrayType(code, index)

const arrayType: ParseFunction<ArrayType> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("const")(code, index), ({ parsed: constant, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: constant, newIndex: index })))), ({ parsed: constant, newIndex: indexAfterConstant }) =>
    given(nonArrayType(code, indexAfterConstant ?? startIndex), ({ parsed: element, newIndex: index }) =>
    given(consume(code, index, "[]"), index => ({
        parsed: {
            kind: "array-type",
            element,
            mutability: constant ? "readonly" : "mutable",
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))

// required because of the way arrayTypes are written
const nonArrayType: ParseFunction<TypeExpression> = (code, index) =>
    unionType(code, index)
    ?? atomicType(code, index)

const unionType: ParseFunction<UnionType> = (code, startIndex) =>
    // TODO: Allow leading |
    given(parseSeries(code, startIndex, atomicType, "|", { leadingDelimiter: "optional", trailingDelimiter: "forbidden" }), ({ parsed: members, newIndex: index }) =>
        members.length >= 2
            ? {
                parsed: {
                    kind: "union-type",
                    members,
                    id: Symbol(),
                    mutability: undefined,
                    code,
                    startIndex,
                    endIndex: index,
                },
                newIndex: index,
            }
            : undefined)

const atomicType: ParseFunction<TypeExpression> = (code, index) =>
    primitiveType(code, index)
    ?? elementType(code, index)
    ?? funcType(code, index)
    ?? procType(code, index)
    ?? iteratorType(code, index)
    ?? planType(code, index)
    ?? literalType(code, index)
    ?? namedType(code, index)
    ?? objectType(code, index)
    ?? indexerType(code, index)
    ?? tupleType(code, index)
    ?? unknownType(code, index)

const elementType: ParseFunction<ElementType> = (code, startIndex) =>
    given(consume(code, startIndex, "Element"), index => ({
        parsed: {
            kind: "element-type",
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const namedType: ParseFunction<NamedType> = (code, startIndex) =>
    given(plainIdentifier(code, startIndex), ({ parsed: name, newIndex: index }) => ({
        parsed: {
            kind: "named-type",
            name,
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const objectType: ParseFunction<ObjectType> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("const")(code, index), ({ parsed: constant, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: constant, newIndex: index })))), ({ parsed: constant, newIndex: indexAfterConstant }) =>
    given(consume(code, indexAfterConstant ?? startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _spreadOrEntry, ","), ({ parsed: entries, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-type",
            spreads: entries.filter((e): e is NamedType => e.kind === "named-type"),
            entries: entries.filter((e): e is Attribute => e.kind === "attribute"),
            id: Symbol(),
            mutability: constant ? "readonly" : "mutable",
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))

const _spreadOrEntry: ParseFunction<NamedType|Attribute> = (code, index) => 
    _objectTypeEntry(code, index) ?? _objectTypeSpread(code, index)

const _objectTypeSpread: ParseFunction<NamedType> = (code, startIndex) =>
    given(consume(code, startIndex, '...'), index =>
    expec(namedType(code, index), err(code,  index, 'Named type'), ({ parsed, newIndex }) => ({
        parsed, newIndex
    })))

const _objectTypeEntry: ParseFunction<Attribute> = (code, startIndex) =>
    given(plainIdentifier(code, startIndex), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(code, index), ({ parsed: type, newIndex: index }) => ({
        parsed: {
            kind: "attribute",
            name,
            type,
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index,
    }))))))

const indexerType: ParseFunction<IndexerType> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("const")(code, index), ({ parsed: constant, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: constant, newIndex: index })))), ({ parsed: constant, newIndex: indexAfterConstant }) =>
    given(consume(code, indexAfterConstant ?? startIndex, "{"), index =>
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
            mutability: constant ? "readonly" : "mutable",
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))))

const tupleType: ParseFunction<TupleType> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("const")(code, index), ({ parsed: constant, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: constant, newIndex: index })))), ({ parsed: constant, newIndex: indexAfterConstant }) =>
    given(consume(code, indexAfterConstant ?? startIndex, "["), index =>
    given(parseSeries(code, index, typeExpression, ","), ({ parsed: members, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "tuple-type",
            members,
            mutability: constant ? "readonly" : "mutable",
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))

const primitiveType: ParseFunction<PrimitiveType> = (code, startIndex) =>
    given(consume(code, startIndex, "string"), index => ({
        parsed: {
            kind: "string-type",
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))
    ?? given(consume(code, startIndex, "number"), index => ({
        parsed: {
            kind: "number-type",
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))
    ?? given(consume(code, startIndex, "boolean"), index => ({
        parsed: {
            kind: "boolean-type",
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))
    ?? given(consume(code, startIndex, "nil"), index => ({
        parsed: {
            kind: "nil-type",
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))
    ?? given(consume(code, startIndex, "unknown"), index => ({
        parsed: {
            kind: "unknown-type",
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const funcType: ParseFunction<FuncType> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(consume(code, index, "<"), index =>
        given(consumeWhitespace(code, index), index =>
        expec(parseSeries(code, index, plainIdentifier, ','), err(code, index, "Type parameters"), ({ parsed: typeParams, newIndex: index }) =>
        given(consumeWhitespace(code, index), index => 
        given(consume(code, index, ">"), index => ({ parsed: typeParams, newIndex: index }))))))), ({ parsed: typeParams, newIndex: indexAfterTypeParams }) =>
    given(consume(code, indexAfterTypeParams ?? startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "=>"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(code, index), err(code, index, 'Return type'), ({ parsed: returnType, newIndex: index }) => ({
        parsed: {
            kind: "func-type",
            typeParams: typeParams ?? [],
            args,
            returnType,
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    })))))))))))

const procType: ParseFunction<FuncType|ProcType> = (code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "{}"), index => ({
        parsed: {
            kind: "proc-type",
            typeParams: [], // TODO
            args,
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))

const iteratorType: ParseFunction<IteratorType> = (code, startIndex) =>
    given(consume(code, startIndex, "Iterator<"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(code, index), err(code, index, "Iterator item type"), ({ parsed: itemType, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ">"), err(code, index, '">"'), index => ({
        parsed: {
            kind: "iterator-type",
            itemType,
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))

const planType: ParseFunction<PlanType> = (code, startIndex) =>
    given(consume(code, startIndex, "Plan<"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(code, index), err(code, index, "Plan result type"), ({ parsed: resultType, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ">"), err(code, index, '">"'), index => ({
        parsed: {
            kind: "plan-type",
            resultType,
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))

const literalType: ParseFunction<LiteralType> = (code, startIndex) =>
    given(exactStringLiteral(code, startIndex) 
        ?? numberLiteral(code, startIndex) 
        ?? booleanLiteral(code, startIndex), 
    ({ parsed: value, newIndex: index }) => ({
        parsed: {
            kind: "literal-type",
            value,
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
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
            id: Symbol(),
            mutability: undefined,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const procDeclaration: ParseFunction<ProcDeclaration> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("export")(code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "proc"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(proc(code, index), err(code, index, 'Procedure'), ({ parsed: proc, newIndex: index }) => ({
        parsed: {
            kind: "proc-declaration",
            name,
            value: proc,
            exported: exported != null,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))

const funcDeclaration: ParseFunction<FuncDeclaration> = (code, startIndex) => 
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("export")(code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "func"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(parseOptional(code, index, (code, index) =>
        given(parseExact("memo")(code, index), ({ parsed: memo, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: memo, newIndex: index })))), ({ parsed: memo, newIndex: indexAfterMemo }) =>
    given(plainIdentifier(code, indexAfterMemo ?? index), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(func(code, index), err(code, index, 'Function'), ({ parsed: func, newIndex: index }) => ({
        parsed: {
            kind: "func-declaration",
            name,
            memo: memo != null,
            value: func,
            exported: exported != null,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))))

const constDeclaration: ParseFunction<ConstDeclaration> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("export")(code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "const"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
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
                type,
                value,
                exported: exported != null,
                id: Symbol(),
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
    })))))))))))

const classDeclaration: ParseFunction<ClassDeclaration> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(parseExact("export")(code, index), ({ parsed: exported, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, newIndex: index })))), ({ parsed: exported, newIndex: indexAfterExport }) =>
    given(consume(code, indexAfterExport ?? startIndex, "class"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(code, index), err(code, index, "Class name"), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(parseSeries(code, index, classMember), ({ parsed: members, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "class-declaration",
            name,
            typeParams: [],
            members,
            exported: exported != null,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index
    }))))))))))

const classMember: ParseFunction<ClassMember> = (code, startIndex) =>
    classProperty(code, startIndex)
    ?? classFunction(code, startIndex)
    ?? classProcedure(code, startIndex)

const classProperty: ParseFunction<ClassProperty> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(_accessModifierWithVisible(code, index), ({ parsed: access, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: access, newIndex: index })))), ({ parsed: access, newIndex: index }) =>
    given(plainIdentifier(code, index ?? startIndex), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(code, index, (code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: type, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Expression'), ({ parsed: value, newIndex: index }) => ({
        parsed: {
            kind: "class-property",
            name,
            type,
            value,
            access: access ?? 'private',
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))))))))

const classFunction: ParseFunction<ClassFunction> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(_accessModifier(code, index), ({ parsed: access, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: access, newIndex: index })))), ({ parsed: access, newIndex: index }) =>
    given(funcDeclaration(code, index ?? startIndex), ({ parsed: { name, value, memo }, newIndex: index }) => ({
        parsed: {
            kind: "class-function",
            memo,
            name,
            value,
            access: access ?? 'private',
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    })))

const classProcedure: ParseFunction<ClassProcedure> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(_accessModifier(code, index), ({ parsed: access, newIndex: index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: access, newIndex: index })))), ({ parsed: access, newIndex: index }) =>
    given(procDeclaration(code, index ?? startIndex), ({ parsed: { name, value }, newIndex: index }) => ({
    parsed: {
        kind: "class-procedure",
        name,
        value,
        access: access ?? 'private',
        id: Symbol(),
        code,
        startIndex,
        endIndex: index,
    },
    newIndex: index,
    })))

const _accessModifierWithVisible: ParseFunction<'private'|'public'|'visible'> = (code, startIndex) =>
    _accessModifier(code, startIndex)
    ?? given(consume(code, startIndex, "visible"), index => ({
        parsed: "visible",
        newIndex: index
    }))

const _accessModifier: ParseFunction<'private'|'public'> = (code, startIndex) =>
    given(consume(code, startIndex, "private"), index => ({
        parsed: "private",
        newIndex: index
    }))
    ?? given(consume(code, startIndex, "public"), index => ({
        parsed: "public",
        newIndex: index
    }))

const testExprDeclaration: ParseFunction<TestExprDeclaration> = (code, startIndex) =>
    given(consume(code, startIndex, 'test'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, 'expr'), index =>
    given(consumeWhitespace(code, index), index => 
    expec(exactStringLiteral(code, index), err(code, index, 'Test name'), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '='), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Test expression'), ({ parsed: expr, newIndex: index }) => ({
        parsed: {
            kind: 'test-expr-declaration',
            name,
            expr,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))))

const testBlockDeclaration: ParseFunction<TestBlockDeclaration> = (code, startIndex) => 
    given(consume(code, startIndex, 'test'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, 'block'), index =>
    given(consumeWhitespace(code, index), index => 
    expec(exactStringLiteral(code, index), err(code, index, 'Test name'), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(code, index), err(code, index, 'Test block'), ({ parsed: block, newIndex: index }) => ({
        parsed: {
            kind: 'test-block-declaration',
            name,
            block,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))

const proc: ParseFunction<Proc> = (code, startIndex) =>
    given(_args(code, startIndex), ({ parsed: args, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlock(code, index), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "proc",
            type: {
                kind: "proc-type",
                typeParams: [], // TODO
                args,
                id: Symbol(),
                mutability: undefined,
                code,
                startIndex,
                endIndex: index
            },
            body,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index,
    }))))

const statement: ParseFunction<Statement> = (code, startIndex) =>
    reaction(code, startIndex)
    ?? javascriptEscape(code, startIndex)
    ?? letDeclaration(code, startIndex)
    ?? constDeclarationStatement(code, startIndex)
    ?? ifElseStatement(code, startIndex)
    ?? forLoop(code, startIndex)
    ?? whileLoop(code, startIndex)
    ?? assignment(code, startIndex)
    ?? procCall(code, startIndex)

const reaction: ParseFunction<Reaction> = (code, startIndex) =>
    given(consume(code, startIndex, "autorun"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(code, index), err(code, index, "Side-effect procedure"), ({ parsed: view, newIndex: index }) => 
    given(consumeWhitespaceRequired(code, index), index =>
    expec(
        given(consume(code, index, "until"), index =>
        expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
        expec(expression(code, index), err(code, index, "Disposal condition"), res => res)))
        ?? consume(code, index, "forever"), err(code, index, 'Reaction lifetime (either "until <func>" or "forever")'), lifetimeResult => 
    given(consumeWhitespace(code, typeof lifetimeResult === 'number' ? lifetimeResult : lifetimeResult.newIndex), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
        parsed: {
            kind: "reaction",
            view,
            until: typeof lifetimeResult === 'number' ? undefined : lifetimeResult.parsed,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))))

const letDeclaration: ParseFunction<LetDeclaration> = (code, startIndex) =>
    given(consume(code, startIndex, "let"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(code, index), err(code, index, "Variable name"), ({ parsed: name, newIndex: index }) =>
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
                type,
                id: Symbol(),
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
        }))))))))))))

const constDeclarationStatement: ParseFunction<ConstDeclarationStatement> = (code, startIndex) => 
    given(consume(code, startIndex, "const"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(code, index), err(code, index, "Constant name"), ({ parsed: name, newIndex: index }) =>
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
                kind: "const-declaration-statement",
                name,
                value,
                type,
                id: Symbol(),
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
        }))))))))))))

const assignment: ParseFunction<Assignment> = (code, startIndex) =>
    given(invocationAccessorChain(code, startIndex) ?? localIdentifier(code, startIndex), ({ parsed: target, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "="), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Assignment value"), ({ parsed: value, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => 
        target.kind === "local-identifier" || target.kind === "property-accessor" ? {
            parsed: {
                kind: "assignment",
                target,
                value,
                id: Symbol(),
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
        } : undefined
    )))))))

const procCall: ParseFunction<Invocation> = (code, startIndex) =>
    given(invocationAccessorChain(code, startIndex), ({ parsed, newIndex: index }) =>
    expec(consume(code, index, ';'), err(code, index, '";"'), index => 
        parsed.kind === "invocation" ? {
        parsed,
        newIndex: index
        } : undefined))
    

const ifElseStatement: ParseFunction<IfElseStatement> = (code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
    given(parseSeries(code, index, _conditionAndOutcomeBlock, 'else if', { trailingDelimiter: "forbidden" }), ({ parsed: cases, newIndex: index }) => {
        const elseResult = 
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(parseBlock(code, index), err(code, index, 'Else block'), result => result)));

        if (isError(elseResult)) {
            return elseResult
        } else if (elseResult == null) {
            return {
                parsed: {
                    kind: "if-else-statement",
                    cases,
                    id: Symbol(),
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
                    id: Symbol(),
                    code,
                    startIndex,
                    endIndex: index,
                },
                newIndex: elseResult.newIndex,
            }
        }
    }))

const _conditionAndOutcomeBlock: ParseFunction<{ readonly condition: Expression, readonly outcome: Block }> = (code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(expression(code, index), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(code, index), err(code, index, 'Block for if clause'), ({ parsed: outcome, newIndex: index }) => ({
        parsed: {
            condition,
            outcome
        },
        newIndex: index
    }))))))))

const forLoop: ParseFunction<ForLoop> = (code, startIndex) =>
    given(consume(code, startIndex, "for"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "("), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(plainIdentifier(code, index), err(code, index, 'Item identifier for loop items'), ({ parsed: itemIdentifier, newIndex: index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(consume(code, index, "of"), err(code, index, '"of"'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
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
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
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
            condition,
            body,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))))))

const parseBlock: ParseFunction<Block> = (code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, statement), ({ parsed: statements, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "block",
            statements,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))


const expression: ParseFunction<Expression> = memoize2((code, startIndex) =>
    parseStartingFromTier(0)(code, startIndex))

const func: ParseFunction<Func> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(consume(code, index, "<"), index =>
        given(consumeWhitespace(code, index), index =>
        expec(parseSeries(code, index, plainIdentifier, ','), err(code, index, "Type parameters"), ({ parsed: typeParams, newIndex: index }) =>
        given(consumeWhitespace(code, index), index => 
        given(consume(code, index, ">"), index => ({ parsed: typeParams, newIndex: index }))))))), ({ parsed: typeParams, newIndex: indexAfterTypeParams }) =>
    given(_args(code, indexAfterTypeParams ?? startIndex), ({ parsed: args, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(code, index, (code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: returnType, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    given(consume(code, index, "=>"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _funcConst, ',', { trailingDelimiter: 'required' }), ({ parsed: consts, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Function body' + (consts.length === 0 ? ' or comma-separated consts' : '')), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "func",
            type: {
                kind: "func-type",
                typeParams: typeParams ?? [],
                args,
                returnType,
                id: Symbol(),
                mutability: undefined,
                code,
                startIndex,
                endIndex: index
            },
            consts,
            body,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index,
    })))))))))))

const _args: ParseFunction<Arg[]> = (code, index) =>
    _singleArgument(code, index) ?? _seriesOfArguments(code, index)

const _singleArgument: ParseFunction<Arg[]> = (code, index) =>
    given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) => ({
        parsed: [
            { name }
        ],
        newIndex: index
    }))

const _seriesOfArguments: ParseFunction<Arg[]> = (code, index) =>
    given(consume(code, index, "("), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consume(code, index, ")"), index => ({
        parsed: args,
        newIndex: index
    }))))

const _argumentDeclaration = (code: string, index: number): ParseResult<Arg> | BagelError | undefined => 
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

const _funcConst: ParseFunction<InlineConst> = (code, startIndex) =>
    given(consume(code, startIndex, 'const'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(code, index, (code, index) =>
        given(consume(code, index, ':'), index =>
        given(consumeWhitespace(code, index), index => 
        expec(typeExpression(code, index), err(code, index, "Type"), res => res)))), ({ parsed: type, newIndex: indexAfterType }) =>
    given(consumeWhitespace(code, indexAfterType ?? index), index =>
    given(consume(code, index, '='), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Value"), ({ parsed: value, newIndex: index }) => ({
        parsed: {
            kind: "inline-const",
            name,
            type,
            value,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))))

const pipe: ParseFunction<Pipe> = (code, startIndex) => 
    given(parseSeries(code, startIndex, parseStartingFromTier(NEXT_TIER_FOR.get(pipe) as number), "|>", { trailingDelimiter: "forbidden" }), ({ parsed: expressions, newIndex: index }) =>
        expressions.length >= 2
            ? {
                parsed: expressions.slice(1).reduce((acc, expr) => ({
                    kind: "pipe",
                    subject: expr,
                    args: [acc],
                    id: Symbol(),
                    code: expr.code,
                    startIndex: expr.startIndex,
                    endIndex: expr.endIndex
                }), expressions[0]) as Pipe,
                newIndex: index
            }
            : undefined)

const binaryOperator = memoize((tier: number): ParseFunction<BinaryOperator> => memoize2((code, startIndex) => 
    given(parseSeries(code, startIndex, 
        beneath(binaryOperator(tier)), 
        _binaryOperatorSymbol(tier), 
        { leadingDelimiter: "forbidden", trailingDelimiter: "forbidden" }
    ), ({ parsed: segments, newIndex: index }) => 
        segments.length >= 3 ? 
            given(_segmentsToOps(segments), ({ base, ops }) => ({
                parsed: {
                    kind: "binary-operator",
                    base,
                    ops,
                    id: Symbol(),
                    code,
                    startIndex,
                    endIndex: index,
                },
                newIndex: index,
            }))
        : undefined
    )))

const negationOperator: ParseFunction<NegationOperator> = memoize2((code, startIndex) => 
    given(consume(code, startIndex, "!"), index =>
    expec(beneath(negationOperator)(code, index), err(code, index, "Boolean expression"), ({ parsed: base, newIndex: index }) => ({
        parsed: {
            kind: "negation-operator",
            base,
            id: Symbol(),
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

const _binaryOperatorSymbol = memoize((tier: number): ParseFunction<Operator> => (code, startIndex) => {
    for (const op of BINARY_OPS[tier]) {
        if (code.substr(startIndex, op.length) === op) {
            const endIndex = startIndex + op.length

            return {
                parsed: {
                    kind: "operator",
                    op,
                    id: Symbol(),
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
    
const indexer: ParseFunction<Indexer> = (code, startIndex) =>
    given(parseBeneath(code, startIndex, indexer), ({ parsed: base, newIndex: index }) =>
    given(parseSeries(code, index, _indexerExpression), ({ parsed: indexers, newIndex: index }) => 
        indexers.length > 0 ? 
            {
                parsed: indexers.reduce((subject: Expression, indexer: Expression) => ({
                    kind: "indexer",
                    subject,
                    indexer,
                    id: Symbol(),
                    code,
                    startIndex,
                    endIndex: index,
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
    given(parseSeries(code, index, _case, 'else if', { trailingDelimiter: "forbidden" }), ({ parsed: cases, newIndex: index }) => {
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
                    cases,
                    id: Symbol(),
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
                    id: Symbol(),
                    code,
                    startIndex,
                    endIndex: index,
                },
                newIndex: elseResultResult.newIndex,
            }
        }
    }))

const _case: ParseFunction<Case> = (code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(expression(code, index), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Result expression for if clause'), ({ parsed: outcome, newIndex: index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "case",
            condition,
            outcome,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))))))

const switchExpression: ParseFunction<SwitchExpression> = (code, startIndex) =>
    given(consume(code, startIndex, "switch"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '('), err(code, index, '"("'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Switch expression"), ({ parsed: value, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ')'), err(code, index, '")"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '{'), err(code, index, '"{"'), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _switchCase, ','), ({ parsed: cases, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(code, index, _defaultCase), ({ parsed: defaultCase, newIndex: indexAfterDefault }) =>
    given(consumeWhitespace(code, indexAfterDefault ?? index), index =>
    expec(consume(code, index, '}'), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "switch-expression",
            value,
            cases,
            defaultCase,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))))))))))

const _switchCase: ParseFunction<Case> = (code, startIndex) =>
    given(consume(code, startIndex, 'case'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(code, index), err(code, index, 'Case expression'), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Case result'), ({ parsed: outcome, newIndex: index }) => ({
        parsed: {
            kind: "case",
            condition,
            outcome,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))

const _defaultCase: ParseFunction<Expression> = (code, startIndex) =>
    given(consume(code, startIndex, 'default'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Case result'), ({ parsed: outcome, newIndex: index }) => ({
        parsed: outcome,
        newIndex: index
    }))))))


const range: ParseFunction<Range> = (code, startIndex) =>
    given(numberLiteral(code, startIndex), ({ parsed: firstNumber, newIndex: index }) =>
    given(consume(code, index, ".."), index =>
    expec(numberLiteral(code, index), err(code, index, 'Range end'), ({ parsed: secondNumber, newIndex: index }) => ({
        parsed: {
            kind: "range",
            start: firstNumber.value,
            end: secondNumber.value,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))));

const parenthesized: ParseFunction<ParenthesizedExpression> = (code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(expression(code, index), ({ parsed: inner, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "parenthesized-expression",
            inner,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))

const invocationAccessorChain: ParseFunction<Invocation|PropertyAccessor> = (code, index) =>
    given(parseBeneath(code, index, invocationAccessorChain), ({ parsed: subject, newIndex: index }) =>
    given(parseSeries<InvocationArgs|PropertyAccess>(code, index, (code, index) => 
        _invocationArgs(code, index) ?? _propertyAccess(code, index)), ({ parsed: gets, newIndex: index }) => 
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
            id: Symbol(),
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
            id: Symbol(),
            code: get.code,
            startIndex: subject.startIndex,
            endIndex: get.endIndex
        }
    }
}
    
type InvocationArgs = SourceInfo & { kind: "invocation-args", exprs: Expression[], typeArgs: TypeExpression[] }

const _invocationArgs: ParseFunction<InvocationArgs> = (code, startIndex) =>
    given(parseOptional(code, startIndex, (code, index) =>
        given(consume(code, index, "<"), index =>
        given(consumeWhitespace(code, index), index =>
        given(parseSeries(code, index, typeExpression, ','), ({ parsed: typeArgs, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
        given(consume(code, index, ">"), index => ({ parsed: typeArgs, newIndex: index }))))))), ({ parsed: typeArgs, newIndex: indexAfterTypeArgs }) =>
    given(consume(code, indexAfterTypeArgs ?? startIndex, "("), index => 
    given(parseSeries(code, index, expression, ","), ({ parsed: exprs, newIndex: index }) =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "invocation-args",
            exprs,
            typeArgs: typeArgs ?? [],
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    })))))

type PropertyAccess = SourceInfo & { kind: "property-access", property: PlainIdentifier, optional: boolean }

const _propertyAccess: ParseFunction<PropertyAccess> = (code, startIndex) =>
    given(parseOptional(code, startIndex, parseExact("?")), ({ parsed: question, newIndex: indexAfterQuestion }) =>
    given(consume(code, indexAfterQuestion ?? startIndex, "."), index =>
    expec(plainIdentifier(code, index), err(code, index, "Property name"), ({ parsed: property, newIndex: index }) => ({
        parsed: { kind: "property-access", property, optional: question != null, code, startIndex, endIndex: index },
        newIndex: index
    }))))


const localIdentifier: ParseFunction<LocalIdentifier> = (code, startIndex) => 
    given(identifierSegment(code, startIndex), ({ segment: name, newIndex: index }) => ({
        parsed: {
            kind: "local-identifier",
            name,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

// TODO: Support /> closing
export const elementTag: ParseFunction<ElementTag> = (code, startIndex) =>
    given(consume(code, startIndex, "<"), index =>
    given(plainIdentifier(code, index), ({ parsed: tagName, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _tagAttribute), ({ parsed: attributes, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ">"), err(code, index, '">"'), index => 
    given(parseSeries(code, index, (code, index) => elementTag(code, index) ?? _elementEmbeddedExpression(code, index)), ({ parsed: children, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "</"), err(code, index, 'Closing tag'), index => 
    expec(plainIdentifier(code, index), err(code, index, "Closing tag name"), ({ parsed: closingTagName, newIndex: index }) =>
    // TODO: Check that closing tag matches opening tag
    expec(consume(code, index, ">"), err(code, index, '">"'), index => ({
        parsed: {
            kind: "element-tag",
            tagName,
            attributes,
            children,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))))))))

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

export const classConstruction: ParseFunction<ClassConstruction> = (code, startIndex) =>
    given(consume(code, startIndex, "new"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(localIdentifier(code, index), err(code, index, "Constructor"), ({ parsed: clazz, newIndex: index }) =>
    expec(consume(code, index, "()"), err(code, index, '"()"'), index => ({
        parsed: {
            kind: "class-construction",
            clazz,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index
    })))))

export const objectLiteral: ParseFunction<ObjectLiteral> = (code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(parseSeries(code, index, _objectEntry, ","), ({ parsed: entries, newIndex: index }) =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-literal",
            entries,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))

const _objectEntry = (code: string, index: number): ParseResult<[PlainIdentifier, Expression]> | BagelError | undefined =>
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
            entries,
            id: Symbol(),
            code,
            startIndex,
            endIndex: index,
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
                    segments,
                    id: Symbol(),
                    code,
                    startIndex,
                    endIndex: index + 1,
                },
                newIndex: index + 1,
            }
        }
    }
}

const exactStringLiteral: ParseFunction<ExactStringLiteral> = (code, startIndex) =>
    given(stringLiteral(code, startIndex), ({ parsed: literal, newIndex: index }) =>
        literal.segments.length === 1 && typeof literal.segments[0] === 'string' ?
            {
                parsed: {
                    kind: "exact-string-literal",
                    value: literal.segments[0],
                    id: Symbol(),
                    code,
                    startIndex,
                    endIndex: index
                },
                newIndex: index
            }
        : undefined)

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
                value: Number(code.substring(numberStart, index)),
                id: Symbol(),
                code,
                startIndex,
                endIndex: index,
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
                value: true,
                id: Symbol(),
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
                id: Symbol(),
                code,
                startIndex,
                endIndex: indexAfterFalse,
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
                id: Symbol(),
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
                js: code.substring(jsStartIndex, jsEndIndex),
                id: Symbol(),
                code,
                startIndex,
                endIndex: index,
            },
            newIndex: index,
        }));
})

const debug: ParseFunction<Debug> = (code, startIndex) =>
    given(consume(code, startIndex, '!debug['), index => 
    given(consumeWhitespace(code, index), index =>
    given(expression(code, index) ?? declaration(code, index), ({ parsed: inner, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ']'), index => ({
        parsed: {
            kind: "debug",
            inner: log(inner, ast => JSON.stringify({ bgl: code.substring(ast.startIndex ?? startIndex, ast.endIndex ?? index), ast: withoutSourceInfo(ast) }, null, 2)),
            id: Symbol(),
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))

const EXPRESSION_PRECEDENCE_TIERS: readonly ParseFunction<Expression>[][] = [
    [ javascriptEscape, pipe, classConstruction, elementTag ],
    [ func, proc, range ],
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
    [ ifElseExpression, debug, switchExpression, booleanLiteral, nilLiteral, objectLiteral, arrayLiteral, 
        stringLiteral, numberLiteral ],
];

const NEXT_TIER_FOR: Map<ParseFunction<Expression>, number> = (() => {
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
            const result = fn(code, index)

            if (result != null) {
                return result;
            }
        }
    }

    return undefined;
}

const parseBeneath = (code: string, index: number, fn: ParseFunction<Expression>) =>
    beneath(fn)(code, index)

const beneath = (fn: ParseFunction<Expression>): ParseFunction<Expression> => (code: string, index: number) =>
    parseStartingFromTier(NEXT_TIER_FOR.get(fn) as number)(code, index)
