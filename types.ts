
export type Type = 
    | { kind: "union-type", members: Type[] }
    | { kind: typeof STRING }
    | { kind: typeof NUMBER }
    | { kind: typeof BOOLEAN }

export const STRING = Symbol("STRING");
export const NUMBER = Symbol("NUMBER");
export const BOOLEAN = Symbol("BOOLEAN");

export function canBeAssignedTo(value: Type, destination: Type): boolean {
if (destination.kind === "union-type") {
    return destination.members.some(memberType => canBeAssignedTo(value, memberType));
} else {
    // primitives
    return value.kind === destination.kind;
}
}