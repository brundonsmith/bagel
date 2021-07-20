import { PlainIdentifier, SourceInfo } from "./common"
import { Expression, Func, Proc, StringLiteral } from "./expressions"
import { TypeExpression } from "./type-expressions"

export type Declaration =
    | ImportDeclaration
    | TypeDeclaration
    | ProcDeclaration
    | FuncDeclaration
    | ConstDeclaration

export type ImportDeclaration = SourceInfo & {
    kind: "import-declaration",
    imports: Array<{
        name: PlainIdentifier,
        alias?: PlainIdentifier,
    }>,
    path: StringLiteral,
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
    proc: Proc,
    exported: boolean,
}

export type FuncDeclaration = SourceInfo & {
    kind: "func-declaration",
    name: PlainIdentifier,
    func: Func,
    exported: boolean,
}

export type ConstDeclaration = SourceInfo & {
    kind: "const-declaration",
    name: PlainIdentifier,
    type: TypeExpression,
    value: Expression,
    exported: boolean,
}
