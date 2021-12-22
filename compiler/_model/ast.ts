import { ModuleName } from "./common.ts";
import { StoreMember, Declaration, ImportItem } from "./declarations.ts";
import { Case, Expression, Operator, Spread } from "./expressions.ts";
import { CaseBlock, Statement } from "./statements.ts";
import { Arg, Attribute, TypeExpression } from "./type-expressions.ts";

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
    | CaseBlock
    | Arg
    | ImportItem
    | Spread
)

export type Module = SourceInfo & {
    readonly kind: "module",
    readonly hasMain: boolean,
    readonly declarations: readonly Declaration[],
}

export type PlainIdentifier = SourceInfo & {
    readonly kind: "plain-identifier",
    readonly name: string,
}

export type Block = SourceInfo & {
    readonly kind: "block",
    readonly statements: readonly Statement[],
}

export type Debug = SourceInfo & {
    readonly kind: "debug",
    readonly inner: AST,
}

export type SourceInfo = {
    readonly module: ModuleName|undefined,
    readonly code: string|undefined,
    readonly startIndex: number|undefined,
    readonly endIndex: number|undefined,
}

export const KEYWORDS = [ "func", "proc", "if", "else", "switch", "case",
//"type", 
"class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "until", "true", "false", "import", "export", "from", "as", "test",
"expr", "block" ] as const;
