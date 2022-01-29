import { os, path } from "../deps.ts";
import { Mode } from "../store.ts";
import { AST } from "../_model/ast.ts";
import { ModuleName } from "../_model/common.ts";

export function given<T, R>(val: T|undefined, fn: (val: T) => R): R|undefined {
    if (val != null) {
        return fn(val);
    } else {
        return undefined;
    }
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
        return true;
    } else if (typeof a === 'symbol' && typeof b === 'symbol') {
        return true;
    } else if(a == null && b == null) {
        return true;
    } else if (a != null && b != null && typeof a === "object" && typeof b === "object") {
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
    return num > 1 ? 's' : '';
}
export function esOrNone(num: number): string {
    return num > 1 ? 'es' : '';
}
export function wasOrWere(num: number): string {
    return num > 1 ? 'were' : 'was';
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

export function memoize4<A1, A2, A3, A4, R>(fn: (arg1: A1, arg2: A2, arg3: A3, arg4: A4) => R): (arg1: A1, arg2: A2, arg3: A3, arg4: A4) => R {
    if ((fn as any).memoized) {
        return fn
    }

    const resultsMap = memoize3((_1: A1, _2: A2, _3: A3) => new Map<A4, R>())

    const mFn = (arg1: A1, arg2: A2, arg3: A3, arg4: A4): R => {
        const results = resultsMap(arg1, arg2, arg3)

        if (!results.has(arg4)) {
            results.set(arg4, fn(arg1, arg2, arg3, arg4))
        }

        return results.get(arg4) as R
    }

    mFn.memoized = true

    return mFn
}

export function memoize5<A1, A2, A3, A4, A5, R>(fn: (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5) => R): (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5) => R {
    if ((fn as any).memoized) {
        return fn
    }

    const resultsMap = memoize4((_1: A1, _2: A2, _3: A3, _4: A4) => new Map<A5, R>())

    const mFn = (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5): R => {
        const results = resultsMap(arg1, arg2, arg3, arg4)

        if (!results.has(arg5)) {
            results.set(arg5, fn(arg1, arg2, arg3, arg4, arg5))
        }

        return results.get(arg5) as R
    }

    mFn.memoized = true

    return mFn
}

export const cacheDir = () => {
    let baseDir;
    switch (Deno.build.os) {
        case "darwin":
            baseDir = Deno.env.get("HOME");
            if (baseDir)
                baseDir = path.resolve(baseDir, "./Library/Caches")
            break;
        case "windows":
            baseDir = Deno.env.get("LOCALAPPDATA");
            if (!baseDir) {
                baseDir = Deno.env.get("USERPROFILE");
                if (baseDir)
                    baseDir = path.resolve(baseDir, "./AppData/Local");
            }
            if (baseDir)
                baseDir = path.resolve(baseDir, "./Cache");
            break;
        case "linux": {
            const xdg = Deno.env.get("XDG_CACHE_HOME");
            if (xdg && xdg[0] === "/")
                baseDir = xdg;
        } break;
    }

    if (!baseDir) {
        baseDir = Deno.env.get("HOME");
        if (baseDir)
            baseDir = path.resolve(baseDir, "./.cache")
    }

    if (!baseDir)
        throw new Error("Failed to find cache directory");

    const finalDir = path.resolve(baseDir, `./bagel/cache`);
    return finalDir
}

export function cachedFilePath(module: string): string {
    return path.resolve(cacheDir(), encodeURIComponent(module))
}

export function pathIsRemote(path: string): boolean {
    return path.match(/^https?:\/\//) != null
}

export function jsFileLocation(module: ModuleName, mode: Mode) {
    return pathIsRemote(module) || mode?.mode !== 'transpile'
        ? cachedFilePath(module + '.ts')
        : bagelFileToTsFile(module)
}


export function bagelFileToTsFile(module: ModuleName, isBundle?: boolean): string {
    const basename = path.basename(module)
    const filename = basename.substring(0, basename.indexOf(path.extname(basename)))

    let bundleFile = filename + '.bgl.ts'

    if (isBundle) {
        const bundleName = filename !== 'index'
            ? filename
            : path.basename(path.dirname(module))

        bundleFile = bundleName + '.bundle.bgl.js'
    }

    return path.resolve(
        path.dirname(module),
        bundleFile
    )
}

const NOMINAL_FLAG = Symbol('NOMINAL_FLAG')
export type NominalType<T, S extends symbol> = T & { [NOMINAL_FLAG]: S }
