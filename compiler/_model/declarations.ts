import { PlainIdentifier, SourceInfo } from "./common.ts";
import { Expression, Func, JavascriptEscape, Proc, StringLiteral } from "./expressions.ts";
import { TypeExpression } from "./type-expressions.ts";

export type Declaration =
    | JavascriptEscape
    | ImportDeclaration
    | TypeDeclaration
    | ProcDeclaration
    | FuncDeclaration
    | ConstDeclaration
    | ClassDeclaration

export type ImportDeclaration = SourceInfo & {
    readonly kind: "import-declaration",
    readonly imports: readonly ImportItem[],
    readonly path: StringLiteral,
}

export type ImportItem = SourceInfo & {
    readonly kind: "import-item",
    readonly name: PlainIdentifier,
    readonly alias?: PlainIdentifier,
}

export type TypeDeclaration = SourceInfo & {
    readonly kind: "type-declaration",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression,
    readonly exported: boolean,
}

export type ProcDeclaration = SourceInfo & {
    readonly kind: "proc-declaration",
    readonly name: PlainIdentifier,
    readonly value: Proc,
    readonly exported: boolean,
}

export type FuncDeclaration = SourceInfo & {
    readonly kind: "func-declaration",
    readonly name: PlainIdentifier,
    readonly value: Func,
    readonly exported: boolean,
}

export type ConstDeclaration = SourceInfo & {
    readonly kind: "const-declaration",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression|undefined,
    readonly value: Expression,
    readonly exported: boolean,
}

export type ClassDeclaration = SourceInfo & {
    readonly kind: "class-declaration",
    readonly name: PlainIdentifier,
    readonly typeParams: readonly PlainIdentifier[],
    readonly members: readonly ClassMember[],
    readonly exported: boolean,
    // TODO: constructor
}

export type ClassMember =
    | ClassProperty
    | ClassFunction
    | ClassProcedure

export type ClassProperty = SourceInfo & {
    readonly kind: "class-property",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly value: Expression,
    readonly access: 'private'|'public'|'visible',
}

export type ClassFunction = SourceInfo & {
    readonly kind: "class-function",
    readonly name: PlainIdentifier,
    readonly value: Func,
    readonly access: 'private'|'public',
}

export type ClassProcedure = SourceInfo & {
    readonly kind: "class-procedure",
    readonly name: PlainIdentifier,
    readonly value: Proc,
    readonly access: 'private'|'public',
}

// TODO: ClassReaction