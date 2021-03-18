export type AST =
    | FuncdefNative
    | FuncdefDynamic
    | Funcall
    | StringLiteral
    | NumberLiteral
    | BooleanLiteral

export type FuncdefNative = {
    kind: "funcdef-native",
    argTypes: ValueType[],
    returnType: ValueType,
    body: string,
}

export type FuncdefDynamic = {
    kind: "funcdef-dynamic",
    body: AST,
}

export type Funcall = {
    kind: "funcall",
    name: string,
    args: AST[],

    intrinsicArgTypes?: ValueType[],
    intrinsicReturnType?: ValueType,
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



export type ValueType = 
    | { kind: "union-type", members: ValueType[] }
    | { kind: typeof STRING }
    | { kind: typeof NUMBER }
    | { kind: typeof BOOLEAN }

export const STRING = Symbol("STRING");
export const NUMBER = Symbol("NUMBER");
export const BOOLEAN = Symbol("BOOLEAN");

export function canBeAssignedTo(value: ValueType, destination: ValueType): boolean {
    if (destination.kind === "union-type") {
        return destination.members.some(memberType => canBeAssignedTo(value, memberType));
    } else {
        // primitives
        return value.kind === destination.kind;
    }
}