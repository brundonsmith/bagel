import { Block, PlainIdentifier, SourceInfo } from "./common.ts";
import { Expression, Invocation, JavascriptEscape, LocalIdentifier, PropertyAccessor } from "./expressions.ts";
import { TypeExpression } from "./type-expressions.ts";

export type Statement = 
    | JavascriptEscape
    | LetDeclaration
    | IfElseStatement
    | ForLoop
    | WhileLoop
    | Assignment
    | Invocation
    | Reaction
    | Computation

export type LetDeclaration = SourceInfo & {
    readonly kind: "let-declaration",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly value: Expression,
}

export type IfElseStatement = SourceInfo & {
    readonly kind: "if-else-statement",
    readonly ifCondition: Expression,
    readonly ifResult: Block,
    readonly elseResult?: Block,
}

export type ForLoop = SourceInfo & {
    readonly kind: "for-loop",
    readonly itemIdentifier: PlainIdentifier,
    readonly iterator: Expression,
    readonly body: Block,
}

export type WhileLoop = SourceInfo & {
    readonly kind: "while-loop",
    readonly condition: Expression,
    readonly body: Block,
}

export type Assignment = SourceInfo & {
    readonly kind: "assignment",
    readonly target: LocalIdentifier | PropertyAccessor,
    readonly value: Expression,
}

export type Reaction = SourceInfo & {
    readonly kind: "reaction",
    readonly data: Expression,
    readonly effect: Expression,
    readonly until: Expression|undefined,
}

export type Computation = SourceInfo & {
    readonly kind: "computation",
    readonly name: PlainIdentifier,
    readonly expression: Expression,
}
