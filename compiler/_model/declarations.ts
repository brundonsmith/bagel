import { Debug } from "./ast.ts";
import { Block, PlainIdentifier, SourceInfo } from "./common.ts";
import { ExactStringLiteral, Expression, Func, JavascriptEscape, Proc } from "./expressions.ts";
import { TypeExpression } from "./type-expressions.ts";

export type Declaration =
    | JavascriptEscape
    | ImportDeclaration
    | TypeDeclaration
    | ProcDeclaration
    | FuncDeclaration
    | ConstDeclaration
    | StoreDeclaration
    | TestExprDeclaration
    | TestBlockDeclaration
    | Debug

type Exported = { readonly exported: boolean }

export type ImportDeclaration = SourceInfo & {
    readonly kind: "import-declaration",
    readonly imports: readonly ImportItem[],
    readonly path: ExactStringLiteral,
}

export type ImportItem = SourceInfo & {
    readonly kind: "import-item",
    readonly name: PlainIdentifier,
    readonly alias?: PlainIdentifier,
}

export type TypeDeclaration = SourceInfo & Exported & {
    readonly kind: "type-declaration",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression,
}

export type ProcDeclaration = SourceInfo & Exported & {
    readonly kind: "proc-declaration",
    readonly name: PlainIdentifier,
    readonly value: Proc,
}

export type FuncDeclaration = SourceInfo & Exported & {
    readonly kind: "func-declaration",
    readonly memo: boolean,
    readonly name: PlainIdentifier,
    readonly value: Func,
}

export type ConstDeclaration = SourceInfo & Exported & {
    readonly kind: "const-declaration",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression|undefined,
    readonly value: Expression,
    readonly next?: ConstDeclaration,
}

export type StoreDeclaration = SourceInfo & Exported & {
    readonly kind: "store-declaration",
    readonly name: PlainIdentifier,
    readonly members: readonly StoreMember[],
}

export type StoreMember =
    | StoreProperty
    | StoreFunction
    | StoreProcedure

export type StoreProperty = SourceInfo & {
    readonly kind: "store-property",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly value: Expression,
    readonly access: 'private'|'public'|'visible',
}

export type StoreFunction = SourceInfo & {
    readonly kind: "store-function",
    readonly memo: boolean,
    readonly name: PlainIdentifier,
    readonly value: Func,
    readonly access: 'private'|'public',
}

export type StoreProcedure = SourceInfo & {
    readonly kind: "store-procedure",
    readonly name: PlainIdentifier,
    readonly value: Proc,
    readonly access: 'private'|'public',
}

export function memberDeclaredType(m: StoreMember): TypeExpression|undefined {
    return m.kind === "store-property" ? m.type : m.value.type
}

export type TestExprDeclaration = SourceInfo & {
    kind: "test-expr-declaration",
    name: ExactStringLiteral,
    expr: Expression,
}

export type TestBlockDeclaration = SourceInfo & {
    kind: "test-block-declaration",
    name: ExactStringLiteral,
    block: Block,
}

// TODO: ClassReaction