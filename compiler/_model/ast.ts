import { ModuleName } from "./common.ts";
import { Declaration, Decorator, ImportItem } from "./declarations.ts";
import { Case, Expression, InlineDeclaration, ObjectEntry, Operator, Spread, SwitchCase } from "./expressions.ts";
import { CaseBlock, Statement } from "./statements.ts";
import { Arg, Args, Attribute, SpreadArgs, TypeExpression } from "./type-expressions.ts";

export type AST = (
    | Module
    | Declaration
    | Expression
    | Attribute
    | Statement
    | TypeExpression
    | PlainIdentifier
    | Block
    | Operator
    | Debug
    | Case
    | SwitchCase
    | CaseBlock
    | Args
    | Arg
    | SpreadArgs
    | ImportItem
    | Spread
    | InlineDeclaration
    | ObjectEntry
    | NameAndType
    | Destructure
    | Decorator
)

export type Module = SourceInfo & {
    readonly kind: "module",
    readonly moduleType: "bgl"|"json"|"text",
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

export type NameAndType = SourceInfo & {
    readonly kind: "name-and-type",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
}

export type Destructure = SourceInfo & {
    readonly kind: "destructure"
    readonly properties: PlainIdentifier[],
    readonly spread: PlainIdentifier|undefined,
    readonly destructureKind: 'array'|'object',
}

export type Debug = SourceInfo & {
    readonly kind: "debug",
    readonly inner: AST,
}

export type SourceInfo = {
    readonly parent?: AST|undefined,
    readonly module: ModuleName|undefined,
    readonly code: string|undefined,
    readonly startIndex: number|undefined,
    readonly endIndex: number|undefined,
}
