
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
        // TODO: Make this more efficient

        // @ts-ignore
        const aEntries = Object.entries(a).filter(([key, value]) => value != null);
        // @ts-ignore
        const bEntries = Object.entries(b).filter(([key, value]) => value != null);
        
        return aEntries.length === bEntries.length && aEntries.every(entry => {
            const otherEntry = bEntries.find(other => entry[0] === other[0]);

            return otherEntry != null && deepEquals(entry[1], otherEntry[1]);
        })
    }

    return false;
}