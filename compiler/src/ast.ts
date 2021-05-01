
export type AST =
    | Module
    | Declaration
    | Expression
    | Statement
    | PlainIdentifier
    | Block

export type Module = {
    kind: "module",
    declarations: Declaration[],
}

export type Declaration =
    | ImportDeclaration
    | TypeDeclaration
    | ProcDeclaration
    | FuncDeclaration
    | ConstDeclaration

export type ImportDeclaration = {
    kind: "import-declaration",
    imports: Array<{
        name: PlainIdentifier,
        alias?: PlainIdentifier,
    }>,
    path: StringLiteral,
}

export type TypeDeclaration = {
    kind: "type-declaration",
    name: PlainIdentifier,
    type: TypeExpression,
    exported: boolean,
}

export type ProcDeclaration = {
    kind: "proc-declaration",
    proc: Proc,
    exported: boolean,
}

export type FuncDeclaration = {
    kind: "func-declaration",
    func: Func,
    exported: boolean,
}

export type ConstDeclaration = {
    kind: "const-declaration",
    name: PlainIdentifier,
    type: TypeExpression,
    value: Expression,
    exported: boolean,
}

export type PlainIdentifier = {
    kind: "plain-identifier",
    name: string,
}

export type Block = {
    kind: "block",
    statements: Statement[],
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
    type?: TypeExpression,
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
    ifResult: Block,
    elseResult?: Block,
}

export type ForLoop = {
    kind: "for-loop",
    itemIdentifier: PlainIdentifier,
    iterator: Expression,
    body: Block,
}

export type WhileLoop = {
    kind: "while-loop",
    condition: Expression,
    body: Block,
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
    | StringType
    | NumberType
    | BooleanType
    | NilType
    | LiteralType
    | NominalType
    | IteratorType
    | PromiseType
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

export type PrimitiveType = 
    | StringType
    | NumberType
    | BooleanType
    | NilType

export type StringType = {
    kind: "string-type",
}

export type NumberType = {
    kind: "number-type",
}

export type BooleanType = {
    kind: "boolean-type",
}

export type NilType = {
    kind: "nil-type",
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

export type IteratorType = {
    kind: "iterator-type",
    itemType: TypeExpression,
}

export type PromiseType = {
    kind: "promise-type",
    resultType: TypeExpression,
}

export type UnknownType = {
    kind: "unknown-type",
}

export const STRING_TYPE: StringType = {
    kind: "string-type"
}
export const NUMBER_TYPE: NumberType = {
    kind: "number-type"
}
export const BOOLEAN_TYPE: BooleanType = {
    kind: "boolean-type"
}
export const NIL_TYPE: NilType = {
    kind: "nil-type"
}
export const UNKNOWN_TYPE: UnknownType = {
    kind: "unknown-type"
}
export const ITERATOR_OF_NUMBERS_TYPE: IteratorType = {
    kind: "iterator-type",
    itemType: NUMBER_TYPE,
}
export const STRING_TEMPLATE_INSERT_TYPE: TypeExpression = {
    kind: "union-type",
    members: [
        STRING_TYPE,
        NUMBER_TYPE,
        BOOLEAN_TYPE,
    ]
}
export const REACTION_DATA_TYPE: TypeExpression = {
    kind: "func-type",
    argTypes: [],
    returnType: {
        kind: "unknown-type"
    },
}
export const REACTION_EFFECT_TYPE: TypeExpression = {
    kind: "proc-type",
    argTypes: [
        UNKNOWN_TYPE
    ],
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
    "object-literal": undefined,
    "array-literal": undefined,
    "string-literal": undefined,
    "number-literal": undefined,
    "boolean-literal": undefined,
    "nil-literal": undefined,
    "javascript-escape": undefined,
};

export function isExpression(ast: AST): ast is Expression {
    return ALL_EXPRESSION_TYPES.hasOwnProperty(ast.kind);
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
    type: ProcType,
    argNames: PlainIdentifier[],
    body: Block,
}

export type Func = {
    kind: "func",
    name?: PlainIdentifier,
    type: FuncType,
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

export type JavascriptEscape = {
    kind: "javascript-escape",
    js: string,
}

export const KEYWORDS = [ "func", "proc", "if", "else", 
"type", "typeof", "class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "true", "false", "import", "export", "from", "as" ] as const;
