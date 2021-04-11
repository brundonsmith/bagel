import { Type } from "./types";

export type AST =
    | Declaration
    | Expression
    | Statement

export type Declaration =
    | TypeDeclaration
    | ProcDeclaration
    | FuncDeclaration
    | ConstDeclaration

export type TypeDeclaration = {
    kind: "type-declaration",
    name: Identifier,
    type: TypeExpression,
}

export type ProcDeclaration = {
    kind: "proc-declaration",
    type?: Type,
    proc: Proc,
}

export type FuncDeclaration = {
    kind: "func-declaration",
    type?: Type,
    func: Func,
}

export type ConstDeclaration = {
    kind: "const-declaration",
    type?: Type,
    name: Identifier,
    value: Expression,
}

export type TypeExpression =
    | UnionType
    | NamedType
    | ObjectType
    | IndexerType
    | ArrayType
    | TupleType
    | PrimitiveType
    | LiteralType

export type UnionType = {
    kind: "union-type",
    members: TypeExpression[],
}

export type NamedType = {
    kind: "named-type",
    name: Identifier,
}

export type ObjectType = {
    kind: "object-type",
    entries: [Identifier, TypeExpression][],
}

export type IndexerType = {
    kind: "indexer-type",
    keyType: TypeExpression,
    valueType: TypeExpression,
}

export type ArrayType = {
    kind: "array-type",
    element: TypeExpression,
}

export type TupleType = {
    kind: "tuple-type",
    members: TypeExpression[],
}

export type PrimitiveType = {
    kind: "primitive-type",
    type: "string" | "number" | "boolean" | "nil",
}

export type LiteralType = {
    kind: "literal-type",
    value: StringLiteral | NumberLiteral | BooleanLiteral,
}

export type Expression = 
    | Proc
    | Func
    | Funcall
    | Pipe
    | BinaryOperator
    | IfElseExpression
    | Range
    | ParenthesizedExpression
    | Identifier
    | ObjectLiteral
    | ArrayLiteral
    | StringLiteral
    | NumberLiteral
    | BooleanLiteral
    | NilLiteral

export type Proc = {
    kind: "proc",
    name?: string,
    args: Array<{ name: Identifier, type?: Type }>,
    body: Statement[],
}

export type Statement = 
    | Assignment;

export type Assignment = {
    kind: "assignment",

}

export type Func = {
    kind: "func",
    name?: string,
    args: Array<{ name: Identifier, type?: Type }>,
    returnType?: Type,
    body: Expression,
}

export type Pipe = {
    kind: "pipe",
    expressions: Expression[],
}

export type BinaryOperator = {
    kind: "binary-operator",
    left: Expression,
    right: Expression,
    operator: BinaryOp,
}

export const BINARY_OPS = [ "+", "-", "*", "/", "<", ">", "<=", ">=", "&&", "||" ] as const;
export type BinaryOp = typeof BINARY_OPS[number];

export type Funcall = {
    kind: "funcall",
    func: Expression,
    args: Expression[],
}

export type IfElseExpression = {
    kind: "if-else-expression",
    ifCondition: Expression,
    ifResult: Expression,
    elseResult?: Expression,
}

export type Range = {
    kind: "range",
    start: number,
    end: number,
}

export type ParenthesizedExpression = {
    kind: "parenthesized-expression",
    inner: Expression,
}

export type Identifier = {
    kind: "identifier",
    name: string,
}

export type ObjectLiteral = {
    kind: "object-literal",
    entries: [Identifier, Expression][],
}

export type ArrayLiteral = {
    kind: "array-literal",
    entries: Expression[],
}

export type StringLiteral = {
    kind: "string-literal",
    value: string,
}

export type NumberLiteral = {
    kind: "number-literal",
    value: number,
}

export type BooleanLiteral = {
    kind: "boolean-literal",
    value: boolean,
}

export type NilLiteral = {
    kind: "nil-literal",
}

export const KEYWORDS = [ "func", "proc", "if", "else", "type", "class", "let", "const" ] as const;