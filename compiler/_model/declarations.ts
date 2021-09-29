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
    kind: "import-declaration",
    imports: Array<ImportItem>,
    path: StringLiteral,
}

export type ImportItem = SourceInfo & {
    kind: "import-item",
    name: PlainIdentifier,
    alias?: PlainIdentifier,
}

export type TypeDeclaration = SourceInfo & {
    kind: "type-declaration",
    name: PlainIdentifier,
    type: TypeExpression,
    exported: boolean,
}

export type ProcDeclaration = SourceInfo & {
    kind: "proc-declaration",
    name: PlainIdentifier,
    value: Proc,
    exported: boolean,
}

export type FuncDeclaration = SourceInfo & {
    kind: "func-declaration",
    name: PlainIdentifier,
    value: Func,
    exported: boolean,
}

export type ConstDeclaration = SourceInfo & {
    kind: "const-declaration",
    name: PlainIdentifier,
    type: TypeExpression|undefined,
    value: Expression,
    exported: boolean,
}

export type ClassDeclaration = SourceInfo & {
    kind: "class-declaration",
    name: PlainIdentifier,
    typeParams: PlainIdentifier[],
    members: ClassMember[],
    exported: boolean,
    // TODO: constructor
}

export type ClassMember =
    | ClassProperty
    | ClassFunction
    | ClassProcedure

export type ClassProperty = SourceInfo & {
    kind: "class-property",
    name: PlainIdentifier,
    type?: TypeExpression,
    value: Expression,
    access: 'private'|'public'|'visible',
}

export type ClassFunction = SourceInfo & {
    kind: "class-function",
    name: PlainIdentifier,
    func: Func,
    access: 'private'|'public',
}

export type ClassProcedure = SourceInfo & {
    kind: "class-procedure",
    name: PlainIdentifier,
    proc: Func|Proc,
    access: 'private'|'public',
}

// TODO: ClassReaction