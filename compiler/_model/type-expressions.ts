import { AST } from "./ast.ts";
import { PlainIdentifier, SourceInfo } from "./common.ts";
import { ClassDeclaration } from "./declarations.ts";
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
    | ClassType
    | LiteralType
    | NominalType
    | IteratorType
    | PlanType
    | UnknownType
    | JavascriptEscapeType

export type UnionType = SourceInfo & {
    readonly kind: "union-type",
    readonly members: readonly TypeExpression[],
}

export type NamedType = SourceInfo & {
    readonly kind: "named-type",
    readonly name: PlainIdentifier,
}

export type ProcType = SourceInfo & {
    readonly kind: "proc-type",
    readonly typeParams: readonly PlainIdentifier[],
    readonly args: readonly { readonly name: PlainIdentifier, readonly type?: TypeExpression}[],
}

export type FuncType = SourceInfo & {
    readonly kind: "func-type",
    readonly typeParams: PlainIdentifier[],
    readonly args: readonly { readonly name: PlainIdentifier, readonly type?: TypeExpression}[],
    readonly returnType?: TypeExpression,
}

export type ElementType = SourceInfo & {
    readonly kind: "element-type",
    // tagName: PlainIdentifier,
    // attributes: [PlainIdentifier, Expression][],
}

export type ObjectType = SourceInfo & {
    readonly kind: "object-type",
    readonly entries: readonly Attribute[],
}

export type Attribute = SourceInfo & {
    readonly kind: "attribute",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression,
}

export type IndexerType = SourceInfo & {
    readonly kind: "indexer-type",
    readonly keyType: TypeExpression,
    readonly valueType: TypeExpression,
}

export type ArrayType = SourceInfo & {
    readonly kind: "array-type",
    readonly element: TypeExpression,
}

export type TupleType = SourceInfo & {
    readonly kind: "tuple-type",
    readonly members: readonly TypeExpression[],
}

export type PrimitiveType = 
    | StringType
    | NumberType
    | BooleanType
    | NilType
    | UnknownType

export type StringType = SourceInfo & {
    readonly kind: "string-type",
}

export type NumberType = SourceInfo & {
    readonly kind: "number-type",
}

export type BooleanType = SourceInfo & {
    readonly kind: "boolean-type",
}

export type NilType = SourceInfo & {
    readonly kind: "nil-type",
}

export type LiteralType = SourceInfo & {
    readonly kind: "literal-type",
    readonly value: StringLiteral | NumberLiteral | BooleanLiteral,
}

export type ClassType = SourceInfo & {
    readonly kind: "class-type",
    readonly clazz: ClassDeclaration
}

export type NominalType = SourceInfo & {
    readonly kind: "nominal-type",
    readonly name: string,
    readonly inner: TypeExpression,
}

export type IteratorType = SourceInfo & {
    readonly kind: "iterator-type",
    readonly itemType: TypeExpression,
}

export type PlanType = SourceInfo & {
    readonly kind: "plan-type",
    readonly resultType: TypeExpression,
}

export type UnknownType = SourceInfo & {
    readonly kind: "unknown-type",
}

export type JavascriptEscapeType = SourceInfo & {
    readonly kind: "javascript-escape-type",
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
    args: [],
    returnType: UNKNOWN_TYPE,
    typeParams: [],
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REACTION_EFFECT_TYPE: TypeExpression = {
    kind: "proc-type",
    typeParams: [],
    args: [{
        name: { kind: "plain-identifier", name: "_", code: undefined, startIndex: undefined, endIndex: undefined },
        type: UNKNOWN_TYPE
    }],
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REACTION_UNTIL_TYPE: TypeExpression = {
    kind: "func-type",
    args: [],
    returnType: BOOLEAN_TYPE,
    typeParams: [],
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}

const ALL_TYPE_EXPRESSION_TYPES: { [key in TypeExpression["kind"]]: undefined } = {
    "union-type": undefined,
    "named-type": undefined,
    "proc-type": undefined,
    "func-type": undefined,
    "element-type": undefined,
    "object-type": undefined,
    "indexer-type": undefined,
    "array-type": undefined,
    "string-type": undefined,
    "number-type": undefined,
    "boolean-type": undefined,
    "nil-type": undefined,
    "unknown-type": undefined,
    "iterator-type": undefined,
    "plan-type": undefined,
    "literal-type": undefined,
    "tuple-type": undefined,
    "class-type": undefined,
    "nominal-type": undefined,
    "javascript-escape-type": undefined,
}

export function isTypeExpression(ast: AST): ast is TypeExpression {
    return Object.prototype.hasOwnProperty.call(ALL_TYPE_EXPRESSION_TYPES, ast.kind);
}