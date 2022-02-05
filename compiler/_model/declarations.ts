import { Block, Debug, PlainIdentifier, SourceInfo } from "./ast.ts";
import { ExactStringLiteral, Expression, Func, JavascriptEscape, JsFunc, JsProc, Proc } from "./expressions.ts";
import { TypeExpression } from "./type-expressions.ts";

export type Declaration =
    | JavascriptEscape
    | ImportAllDeclaration
    | ImportDeclaration
    | TypeDeclaration
    | ProcDeclaration
    | FuncDeclaration
    | ValueDeclaration
    | RemoteDeclaration
    | AutorunDeclaration
    | TestExprDeclaration
    | TestBlockDeclaration
    | Debug

type Exported = { readonly exported: boolean }

export type ImportAllDeclaration = SourceInfo & {
    readonly kind: "import-all-declaration",
    readonly alias: PlainIdentifier,
    readonly path: ExactStringLiteral,
}

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
    readonly action: boolean,
    readonly name: PlainIdentifier,
    readonly value: Proc|JsProc,
}

export type FuncDeclaration = SourceInfo & Exported & {
    readonly kind: "func-declaration",
    readonly memo: boolean,
    readonly name: PlainIdentifier,
    readonly value: Func|JsFunc,
}

export type ValueDeclaration = SourceInfo & {
    readonly kind: "value-declaration",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression|undefined,
    readonly value: Expression,
    readonly isConst: boolean,
    readonly exported: undefined|'export'|'expose',
}

export type RemoteDeclaration = SourceInfo & Exported & {
    readonly kind: "remote-declaration",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression|undefined,
    readonly planGenerator: Expression,
}

export type TestExprDeclaration = SourceInfo & {
    readonly kind: "test-expr-declaration",
    readonly name: ExactStringLiteral,
    readonly expr: Expression,
}

export type TestBlockDeclaration = SourceInfo & {
    readonly kind: "test-block-declaration",
    readonly name: ExactStringLiteral,
    readonly block: Block,
}

export type AutorunDeclaration = SourceInfo & {
    readonly kind: "autorun-declaration",
    readonly effect: Expression
}

// TODO: ClassReaction