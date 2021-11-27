import { Block, Identifier, PlainIdentifier, SourceInfo } from "./common.ts";
import { Expression, Invocation, JavascriptEscape, LocalIdentifier, PropertyAccessor } from "./expressions.ts";
import { TypeExpression } from "./type-expressions.ts";

export type Statement = 
    | JavascriptEscape
    | LetDeclaration
    | ConstDeclarationStatement
    | IfElseStatement
    | ForLoop
    | WhileLoop
    | Assignment
    | Invocation
    | Reaction

export type LetDeclaration = SourceInfo & Identifier & {
    readonly kind: "let-declaration",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly value: Expression,
}

export type ConstDeclarationStatement = SourceInfo & Identifier & {
    readonly kind: "const-declaration-statement",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly value: Expression,
}

export type IfElseStatement = SourceInfo & Identifier & {
    readonly kind: "if-else-statement",
    readonly cases: readonly { readonly condition: Expression, readonly outcome: Block }[],
    readonly defaultCase?: Block
}

export type ForLoop = SourceInfo & Identifier & {
    readonly kind: "for-loop",
    readonly itemIdentifier: PlainIdentifier,
    readonly iterator: Expression,
    readonly body: Block,
}

export type WhileLoop = SourceInfo & Identifier & {
    readonly kind: "while-loop",
    readonly condition: Expression,
    readonly body: Block,
}

export type Assignment = SourceInfo & Identifier & {
    readonly kind: "assignment",
    readonly target: LocalIdentifier | PropertyAccessor,
    readonly value: Expression,
}

export type Reaction = SourceInfo & Identifier & {
    readonly kind: "reaction",
    readonly data: Expression,
    readonly effect: Expression,
    readonly until: Expression|undefined,
}
