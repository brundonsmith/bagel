import { path } from "../deps.ts";
import { ModuleName } from "../_model/common.ts";

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

export function memoize<A, R>(fn: (arg: A) => R): (arg: A) => R {
    if ((fn as any).memoized) {
        return fn
    }

    const results = new Map<A, R>()

    const mFn = (arg: A): R => {
        if (!results.has(arg)) {
            results.set(arg, fn(arg))
        }

        return results.get(arg) as R
    }

    mFn.memoized = true

    return mFn
}

export function memoize2<A1, A2, R>(fn: (arg1: A1, arg2: A2) => R): (arg1: A1, arg2: A2) => R {
    if ((fn as any).memoized) {
        return fn
    }

    const resultsMap = memoize((_1: A1) => new Map<A2, R>())

    const mFn = (arg1: A1, arg2: A2): R => {
        const results = resultsMap(arg1)

        if (!results.has(arg2)) {
            results.set(arg2, fn(arg1, arg2))
        }

        return results.get(arg2) as R
    }

    mFn.memoized = true

    return mFn
}

export function memoize3<A1, A2, A3, R>(fn: (arg1: A1, arg2: A2, arg3: A3) => R): (arg1: A1, arg2: A2, arg3: A3) => R {
    if ((fn as any).memoized) {
        return fn
    }

    const resultsMap = memoize2((_1: A1, _2: A2) => new Map<A3, R>())

    const mFn = (arg1: A1, arg2: A2, arg3: A3): R => {
        const results = resultsMap(arg1, arg2)

        if (!results.has(arg3)) {
            results.set(arg3, fn(arg1, arg2, arg3))
        }

        return results.get(arg3) as R
    }

    mFn.memoized = true

    return mFn
}

const NOMINAL_FLAG = Symbol('NOMINAL_FLAG')
export type NominalType<T, S extends symbol> = T & { [NOMINAL_FLAG]: S }
