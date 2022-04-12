import { SourceInfo,PlainIdentifier,Block } from "./ast.ts";
import { Expression, Invocation, JavascriptEscape, LocalIdentifier, PropertyAccessor } from "./expressions.ts";
import { TypeExpression } from "./type-expressions.ts";

export type Statement = 
    | JavascriptEscape
    | ValueDeclarationStatement
    | DestructuringDeclarationStatement
    | IfElseStatement
    | ForLoop
    | WhileLoop
    | Assignment
    | Invocation
    | AwaitStatement
    | TryCatch
    | ThrowStatement

export type ValueDeclarationStatement = SourceInfo & {
    readonly kind: "value-declaration-statement",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression|undefined,
    readonly value: Expression,
    readonly isConst: boolean,
}

export type DestructuringDeclarationStatement = SourceInfo & {
    readonly kind: "destructuring-declaration-statement",
    readonly properties: readonly PlainIdentifier[],
    readonly spread: PlainIdentifier|undefined,
    readonly destructureKind: 'array'|'object',
    readonly value: Expression,
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

export type AwaitStatement = SourceInfo & {
    readonly kind: "await-statement",
    readonly plan: Expression,
    readonly noAwait: boolean,
    readonly name: PlainIdentifier|undefined,
    readonly type: TypeExpression|undefined,
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