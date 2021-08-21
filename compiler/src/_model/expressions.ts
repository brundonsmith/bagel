import { AST } from "./ast"
import { Block, PlainIdentifier, SourceInfo } from "./common"
import { FuncType, ProcType } from "./type-expressions"

export type Expression = 
    | JavascriptEscape
    | Pipe
    | Func
    | Proc
    | Range
    | BinaryOperator
    | Funcall
    | Indexer
    | ParenthesizedExpression
    | PropertyAccessor
    | LocalIdentifier
    | IfElseExpression
    | BooleanLiteral
    | NilLiteral
    | ObjectLiteral
    | ArrayLiteral
    | StringLiteral
    | NumberLiteral
    | ElementTag
    | ClassConstruction

export type JavascriptEscape = SourceInfo & {
    kind: "javascript-escape",
    js: string,
}
  
export type Pipe = SourceInfo & {
    kind: "pipe",
    expressions: Expression[],
}
  
export type Func = SourceInfo & {
    kind: "func",
    type: FuncType,
    argNames: PlainIdentifier[],
    body: Expression,
}

export type Proc = SourceInfo & {
    kind: "proc",
    type: ProcType,
    argNames: PlainIdentifier[],
    body: Block,
}

export type Range = SourceInfo & {
    kind: "range",
    start: number,
    end: number,
}

export type BinaryOperator = SourceInfo & {
    kind: "binary-operator",
    left: Expression,
    right: Expression,
    operator: BinaryOp,
}

export const BINARY_OPS = [ "+", "-", "*", "/", "<=", ">=", "<", ">", "==", "&&", "||", "??" ] as const;
export type BinaryOp = typeof BINARY_OPS[number];

export type Funcall = SourceInfo & {
    kind: "funcall",
    func: Expression,
    args: Expression[],
}

export type Indexer = SourceInfo & {
    kind: "indexer",
    base: Expression,
    indexer: Expression,
}

export type ParenthesizedExpression = SourceInfo & {
    kind: "parenthesized-expression",
    inner: Expression,
}

export type PropertyAccessor = SourceInfo & {
    kind: "property-accessor",
    base: Expression,
    properties: PlainIdentifier[],
}

export type LocalIdentifier = SourceInfo & {
    kind: "local-identifier",
    name: string,
}

export type IfElseExpression = SourceInfo & {
    kind: "if-else-expression",
    ifCondition: Expression,
    ifResult: Expression,
    elseResult?: Expression,
}

export type BooleanLiteral = SourceInfo & {
    kind: "boolean-literal",
    value: boolean,
}

export type NilLiteral = SourceInfo & {
    kind: "nil-literal",
}

export type ObjectLiteral = SourceInfo & {
    kind: "object-literal",
    entries: [PlainIdentifier, Expression][],
}

export type ArrayLiteral = SourceInfo & {
    kind: "array-literal",
    entries: Expression[],
}

export type StringLiteral = SourceInfo & {
    kind: "string-literal",
    segments: (string|Expression)[],
}

export type NumberLiteral = SourceInfo & {
    kind: "number-literal",
    value: number,
}

export type ElementTag = SourceInfo & {
    kind: "element-tag",
    tagName: PlainIdentifier,
    attributes: [PlainIdentifier, Expression][],
    children: Expression[],
}

export type ClassConstruction = SourceInfo & {
    kind: "class-construction",
    clazz: LocalIdentifier,
    
}

const ALL_EXPRESSION_TYPES: { [key in Expression["kind"]]: undefined } = {
    "proc": undefined,
    "func": undefined,
    "pipe": undefined,
    "binary-operator": undefined,
    "funcall": undefined,
    "indexer": undefined,
    "if-else-expression": undefined,
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
    return ALL_EXPRESSION_TYPES.hasOwnProperty(ast.kind);
}