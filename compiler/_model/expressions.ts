import { AST, Debug } from "./ast.ts";
import { Block, Identifier, PlainIdentifier, SourceInfo } from "./common.ts";
import { FuncType, ProcType, TypeExpression } from "./type-expressions.ts";

export type Expression = 
    | JavascriptEscape
    | Debug
    | Pipe
    | Func
    | Proc
    | Range
    | BinaryOperator
    | NegationOperator
    | Invocation
    | Indexer
    | ParenthesizedExpression
    | PropertyAccessor
    | LocalIdentifier
    | IfElseExpression
    | SwitchExpression
    | BooleanLiteral
    | NilLiteral
    | ObjectLiteral
    | ArrayLiteral
    | StringLiteral
    | ExactStringLiteral
    | NumberLiteral
    | ElementTag

export type JavascriptEscape = SourceInfo & Identifier & {
    readonly kind: "javascript-escape",
    readonly js: string,
}

export type Pipe = SourceInfo & Identifier & {
    readonly kind: "pipe",
    readonly subject: Expression,
    readonly args: [Expression],
}
  
export type Func = SourceInfo & Identifier & {
    readonly kind: "func",
    readonly type: FuncType,
    readonly consts: readonly InlineConst[],
    readonly body: Expression,
}

export type InlineConst = SourceInfo & Identifier & {
    readonly kind: "inline-const",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly value: Expression
}

export type Proc = SourceInfo & Identifier & {
    readonly kind: "proc",
    readonly type: ProcType,
    readonly body: Block,
}

export type Range = SourceInfo & Identifier & {
    readonly kind: "range",
    readonly start: number,
    readonly end: number,
}

export type BinaryOperator = SourceInfo & Identifier & {
    readonly kind: "binary-operator",
    readonly base: Expression,
    readonly ops: readonly [readonly [Operator, Expression], ...readonly [Operator, Expression][]],
    // TODO: Once generics are fully functional, create a `type: FuncType` property
}

export type NegationOperator = SourceInfo & Identifier & {
    readonly kind: "negation-operator",
    readonly base: Expression,
}

export type Operator = SourceInfo & Identifier & {
    readonly kind: "operator",
    readonly op: BinaryOp,
}

export const BINARY_OPS = [
    ["??"],
    ["||"],
    ["&&"],
    ["==", "!="],
    ["<=", ">=", "<", ">"],
    ["+", "-"],
    ["*", "/"],
] as const
export const ALL_BINARY_OPS = BINARY_OPS.flat()
export type BinaryOp = typeof BINARY_OPS[number][number];

export function isBinaryOp(str: string): str is BinaryOp {
    return (ALL_BINARY_OPS as readonly string[]).includes(str);
}

export type Invocation = SourceInfo & Identifier & {
    readonly kind: "invocation",
    readonly subject: Expression,
    readonly args: readonly Expression[],
    readonly typeArgs: readonly TypeExpression[],
}

export type Indexer = SourceInfo & Identifier & {
    readonly kind: "indexer",
    readonly subject: Expression,
    readonly indexer: Expression,
}

export type PropertyAccessor = SourceInfo & Identifier & {
    readonly kind: "property-accessor",
    readonly subject: Expression,
    readonly property: PlainIdentifier,
    readonly optional: boolean,
}

export type ParenthesizedExpression = SourceInfo & Identifier & {
    readonly kind: "parenthesized-expression",
    readonly inner: Expression,
}

export type LocalIdentifier = SourceInfo & Identifier & {
    readonly kind: "local-identifier",
    readonly name: string,
}

export type IfElseExpression = SourceInfo & Identifier & {
    readonly kind: "if-else-expression",
    readonly cases: readonly Case[],
    readonly defaultCase?: Expression
}

export type SwitchExpression = SourceInfo & Identifier & {
    readonly kind: "switch-expression",
    readonly value: Expression,
    readonly cases: readonly Case[],
    readonly defaultCase?: Expression
}

export type Case = SourceInfo & Identifier & {
    readonly kind: "case",
    readonly condition: Expression,
    readonly outcome: Expression,
}

export type BooleanLiteral = SourceInfo & Identifier & {
    readonly kind: "boolean-literal",
    readonly value: boolean,
}

export type NilLiteral = SourceInfo & Identifier & {
    readonly kind: "nil-literal",
}

export type ObjectLiteral = SourceInfo & Identifier & {
    readonly kind: "object-literal",
    readonly entries: readonly (readonly [PlainIdentifier, Expression])[],
}

export type ArrayLiteral = SourceInfo & Identifier & {
    readonly kind: "array-literal",
    readonly entries: readonly Expression[],
}

export type StringLiteral = SourceInfo & Identifier & {
    readonly kind: "string-literal",
    readonly segments: readonly (string|Expression)[],
}

export type ExactStringLiteral = SourceInfo & Identifier & {
    readonly kind: "exact-string-literal",
    readonly value: string,
}

export type NumberLiteral = SourceInfo & Identifier & {
    readonly kind: "number-literal",
    readonly value: number,
}

export type ElementTag = SourceInfo & Identifier & {
    readonly kind: "element-tag",
    readonly tagName: PlainIdentifier,
    readonly attributes: readonly (readonly [PlainIdentifier, Expression])[],
    readonly children: readonly Expression[],
}

const ALL_EXPRESSION_TYPES: { [key in Expression["kind"]]: undefined } = {
    "proc": undefined,
    "func": undefined,
    "pipe": undefined,
    "binary-operator": undefined,
    "negation-operator": undefined,
    "invocation": undefined,
    "indexer": undefined,
    "if-else-expression": undefined,
    "switch-expression": undefined,
    "range": undefined,
    "parenthesized-expression": undefined,
    "property-accessor": undefined,
    "local-identifier": undefined,
    "element-tag": undefined,
    "object-literal": undefined,
    "array-literal": undefined,
    "string-literal": undefined,
    "exact-string-literal": undefined,
    "number-literal": undefined,
    "boolean-literal": undefined,
    "nil-literal": undefined,
    "javascript-escape": undefined,
    "debug": undefined,
};

export function isExpression(ast: AST): ast is Expression {
    return Object.prototype.hasOwnProperty.call(ALL_EXPRESSION_TYPES, ast.kind);
}