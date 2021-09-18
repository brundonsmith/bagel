import { ClassMember, Declaration } from "./declarations.ts";
import { Expression } from "./expressions.ts";
import { Statement } from "./statements.ts";
import { TypeExpression } from "./type-expressions.ts";
import { Block, PlainIdentifier, SourceInfo } from "./common.ts";

export type AST =
    | Module
    | Declaration
    | ClassMember
    | Expression
    | Statement
    | TypeExpression
    | PlainIdentifier
    | Block

export type Module = SourceInfo & {
    kind: "module",
    declarations: Declaration[],
}
