import { Block, PlainIdentifier, SourceInfo } from "./common"
import { Expression, JavascriptEscape, LocalIdentifier, PropertyAccessor } from "./expressions"
import { TypeExpression } from "./type-expressions"

export type Statement = 
    | JavascriptEscape
    | LetDeclaration
    | IfElseStatement
    | ForLoop
    | WhileLoop
    | Assignment
    | ProcCall
    | Reaction

export type LetDeclaration = SourceInfo & {
    kind: "let-declaration",
    name: LocalIdentifier,
    type?: TypeExpression,
    value: Expression,
}

export type IfElseStatement = SourceInfo & {
    kind: "if-else-statement",
    ifCondition: Expression,
    ifResult: Block,
    elseResult?: Block,
}

export type ForLoop = SourceInfo & {
    kind: "for-loop",
    itemIdentifier: PlainIdentifier,
    iterator: Expression,
    body: Block,
}

export type WhileLoop = SourceInfo & {
    kind: "while-loop",
    condition: Expression,
    body: Block,
}

export type Assignment = SourceInfo & {
    kind: "assignment",
    target: LocalIdentifier | PropertyAccessor,
    value: Expression,
}

export type ProcCall = SourceInfo & {
    kind: "proc-call",
    proc: Expression,
    args: Expression[],
}

export type Reaction = SourceInfo & {
    kind: "reaction",
    data: Expression,
    effect: Expression,
}
