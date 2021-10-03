import { AST } from "./ast.ts";
import { Block, PlainIdentifier, SourceInfo } from "./common.ts";
import { FuncType, ProcType, TypeExpression } from "./type-expressions.ts";

export type Expression = 
    | JavascriptEscape
    | Pipe
    | Func
    | Proc
    | Range
    | BinaryOperator
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
    | NumberLiteral
    | ElementTag
    | ClassConstruction

export type JavascriptEscape = SourceInfo & {
    readonly kind: "javascript-escape",
    readonly js: string,
}
  
export type Pipe = SourceInfo & {
    readonly kind: "pipe",
    readonly subject: Expression,
    readonly args: [Expression],
}
  
export type Func = SourceInfo & {
    readonly kind: "func",
    readonly type: FuncType,
    readonly consts: readonly { readonly name: PlainIdentifier, readonly type?: TypeExpression, readonly value: Expression }[],
    readonly body: Expression,
}

export type Proc = SourceInfo & {
    readonly kind: "proc",
    readonly type: ProcType,
    readonly body: Block,
}

export type Range = SourceInfo & {
    readonly kind: "range",
    readonly start: number,
    readonly end: number,
}

export type BinaryOperator = SourceInfo & {
    readonly kind: "binary-operator",
    readonly operator: BinaryOp,
    readonly args: readonly [Expression, Expression],
    // TODO: Once generics are fully functional, create a `type: FuncType` property
}

export const BINARY_OPS = [ "+", "-", "*", "/", "<=", ">=", "<", ">", "==", "&&", "||", "??" ] as const;
export type BinaryOp = typeof BINARY_OPS[number];

export type Invocation = SourceInfo & {
    readonly kind: "invocation",
    readonly subject: Expression,
    readonly args: readonly Expression[],
    readonly typeArgs?: readonly TypeExpression[],
}

export type Indexer = SourceInfo & {
    readonly kind: "indexer",
    readonly subject: Expression,
    readonly indexer: Expression,
}

export type PropertyAccessor = SourceInfo & {
    readonly kind: "property-accessor",
    readonly subject: Expression,
    readonly property: PlainIdentifier,
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
    readonly cases: readonly { readonly condition: Expression, readonly outcome: Expression }[],
    readonly defaultCase?: Expression
}

export type SwitchExpression = SourceInfo & {
    readonly kind: "switch-expression",
    readonly value: Expression,
    readonly cases: readonly { readonly condition: Expression, readonly outcome: Expression }[],
    readonly defaultCase?: Expression
}

export type BooleanLiteral = SourceInfo & {
    readonly kind: "boolean-literal",
    readonly value: boolean,
}

export type NilLiteral = SourceInfo & {
    readonly kind: "nil-literal",
}

export type ObjectLiteral = SourceInfo & {
    readonly kind: "object-literal",
    readonly entries: readonly (readonly [PlainIdentifier, Expression])[],
}

export type ArrayLiteral = SourceInfo & {
    readonly kind: "array-literal",
    readonly entries: readonly Expression[],
}

export type StringLiteral = SourceInfo & {
    readonly kind: "string-literal",
    readonly segments: readonly (string|Expression)[],
}

export type NumberLiteral = SourceInfo & {
    readonly kind: "number-literal",
    readonly value: number,
}

export type ElementTag = SourceInfo & {
    readonly kind: "element-tag",
    readonly tagName: PlainIdentifier,
    readonly attributes: readonly (readonly [PlainIdentifier, Expression])[],
    readonly children: readonly Expression[],
}

export type ClassConstruction = SourceInfo & {
    readonly kind: "class-construction",
    readonly clazz: LocalIdentifier,
    
}

const ALL_EXPRESSION_TYPES: { [key in Expression["kind"]]: undefined } = {
    "proc": undefined,
    "func": undefined,
    "pipe": undefined,
    "binary-operator": undefined,
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
    "number-literal": undefined,
    "boolean-literal": undefined,
    "nil-literal": undefined,
    "javascript-escape": undefined,
    "class-construction": undefined,
};

export function isExpression(ast: AST): ast is Expression {
    return Object.prototype.hasOwnProperty.call(ALL_EXPRESSION_TYPES, ast.kind);
}