import { Debug } from "./ast.ts";
import { Block, Identifier, PlainIdentifier, SourceInfo } from "./common.ts";
import { ExactStringLiteral, Expression, Func, JavascriptEscape, Proc } from "./expressions.ts";
import { TypeExpression } from "./type-expressions.ts";

export type Declaration =
    | JavascriptEscape
    | ImportDeclaration
    | TypeDeclaration
    | ProcDeclaration
    | FuncDeclaration
    | ConstDeclaration
    | ClassDeclaration
    | StoreDeclaration
    | TestExprDeclaration
    | TestBlockDeclaration
    | Debug

type Exported = { readonly exported: boolean }

export type ImportDeclaration = SourceInfo & Identifier & {
    readonly kind: "import-declaration",
    readonly imports: readonly ImportItem[],
    readonly path: ExactStringLiteral,
}

export type ImportItem = SourceInfo & Identifier & {
    readonly kind: "import-item",
    readonly name: PlainIdentifier,
    readonly alias?: PlainIdentifier,
}

export type TypeDeclaration = SourceInfo & Identifier & Exported & {
    readonly kind: "type-declaration",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression,
}

export type ProcDeclaration = SourceInfo & Identifier & Exported & {
    readonly kind: "proc-declaration",
    readonly name: PlainIdentifier,
    readonly value: Proc,
}

export type FuncDeclaration = SourceInfo & Identifier & Exported & {
    readonly kind: "func-declaration",
    readonly memo: boolean,
    readonly name: PlainIdentifier,
    readonly value: Func,
}

export type ConstDeclaration = SourceInfo & Identifier & Exported & {
    readonly kind: "const-declaration",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression|undefined,
    readonly value: Expression,
}

export type ClassDeclaration = SourceInfo & Identifier & Exported & {
    readonly kind: "class-declaration",
    readonly name: PlainIdentifier,
    readonly typeParams: readonly PlainIdentifier[],
    readonly members: readonly ClassMember[],
    // TODO: constructor
}

export type StoreDeclaration = SourceInfo & Identifier & Exported & {
    readonly kind: "store-declaration",
    readonly name: PlainIdentifier,
    readonly members: readonly ClassMember[],
}

export type ClassMember =
    | ClassProperty
    | ClassFunction
    | ClassProcedure

export type ClassProperty = SourceInfo & Identifier & {
    readonly kind: "class-property",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly value: Expression,
    readonly access: 'private'|'public'|'visible',
}

export type ClassFunction = SourceInfo & Identifier & {
    readonly kind: "class-function",
    readonly memo: boolean,
    readonly name: PlainIdentifier,
    readonly value: Func,
    readonly access: 'private'|'public',
}

export type ClassProcedure = SourceInfo & Identifier & {
    readonly kind: "class-procedure",
    readonly name: PlainIdentifier,
    readonly value: Proc,
    readonly access: 'private'|'public',
}

export function memberDeclaredType(m: ClassMember): TypeExpression|undefined {
    return m.kind === "class-property" ? m.type : m.value.type
}

export type TestExprDeclaration = SourceInfo & Identifier & {
    kind: "test-expr-declaration",
    name: ExactStringLiteral,
    expr: Expression,
}

export type TestBlockDeclaration = SourceInfo & Identifier & {
    kind: "test-block-declaration",
    name: ExactStringLiteral,
    block: Block,
}

// TODO: ClassReaction