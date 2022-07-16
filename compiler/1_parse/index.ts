import { log, stripSourceInfo } from "../utils/debugging.ts";
import { BagelError, isError, syntaxError } from "../errors.ts";
import { Module, Debug, Block, PlainIdentifier, SourceInfo, Destructure, NameAndType } from "../_model/ast.ts";
import { ModuleName,ReportError } from "../_model/common.ts";
import { ValueDeclaration, Declaration, FuncDeclaration, ImportDeclaration, ProcDeclaration, TestBlockDeclaration, TestExprDeclaration, TypeDeclaration, ImportAllDeclaration, RemoteDeclaration, DeriveDeclaration, ALL_PLATFORMS, Platform, ImportItem, Decorator, TestTypeDeclaration } from "../_model/declarations.ts";
import { ArrayLiteral, BinaryOperator, BooleanLiteral, ElementTag, Expression, Func, Invocation, IfElseExpression, JavascriptEscape, LocalIdentifier, NilLiteral, NumberLiteral, ObjectLiteral, ParenthesizedExpression, Proc, PropertyAccessor, Range, StringLiteral, SwitchExpression, InlineConstGroup, ExactStringLiteral, Case, Operator, BINARY_OPS, NegationOperator, AsCast, Spread, SwitchCase, InstanceOf, ErrorExpression, ObjectEntry, InlineDeclaration, ALL_REG_EXP_FLAGS, RegularExpression, RegularExpressionFlag } from "../_model/expressions.ts";
import { Assignment, CaseBlock, ForLoop, IfElseStatement, Statement, WhileLoop, DeclarationStatement, TryCatch, ThrowStatement, Autorun } from "../_model/statements.ts";
import { ArrayType, FuncType, RecordType, LiteralType, NamedType, ObjectType, PrimitiveType, ProcType, TupleType, TypeExpression, UnionType, UnknownType, Attribute, Arg, GenericType, ParenthesizedType, MaybeType, BoundGenericType, IteratorType, PlanType, GenericFuncType, GenericProcType, TypeParam, RemoteType, ErrorType, TypeofType, ElementofType, KeyofType, ValueofType, SpreadArgs, Args, RegularExpressionType } from "../_model/type-expressions.ts";
import { consume, consumeWhitespace, consumeWhitespaceRequired, expec, given, identifierSegment, isNumeric, ParseFunction, parseExact, parseOptional, ParseResult, parseSeries, plainIdentifier, parseKeyword, TieredParser, isSymbolic } from "./utils.ts";
import { setParents } from "../utils/ast.ts";
import { format } from "../other/format.ts";
import { path } from '../deps.ts';
import { AST_NOISE } from "../3_checking/typeinfer.ts";
import { memo } from "../../lib/ts/reactivity.ts";

export const parse = (moduleName: ModuleName, code: string): { ast: Module, noPreludeAst: Module, errors: readonly BagelError[] } | undefined => {
    const fileType = path.extname(moduleName)

    if (fileType === '.bgl') {
        const errors: BagelError[] = []

        const ast = parseInner(
            moduleName,  
            code + preludeFor(moduleName),
            () => {}
        )

        const noPreludeAst = parseInner(
            moduleName,  
            code,
            err => errors.push(err)
        )
        
        return {
            ast,
            noPreludeAst,
            errors
        }
    } else if (fileType === '.json') {
        try {
            const contents = JSON.parse(code)

            const ast = moduleWithDeclarations([
                {
                    kind: "value-declaration",
                    name: {
                        kind: "plain-identifier",
                        name: JSON_AND_PLAINTEXT_EXPORT_NAME,
                        ...AST_NOISE
                    },
                    type: undefined,
                    isConst: true,
                    exported: "export",
                    value: jsonToAST(contents),
                    platforms: ALL_PLATFORMS,
                    ...AST_NOISE
                }
            ])

            return {
                ast,
                noPreludeAst: ast,
                errors: []
            }
        } catch (e) {
            const ast = moduleWithDeclarations([])

            return {
                ast,
                noPreludeAst: ast,
                errors: [
                    { kind: "bagel-syntax-error", message: `Failed to parse JSON file '${moduleName}': ` + e.message, ast: undefined, code: undefined, index: undefined, stack: undefined }
                ]
            }
        }
    } else {
        const ast = moduleWithDeclarations([
            {
                kind: "value-declaration",
                name: {
                    kind: "plain-identifier",
                    name: JSON_AND_PLAINTEXT_EXPORT_NAME,
                    ...AST_NOISE
                },
                type: undefined,
                isConst: true,
                exported: "export",
                value: {
                    kind: "exact-string-literal",
                    value: code,
                    ...AST_NOISE
                },
                platforms: ALL_PLATFORMS,
                ...AST_NOISE
            }
        ])

        return {
            ast,
            noPreludeAst: ast,
            errors: []
        }
    }
}

export const JSON_AND_PLAINTEXT_EXPORT_NAME = "CONTENTS"

function moduleWithDeclarations(declarations: Declaration[]): Module {
    return {
        kind: "module",
        moduleType: "text",
        declarations,
        ...AST_NOISE
    }
}

function jsonToAST(json: unknown): Expression {
    if (json == null) {
        return {
            kind: "nil-literal",
            ...AST_NOISE
        }
    } else if (typeof json === 'boolean') {
        return {
            kind: "boolean-literal",
            value: json,
            ...AST_NOISE
        }
    } else if (typeof json === 'number') {
        return {
            kind: "number-literal",
            value: json,
            ...AST_NOISE
        }
    } else if (typeof json === 'string') {
        return {
            kind: "exact-string-literal",
            value: json,
            ...AST_NOISE
        }
    } else if (Array.isArray(json)) {
        return {
            kind: "array-literal",
            entries: json.map(jsonToAST),
            ...AST_NOISE
        }
    } else if (typeof json === 'object') {
        return {
            kind: "object-literal",
            entries: Object.entries(json).map(([key, value]) => ({
                kind: 'object-entry',
                key: {
                    kind: "plain-identifier",
                    name: key,
                    ...AST_NOISE
                },
                value: jsonToAST(value),
                ...AST_NOISE
            })),
            ...AST_NOISE
        }
    }

    // Should be unreachable
    throw Error(`Failed to convert value ${json} to Bagel JSON value`)
}

function preludeFor(module: ModuleName) {
    return '\n\n' + BGL_PRELUDE_DATA
        .filter(m =>
            module !== m.module && 
            decodeURIComponent(module.match(/bagel_modules\/(.*)/)?.[1] ?? '') !== m.module &&
            module.match(/lib\/bgl\/(.*)/)?.[1] !== m.module.match(/lib\/bgl\/(.*)/)?.[1])
        .map(({ module, imports }) =>
            `from '${module}' import { ${imports.join(', ')} }`)
        .join('\n')
}

const LIB_LOCATION = 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl'

const BGL_PRELUDE_DATA = [
    { module: LIB_LOCATION + '/core.bgl' as ModuleName, imports: [ 'log', 'logf', 'iter', 'memo', 'action', 'UnknownObject', 'BagelConfig', 'Element', 'assert' ] },
    { module: LIB_LOCATION + '/arrays.bgl' as ModuleName, imports: [ 'push', 'unshift', 'pop', 'shift', 'splice' ] },
    { module: LIB_LOCATION + '/strings.bgl' as ModuleName, imports: [ 'includes', 'indexOf', 'replace', 'split', 'startsWith', 'substring', 'toLowerCase', 'toUpperCase', 'trim' ] },
    { module: LIB_LOCATION + '/objects.bgl' as ModuleName, imports: [ 'keys', 'values', 'entries' ] },
    { module: LIB_LOCATION + '/numbers.bgl' as ModuleName, imports: [ 'parseNumber', 'stringifyNumber', 'abs', 'pow', 'sqrt', 'ceil', 'floor', 'sin', 'cos', 'tan' ] },
    { module: LIB_LOCATION + '/booleans.bgl' as ModuleName, imports: [ 'parseBoolean', 'stringifyBoolean' ] },
    { module: LIB_LOCATION + '/iterators.bgl' as ModuleName, imports: [ 'map', 'filter', 'slice', 'sorted', 'every', 'some', 'count', 'concat', 'zip', 'indexed', 'find', 'collectArray', 'collectObject', 'takeWhile', 'first' ] },
    { module: LIB_LOCATION + '/plans.bgl' as ModuleName, imports: [ 'timeout' ] },
    { module: LIB_LOCATION + '/json.bgl' as ModuleName, imports: [ 'parseJson', 'stringifyJson', 'JSON' ] },
] as const

function parseInner(module: ModuleName, code: string, sendError: ReportError): Module {
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
        sendError(result);
    } else if (index < code.length) {
        sendError({
            kind: "bagel-syntax-error",
            ast: undefined,
            code,
            index,
            message: `Failed to parse entire module`,
            stack: undefined,
        });
    }

    const moduleAst: Module = {
        kind: "module",
        moduleType: "bgl",
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
    ?? autorun(false)(module, code, startIndex)
    ?? testExprDeclaration(module, code, startIndex)
    ?? testBlockDeclaration(module, code, startIndex)
    ?? testTypeDeclaration(module, code, startIndex)
    ?? javascriptEscape(module, code, startIndex)

const importAllDeclaration: ParseFunction<ImportAllDeclaration> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "import"), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(exactStringLiteral(module, code, index), err(code, index, 'Import path'), ({ parsed: path, index }) => 
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(consume(code, index, "as"), err(code, index, '"as"'), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(plainIdentifier(module, code, index), err(code, index, '"Name"'), ({ parsed: name, index }) => ({
        parsed: {
            kind: "import-all-declaration",
            name,
            path,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))))))))

const importDeclaration: ParseFunction<ImportDeclaration> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "from"), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(exactStringLiteral(module, code, index), err(code, index, 'Import path'), ({ parsed: path, index }) => 
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(consume(code, index, "import"), err(code, index, '"import"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, importItem, ","), ({ parsed: imports, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "import-declaration",
            imports,
            path,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))))))))))

const importItem: ParseFunction<ImportItem> = memo((module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consumeWhitespace(code, index), index =>
        given(consume(code, index, 'as'), index =>
        given(consumeWhitespace(code, index), index =>
          plainIdentifier(module, code, index))))), ({ parsed: alias, index }) => ({
            parsed: {
                kind: "import-item",
                name,
                alias,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index
          }))))

const typeDeclaration: ParseFunction<TypeDeclaration> = memo((module, code, startIndex) =>
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
    }))))))))))

const _nominalTypeDeclaration: ParseFunction<TypeDeclaration> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'export'), ({ parsed: exported, index }) =>
    given(consume(code, index, "nominal"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(consume(code, index, "type"), err(code, index, '"type"'), index => 
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, 'Type name'), ({ parsed: name, index }) =>
    given(parseOptional(module, code, index, (module, code, index) =>
        given(consumeWhitespace(code, index), index =>
        given(consume(code, index, "("), index =>
        given(consumeWhitespace(code, index), index =>
        given(typeExpression(module, code, index), ({ parsed: inner, index }) =>
        given(consumeWhitespace(code, index), index =>
        given(consume(code, index, ")"), index => ({ parsed: inner, index })))))))), ({ parsed: inner, index }) => ({
        parsed: {
            kind: "type-declaration",
            name,
            type: {
                kind:"nominal-type",
                name: name.name,
                inner,
                mutability: undefined,
                module,
                code,
                startIndex: name.startIndex,
                endIndex: index
            },
            exported,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))))))


const typeExpression: ParseFunction<TypeExpression> =  memo((module, code, startIndex) =>
    TYPE_PARSER.parseStartingFromTier(0)(module, code, startIndex))

const genericType: ParseFunction<GenericType> = memo((module, code, startIndex) =>
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
    }))))

const arrayType: ParseFunction<ArrayType> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'readonly'), ({ parsed: readonly, index }) =>
    given(TYPE_PARSER.parseBeneath(module, code, index, arrayType), ({ parsed: element, index }) =>
    given(consume(code, index, "[]"), index => ({
        parsed: {
            kind: "array-type",
            element,
            mutability: readonly ? "readonly" : "mutable",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))

const maybeType: ParseFunction<MaybeType> = memo((module, code, startIndex) =>
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
    }))))

const unionType: ParseFunction<UnionType> = memo((module, code, startIndex) =>
    given(parseSeries(module, code, startIndex, TYPE_PARSER.beneath(unionType), "|", { leadingDelimiter: "optional", trailingDelimiter: "forbidden" }), ({ parsed: members, index }) =>
        members.length >= 2
            ? {
                parsed: {
                    kind: "union-type",
                    members,
                    mutability: undefined,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index,
            }
            : undefined))

const namedType: ParseFunction<NamedType|RegularExpressionType> = memo((module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) => ({
        parsed: (
            name.name === 'RegExp'
                ? {
                    kind: "regular-expression-type",
                    mutability: undefined,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                }
                : {
                    kind: "named-type",
                    name,
                    mutability: undefined,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                }
        ),
        index,
    })))

const objectType: ParseFunction<ObjectType> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'readonly'), ({ parsed: readonly, index }) =>
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
            mutability: readonly ? "readonly" : "mutable",
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))))))

const _typeSpreadOrEntry: ParseFunction<NamedType|Attribute> = memo((module, code, startIndex) => 
    attribute(module, code, startIndex) ?? _objectTypeSpread(module, code, startIndex))

const _objectTypeSpread: ParseFunction<NamedType> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, '...'), index =>
    expec(namedType(module, code, index), err(code,  index, 'Named type'), res =>
        res.parsed.kind !== 'named-type'
            ? syntaxError(code, index, `Can't spread type ${format(res.parsed)}`)
            : res as ParseResult<NamedType>)))

const attribute: ParseFunction<Attribute> =memo((module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex) ?? exactStringLiteral(module, code, startIndex), ({ parsed: name, index }) =>
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
    }))))))))

const recordType: ParseFunction<RecordType> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'readonly'), ({ parsed: readonly, index }) =>
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
            mutability: readonly ? "readonly" : "mutable",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))))))))))))

const tupleType: ParseFunction<TupleType> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'readonly'), ({ parsed: readonly, index }) =>
    given(consume(code, index, "["), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, typeExpression, ","), ({ parsed: members, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "tuple-type",
            members,
            mutability: readonly ? "readonly" : "mutable",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    }))))))))

const primitiveType: ParseFunction<PrimitiveType> = memo((module, code, startIndex) =>
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
    })))

const funcType: ParseFunction<FuncType|GenericFuncType> = memo((module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, index }) =>
    given(_parenthesizedArguments(module, code, index), ({ parsed: args, index }) =>
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
    })))))))

const procType: ParseFunction<ProcType|GenericProcType> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'async'), ({ parsed: isAsync, index }) =>
    given(parseOptional(module, code, index, _typeParams), ({ parsed: typeParams, index }) =>
    given(_parenthesizedArguments(module, code, index), ({ parsed: args, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "}"), index => {
        const procType: ProcType = {
            kind: "proc-type",
            args,
            isAsync,
            throws: undefined, // TODO: Parse optional explicit "throws" type
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

const _typeParam: ParseFunction<TypeParam> = memo((module, code, startIndex) =>
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
    })))))

const boundGenericType: ParseFunction<BoundGenericType|IteratorType|PlanType|ErrorType|RemoteType> = memo((module, code, startIndex) =>
    given(TYPE_PARSER.beneath(boundGenericType)(module, code, startIndex), ({ parsed: generic, index }) =>
    given(_typeArgs(module, code, index), ({ parsed: typeArgs, index }) => 
        generic.kind === 'named-type' && (generic.name.name === 'Iterator' || generic.name.name === 'Plan' || generic.name.name === 'Error' || generic.name.name === 'Remote')
            ? (typeArgs.length !== 1
                ? syntaxError(code, index, `${generic.name.name} types must have exactly one type parameter; found ${typeArgs.length}`)
                : {
                    parsed: {
                        kind: (
                            generic.name.name === 'Iterator' ? "iterator-type" :
                            generic.name.name === 'Plan' ? "plan-type" :
                            generic.name.name === 'Error' ? "error-type" :
                            generic.name.name === 'Remote' ? "remote-type" :
                            "remote-type" // unreachable
                        ),
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
        })))

const parenthesizedType: ParseFunction<ParenthesizedType> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(module, code, index), ({ parsed: inner, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ")"), index => ({
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
    })))))))

const typeofType: ParseFunction<TypeofType> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "typeof"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: expr, index }) => ({
        parsed: {
            kind: "typeof-type",
            expr,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))

const keyofValueofElementofType: ParseFunction<KeyofType|ValueofType|ElementofType> = memo((module, code, startIndex) =>
    given(parseExact("keyof")(module, code, startIndex) ?? parseExact("valueof")(module, code, startIndex) ?? parseExact("elementof")(module, code, startIndex), ({ parsed: keyword, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression'), ({ parsed: inner, index }) => ({
        parsed: {
            kind: keyword === 'keyof' ? 'keyof-type' : keyword === 'valueof' ? 'valueof-type' : 'elementof-type',
            inner,
            mutability: undefined,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))

const literalType: ParseFunction<LiteralType> = memo((module, code, startIndex) =>
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
    })))

const unknownType: ParseFunction<UnknownType> = memo((module, code, startIndex) =>
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
    })))

const procDeclaration: ParseFunction<ProcDeclaration> = memo((module, code, startIndex) =>
    given(parseSeries(module, code, startIndex, decorator), ({ parsed: decorators, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseKeyword(code, index, 'export'), ({ parsed: exported, index }) =>
    given(parseKeyword(code, index, 'async'), ({ parsed: isAsync, index }) =>
    given(parseOptional(module, code, index, parseJsOrPlatform), ({ parsed: platform, index }) =>
    given(consume(code, index, "proc"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_procHeader(isAsync)(module, code, index), ({ parsed: type, index }) => 
    given(consumeWhitespace(code, index), index =>
    platform 
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
                    value: {
                        kind: "js-proc",
                        type,
                        isAsync,
                        body: code.substring(jsStartIndex, jsEndIndex),
                        module,
                        code,
                        startIndex,
                        endIndex
                    },
                    platforms: platform === 'js' ? ALL_PLATFORMS : [platform],
                    decorators,
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
                value: {
                    kind: "proc",
                    type,
                    isAsync,
                    body,
                    module,
                    code,
                    startIndex,
                    endIndex: index
                },
                platforms: ALL_PLATFORMS,
                decorators,
                exported,
                module,
                code,
                startIndex,
                endIndex: index
            },
            index,
        }))))))))))))))

const funcDeclaration: ParseFunction<FuncDeclaration> = memo((module, code, startIndex) => 
    given(parseSeries(module, code, startIndex, decorator), ({ parsed: decorators, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseKeyword(code, index, 'export'), ({ parsed: exported, index }) =>
    given(parseKeyword(code, index, 'async'), ({ parsed: isAsync, index }) =>
    given(parseOptional(module, code, index, parseJsOrPlatform), ({ parsed: platform, index }) =>
    given(consume(code, index, "func"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_funcHeader(module, code, index), ({ parsed: type, index }) => 
    given(consumeWhitespace(code, index), index =>
    platform 
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
                    value: {
                        kind: "js-func",
                        type,
                        isAsync,
                        body: code.substring(jsStartIndex, jsEndIndex),
                        module,
                        code,
                        startIndex,
                        endIndex,
                    },
                    platforms: platform === 'js' ? ALL_PLATFORMS : [platform],
                    decorators,
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
                value: {
                    kind: "func",
                    type,
                    isAsync,
                    body,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                platforms: ALL_PLATFORMS,
                decorators,
                exported,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
        }))))))))))))))
    
const decorator: ParseFunction<Decorator> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, '@'), index =>
    given(localIdentifier(module, code, index), ({ parsed: ident, index }) =>
    given(parseOptional(module, code, index, _invocationArgs), ({ parsed: args, index }) => ({
        parsed: {
            kind: 'decorator',
            decorator: (
                args
                    ? {
                        kind: 'invocation',
                        subject: ident,
                        typeArgs: args.typeArgs,
                        args: args.args,
                        spreadArg: args.spreadArg,
                        bubbles: false,
                        module,
                        code,
                        startIndex,
                        endIndex: index,
                    }
                    : ident
            ),
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))

const parseJsOrPlatform: ParseFunction<'js' | Platform> = memo((module, code, index) =>
    parsePlatform(module, code, index) ??
    given(parseExact('js')(module, code, index), ({ parsed: js, index }) =>
    given(consumeWhitespaceRequired(code, index), index => ({ parsed: js, index }))))

const parsePlatform: ParseFunction<Platform> = memo((module, code, index) =>
    given(
        parseExact('node')(module, code, index) ??
        parseExact('deno')(module, code, index) ??
        parseExact('browser')(module, code, index), ({ parsed: platform, index }) =>
    given(consumeWhitespaceRequired(code, index), index => ({ parsed: platform, index }))))
    
const valueDeclaration: ParseFunction<ValueDeclaration> = memo((module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, (module, code, index) =>
        given(parseExact("export")(module, code, index) ?? parseExact("expose")(module, code, index), ({ parsed: exported, index }) =>
        given(consumeWhitespaceRequired(code, index), index => ({ parsed: exported, index })))), ({ parsed: exported, index }) =>
    given(parseOptional(module, code, index, parsePlatform), ({ parsed: platform, index }) =>
    given(parseExact("const")(module, code, index) ?? parseExact("let")(module, code, index), ({ parsed: kind, index }) =>
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
                platforms: (
                    platform == null
                        ? ALL_PLATFORMS
                        : [platform]
                ),
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
    })))))))))))))

const deriveOrRemoteDelcaration: ParseFunction<DeriveDeclaration|RemoteDeclaration> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'export'), ({ parsed: exported, index }) =>
    given(parseExact("derive")(module, code, index) ?? parseExact("remote")(module, code, index), ({ parsed: kind, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_maybeTypeAnnotation(module, code, index), ({ parsed: type, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '=>'), err(code, index, "'=>'"), index =>
    given(consumeWhitespace(code, index), index =>
    given(expression(module, code, index), ({ parsed: expr, index }) => ({
        parsed: {
            kind: kind === 'derive' ? 'derive-declaration' : 'remote-declaration',
            name,
            type,
            expr,
            exported,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    }))))))))))))

const _maybeTypeAnnotation: ParseFunction<TypeExpression|undefined> = memo((module, code, startIndex) =>{
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
})

const autorun = (withSemicolon: boolean): ParseFunction<Autorun> => memo((module, code, startIndex) =>
    given(consume(code, startIndex, "autorun"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, "Effect block"), ({ parsed: effect, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseExact("forever")(module, code, index) ?? _untilClause(module, code, index), err(code, index, '"forever", or "until" clause'), ({ parsed: until, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(withSemicolon ? consume(code, index, ";") : consumeWhitespace(code, index), err(code, index, '";"'), index => ({
        parsed: {
            kind: "autorun",
            effect,
            until: until === 'forever' ? undefined : until,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))))))

const _untilClause: ParseFunction<Expression> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "until"), index =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, "=>"), index =>
    given(consumeWhitespace(code, index), index =>
    expression(module, code, index))))))

const testExprDeclaration: ParseFunction<TestExprDeclaration> = memo((module, code, startIndex) =>
    given(_testDeclFront(module, code, startIndex, 'expr'), ({ parsed: name, index }) =>
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
    })))))

const testBlockDeclaration: ParseFunction<TestBlockDeclaration> = memo((module, code, startIndex) => 
    given(_testDeclFront(module, code, startIndex, 'block'), ({ parsed: name, index }) =>
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
    })))))

const testTypeDeclaration: ParseFunction<TestTypeDeclaration> = memo((module, code, startIndex) => 
    given(_testDeclFront(module, code, startIndex, 'type'), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Destination type'), ({ parsed: destinationType, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Value type'), ({ parsed: valueType, index }) => ({
        parsed: {
            kind: 'test-type-declaration',
            name,
            destinationType,
            valueType,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))))))))

const _testDeclFront = memo((module: ModuleName, code: string, startIndex: number, keyword: string) =>
    given(consume(code, startIndex, 'test'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, keyword), index =>
    given(consumeWhitespace(code, index), index => 
    expec(exactStringLiteral(module, code, index), err(code, index, 'Test name'), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '=>'), err(code, index, '"=>"'), index => ({
        parsed: name,
        index
    })))))))))

const proc: ParseFunction<Proc> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'async'), ({ parsed: isAsync, index }) =>
    given(_procHeader(isAsync)(module, code, index), ({ parsed: type, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlock(module, code, index), ({ parsed: body, index }) => ({
        parsed: {
            kind: "proc",
            type,
            isAsync,
            body,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index,
    }))))))

const _procHeader = (isAsync: boolean): ParseFunction<ProcType|GenericProcType> => memo((module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, index }) =>
    given(_parenthesizedArguments(module, code, index), ({ parsed: args, index }) => {
        const procType: ProcType = {
            kind: "proc-type",
            args,
            isAsync,
            throws: undefined, // TODO: Parse optional explicit "throws" type
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
    })))

const statement: ParseFunction<Statement> = memo((module, code, startIndex) =>
    javascriptEscape(module, code, startIndex)
    ?? tryCatch(module, code, startIndex)
    ?? throwStatement(module, code, startIndex)
    ?? declarationStatement(module, code, startIndex)
    ?? ifElseStatement(module, code, startIndex)
    ?? forLoop(module, code, startIndex)
    ?? whileLoop(module, code, startIndex)
    ?? assignment(module, code, startIndex)
    ?? procCall(module, code, startIndex)
    ?? autorun(true)(module, code, startIndex))

const declarationStatement: ParseFunction<DeclarationStatement> = memo((module, code, startIndex) => 
    given(parseExact("const")(module, code, startIndex) ?? parseExact("let")(module, code, startIndex), ({ parsed: kind, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(nameAndType(module, code, index) ?? destructure(module, code, index), err(code, index, "Constant name or spread"), ({ parsed: destination, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "="), err(code, index, '"="'), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseKeyword(code, index, 'await'), ({ parsed: awaited, index }) =>
    expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: value, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
            parsed: {
                kind: "declaration-statement",
                destination,
                value,
                awaited,
                isConst: kind === 'const',
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
        }))))))))))))

const assignment: ParseFunction<Assignment> = memo((module, code, startIndex) =>
    given(invocationAccessorChain(module, code, startIndex) ?? indexer(module, code, startIndex) ?? localIdentifier(module, code, startIndex), ({ parsed: target, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, (module, code, index) => _binaryOperatorSymbol(5)(module, code, index) ?? _binaryOperatorSymbol(6)(module, code, index)), ({ parsed: operator, index }) =>
    given(consume(code, index, "="), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Assignment value"), ({ parsed: value, index }) => 
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ";"), err(code, index, '";"'), index => 
        target.kind === "local-identifier" || target.kind === "property-accessor" ? {
            parsed: {
                kind: "assignment",
                target,
                value,
                operator,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
        } : undefined
    )))))))))

const procCall: ParseFunction<Invocation> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'await'), ({ parsed: awaited, index }) =>
    given(parseKeyword(code, index, 'detach'), ({ parsed: detached, index }) =>
    given(invocationAccessorChain(module, code, index), ({ parsed, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, parseExact("?")), ({ parsed: bubbles, index: indexAfterQuestionMark }) =>
    given(consumeWhitespace(code, indexAfterQuestionMark ?? index), index =>
    expec(consume(code, index, ';'), err(code, index, '";"'), index => 
        parsed.kind === "invocation" ? {
            parsed: {
                ...parsed,
                bubbles: bubbles != null,
                awaitedOrDetached: awaited ? 'await' : detached ? 'detach' : undefined,
            },
            index
        } : undefined))))))))
    

const ifElseStatement: ParseFunction<IfElseStatement> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _conditionAndOutcomeBlock, 'else if', { trailingDelimiter: "forbidden" }), ({ parsed: cases, index }) => {
        const elseResult = 
            given(consumeWhitespace(code, index), index =>
            given(consume(code, index, "else"), index => 
            given(consumeWhitespace(code, index), index =>
            expec(parseBlock(module, code, index), err(code, index, 'Else block'), result => result))));

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
    }))))

const _conditionAndOutcomeBlock: ParseFunction<CaseBlock> = memo((module, code, startIndex) =>
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
    })))))

const forLoop: ParseFunction<ForLoop> = memo((module, code, startIndex) =>
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
    })))))))))))

const whileLoop: ParseFunction<WhileLoop> = memo((module, code, startIndex) =>
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
    })))))))

const parseBlock: ParseFunction<Block> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlockWithoutBraces(module, code, index), ({ parsed, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed,
        index,
    })))))))

const parseBlockWithoutBraces: ParseFunction<Block> = memo((module, code, startIndex) =>
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
    })))

const tryCatch: ParseFunction<TryCatch> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "try"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Try-block'), ({ parsed: tryBlock, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "catch"), err(code, index, '"catch"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(plainIdentifier(module, code, index), err(code, index, 'Identifier'), ({ parsed: errIdentifier, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(parseBlock(module, code, index), err(code, index, 'Catch-block'), ({ parsed: catchBlock, index }) => ({
        parsed: {
            kind: 'try-catch',
            tryBlock,
            errIdentifier,
            catchBlock,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))))))))

const throwStatement: ParseFunction<ThrowStatement> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "throw"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Error expression'), ({ parsed: errorExpression, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ';'), err(code, index, '";"'), index => ({
        parsed: {
            kind: 'throw-statement',
            errorExpression,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))))

const expression: ParseFunction<Expression> = memo((module, code, startIndex) =>
    EXPRESSION_PARSER.parseStartingFromTier(0)(module, code, startIndex))

const func: ParseFunction<Func> = memo((module, code, startIndex) =>
    given(parseKeyword(code, startIndex, 'async'), ({ parsed: isAsync, index }) =>
    given(_funcHeader(module, code, index), ({ parsed: type, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Function body'), ({ parsed: body, index }) => ({
        parsed: {
            kind: "func",
            type,
            isAsync,
            body,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index,
    }))))))

const _funcHeader: ParseFunction<FuncType|GenericFuncType> = memo((module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeParams), ({ parsed: typeParams, index }) =>
    given(_funcArgs(module, code, index), ({ parsed: args, index }) =>
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
    })))))))


const _typeParams: ParseFunction<TypeParam[]> = memo((module, code, index) =>
    given(consume(code, index, "<"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(parseSeries(module, code, index, _typeParam, ','), err(code, index, "Type parameters"), ({ parsed: typeParams, index }) =>
    given(consumeWhitespace(code, index), index => 
    given(consume(code, index, ">"), index => ({ parsed: typeParams, index })))))))

const _funcArgs: ParseFunction<Args | SpreadArgs> = memo((module, code, startIndex) => 
    _singleArgument(module, code, startIndex) ??
    _parenthesizedArguments(module, code, startIndex))

const _singleArgument: ParseFunction<Args> = memo((module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) => ({
        parsed: {
            kind: 'args',
            args: [
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
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))

const _parenthesizedArguments: ParseFunction<Args | SpreadArgs> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(spreadArgs(module, code, index) ?? args(module, code, index), ({ parsed: args, index }) =>
    given(consume(code, index, ")"), index => ({
        parsed: args,
        index
    })))))

const spreadArgs: ParseFunction<SpreadArgs> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, '...'), index =>
    given(plainIdentifier(module, code, index), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ':'), index =>
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(module, code, index), ({ parsed: type, index }) => ({
        parsed: {
            kind: 'spread-args',
            name,
            type,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))

const args: ParseFunction<Args> = memo((module, code, startIndex) =>
    given(parseSeries(module, code, startIndex, (module, code, index) =>
        arg(module, code, index) ?? 
        given(typeExpression(module, code, index), ({ parsed: type, index }): ParseResult<Arg> => ({
            parsed: {
                kind: "arg",
                name: { kind: 'plain-identifier', name: '', ...AST_NOISE },
                type,
                optional: false,
                module: type.module,
                code: type.code,
                startIndex: type.startIndex,
                endIndex: type.endIndex
            },
            index
        }))
    , ","), ({ parsed: args, index }) => ({
        parsed: {
            kind: "args",
            args: args.map((a, i) => a.name.name 
                ? a 
                : ({ ...a, name: { ...a.name, name: `arg${i}` } })),
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))

const arg: ParseFunction<Arg> = memo((module, code, startIndex) => 
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
    }))))))

const inlineConstGroup: ParseFunction<InlineConstGroup> = memo((module, code, startIndex) =>
    given(parseSeries(module, code, startIndex, inlineDeclaration), ({ parsed: declarations, index }) =>
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
        : undefined))

const inlineDeclaration: ParseFunction<InlineDeclaration> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, 'const'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(nameAndType(module, code, index) ?? destructure(module, code, index), ({ parsed: destination, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, '='), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseKeyword(code, index, 'await'), ({ parsed: awaited, index }) =>
    expec(expression(module, code, index), err(code, index, "Value"), ({ parsed: value, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ','), err(code, index, '","'), index => ({
        parsed: {
            kind: 'inline-declaration',
            destination,
            awaited,
            value,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))))))

const nameAndType: ParseFunction<NameAndType> = memo((module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(_maybeTypeAnnotation(module, code, index), ({ parsed: type, index }) => ({
        parsed: {
            kind: 'name-and-type',
            name,
            type,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))))

const destructure: ParseFunction<Destructure> = memo((module, code, startIndex) =>
    given(parseExact('{')(module, code, startIndex) ?? parseExact('[')(module, code, startIndex), ({ parsed: destructureChar, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, plainIdentifier, ','), ({ parsed: properties, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(destructureChar === '{' ? consume(code, index, '}') : consume(code, index, ']'), err(code, index, destructureChar === '{' ? '"}"' : '"]"'), index => ({
        parsed: {
            kind: 'destructure',
            properties,
            spread: undefined,
            destructureKind: destructureChar === '{' ? 'object' : 'array',
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))))))



const binaryOperator = memo((tier: number): ParseFunction<BinaryOperator> => memo((module, code, startIndex) => 
    given(parseSeries(module, code, startIndex, 
        EXPRESSION_PARSER.beneath(binaryOperator(tier)), 
        _binaryOperatorSymbol(tier), 
        { leadingDelimiter: "forbidden", trailingDelimiter: "forbidden" }
    ), ({ parsed: segments, index }) => 
        segments.length >= 3 ? 
            given(_segmentsToOps(segments), parsed => ({
                parsed,
                index,
            }))
        : undefined
    )))

const _binaryOperatorSymbol = memo((tier: number): ParseFunction<Operator> => memo((module, code, startIndex) => {
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
}))

const _segmentsToOps = memo((segments: (Operator|Expression)[]): BagelError|BinaryOperator => {
    let result: BinaryOperator|undefined;
    const base = segments[0] as Expression
    const { parent, module, code, startIndex } = base

    for (let i = 1; i < segments.length; i += 2) {
        const left = result ?? base
        const op = segments[i]
        const right = segments[i+1]

        if (op.kind !== "operator") {
            return err(op.code, op.startIndex, "Operator")
        }

        if (right.kind === "operator") {
            return err(right.code, right.startIndex, "Expression")
        }

        result = {
            kind: "binary-operator",
            left,
            op,
            right,
            parent,
            module,
            code,
            startIndex,
            endIndex: right.endIndex
        }
    }

    return result as BinaryOperator
})


const instanceOf: ParseFunction<InstanceOf> = memo((module, code, startIndex) =>
    given(EXPRESSION_PARSER.beneath(instanceOf)(module, code, startIndex), ({ parsed: expr, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, "instanceof"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression'), ({ parsed: type, index }) => ({
        parsed: {
            kind: "instance-of",
            expr,
            type,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))))
    

const asCast: ParseFunction<AsCast> = memo((module, code, startIndex) =>
    given(EXPRESSION_PARSER.beneath(asCast)(module, code, startIndex), ({ parsed: inner, index }) =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(consume(code, index, "as"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Type expression'), ({ parsed: type, index }) => ({
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
    })))))))


const negationOperator: ParseFunction<NegationOperator> = memo((module, code, startIndex) => 
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
    
const indexer: ParseFunction<PropertyAccessor> = memo((module, code, startIndex) =>
    given(EXPRESSION_PARSER.parseBeneath(module, code, startIndex, indexer), ({ parsed: base, index }) =>
    given(parseSeries(module, code, index, _indexerExpression), ({ parsed: indexers, index }) => 
        indexers.length > 0 ? 
            {
                parsed: indexers.reduce((subject, { property, optional }) => ({
                    kind: "property-accessor",
                    subject,
                    property,
                    optional,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                }), base) as PropertyAccessor,
                index,
            }
        : undefined)))

const _indexerExpression: ParseFunction<Omit<PropertyAccessor, 'subject'>> = memo((module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, parseExact('?.')), ({ parsed: question, index }) =>
    given(consume(code, index, "["), index => 
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Indexer expression'),({ parsed: property, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "property-accessor",
            property,
            optional: question != null,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    }))))))))

const ifElseExpression: ParseFunction<IfElseExpression> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "if"), index =>
    given(consumeWhitespace(code, index), index =>
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
    }))))

const _case: ParseFunction<Case> = memo((module, code, startIndex) =>
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
    })))))))))

const switchExpression: ParseFunction<SwitchExpression> = memo((module, code, startIndex) =>
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
    })))))))))))))

const switchCase: ParseFunction<SwitchCase> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, 'case'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(typeExpression(module, code, index), err(code, index, 'Case expression'), ({ parsed: type, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Case result'), ({ parsed: outcome, index }) => ({
        parsed: {
            kind: "switch-case",
            type,
            outcome,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))))))))

const _defaultCase: ParseFunction<Expression> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, 'default'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, 'Case result'), ({ parsed: outcome, index }) => ({
        parsed: {
            ...outcome,
            startIndex
        },
        index
    })))))))


const range: ParseFunction<Range> = memo((module, code, startIndex) =>
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
    })))))

const parenthesized: ParseFunction<ParenthesizedExpression> = memo((module, code, startIndex) =>
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
    })))))))

const invocationAccessorChain: ParseFunction<Invocation|PropertyAccessor> = memo((module, code, startIndex) =>
    given(EXPRESSION_PARSER.parseBeneath(module, code, startIndex, invocationAccessorChain), ({ parsed: subject, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries<InvocationArgs|Omit<PropertyAccessor, 'subject'>>(module, code, index, (module, code, index) => 
        _invocationArgs(module, code, index) ?? _indexerExpression(module, code, index) ?? _dotPropertyAccess(module, code, index)),
    ({ parsed: gets, index }) => 
        gets.length > 0 ? {
            parsed: _getsToInvocationsAndAccesses(subject, gets),
            index
        } : undefined))))

const _dotPropertyAccess: ParseFunction<Omit<PropertyAccessor, 'subject'>> = memo((module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, parseExact("?")), ({ parsed: question, index }) =>
    given(consume(code, index, "."), index =>
    expec(plainIdentifier(module, code, index), err(code, index, "Property name"), ({ parsed: property, index }) => ({
        parsed: {
            kind: "property-accessor",
            property,
            optional: question != null,
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    })))))

const _getsToInvocationsAndAccesses = memo((subject: Expression, gets: (InvocationArgs|Omit<PropertyAccessor, 'subject'>)[]): Invocation|PropertyAccessor => {
    let current = _oneGetToInvocationOrAccess(subject, gets[0])

    for (let i = 1; i < gets.length; i++) {
        current = _oneGetToInvocationOrAccess(current, gets[i])
    }

    return current
})

const _oneGetToInvocationOrAccess = memo((subject: Expression, get: InvocationArgs|Omit<PropertyAccessor, 'subject'>): Invocation|PropertyAccessor => {
    if (get.kind === "invocation-args") {
        return {
            ...get,
            startIndex: subject.startIndex,

            kind: "invocation",
            subject,
            bubbles: false,
        }
    } else {
        return {
            ...get,
            subject
        }
    }
})
    
type InvocationArgs = SourceInfo & { kind: "invocation-args", args: readonly Expression[], spreadArg: Spread|undefined, typeArgs: TypeExpression[] }

const _invocationArgs: ParseFunction<InvocationArgs> = memo((module, code, startIndex) =>
    given(parseOptional(module, code, startIndex, _typeArgs), ({ parsed: typeArgs, index }) =>
    given(consume(code, index, "("), index => 
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, expression, ","), ({ parsed: args, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(module, code, index, spread), ({ parsed: spreadArg, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "invocation-args",
            args,
            spreadArg,
            typeArgs: typeArgs ?? [],
            module,
            code,
            startIndex,
            endIndex: index
        },
        index
    }))))))))))

const _typeArgs: ParseFunction<TypeExpression[]> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "<"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, typeExpression, ','), ({ parsed: typeArgs, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ">"), index => ({ parsed: typeArgs, index })))))))

const localIdentifier: ParseFunction<LocalIdentifier> = memo((module, code, startIndex) => 
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
    })))

export const elementTag: ParseFunction<ElementTag> = memo((module, code, startIndex) => 
    given(consume(code, startIndex, "<"), index =>
    given(plainIdentifier(module, code, index), ({ parsed: tagName, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _tagAttribute), ({ parsed: parsedAttributes, index }) => 
    given(consumeWhitespace(code, index), index => {
        const attributes: ObjectEntry[] = parsedAttributes.map(([key, value]) => ({
            kind: 'object-entry',
            key,
            value,
            module: key.module,
            code: key.code,
            startIndex: key.startIndex,
            endIndex: value.endIndex
        }))

        const singletonClose = consume(code, index, '/>')

        if (singletonClose != null) {
            return {
                parsed: {
                    kind: "element-tag",
                    tagName,
                    attributes,
                    children: [],
                    module,
                    code,
                    startIndex,
                    endIndex: singletonClose,
                },
                index: singletonClose,
            }
        } else {
            return (
                expec(consume(code, index, ">"), err(code, index, '">"'), index => 
                given(consumeWhitespace(code, index), index =>
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
                }))))))))
            )
        }
    }))))))

const _tagAttribute: ParseFunction<[PlainIdentifier, Expression]> = memo((module, code, startIndex) =>
    given(plainIdentifier(module, code, startIndex), ({ parsed: name, index }) =>
    given(consume(code, index, "="), index =>
    expec(exactStringLiteral(module, code, index) ?? _elementEmbeddedExpression(module, code, index), err(code, index, "Expression"), ({ parsed: expression, index }) => ({
        parsed: [ name, expression ],
        index,
    })))))

const _elementEmbeddedExpression: ParseFunction<Expression> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Expression"), ({ parsed: expression, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: expression,
        index,
    })))))))

const error: ParseFunction<ErrorExpression> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "Error("), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(module, code, index), err(code, index, "Expression"), ({ parsed: inner, index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ")"), err(code, index, '")"'), index => ({
        parsed: {
            kind: "error-expression",
            inner,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index
    })))))))

export const objectLiteral: ParseFunction<ObjectLiteral> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _spreadOrEntry, ","), ({ parsed: entries, index }) =>
    given(consumeWhitespace(code, index), index =>
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
    })))))))

const _spreadOrEntry: ParseFunction<ObjectLiteral['entries'][number]> = memo((module, code, startIndex) =>
    spread(module, code, startIndex)
    ?? objectEntry(module, code, startIndex)
    ?? localIdentifier(module, code, startIndex))

const objectEntry = memo((module: ModuleName, code: string, startIndex: number): ParseResult<ObjectEntry> | BagelError | undefined =>
    given(plainIdentifier(module, code, startIndex) ??
          exactStringLiteral(module, code, startIndex) ??
          given(consume(code, startIndex, '['), index =>
            given(consumeWhitespace(code, index), index =>
            expec(expression(module, code, index), err(code, index, 'Expression'), ({ parsed: key, index }) =>
            given(consumeWhitespace(code, index), index =>
            expec(consume(code, index, ']'), err(code, index, '"]"'), index => ({ parsed: key, index })))))), ({ parsed: key, index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(expression(module, code, index), ({ parsed: value, index }) => ({
        parsed: {
            kind: 'object-entry',
            key,
            value,
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))))))

const arrayLiteral: ParseFunction<ArrayLiteral> = memo((module, code, startIndex) =>
    given(consume(code, startIndex, "["), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(module, code, index, _expressionOrSpread, ","), ({ parsed: entries, index }) =>
    given(consumeWhitespace(code, index), index =>
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
    })))))))

const _expressionOrSpread: ParseFunction<Expression|Spread> = memo((module, code, startIndex) =>
    spread(module, code, startIndex)
    ?? expression(module, code, startIndex))

const spread: ParseFunction<Spread> = memo((module, code, startIndex) =>
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
    }))))

const regExp: ParseFunction<RegularExpression> = memo((module, code, startIndex) => 
    given(consume(code, startIndex, '/'), index => {
        const exprStart = index
        while (code[index] !== '/' && index < code.length) index++;
        const exprEnd = index

        index++

        if (index >= code.length) return undefined

        const flags: RegularExpressionFlag[] = []

        while((ALL_REG_EXP_FLAGS as readonly string[]).includes(code[index])) {
            flags.push(code[index] as RegularExpressionFlag)
            index++
        }

        return {
            parsed: {
                kind: 'regular-expression',
                expr: code.substring(exprStart, exprEnd),
                flags,
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index
        }
    }))


const stringLiteral: ParseFunction<StringLiteral|ExactStringLiteral> = memo((module, code, startIndex) => {
    const segments: (string|Expression)[] = [];
    let index = startIndex;
    let tag: PlainIdentifier | undefined

    const tagResult = plainIdentifier(module, code, index)
    if (isError(tagResult)) {
        return tagResult
    } else if (tagResult != null) {
        index = tagResult.index
        tag = tagResult.parsed
    }

    if (code[index] === "'") {
        index++;
        let currentSegment = '';

        let escapeNext = false

        while (index < code.length && (escapeNext || code[index] !== "'")) {            
            if (!escapeNext && code[index] === "$" && code[index+1] === "{") {
                escapeNext = false

                if (currentSegment.length > 0) {
                    segments.push(currentSegment);
                    currentSegment = '';
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
                        // unclosed insertion
                        return err(code, index, '"}"');
                    } else {
                        // finished insertion, begin next string segment
                        index = closeBraceResult;
                    }
                }
            } else if (!escapeNext && code[index] === '\\') {
                escapeNext = true
                index++
            } else {
                escapeNext = false
                currentSegment += code[index]
                index++;
            }
        }

        if (index > code.length) {
            return err(code, index, '"\'"');
        } else {
            segments.push(currentSegment);

            if (segments.length === 1 && typeof segments[0] === 'string' && tag == null) {
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
                        tag,
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
})

const exactStringLiteral: ParseFunction<ExactStringLiteral> = memo((module, code, startIndex) =>
    given(stringLiteral(module, code, startIndex), ({ parsed: literal, index }) =>
        literal.kind === 'exact-string-literal' ?
            {
                parsed: literal,
                index
            }
        : undefined))

const numberLiteral: ParseFunction<NumberLiteral> = memo((module, code, startIndex) => {
    let index = startIndex;

    if (code[index] === '-') {
        index++
    }

    if (isNumeric(code[index])) {
        index++;
        while (isNumeric(code[index])) {
            index++;
        }

        return {
            parsed: {
                kind: "number-literal",
                value: Number(code.substring(startIndex, index)),
                module,
                code,
                startIndex,
                endIndex: index,
            },
            index,
        }
    }
})

const booleanLiteral: ParseFunction<BooleanLiteral> = memo((module, code, startIndex) => {

    {
        const index = consume(code, startIndex, "true");
        if (index != null && !isSymbolic(code[index], false)) {
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
        if (index != null && !isSymbolic(code[index], false)) {
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
})

const nilLiteral: ParseFunction<NilLiteral> = memo((module, code, startIndex) => 
    given(consume(code, startIndex, "nil"), index => ({
        parsed: {
            kind: "nil-literal",
            module,
            code,
            startIndex,
            endIndex: index,
        },
        index,
    })))

const javascriptEscape: ParseFunction<JavascriptEscape> = memo((module, code, startIndex) =>
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
}))

const debug: ParseFunction<Debug> = memo((module, code, startIndex) =>
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
    }))))))

const EXPRESSION_PARSER = new TieredParser<Expression>([
    [ debug, javascriptEscape, elementTag ],
    [ func, proc ],
    [ binaryOperator(0) ],
    [ binaryOperator(1) ],
    [ binaryOperator(2) ],
    [ binaryOperator(3) ],
    [ binaryOperator(4) ],
    [ binaryOperator(5) ],
    [ binaryOperator(6) ],
    [ asCast, instanceOf ],
    [ negationOperator ],
    [ indexer ],
    [ error ],
    [ invocationAccessorChain ],
    [ range ],
    [ parenthesized ],
    [ ifElseExpression, switchExpression, inlineConstGroup, booleanLiteral, nilLiteral, objectLiteral, arrayLiteral, 
        stringLiteral, numberLiteral ],
    [ localIdentifier, regExp ],
])

const TYPE_PARSER = new TieredParser<TypeExpression>([
    [ typeofType, keyofValueofElementofType ],
    [ genericType ],
    [ unionType ],
    [ maybeType ],
    [ boundGenericType ],
    [ arrayType ],
    [ primitiveType, parenthesizedType, funcType, procType, 
        literalType, recordType, objectType, 
        tupleType, unknownType ],
    [ namedType ]
])

function err(code: string|undefined, index: number|undefined, expected: string): BagelError {
    
    if (code != null && index != null) {
        while (code[index - 1]?.match(/[\s]/)) {
            index--
        }
    }
    
    return {
        kind: "bagel-syntax-error",
        ast: undefined,
        code,
        index,
        message: `${expected} expected`,
        stack: undefined
    };
}
