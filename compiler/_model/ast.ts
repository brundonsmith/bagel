import { StoreMember, Declaration, ImportItem } from "./declarations.ts";
import { Case, Expression, Operator } from "./expressions.ts";
import { Statement } from "./statements.ts";
import { Arg, Attribute, TypeExpression } from "./type-expressions.ts";
import { Block, PlainIdentifier, SourceInfo } from "./common.ts";

export type AST = (
    | Module
    | Declaration
    | StoreMember
    | Expression
    | Attribute
    | Statement
    | TypeExpression
    | PlainIdentifier
    | Block
    | Operator
    | Debug
    | Case
    | Arg
    | ImportItem
)

export type Module = SourceInfo & {
    readonly kind: "module",
    readonly hasMain: boolean,
    readonly declarations: readonly Declaration[],
}

export type Debug = SourceInfo & {
    readonly kind: "debug",
    readonly inner: AST,
}
