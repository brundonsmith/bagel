import { ClassMember, Declaration } from "./declarations.ts";
import { Expression, InlineConst, Operator } from "./expressions.ts";
import { Statement } from "./statements.ts";
import { Attribute, TypeExpression } from "./type-expressions.ts";
import { Block, PlainIdentifier, SourceInfo } from "./common.ts";

export type AST =
    | Module
    | Declaration
    | ClassMember
    | Expression
    | InlineConst
    | Attribute
    | Statement
    | TypeExpression
    | PlainIdentifier
    | Block
    | Operator
    | Debug

export type Module = SourceInfo & {
    readonly kind: "module",
    readonly declarations: readonly Declaration[],
}

export type Debug = SourceInfo & {
    readonly kind: "debug",
    readonly inner: AST,
}
