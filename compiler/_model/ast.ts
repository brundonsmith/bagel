import { ClassMember, Declaration } from "./declarations.ts";
import { Case, Expression, InlineConst, Operator } from "./expressions.ts";
import { Statement } from "./statements.ts";
import { Attribute, TypeExpression } from "./type-expressions.ts";
import { Block, Identifier, PlainIdentifier, SourceInfo } from "./common.ts";

export type AST = (
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
    | Case
)

export type Module = SourceInfo & Identifier & {
    readonly kind: "module",
    readonly hasMain: boolean,
    readonly declarations: readonly Declaration[],
}

export type Debug = SourceInfo & Identifier & {
    readonly kind: "debug",
    readonly inner: AST,
}
