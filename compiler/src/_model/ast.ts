import { Block, PlainIdentifier, SourceInfo } from "./common";
import { Declaration } from "./declarations";
import { Expression } from "./expressions";
import { Statement } from "./statements";

export type AST =
    | Module
    | Declaration
    | Expression
    | Statement
    | PlainIdentifier
    | Block

export type Module = SourceInfo & {
    kind: "module",
    declarations: Declaration[],
}
