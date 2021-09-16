import { ClassMember, Declaration } from "./declarations";
import { Expression } from "./expressions";
import { Statement } from "./statements";
import { TypeExpression } from "./type-expressions";
import { Block, PlainIdentifier, SourceInfo } from "./common";

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
