import { AST, PlainIdentifier, SourceInfo } from "./ast.ts";
import { BooleanLiteral, ExactStringLiteral, NumberLiteral } from "./expressions.ts";

export type TypeExpression =
    | UnionType
    | MaybeType
    | NamedType
    | GenericParamType
    | ProcType
    | FuncType
    | GenericType
    | BoundGenericType
    | ElementType
    | ObjectType
    | RecordType
    | ArrayType
    | TupleType
    | StringType
    | NumberType
    | BooleanType
    | NilType
    | LiteralType
    | NominalType
    | IteratorType
    | PlanType
    | ParenthesizedType
    | UnknownType
    | AnyType
    | JavascriptEscapeType

export type UnionType = SourceInfo & {
    readonly kind: "union-type",
    readonly members: readonly TypeExpression[],
    readonly mutability: undefined,
}

export type MaybeType = SourceInfo & {
    readonly kind: "maybe-type",
    readonly inner: TypeExpression,
    readonly mutability: undefined,
}

export type NamedType = SourceInfo & {
    readonly kind: "named-type",
    readonly name: PlainIdentifier,
    readonly mutability: undefined,
}

export type GenericParamType = SourceInfo & {
    readonly kind: "generic-param-type",
    readonly name: PlainIdentifier,
    readonly extends: TypeExpression|undefined,
    readonly mutability: undefined,
}

export type ProcType = SourceInfo & {
    readonly kind: "proc-type",
    readonly args: readonly Arg[],
    readonly invalidatesParent: boolean,
    readonly mutability: undefined,
}

export type FuncType = SourceInfo & {
    readonly kind: "func-type",
    readonly args: readonly Arg[],
    readonly returnType?: TypeExpression,
    readonly mutability: undefined,
}

export type GenericType = SourceInfo & {
    readonly kind: "generic-type",
    readonly typeParams: readonly TypeParam[],
    readonly inner: TypeExpression,
    readonly mutability: undefined,
}

export type TypeParam = {
    readonly name: PlainIdentifier,
    readonly extends: TypeExpression|undefined
}

// These two types are special cases of GenericType that allow us to encode 
// additional guarantees at certain spots in the AST, and thereby avoid some 
// as-casting later on
export type GenericFuncType = SourceInfo & {
    readonly kind: "generic-type",
    readonly typeParams: readonly TypeParam[],
    readonly inner: FuncType,
    readonly mutability: undefined,
}
export type GenericProcType = SourceInfo & {
    readonly kind: "generic-type",
    readonly typeParams: readonly TypeParam[],
    readonly inner: ProcType,
    readonly mutability: undefined,
}

export type BoundGenericType = SourceInfo & {
    readonly kind: "bound-generic-type",
    readonly typeArgs: readonly TypeExpression[],
    readonly generic: TypeExpression,
    readonly mutability: undefined,
}

export type Arg = SourceInfo & {
    readonly kind: "arg",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly optional: boolean,
}

export type ElementType = SourceInfo & {
    readonly kind: "element-type",
    // tagName: PlainIdentifier,
    // attributes: [PlainIdentifier, Expression][],
    readonly mutability: undefined,
}

export type ObjectType = SourceInfo & Mutability & {
    readonly kind: "object-type",
    readonly spreads: readonly NamedType[],
    readonly entries: readonly Attribute[],
}

export type Attribute = SourceInfo & {
    readonly kind: "attribute",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression,
    readonly optional: boolean,
    readonly forceReadonly: boolean,
    readonly mutability: undefined,
}

export type RecordType = SourceInfo & Mutability & {
    readonly kind: "record-type",
    readonly keyType: TypeExpression,
    readonly valueType: TypeExpression,
}

export type ArrayType = SourceInfo & Mutability & {
    readonly kind: "array-type",
    readonly element: TypeExpression,
}

export type TupleType = SourceInfo & Mutability & {
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
    readonly mutability: undefined,
}

export type NumberType = SourceInfo & {
    readonly kind: "number-type",
    readonly mutability: undefined,
}

export type BooleanType = SourceInfo & {
    readonly kind: "boolean-type",
    readonly mutability: undefined,
}

export type NilType = SourceInfo & {
    readonly kind: "nil-type",
    readonly mutability: undefined,
}

export type LiteralType = SourceInfo & {
    readonly kind: "literal-type",
    readonly value: ExactStringLiteral | NumberLiteral | BooleanLiteral,
    readonly mutability: undefined,
}

export type NominalType = SourceInfo & {
    readonly kind: "nominal-type",
    readonly name: symbol,
    readonly inner: TypeExpression,
    readonly mutability: undefined,
}

export type IteratorType = SourceInfo & {
    readonly kind: "iterator-type",
    readonly inner: TypeExpression,
    readonly mutability: undefined,
}

export type PlanType = SourceInfo & {
    readonly kind: "plan-type",
    readonly inner: TypeExpression,
    readonly mutability: undefined,
}

export type ParenthesizedType = SourceInfo & {
    readonly kind: "parenthesized-type",
    readonly inner: TypeExpression,
    readonly mutability: undefined,
}

export type UnknownType = SourceInfo & {
    readonly kind: "unknown-type",
    readonly mutability: undefined,
}

// Internal use only!
export type AnyType = SourceInfo & {
    readonly kind: "any-type",
    readonly mutability: undefined,
}

export type JavascriptEscapeType = SourceInfo & {
    readonly kind: "javascript-escape-type",
    readonly mutability: undefined,
}

export type Mutability = { readonly mutability: "immutable"|"readonly"|"mutable" }

export const STRING_TYPE: StringType = {
    kind: "string-type",
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const NUMBER_TYPE: NumberType = {
    kind: "number-type",
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const BOOLEAN_TYPE: BooleanType = {
    kind: "boolean-type",
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const NIL_TYPE: NilType = {
    kind: "nil-type",
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const UNKNOWN_TYPE: UnknownType = {
    kind: "unknown-type",
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ANY_TYPE: AnyType = {
    kind: "any-type",
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const JAVASCRIPT_ESCAPE_TYPE: JavascriptEscapeType = {
    kind: "javascript-escape-type",
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const OBJECT_OF_ANY: RecordType = {
    kind: "record-type",
    keyType: ANY_TYPE,
    valueType: ANY_TYPE,
    mutability: "immutable",
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ARRAY_OF_ANY: ArrayType = {
    kind: "array-type",
    element: ANY_TYPE,
    mutability: "immutable",
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ITERATOR_OF_ANY: IteratorType = {
    kind: "iterator-type",
    inner: ANY_TYPE,
    mutability: undefined,
    parent: undefined,
    module: undefined,
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
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ELEMENT_TAG_CHILD_TYPE: TypeExpression = {
    kind: "union-type",
    members: [
        STRING_TYPE,
        NUMBER_TYPE,
        NIL_TYPE,
        { kind: "element-type", mutability: undefined, parent: undefined, module: undefined, code: undefined, startIndex: undefined, endIndex: undefined },
        { kind: "array-type", element: {
            kind: "union-type",
            members: [
                STRING_TYPE,
                NUMBER_TYPE,
                NIL_TYPE,
                { kind: "element-type", mutability: undefined, parent: undefined, module: undefined, code: undefined, startIndex: undefined, endIndex: undefined },
            ],
            code: undefined,
            parent: undefined,
            module: undefined,
            startIndex: undefined,
            endIndex: undefined,
            mutability: undefined,
        }, mutability: "immutable", parent: undefined, module: undefined, code: undefined, startIndex: undefined, endIndex: undefined}
    ],
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}

const ALL_TYPE_EXPRESSION_TYPES: { [key in TypeExpression["kind"]]: undefined } = {
    "union-type": undefined,
    "maybe-type": undefined,
    "named-type": undefined,
    "generic-param-type": undefined,
    "proc-type": undefined,
    "func-type": undefined,
    "generic-type": undefined,
    "bound-generic-type": undefined,
    "element-type": undefined,
    "object-type": undefined,
    "record-type": undefined,
    "array-type": undefined,
    "string-type": undefined,
    "number-type": undefined,
    "boolean-type": undefined,
    "nil-type": undefined,
    "unknown-type": undefined,
    "any-type": undefined,
    "iterator-type": undefined,
    "plan-type": undefined,
    "parenthesized-type": undefined,
    "literal-type": undefined,
    "tuple-type": undefined,
    "nominal-type": undefined,
    "javascript-escape-type": undefined,
}

export function isTypeExpression(ast: AST): ast is TypeExpression {
    return Object.prototype.hasOwnProperty.call(ALL_TYPE_EXPRESSION_TYPES, ast.kind);
}
