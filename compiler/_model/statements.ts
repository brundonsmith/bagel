import { SourceInfo, PlainIdentifier, Block, Destructure, NameAndType } from "./ast.ts";
import { Expression, Invocation, JavascriptEscape, LocalIdentifier, PropertyAccessor } from "./expressions.ts";

export type Statement =
    | JavascriptEscape
    | DeclarationStatement
    | IfElseStatement
    | ForLoop
    | WhileLoop
    | Assignment
    | Invocation
    | TryCatch
    | ThrowStatement
    | Autorun

export type DeclarationStatement = SourceInfo & {
    readonly kind: "declaration-statement",
    readonly destination: NameAndType | Destructure,
    readonly value: Expression,
    readonly awaited: boolean,
    readonly isConst: boolean,
}

export type IfElseStatement = SourceInfo & {
    readonly kind: "if-else-statement",
    readonly cases: readonly CaseBlock[],
    readonly defaultCase?: Block
}

export type CaseBlock = SourceInfo & {
    readonly kind: "case-block",
    readonly condition: Expression,
    readonly outcome: Block,
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

export type TryCatch = SourceInfo & {
    readonly kind: "try-catch",
    readonly tryBlock: Block,
    readonly errIdentifier: PlainIdentifier,
    readonly catchBlock: Block
    // TODO: finally-block
}

export type ThrowStatement = SourceInfo & {
    readonly kind: "throw-statement",
    readonly errorExpression: Expression,
}

export type Autorun = SourceInfo & {
    readonly kind: "autorun",
    readonly effect: Block,
    readonly until: Expression | undefined
}