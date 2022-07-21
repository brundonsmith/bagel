export function given<T, R>(val: T|undefined, fn: (val: T) => R): R|undefined {
    if (val != null) {
        return fn(val);
    } else {
        return undefined;
    }
}

export function exists<T> (val: T|null|undefined): val is T {
    return val != null
}

type BasicData =
    | {readonly [key: string]: BasicData}
    | readonly BasicData[]
    | symbol
    | string
    | number
    | boolean
    | undefined

export function deepEquals(a: BasicData, b: BasicData, ignorePropNames: readonly string[] = []): boolean {
    if (a === b) {
        // Trivially equal
        return true;
    } else if(a == null && b == null) {
        // Don't distinguish null and undefined
        return true;
    } else if (a != null && b != null && typeof a === "object" && typeof b === "object") {
        // Recurse
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) {
                return false;
            } else {
                for (let i = 0; i < a.length; i++) {
                    if (!deepEquals(a[i], b[i], ignorePropNames)) {
                        return false;
                    }
                }
                return true;
            }
        } else if(!Array.isArray(a) && !Array.isArray(b)) {
            a = a as {readonly [key: string]: BasicData}
            b = b as {readonly [key: string]: BasicData}
            
            const keysSet = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
            
            for (const key of keysSet) {
                if (!ignorePropNames.includes(key) && !deepEquals(a[key], b[key], ignorePropNames)) {
                    return false;
                }
            }
            return true;
        }
    }

    return false;
}

export function sOrNone(num: number): string {
    return num !== 1 ? 's' : '';
}
export function esOrNone(num: number): string {
    return num !== 1 ? 'es' : '';
}
export function iesOrY(num: number): string {
    return num !== 1 ? 'ies' : 'y';
}
export function wasOrWere(num: number): string {
    return num !== 1 ? 'were' : 'was';
}

export async function on<T>(iter: AsyncIterable<T>, cb: (val: T) => void) {
    for await (const val of iter) {
        cb(val)
    }
}

export async function all<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const results: T[] = [];

    for await (const val of iter) {
        results.push(val)
    }

    return results
}

const NOMINAL_FLAG = Symbol('NOMINAL_FLAG')
export type NominalType<T, S extends symbol> = T & { [NOMINAL_FLAG]: S }

export const devMode = true