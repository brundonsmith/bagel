
export function given<T, R>(val: T|undefined, fn: (val: T) => R): R|undefined {
    if (val != null) {
        return fn(val);
    } else {
        return undefined;
    }
}

export function log<T>(expr: T, fn?: (expr: T) => string): T {
    console.log(fn == null ? expr : fn(expr));
    return expr;
}


type BasicData =
    | {[key: string]: BasicData}
    | BasicData[]
    | string
    | number
    | boolean
    | undefined

export function deepEquals<T extends BasicData>(a: T, b: T): boolean {
    if (a === b) {
        return true;
    } else if (a != null && b != null 
            && typeof a === "object" && typeof b === "object" 
            && Array.isArray(a) == Array.isArray(b)) {
        // @ts-ignore
        const aEntries = Object.entries(a);
        // @ts-ignore
        const bEntries = Object.entries(b);

        return aEntries.length === bEntries.length && aEntries.every((entry, index) => 
            bEntries[index][0] === entry[0] && deepEquals(bEntries[index][1], entry[1]))
    }

    return false;
}