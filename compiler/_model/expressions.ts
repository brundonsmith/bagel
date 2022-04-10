import { AST, Block, Debug, PlainIdentifier, SourceInfo } from "./ast.ts";
import { FuncType, GenericFuncType, GenericProcType, ProcType, TypeExpression } from "./type-expressions.ts";

export type Expression = 
    | JavascriptEscape
    | Debug
    | Func
    | JsFunc
    | Proc
    | JsProc
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
    | InlineConstGroup
    | InstanceOf
    | AsCast
    | ErrorExpression

export type JavascriptEscape = SourceInfo & {
    readonly kind: "javascript-escape",
    readonly js: string,
}

export type Func = SourceInfo & {
    readonly kind: "func",
    readonly type: FuncType|GenericFuncType,
    readonly body: Expression,
}

export type JsFunc = SourceInfo & {
    readonly kind: "js-func",
    readonly type: FuncType|GenericFuncType,
    readonly body: string,
}

export type InlineConstGroup = SourceInfo & {
    readonly kind: "inline-const-group",
    readonly declarations: readonly (InlineConstDeclaration|InlineDestructuringDeclaration)[],
    readonly inner: Expression
}

export type InlineConstDeclaration = SourceInfo & {
    readonly kind: "inline-const-declaration",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly awaited: boolean,
    readonly value: Expression,
}

export type InlineDestructuringDeclaration = SourceInfo & {
    readonly kind: "inline-destructuring-declaration",
    readonly properties: readonly PlainIdentifier[],
    readonly spread: PlainIdentifier|undefined,
    readonly destructureKind: 'array'|'object',
    readonly awaited: boolean,
    readonly value: Expression,
}

export type Proc = SourceInfo & {
    readonly kind: "proc",
    readonly type: ProcType|GenericProcType,
    readonly body: Block,
}

export type JsProc = SourceInfo & {
    readonly kind: "js-proc",
    readonly type: ProcType|GenericProcType,
    readonly body: string,
}

export type Range = SourceInfo & {
    readonly kind: "range",
    readonly start: Expression,
    readonly end: Expression,
}

export type BinaryOperator = SourceInfo & {
    readonly kind: "binary-operator",
    readonly left: Expression,
    readonly op: Operator,
    readonly right: Expression
}

export type NegationOperator = SourceInfo & {
    readonly kind: "negation-operator",
    readonly base: Expression,
}

export type Operator = SourceInfo & {
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

export type Invocation = SourceInfo & {
    readonly kind: "invocation",
    readonly subject: Expression,
    readonly args: readonly Expression[],
    readonly typeArgs: readonly TypeExpression[],
    readonly bubbles: boolean,
}

export type Indexer = SourceInfo & {
    readonly kind: "indexer",
    readonly subject: Expression,
    readonly indexer: Expression,
    readonly optional: boolean,
}

export type PropertyAccessor = SourceInfo & {
    readonly kind: "property-accessor",
    readonly subject: Expression,
    readonly property: PlainIdentifier,
    readonly optional: boolean,
}

export type ParenthesizedExpression = SourceInfo & {
    readonly kind: "parenthesized-expression",
    readonly inner: Expression,
}

export type LocalIdentifier = SourceInfo & {
    readonly kind: "local-identifier",
    readonly name: string,
}

export type IfElseExpression = SourceInfo & {
    readonly kind: "if-else-expression",
    readonly cases: readonly Case[],
    readonly defaultCase?: Expression
}

export type SwitchExpression = SourceInfo & {
    readonly kind: "switch-expression",
    readonly value: Expression,
    readonly cases: readonly SwitchCase[],
    readonly defaultCase?: Expression
}

export type Case = SourceInfo & {
    readonly kind: "case",
    readonly condition: Expression,
    readonly outcome: Expression,
}

export type SwitchCase = SourceInfo & {
    readonly kind: "switch-case",
    readonly condition: Expression,
    readonly outcome: Expression,
}

export type ObjectLiteral = SourceInfo & {
    readonly kind: "object-literal",
    readonly entries: readonly (ObjectEntry | Spread | LocalIdentifier)[],
}

export type ObjectEntry = SourceInfo & {
    readonly kind: "object-entry",
    readonly key: PlainIdentifier|Expression,
    readonly value: Expression
}

export type ArrayLiteral = SourceInfo & {
    readonly kind: "array-literal",
    readonly entries: readonly (Expression | Spread)[],
}

export type Spread = SourceInfo & {
    readonly kind: "spread",
    readonly expr: Expression,
}

export type StringLiteral = SourceInfo & {
    readonly kind: "string-literal",
    readonly segments: readonly (string|Expression)[],
}

export type ExactStringLiteral = SourceInfo & {
    readonly kind: "exact-string-literal",
    readonly value: string,
}

export type NumberLiteral = SourceInfo & {
    readonly kind: "number-literal",
    readonly value: number,
}

export type BooleanLiteral = SourceInfo & {
    readonly kind: "boolean-literal",
    readonly value: boolean,
}

export type NilLiteral = SourceInfo & {
    readonly kind: "nil-literal",
}

export type ElementTag = SourceInfo & {
    readonly kind: "element-tag",
    readonly tagName: PlainIdentifier,
    readonly attributes: ObjectLiteral,
    readonly children: readonly Expression[],
}

export type InstanceOf = SourceInfo & {
    readonly kind: "instance-of",
    readonly expr: Expression,
    readonly type: TypeExpression,
}

export type AsCast = SourceInfo & {
    readonly kind: "as-cast",
    readonly inner: Expression,
    readonly type: TypeExpression,
}

export type ErrorExpression = SourceInfo & {
    readonly kind: "error-expression",
    readonly inner: Expression,
}

const ALL_EXPRESSION_TYPES: { [key in Expression["kind"]]: undefined } = {
    "proc": undefined,
    "js-proc": undefined,
    "func": undefined,
    "js-func": undefined,
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
    "inline-const-group": undefined,
    "instance-of": undefined,
    "as-cast": undefined,
    "error-expression": undefined,
};

export function isExpression(ast: AST): ast is Expression {
    return Object.prototype.hasOwnProperty.call(ALL_EXPRESSION_TYPES, ast.kind);
}