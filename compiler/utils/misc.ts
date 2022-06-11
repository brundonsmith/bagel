import { path, fs } from "../deps.ts";
import { ModuleName } from "../_model/common.ts";
import { Platform } from "../_model/declarations.ts";

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

export const globalScratchDir = (() => {
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

    return path.resolve(baseDir, 'bagel')
})()

export const globalCacheDir = path.resolve(globalScratchDir, `bagel_modules`)
export const globalBuildDir = path.resolve(globalScratchDir, 'bagel_out')

export function cachedFilePath(module: string): string {
    return path.resolve(cacheDir, encodeURIComponent(module))
}

export function buildFilePath(module: string): string {
    return path.resolve(buildDir, pathRelativeToProject(module)) + '.ts'
}

export function pathIsInProject(module: string): boolean {
    return (!targetIsScript && isWithin(targetDir, module)) || module === target
}

export function transpileJsPath(module: string): string {
    return (
        pathIsInProject(module)
            ? module + '.ts'
            : cachedFilePath(module) + '.ts'
    )
}

export function pathRelativeToProject(module: string): string {
    return (
        pathIsInProject(module) 
            ? path.relative(targetDir, module)
            : path.relative(targetDir, cachedFilePath(module))
    )
}

export function pathIsRemote(path: string): boolean {
    return path.match(/^https?:\/\//) != null
}

export function isWithin(dir: string, other: string) {
    const relative = path.relative(dir, other)
    return !relative.startsWith('../') && relative !== '..'
}

const NOMINAL_FLAG = Symbol('NOMINAL_FLAG')
export type NominalType<T, S extends symbol> = T & { [NOMINAL_FLAG]: S }


export const POSSIBLE_COMMANDS = ['new', 'init', 'build', 'run', 'transpile', 'check', 
    'test', 'format', 'autofix', 'clean'] as const
type Command = typeof POSSIBLE_COMMANDS[number]

function parseArgs(args: readonly string[]) {
    const flags = args.filter(arg => arg.startsWith('--'))
    const nonFlags = args.filter(arg => !arg.startsWith('--'))

    return {
        command: (POSSIBLE_COMMANDS as readonly string[]).includes(nonFlags[0]) ? nonFlags[0] as Command : undefined,
        target: path.resolve(Deno.cwd(), nonFlags[1] || '.'),
        flags: {
            watch: flags.includes('--watch'),
            clean: flags.includes('--clean'),
            node: flags.includes('--node'),
            deno: flags.includes('--deno'),
            bundle: flags.includes('--bundle'),
        } as const
    }
}

export const { command, target, flags } = parseArgs(Deno.args)
const targetStat = Deno.statSync(target)
export const targetDir = targetStat.isDirectory ? target : path.dirname(target)
export const targetIsScript = targetStat.isFile
export const cacheDir = targetIsScript ? globalCacheDir : path.resolve(targetDir, 'bagel_modules')
export const buildDir = targetIsScript ? globalBuildDir : path.resolve(targetDir, 'bagel_out')
export const cliPlatforms = [
    flags.deno ? 'deno' : undefined,
    flags.node ? 'node' : undefined,
].filter(exists) as Platform[]

export const entry: ModuleName|undefined = (() => {
    const entryPath = (
        targetStat.isDirectory
            ? path.resolve(target, 'index.bgl')
            : target
    )

    if (fs.existsSync(entryPath) && path.extname(entryPath) === '.bgl') {
        return entryPath as ModuleName
    } else {
        return undefined
    }
})()
