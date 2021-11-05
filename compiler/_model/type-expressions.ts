import { AST } from "./ast.ts";
import { Identifier, PlainIdentifier, SourceInfo } from "./common.ts";
import { ClassDeclaration } from "./declarations.ts";
import { BooleanLiteral, ExactStringLiteral, NumberLiteral } from "./expressions.ts";

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
    | ClassInstanceType
    | LiteralType
    | NominalType
    | IteratorType
    | PlanType
    | UnknownType
    | AnyType
    | JavascriptEscapeType

export type UnionType = SourceInfo & Identifier & Mutability & {
    readonly kind: "union-type",
    readonly members: readonly TypeExpression[],
}

export type NamedType = SourceInfo & Identifier & Mutability & {
    readonly kind: "named-type",
    readonly name: PlainIdentifier,
}

export type ProcType = SourceInfo & Identifier & {
    readonly kind: "proc-type",
    readonly typeParams: readonly PlainIdentifier[],
    readonly args: readonly Arg[],
    readonly mutable: false,
}

export type FuncType = SourceInfo & Identifier & {
    readonly kind: "func-type",
    readonly typeParams: PlainIdentifier[],
    readonly args: readonly Arg[],
    readonly returnType?: TypeExpression,
    readonly mutable: false,
}

export type Arg = { readonly name: PlainIdentifier, readonly type?: TypeExpression }

export type ElementType = SourceInfo & Identifier & {
    readonly kind: "element-type",
    // tagName: PlainIdentifier,
    // attributes: [PlainIdentifier, Expression][],
    readonly mutable: false,
}

export type ObjectType = SourceInfo & Identifier & Mutability & {
    readonly kind: "object-type",
    readonly spreads: readonly NamedType[],
    readonly entries: readonly Attribute[],
}

export type Attribute = SourceInfo & Identifier & {
    readonly kind: "attribute",
    readonly name: PlainIdentifier,
    readonly type: TypeExpression,
    readonly mutable: false,
}

export type IndexerType = SourceInfo & Identifier & Mutability & {
    readonly kind: "indexer-type",
    readonly keyType: TypeExpression,
    readonly valueType: TypeExpression,
}

export type ArrayType = SourceInfo & Identifier & Mutability & {
    readonly kind: "array-type",
    readonly element: TypeExpression,
}

export type TupleType = SourceInfo & Identifier & Mutability & {
    readonly kind: "tuple-type",
    readonly members: readonly TypeExpression[],
}

export type PrimitiveType = 
    | StringType
    | NumberType
    | BooleanType
    | NilType
    | UnknownType

export type StringType = SourceInfo & Identifier & {
    readonly kind: "string-type",
    readonly mutable: false,
}

export type NumberType = SourceInfo & Identifier & {
    readonly kind: "number-type",
    readonly mutable: false,
}

export type BooleanType = SourceInfo & Identifier & {
    readonly kind: "boolean-type",
    readonly mutable: false,
}

export type NilType = SourceInfo & Identifier & {
    readonly kind: "nil-type",
    readonly mutable: false,
}

export type LiteralType = SourceInfo & Identifier & {
    readonly kind: "literal-type",
    readonly value: ExactStringLiteral | NumberLiteral | BooleanLiteral,
    readonly mutable: false,
}

export type ClassInstanceType = SourceInfo & Identifier & {
    readonly kind: "class-instance-type",
    readonly clazz: ClassDeclaration,
    readonly internal: boolean,
    readonly mutable: true,
}

export type NominalType = SourceInfo & Identifier & {
    readonly kind: "nominal-type",
    readonly name: string,
    readonly inner: TypeExpression,
    readonly mutable: false,
}

export type IteratorType = SourceInfo & Identifier & {
    readonly kind: "iterator-type",
    readonly itemType: TypeExpression,
    readonly mutable: false,
}

export type PlanType = SourceInfo & Identifier & {
    readonly kind: "plan-type",
    readonly resultType: TypeExpression,
    readonly mutable: false,
}

export type UnknownType = SourceInfo & Identifier & {
    readonly kind: "unknown-type",
    readonly mutable: false,
}

// Internal use only!
export type AnyType = SourceInfo & Identifier & {
    readonly kind: "any-type",
    readonly mutable: true,
}

export type JavascriptEscapeType = SourceInfo & Identifier & {
    readonly kind: "javascript-escape-type",
    readonly mutable: true,
}

export type Mutability = { readonly mutable: boolean|undefined }

export const STRING_TYPE: StringType = {
    kind: "string-type",
    mutable: false,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const NUMBER_TYPE: NumberType = {
    kind: "number-type",
    mutable: false,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const BOOLEAN_TYPE: BooleanType = {
    kind: "boolean-type",
    mutable: false,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const NIL_TYPE: NilType = {
    kind: "nil-type",
    mutable: false,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const UNKNOWN_TYPE: UnknownType = {
    kind: "unknown-type",
    mutable: false,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ANY_TYPE: AnyType = {
    kind: "any-type",
    mutable: true,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const JAVASCRIPT_ESCAPE_TYPE: JavascriptEscapeType = {
    kind: "javascript-escape-type",
    mutable: true,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ITERATOR_OF_NUMBERS_TYPE: IteratorType = {
    kind: "iterator-type",
    itemType: NUMBER_TYPE,
    mutable: false,
    id: Symbol(),
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
    mutable: false,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REACTION_DATA_TYPE: TypeExpression = {
    kind: "func-type",
    args: [],
    returnType: UNKNOWN_TYPE,
    typeParams: [],
    mutable: false,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REACTION_EFFECT_TYPE: TypeExpression = {
    kind: "proc-type",
    typeParams: [],
    args: [{
        name: { kind: "plain-identifier", name: "_", id: Symbol(), code: undefined, startIndex: undefined, endIndex: undefined },
        type: UNKNOWN_TYPE
    }],
    mutable: false,
    id: Symbol(),
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REACTION_VIEW_TYPE: TypeExpression = {
    kind: 'proc-type',
    args: [],
    typeParams: [],
    mutable: false,
    id: Symbol(),
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
        { kind: "element-type", mutable: false, id: Symbol(), code: undefined, startIndex: undefined, endIndex: undefined },
        { kind: "array-type", element: {
            kind: "union-type",
            members: [
                STRING_TYPE,
                NUMBER_TYPE,
                NIL_TYPE,
                { kind: "element-type", mutable: false, id: Symbol(), code: undefined, startIndex: undefined, endIndex: undefined },
            ],
            code: undefined,
            id: Symbol(),
            startIndex: undefined,
            endIndex: undefined,
            mutable: false,
        }, mutable: false, id: Symbol(), code: undefined, startIndex: undefined, endIndex: undefined}
    ],
    mutable: false,
    id: Symbol(),
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
    "any-type": undefined,
    "iterator-type": undefined,
    "plan-type": undefined,
    "literal-type": undefined,
    "tuple-type": undefined,
    "class-instance-type": undefined,
    "nominal-type": undefined,
    "javascript-escape-type": undefined,
}

export function isTypeExpression(ast: AST): ast is TypeExpression {
    return Object.prototype.hasOwnProperty.call(ALL_TYPE_EXPRESSION_TYPES, ast.kind);
}