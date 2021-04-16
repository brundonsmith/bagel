
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

export function deepEquals(a: BasicData, b: BasicData): boolean {
    if (a === b) {
        return true;
    } else if(a == null && b == null) {
        return true;
    } else if (a != null && b != null && typeof a === "object" && typeof b === "object") {
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) {
                return false;
            } else {
                for (let i = 0; i < a.length; i++) {
                    if (!deepEquals(a[i], b[i])) {
                        return false;
                    }
                }
                return true;
            }
        } else if(!Array.isArray(a) && !Array.isArray(b)) {
            const keysSet = Array.from(new Set([...Object.keys(a as {}), ...Object.keys(b as {})]));

            for (const key of keysSet) {
                if (!deepEquals(a[key], b[key])) {
                    return false;
                }
            }
            return true;
        }
    }

    return false;
}