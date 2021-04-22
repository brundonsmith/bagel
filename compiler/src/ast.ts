
export type AST =
    | Declaration
    | Expression
    | Statement
    | PlainIdentifier

export type Declaration =
    | TypeDeclaration
    | ProcDeclaration
    | FuncDeclaration
    | ConstDeclaration

export type TypeDeclaration = {
    kind: "type-declaration",
    name: PlainIdentifier,
    type: TypeExpression,
}

export type ProcDeclaration = {
    kind: "proc-declaration",
    proc: Proc,
}

export type FuncDeclaration = {
    kind: "func-declaration",
    func: Func,
}

export type ConstDeclaration = {
    kind: "const-declaration",
    name: PlainIdentifier,
    type: TypeExpression,
    value: Expression,
}

export function declarationName(decl: Declaration): PlainIdentifier {
    switch(decl.kind) {
        case "type-declaration":
        case "const-declaration":
            return decl.name;
        case "proc-declaration":
            return decl.proc.name as PlainIdentifier;
        case "func-declaration":
            return decl.func.name as PlainIdentifier;
    }
}

export type PlainIdentifier = {
    kind: "plain-identifier",
    name: string,
}

export type Statement = 
    | Reaction
    | IfElseStatement
    | ForLoop
    | WhileLoop
    | JavascriptEscape
    | LetDeclaration
    | Assignment
    | ProcCall

export type Reaction = {
    kind: "reaction",
    data: Expression,
    effect: Expression,
}

export type LetDeclaration = {
    kind: "let-declaration",
    name: LocalIdentifier,
    type: TypeExpression,
    value: Expression,
}

export type Assignment = {
    kind: "assignment",
    target: LocalIdentifier | PropertyAccessor,
    value: Expression,
}

export type ProcCall = {
    kind: "proc-call",
    proc: Expression,
    args: Expression[],
}

export type IfElseStatement = {
    kind: "if-else-statement",
    ifCondition: Expression,
    ifResult: Statement[],
    elseResult?: Statement[],
}

export type ForLoop = {
    kind: "for-loop",
    itemIdentifier: PlainIdentifier,
    iterator: Expression,
    body: Statement[],
}

export type WhileLoop = {
    kind: "while-loop",
    condition: Expression,
    body: Statement[],
}

export type TypeExpression =
    | UnionType
    | NamedType
    | ProcType
    | FuncType
    | ObjectType
    | IndexerType
    | ArrayType
    | TupleType
    | PrimitiveType
    | LiteralType
    | NominalType
    | UnknownType

export type UnionType = {
    kind: "union-type",
    members: TypeExpression[],
}

export type NamedType = {
    kind: "named-type",
    name: PlainIdentifier,
}

export type ProcType = {
    kind: "proc-type",
    argTypes: TypeExpression[],
}

export type FuncType = {
    kind: "func-type",
    argTypes: TypeExpression[],
    returnType: TypeExpression,
}

export type ObjectType = {
    kind: "object-type",
    entries: [PlainIdentifier, TypeExpression][],
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

export type NominalType = {
    kind: "nominal-type",
    name: string,
    inner: TypeExpression,
}

export type UnknownType = {
    kind: "unknown-type",
}

export type Expression = 
    | JavascriptEscape
    | Proc
    | Func
    | Funcall
    | Indexer
    | Pipe
    | BinaryOperator
    | IfElseExpression
    | Range
    | ParenthesizedExpression
    | PropertyAccessor
    | LocalIdentifier
    | ObjectLiteral
    | ArrayLiteral
    | StringLiteral
    | NumberLiteral
    | BooleanLiteral
    | NilLiteral

export type Proc = {
    kind: "proc",
    name?: PlainIdentifier,
    type: ProcType | UnknownType,
    argNames: PlainIdentifier[],
    body: Statement[],
}

export type Func = {
    kind: "func",
    name?: PlainIdentifier,
    type: FuncType | UnknownType,
    argNames: PlainIdentifier[],
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

export const BINARY_OPS = [ "+", "-", "*", "/", "<=", ">=", "<", ">", "==", "&&", "||", "??" ] as const;
export type BinaryOp = typeof BINARY_OPS[number];

export type Funcall = {
    kind: "funcall",
    func: Expression,
    args: Expression[],
}

export type Indexer = {
    kind: "indexer",
    base: Expression,
    indexer: Expression,
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

export type PropertyAccessor = {
    kind: "property-accessor",
    base: Expression,
    properties: PlainIdentifier[],
}

export type LocalIdentifier = {
    kind: "local-identifier",
    name: string,
}

export type ObjectLiteral = {
    kind: "object-literal",
    entries: [PlainIdentifier, Expression][],
}

export type ArrayLiteral = {
    kind: "array-literal",
    entries: Expression[],
}

export type StringLiteral = {
    kind: "string-literal",
    segments: (string|Expression)[],
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

export const KEYWORDS = [ "func", "proc", "if", "else", 
"type", "typeof", "class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "true", "false" ] as const;



export type JavascriptEscape = {
    kind: "javascript-escape",
    js: string,
}