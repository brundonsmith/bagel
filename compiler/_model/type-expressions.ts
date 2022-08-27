import { PlainIdentifier, SourceInfo } from "./ast.ts";
import { BooleanLiteral, ExactStringLiteral, Expression, NumberLiteral } from "./expressions.ts";

export type TypeExpression =
    | UnionType
    | MaybeType
    | NamedType
    | GenericParamType
    | ProcType
    | FuncType
    | GenericType
    | BoundGenericType
    | ObjectType
    | RecordType
    | ArrayType
    | TupleType
    | ReadonlyType
    | StringType
    | NumberType
    | BooleanType
    | NilType
    | LiteralType
    | NominalType
    | IteratorType
    | PlanType
    | RemoteType
    | ErrorType
    | ParenthesizedType
    | TypeofType
    | KeyofType
    | ValueofType
    | ElementofType
    | UnknownType
    | PoisonedType
    | AnyType
    | RegularExpressionType
    | PropertyType
    | JavascriptEscapeType

export type UnionType = SourceInfo & NoMutability & {
    readonly kind: "union-type",
    readonly members: readonly TypeExpression[],
}

export type MaybeType = SourceInfo & NoMutability & {
    readonly kind: "maybe-type",
    readonly inner: TypeExpression,
}

export type NamedType = SourceInfo & NoMutability & {
    readonly kind: "named-type",
    readonly name: PlainIdentifier,
}

export type GenericParamType = SourceInfo & NoMutability & {
    readonly kind: "generic-param-type",
    readonly name: PlainIdentifier,
    readonly extends: TypeExpression|undefined,
}

export type ProcType = SourceInfo & NoMutability & {
    readonly kind: "proc-type",
    readonly args: Args | SpreadArgs,
    readonly isPure: boolean,
    readonly isAsync: boolean,
    readonly throws: TypeExpression|undefined,
}

export type FuncType = SourceInfo & NoMutability & {
    readonly kind: "func-type",
    readonly args: Args | SpreadArgs,
    readonly returnType?: TypeExpression,
    readonly isPure: boolean,
}

export type GenericType = SourceInfo & NoMutability & {
    readonly kind: "generic-type",
    readonly typeParams: readonly TypeParam[],
    readonly inner: TypeExpression,
}

export type TypeParam = {
    readonly name: PlainIdentifier,
    readonly extends: TypeExpression|undefined
}

// These two types are special cases of GenericType that allow us to encode 
// additional guarantees at certain spots in the AST, and thereby avoid some 
// as-casting later on
export type GenericFuncType = SourceInfo & NoMutability & {
    readonly kind: "generic-type",
    readonly typeParams: readonly TypeParam[],
    readonly inner: FuncType,
}
export type GenericProcType = SourceInfo & NoMutability & {
    readonly kind: "generic-type",
    readonly typeParams: readonly TypeParam[],
    readonly inner: ProcType,
}

export type BoundGenericType = SourceInfo & NoMutability & {
    readonly kind: "bound-generic-type",
    readonly typeArgs: readonly TypeExpression[],
    readonly generic: TypeExpression,
}

export type Args = SourceInfo & {
    readonly kind: "args",
    readonly args: readonly Arg[],
}

export type Arg = SourceInfo & {
    readonly kind: "arg",
    readonly name: PlainIdentifier,
    readonly type?: TypeExpression,
    readonly optional: boolean,
}

export type SpreadArgs = SourceInfo & {
    readonly kind: "spread-args",
    readonly name?: PlainIdentifier,
    readonly type: TypeExpression,
}

export type ObjectType = SourceInfo & Mutability & {
    readonly kind: "object-type",
    readonly spreads: readonly NamedType[],
    readonly entries: readonly Attribute[],
}

export type Attribute = SourceInfo & {
    readonly kind: "attribute",
    readonly name: PlainIdentifier | ExactStringLiteral,
    readonly type: TypeExpression,
    readonly optional: boolean,
    readonly forceReadonly: boolean,
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

export type ReadonlyType = SourceInfo & NoMutability & {
    readonly kind: "readonly-type",
    readonly inner: TypeExpression,
}

export type PrimitiveType = 
    | StringType
    | NumberType
    | BooleanType
    | NilType
    | UnknownType

export type StringType = SourceInfo & NoMutability & {
    readonly kind: "string-type",
}

export type NumberType = SourceInfo & NoMutability & {
    readonly kind: "number-type",
}

export type BooleanType = SourceInfo & NoMutability & {
    readonly kind: "boolean-type",
}

export type NilType = SourceInfo & NoMutability & {
    readonly kind: "nil-type",
}

export type LiteralType = SourceInfo & NoMutability & {
    readonly kind: "literal-type",
    readonly value: ExactStringLiteral | NumberLiteral | BooleanLiteral,
}

export type NominalType = SourceInfo & NoMutability & {
    readonly kind: "nominal-type",
    readonly name: string,
    readonly inner: TypeExpression | undefined,
}

export type IteratorType = SourceInfo & NoMutability & {
    readonly kind: "iterator-type",
    readonly inner: TypeExpression,
}

export type PlanType = SourceInfo & NoMutability & {
    readonly kind: "plan-type",
    readonly inner: TypeExpression,
}

export type RemoteType = SourceInfo & NoMutability & {
    readonly kind: "remote-type",
    readonly inner: TypeExpression,
}

export type ErrorType = SourceInfo & NoMutability & {
    readonly kind: "error-type",
    readonly inner: TypeExpression,
}

export type RegularExpressionType = SourceInfo & NoMutability & {
    readonly kind: "regular-expression-type",
    // TODO: Number of match groups?
}

export type ParenthesizedType = SourceInfo & NoMutability & {
    readonly kind: "parenthesized-type",
    readonly inner: TypeExpression,
}

export type TypeofType = SourceInfo & NoMutability & {
    readonly kind: "typeof-type",
    readonly expr: Expression,
}

export type KeyofType = SourceInfo & NoMutability & {
    readonly kind: "keyof-type",
    readonly inner: TypeExpression,
}

export type ValueofType = SourceInfo & NoMutability & {
    readonly kind: "valueof-type",
    readonly inner: TypeExpression,
}

export type ElementofType = SourceInfo & NoMutability & {
    readonly kind: "elementof-type",
    readonly inner: TypeExpression,
}

export type UnknownType = SourceInfo & Mutability & {
    readonly kind: "unknown-type",
}

export type PoisonedType = SourceInfo & NoMutability & {
    readonly kind: "poisoned-type",
}

// Internal use only!
export type AnyType = SourceInfo & NoMutability & {
    readonly kind: "any-type",
}

export type PropertyType = SourceInfo & NoMutability & {
    readonly kind: "property-type",
    readonly subject: TypeExpression,
    readonly property: PlainIdentifier,
    readonly optional: boolean,
}

export type JavascriptEscapeType = SourceInfo & NoMutability & {
    readonly kind: "javascript-escape-type",
}

export type Mutability = { readonly mutability: 'constant'|"readonly"|"mutable"|"literal" }
export type NoMutability = { readonly mutability: undefined }

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
export const STRING_OR_NUMBER_TYPE: UnionType = {
    kind: "union-type",
    members: [STRING_TYPE, NUMBER_TYPE],
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
export const TRUE_TYPE: LiteralType = {
    kind: "literal-type",
    value: {
        kind: "boolean-literal",
        value: true,
        parent: undefined,
        module: undefined,
        code: undefined,
        startIndex: undefined,
        endIndex: undefined,
    },
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const FALSE_TYPE: LiteralType = {
    kind: "literal-type",
    value: {
        kind: "boolean-literal",
        value: false,
        parent: undefined,
        module: undefined,
        code: undefined,
        startIndex: undefined,
        endIndex: undefined,
    },
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
    mutability: "mutable",
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const POISONED_TYPE: PoisonedType = {
    kind: "poisoned-type",
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
export const EMPTY_TYPE: UnionType = {
    kind: "union-type",
    members: [],
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export function isEmptyType(type: TypeExpression) {
    return type.kind === 'union-type' && type.members.length === 0
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
export const VALID_RECORD_KEY: TypeExpression = STRING_TYPE
export const RECORD_OF_ANY: RecordType = {
    kind: "record-type",
    keyType: ANY_TYPE,
    valueType: ANY_TYPE,
    mutability: 'constant',
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ARRAY_OF_ANY: ArrayType = {
    kind: "array-type",
    element: ANY_TYPE,
    mutability: 'constant',
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
export const PLAN_OF_ANY: PlanType = {
    kind: "plan-type",
    inner: ANY_TYPE,
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const ERROR_OF_ANY: ErrorType = {
    kind: "error-type",
    inner: ANY_TYPE,
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const REMOTE_OF_ANY: RemoteType = {
    kind: "remote-type",
    inner: ANY_TYPE,
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}

export const FUNC: FuncType = {
    kind: "func-type",
    args: {
        kind: 'spread-args',
        type: ARRAY_OF_ANY,
        parent: undefined,
        module: undefined,
        code: undefined,
        startIndex: undefined,
        endIndex: undefined,
    },
    returnType: ANY_TYPE,
    isPure: false,
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const PROC: ProcType = {
    kind: "proc-type",
    args: {
        kind: 'spread-args',
        type: ARRAY_OF_ANY,
        parent: undefined,
        module: undefined,
        code: undefined,
        startIndex: undefined,
        endIndex: undefined,
    },
    isAsync: false,
    isPure: false,
    throws: undefined,
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
export const TRUTHINESS_SAFE_TYPES: UnionType = {
    kind: "union-type",
    members: [
        BOOLEAN_TYPE,
        NIL_TYPE,
        RECORD_OF_ANY,
        ARRAY_OF_ANY,
        ITERATOR_OF_ANY,
        PLAN_OF_ANY,
        REMOTE_OF_ANY,
        PROC,
        FUNC
    ],
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}
export const FALSY: UnionType = {
    kind: "union-type",
    members: [
        FALSE_TYPE,
        NIL_TYPE,
        ERROR_OF_ANY
    ],
    mutability: undefined,
    parent: undefined,
    module: undefined,
    code: undefined,
    startIndex: undefined,
    endIndex: undefined,
}

// TODO: Only allow known object properties when instantiating an object literal, like TypeScript does
