import { BagelError, isError } from "../errors.ts";
import { Module } from "../_model/ast.ts";
import { Block, PlainIdentifier, SourceInfo } from "../_model/common.ts";
import { ClassDeclaration, ClassFunction, ClassMember, ClassProcedure, ClassProperty, ConstDeclaration, Declaration, FuncDeclaration, ImportDeclaration, ProcDeclaration, TypeDeclaration } from "../_model/declarations.ts";
import { ArrayLiteral, BinaryOperator, BooleanLiteral, ClassConstruction, ElementTag, Expression, Func, Invocation, IfElseExpression, Indexer, JavascriptEscape, LocalIdentifier, NilLiteral, NumberLiteral, ObjectLiteral, ParenthesizedExpression, Pipe, Proc, PropertyAccessor, Range, StringLiteral, SwitchExpression } from "../_model/expressions.ts";
import { Assignment, Computation, ForLoop, IfElseStatement, LetDeclaration, Reaction, Statement, WhileLoop } from "../_model/statements.ts";
import { ArrayType, FuncType, IndexerType, IteratorType, LiteralType, NamedType, ObjectType, PrimitiveType, ProcType, PlanType, TupleType, TypeExpression, UnionType, UnknownType } from "../_model/type-expressions.ts";
import { consume, consumeWhile, consumeWhitespace, consumeWhitespaceRequired, err, expec, given, identifierSegment, isNumeric, parseBinaryOp, ParseFunction, parseOptional, ParseResult, parseSeries, plainIdentifier } from "./common.ts";


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
    ?? classDeclaration(code, index)
    ?? javascriptEscape(code, index)

const importDeclaration: ParseFunction<ImportDeclaration> = (code, startIndex) =>
    given(consume(code, startIndex, "from"), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(stringLiteral(code, index), err(code, index, 'Import path'), ({ parsed: path, newIndex: index }) => 
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
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
            imports: imports.map(i => ({
                kind: "import-item",
                name: i,
                code: i.code,
                startIndex: i.startIndex,
                endIndex: i.endIndex,
            })),
            path,
        },
        newIndex: index
    })))))))))))

const typeDeclaration: ParseFunction<TypeDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespaceRequired(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? startIndex, "type"), index => 
        given(consumeWhitespaceRequired(code, index), index =>
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

const arrayType: ParseFunction<ArrayType> = (code, startIndex) =>
    given(nonArrayType(code, startIndex), ({ parsed: element, newIndex: index }) =>
    given(consume(code, index, "[]"), index => ({
        parsed: {
            kind: "array-type",
            element,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index,
    })))

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
                    code,
                    startIndex,
                    endIndex: index,
                },
                newIndex: index,
            }
            : undefined)

const atomicType: ParseFunction<TypeExpression> = (code, index) =>
    primitiveType(code, index)
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

const namedType: ParseFunction<NamedType> = (code, startIndex) =>
    given(plainIdentifier(code, startIndex), ({ parsed: name, newIndex: index }) => ({
        parsed: {
            kind: "named-type",
            name,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const objectType: ParseFunction<ObjectType> = (code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _objectTypeEntry, ","), ({ parsed: entries, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
        parsed: {
            kind: "object-type",
            entries,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))

const _objectTypeEntry = (code: string, index: number): ParseResult<[PlainIdentifier, TypeExpression]> | BagelError | undefined =>
    given(plainIdentifier(code, index), ({ parsed: key, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    given(consume(code, index, ":"), index => 
    given(consumeWhitespace(code, index), index =>
    given(typeExpression(code, index), ({ parsed: value, newIndex: index }) => ({
        parsed: [key, value],
        newIndex: index,
    }))))))

const indexerType: ParseFunction<IndexerType> = (code, startIndex) =>
    given(consume(code, startIndex, "{"), index =>
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
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))))

const tupleType: ParseFunction<TupleType> = (code, startIndex) =>
    given(consume(code, startIndex, "["), index =>
    given(parseSeries(code, index, typeExpression, ","), ({ parsed: members, newIndex: index }) =>
    expec(consume(code, index, "]"), err(code, index, '"]"'), index => ({
        parsed: {
            kind: "tuple-type",
            members,
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))

const primitiveType: ParseFunction<PrimitiveType> = (code, startIndex) =>
    given(consume(code, startIndex, "string"), index => ({
        parsed: {
            kind: "string-type",
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))
    ?? given(consume(code, startIndex, "number"), index => ({
        parsed: {
            kind: "number-type",
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))
    ?? given(consume(code, startIndex, "boolean"), index => ({
        parsed: {
            kind: "boolean-type",
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))
    ?? given(consume(code, startIndex, "nil"), index => ({
        parsed: {
            kind: "nil-type",
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))
    ?? given(consume(code, startIndex, "unknown"), index => ({
        parsed: {
            kind: "unknown-type",
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
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))))))

const literalType: ParseFunction<LiteralType> = (code, startIndex) =>
    given(stringLiteral(code, startIndex) 
        ?? numberLiteral(code, startIndex) 
        ?? booleanLiteral(code, startIndex), 
    ({ parsed: value, newIndex: index }) => ({
        parsed: {
            kind: "literal-type",
            value,
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
            code,
            startIndex,
            endIndex: index,
        },
        newIndex: index,
    }))

const procDeclaration: ParseFunction<ProcDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespaceRequired(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? startIndex, "proc"), index =>
        given(consumeWhitespaceRequired(code, index), index =>
        given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
        expec(proc(code, index), err(code, index, 'Procedure'), ({ parsed: proc, newIndex: index }) => ({
            parsed: {
                kind: "proc-declaration",
                name,
                code,
                startIndex,
                endIndex: index,
                value: proc,
                exported,
            },
            newIndex: index,
        }))))))
}

const funcDeclaration: ParseFunction<FuncDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespaceRequired(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? startIndex, "func"), index =>
        given(consumeWhitespaceRequired(code, index), index =>
        given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
        expec(func(code, index), err(code, index, 'Function'), ({ parsed: func, newIndex: index }) => ({
            parsed: {
                kind: "func-declaration",
                name,
                code,
                startIndex,
                endIndex: index,
                value: func,
                exported,
            },
            newIndex: index,
        }))))))
}

const constDeclaration: ParseFunction<ConstDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespaceRequired(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, indexAfterExport ?? startIndex, "const"), index =>
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
                    code,
                    startIndex,
                    endIndex: index,
                    name,
                    type,
                    value,
                    exported,
                },
                newIndex: index,
        }))))))))))
}

const classDeclaration: ParseFunction<ClassDeclaration> = (code, startIndex) => {
    const indexAfterExport = given(consume(code, startIndex, "export"), index =>
        consumeWhitespaceRequired(code, index));

    if (isError(indexAfterExport)) {
        return indexAfterExport;
    }

    const exported = indexAfterExport != null;
    
    return given(consume(code, startIndex, "class"), index =>
        given(consumeWhitespaceRequired(code, index), index =>
        expec(plainIdentifier(code, index), err(code, index, "Class name"), ({ parsed: name, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
        expec(consume(code, index, "{"), err(code, index, '"{"'), index =>
        given(parseSeries(code, index, classMember), ({ parsed: members, newIndex: index }) =>
        given(consumeWhitespace(code, index), index =>
        expec(consume(code, index, "}"), err(code, index, '"}"'), index => ({
            parsed: {
                kind: "class-declaration",
                code,
                startIndex,
                endIndex: index,
                name,
                typeParams: [],
                members,
                exported
            },
            newIndex: index
        })))))))))
}

const classMember: ParseFunction<ClassMember> = (code, startIndex) =>
    classProperty(code, startIndex)
    ?? classFunction(code, startIndex)
    ?? classProcedure(code, startIndex)

const classProperty: ParseFunction<ClassProperty> = (code, startIndex) => {
    const accessResult = given(_accessModifierWithVisible(code, startIndex), ({ parsed, newIndex: index }) => 
        given(consumeWhitespaceRequired(code, index), index => ({
            parsed,
            newIndex: index
        })));

    if (isError(accessResult)) {
        return accessResult;
    }

    const access = accessResult?.parsed ?? 'public';
    
    return given(plainIdentifier(code, accessResult?.newIndex ?? startIndex), ({ parsed: name, newIndex: index }) =>
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
                code,
                startIndex,
                endIndex: index,
                name,
                type,
                value,
                access
            },
            newIndex: index,
        }))))))))
}

const classFunction: ParseFunction<ClassFunction> = (code, startIndex) => {
    const accessResult = given(_accessModifier(code, startIndex), ({ parsed, newIndex: index }) => 
        given(consumeWhitespaceRequired(code, index), index => ({
            parsed,
            newIndex: index
        })));

    if (isError(accessResult)) {
        return accessResult;
    }

    const access = accessResult?.parsed ?? 'public';
    
    return given(funcDeclaration(code, accessResult?.newIndex ?? startIndex), ({ parsed: { name, value }, newIndex: index }) => ({
        parsed: {
            kind: "class-function",
            code,
            startIndex,
            endIndex: index,
            name,
            value,
            access
        },
        newIndex: index,
    }))
}

const classProcedure: ParseFunction<ClassProcedure> = (code, startIndex) => {
    const accessResult = given(_accessModifier(code, startIndex), ({ parsed, newIndex: index }) => 
        given(consumeWhitespaceRequired(code, index), index => ({
            parsed,
            newIndex: index
        })));

    if (isError(accessResult)) {
        return accessResult;
    }

    const access = accessResult?.parsed ?? 'public';
    
    return given(procDeclaration(code, accessResult?.newIndex ?? startIndex), ({ parsed: { name, value }, newIndex: index }) => ({
        parsed: {
            kind: "class-procedure",
            code,
            startIndex,
            endIndex: index,
            name,
            value,
            access
        },
        newIndex: index,
    }))
}

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

const proc: ParseFunction<Proc> = (code, startIndex) =>
    given(consume(code, startIndex, "("), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseBlock(code, index), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "proc",
            type: {
                kind: "proc-type",
                typeParams: [], // TODO
                args: args,
                code,
                startIndex,
                endIndex: index
            },
            body,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index,
    }))))))

const statement: ParseFunction<Statement> = (code, startIndex) =>
    reaction(code, startIndex)
    ?? computation(code, startIndex)
    ?? javascriptEscape(code, startIndex)
    ?? letDeclaration(code, startIndex)
    ?? ifElseStatement(code, startIndex)
    ?? forLoop(code, startIndex)
    ?? whileLoop(code, startIndex)
    ?? assignment(code, startIndex)
    ?? procCall(code, startIndex)

const reaction: ParseFunction<Reaction> = (code, startIndex) =>
    given(consume(code, startIndex, "reaction"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(code, index), err(code, index, "Data function"), ({ parsed: data, newIndex: index }) =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(consume(code, index, "triggers"), err(code, index, '"triggers" clause'), index =>
    expec(consumeWhitespaceRequired(code, index), err(code, index, "Whitespace"), index =>
    expec(expression(code, index), err(code, index, "Side-effect procedure"), ({ parsed: effect, newIndex: index }) => 
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
            code,
            startIndex,
            endIndex: index,
            data,
            effect,
            until: typeof lifetimeResult === 'number' ? undefined : lifetimeResult.parsed
        },
        newIndex: index,
    }))))))))))))

const computation: ParseFunction<Computation> = (code, startIndex) =>
    given(consume(code, startIndex, "computation"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(plainIdentifier(code, index), err(code, index, "Computation name"), ({ parsed: name, newIndex: index }) =>
    expec(consume(code, index, '()'), err(code, index, '"()"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, '=>'), err(code, index, '"=>"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, "Computation expression"), ({ parsed: expression, newIndex: index }) => 
    expec(consume(code, index, ";"), err(code, index, '";"'), index => ({
        parsed: {
            kind: "computation",
            code,
            startIndex,
            endIndex: index,
            name,
            expression
        },
        newIndex: index
    }))))))))))

const letDeclaration: ParseFunction<LetDeclaration> = (code, startIndex) =>
    given(consume(code, startIndex, "let"), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    given(plainIdentifier(code, index), ({ parsed: name, newIndex: index }) =>
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
                type
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
            code,
            startIndex,
            endIndex: index,
            target,
            value,
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
    given(consumeWhitespace(code, index), index =>
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
    }))))))


class ParseMemo {
    private memo = new Map<string, Map<ParseFunction<Expression>, Map<number, ParseResult<Expression>>>>();

    memoize(fn: ParseFunction<Expression>, code: string, index: number, result: ParseResult<Expression>|BagelError|undefined) {
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
        return (code: string, index: number): ParseResult<T>|BagelError|undefined => {
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
    given(parseOptional(code, startIndex, (code, index) =>
        given(consume(code, index, "<"), index =>
        given(consumeWhitespace(code, index), index =>
        expec(parseSeries(code, index, plainIdentifier, ','), err(code, index, "Type parameters"), ({ parsed: typeParams, newIndex: index }) =>
        given(consumeWhitespace(code, index), index => 
        given(consume(code, index, ">"), index => ({ parsed: typeParams, newIndex: index }))))))), ({ parsed: typeParams, newIndex: indexAfterTypeParams }) =>
    given(consume(code, indexAfterTypeParams ?? startIndex, "("), index =>
    given(parseSeries(code, index, _argumentDeclaration, ","), ({ parsed: args, newIndex: index }) =>
    given(consume(code, index, ")"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseOptional(code, index, (code, index) =>
        given(consume(code, index, ":"), index =>
        given(consumeWhitespace(code, index), index => typeExpression(code, index)))), ({ parsed: returnType, newIndex }) =>
    given(consumeWhitespace(code, newIndex ?? index), index =>
    given(consume(code, index, "=>"), index =>
    given(consumeWhitespace(code, index), index =>
    given(parseSeries(code, index, _funcConst, ',', { trailingDelimiter: 'required' }), ({ parsed: consts, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Function body'), ({ parsed: body, newIndex: index }) => ({
        parsed: {
            kind: "func",
            type: {
                kind: "func-type",
                typeParams: typeParams ?? [],
                args,
                returnType,
                code,
                startIndex,
                endIndex: index
            },
            consts,
            body,
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index,
    })))))))))))))

const _argumentDeclaration = (code: string, index: number): ParseResult<{ name: PlainIdentifier, type?: TypeExpression }> | BagelError | undefined => 
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

const _funcConst = (code: string, index: number): ParseResult<{ name: PlainIdentifier, type?: TypeExpression, value: Expression }> | BagelError | undefined =>
    given(consume(code, index, 'const'), index =>
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
            name,
            type,
            value
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
                    code: expr.code,
                    startIndex: expr.startIndex,
                    endIndex: expr.endIndex
                }), expressions[0]) as Pipe,
                newIndex: index
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
            args: [left, right],
        },
        newIndex: index,
    }))))))

const indexer: ParseFunction<Indexer> = (code, startIndex) =>
    given(parseBeneath(code, startIndex, indexer), ({ parsed: base, newIndex: index }) =>
    given(parseSeries(code, index, _indexerExpression), ({ parsed: indexers, newIndex: index }) => 
        indexers.length > 0 ? 
            {
                parsed: indexers.reduce((subject: Expression, indexer: Expression) => ({
                    kind: "indexer",
                    code,
                    startIndex,
                    endIndex: index,
                    subject,
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
                    cases: [{
                        condition: ifCondition,
                        outcome: ifResult
                    }]
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
                    cases: [{
                        condition: ifCondition,
                        outcome: ifResult
                    }],
                    defaultCase: elseResultResult.parsed,
                },
                newIndex: elseResultResult.newIndex,
            }
        }
    })))))))))))))

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
            code,
            startIndex,
            endIndex: index
        },
        newIndex: index
    }))))))))))))))))

const _switchCase: ParseFunction<{ condition: Expression, outcome: Expression }> = (code, startIndex) =>
    given(consume(code, startIndex, 'case'), index =>
    given(consumeWhitespaceRequired(code, index), index =>
    expec(expression(code, index), err(code, index, 'Case expression'), ({ parsed: condition, newIndex: index }) =>
    given(consumeWhitespace(code, index), index =>
    expec(consume(code, index, ':'), err(code, index, '":"'), index =>
    given(consumeWhitespace(code, index), index =>
    expec(expression(code, index), err(code, index, 'Case result'), ({ parsed: outcome, newIndex: index }) => ({
        parsed: { condition, outcome },
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
            code: get.code,
            startIndex: subject.startIndex,
            endIndex: get.endIndex
        }
    } else {
        return {
            kind: "property-accessor",
            subject,
            property: get.property,
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
        parsed: { kind: "invocation-args", exprs, typeArgs: typeArgs ?? [], code, startIndex, endIndex: index },
                newIndex: index
    })))))

type PropertyAccess = SourceInfo & { kind: "property-access", property: PlainIdentifier }

const _propertyAccess: ParseFunction<PropertyAccess> = (code, startIndex) =>
    given(consume(code, startIndex, "."), index =>
    expec(plainIdentifier(code, index), err(code, index, "Property name"), ({ parsed: property, newIndex: index }) => ({
        parsed: { kind: "property-access", property, code, startIndex, endIndex: index },
        newIndex: index
    })))


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
            code,
            startIndex,
            endIndex: index,
            tagName,
            attributes,
            children,
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
            code,
            startIndex,
            endIndex: index,
            clazz
        },
        newIndex: index
    })))))

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
                    endIndex: index + 1,
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

const EXPRESSION_PRECEDENCE_TIERS: readonly ParseFunction<Expression>[][] = [
    [ javascriptEscape, pipe, classConstruction, elementTag ],
    [ func, proc, range, binaryOperator ],
    [ indexer ],
    [ invocationAccessorChain ],
    [ parenthesized ],
    [ localIdentifier ],
    [ ifElseExpression, switchExpression, booleanLiteral, nilLiteral, objectLiteral, arrayLiteral, 
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
            const result = fn(code, index);

            if (result != null) {
                return result;
            }
        }
    }

    return undefined;
}

const parseBeneath = (code: string, index: number, fn: ParseFunction<Expression>) =>
    parseStartingFromTier(NEXT_TIER_FOR.get(fn) as number)(code, index)
