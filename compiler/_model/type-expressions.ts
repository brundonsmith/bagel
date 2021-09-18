import { PlainIdentifier, SourceInfo } from "./common.ts";
import { BooleanLiteral, NumberLiteral, StringLiteral } from "./expressions.ts";

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

export type UnionType = SourceInfo & {
    kind: "union-type",
    members: TypeExpression[],
}

export type NamedType = SourceInfo & {
    kind: "named-type",
    name: PlainIdentifier,
}

export type ProcType = SourceInfo & {
    kind: "proc-type",
    typeParams: PlainIdentifier[],
    arg: { name: PlainIdentifier, type: TypeExpression} | undefined,
}

export type FuncType = SourceInfo & {
    kind: "func-type",
    typeParams: PlainIdentifier[],
    arg: { name: PlainIdentifier, type: TypeExpression} | undefined,
    returnType: TypeExpression,
}

export type ElementType = SourceInfo & {
    kind: "element-type",
    // tagName: PlainIdentifier,
    // attributes: [PlainIdentifier, Expression][],
}

export type ObjectType = SourceInfo & {
    kind: "object-type",
    entries: [PlainIdentifier, TypeExpression][],
}

export type IndexerType = SourceInfo & {
    kind: "indexer-type",
    keyType: TypeExpression,
    valueType: TypeExpression,
}

export type ArrayType = SourceInfo & {
    kind: "array-type",
    element: TypeExpression,
}

export type TupleType = SourceInfo & {
    kind: "tuple-type",
    members: TypeExpression[],
}

export type PrimitiveType = 
    | StringType
    | NumberType
    | BooleanType
    | NilType
    | UnknownType

export type StringType = SourceInfo & {
    kind: "string-type",
}

export type NumberType = SourceInfo & {
    kind: "number-type",
}

export type BooleanType = SourceInfo & {
    kind: "boolean-type",
}

export type NilType = SourceInfo & {
    kind: "nil-type",
}

export type LiteralType = SourceInfo & {
    kind: "literal-type",
    value: StringLiteral | NumberLiteral | BooleanLiteral,
}

export type NominalType = SourceInfo & {
    kind: "nominal-type",
    name: string,
    inner: TypeExpression,
}

export type IteratorType = SourceInfo & {
    kind: "iterator-type",
    itemType: TypeExpression,
}

export type PromiseType = SourceInfo & {
    kind: "promise-type",
    resultType: TypeExpression,
}

export type UnknownType = SourceInfo & {
    kind: "unknown-type",
}

export type JavascriptEscapeType = SourceInfo & {
    kind: "javascript-escape-type",
}

export const STRING_TYPE: StringType = {
    kind: "string-type",
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const NUMBER_TYPE: NumberType = {
    kind: "number-type",
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const BOOLEAN_TYPE: BooleanType = {
    kind: "boolean-type",
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const NIL_TYPE: NilType = {
    kind: "nil-type",
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const UNKNOWN_TYPE: UnknownType = {
    kind: "unknown-type",
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const JAVASCRIPT_ESCAPE_TYPE: JavascriptEscapeType = {
    kind: "javascript-escape-type",
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ITERATOR_OF_NUMBERS_TYPE: IteratorType = {
    kind: "iterator-type",
    itemType: NUMBER_TYPE,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const STRING_TEMPLATE_INSERT_TYPE: TypeExpression = {
    kind: "union-type",
    members: [
        STRING_TYPE,
        NUMBER_TYPE,
        BOOLEAN_TYPE,
    ],
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REACTION_DATA_TYPE: TypeExpression = {
    kind: "func-type",
    arg: undefined,
    returnType: UNKNOWN_TYPE,
    typeParams: [],
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REACTION_EFFECT_TYPE: TypeExpression = {
    kind: "proc-type",
    typeParams: [],
    arg: {
        name: { kind: "plain-identifier", name: "_", code: undefined, startIndex: undefined, endIndex: undefined },
        type: UNKNOWN_TYPE
    },
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REACTION_UNTIL_TYPE: TypeExpression = {
    kind: "func-type",
    arg: undefined,
    returnType: BOOLEAN_TYPE,
    typeParams: [],
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}