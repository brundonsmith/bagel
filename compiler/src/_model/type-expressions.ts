import { PlainIdentifier } from "./common"
import { BooleanLiteral, Expression, NumberLiteral, StringLiteral } from "./expressions"

export type TypeExpression =
    | UnionType
    | NamedType
    | ProcType
    | FuncType
    | ElementType
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
    | JavascriptEscapeType

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
    typeParams: PlainIdentifier[],
}

export type ElementType = {
    kind: "element-type",
    tagName: PlainIdentifier,
    attributes: [PlainIdentifier, Expression][],
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

export type JavascriptEscapeType = {
    kind: "javascript-escape-type",
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
export const JAVASCRIPT_ESCAPE_TYPE: JavascriptEscapeType = {
    kind: "javascript-escape-type"
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
    returnType: UNKNOWN_TYPE,
    typeParams: [],
}
export const REACTION_EFFECT_TYPE: TypeExpression = {
    kind: "proc-type",
    argTypes: [
        UNKNOWN_TYPE
    ],
}
export const REACTION_UNTIL_TYPE: TypeExpression = {
    kind: "func-type",
    argTypes: [],
    returnType: BOOLEAN_TYPE,
    typeParams: [],
}