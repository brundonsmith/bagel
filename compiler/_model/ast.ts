import { ClassMember, Declaration } from "./declarations.ts";
import { Expression } from "./expressions.ts";
import { Statement } from "./statements.ts";
import { TypeExpression } from "./type-expressions.ts";
import { Block, PlainIdentifier } from "./common.ts";

export type AST =
    | Module
    | Declaration
    | ClassMember
    | Expression
    | Statement
    | TypeExpression
    | PlainIdentifier
    | Block

export type Module = {
    readonly kind: "module",
    readonly declarations: readonly Declaration[],
}
