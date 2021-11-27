import { os, path } from "./deps.ts";
import { createTransformer } from "./mobx.ts";
import { AST } from "./_model/ast.ts";

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

export function deepEquals(a: BasicData, b: BasicData, ignorePropNames: string[] = []): boolean {
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

export function walkParseTree<T>(payload: T, ast: AST, fn: (payload: T, ast: AST) => T): void {
    const nextPayload = fn(payload, ast);
    
    switch(ast.kind) {
        case "module": {
            for (const declaration of ast.declarations) {
                walkParseTree(nextPayload, declaration, fn);
            }
        } break;
        case "block": {
            for(const statement of ast.statements) {
                walkParseTree(nextPayload, statement, fn);
            }
        } break;
        case "type-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.type, fn);
        } break;
        case "func-declaration":
        case "proc-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "const-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            if (ast.type) {
                walkParseTree(nextPayload, ast.type, fn);
            }
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "class-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            for(const member of ast.members) {
                walkParseTree(nextPayload, member, fn);
            }
        } break;
        case "class-property":
        case "class-function":
        case "class-procedure": {
            walkParseTree(nextPayload, ast.name, fn);
            if (ast.kind === "class-property" && ast.type) {
                walkParseTree(nextPayload, ast.type, fn);
            }
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "test-expr-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.expr, fn);
        } break;
        case "test-block-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.block, fn);
        } break;
        case "proc":
        case "func": {
            walkParseTree(nextPayload, ast.type, fn);

            if (ast.kind === "func") {
                for (const c of ast.consts) {
                    walkParseTree(nextPayload, c, fn);
                }
            }
            
            walkParseTree(nextPayload, ast.body, fn);
        } break;
        case "inline-const":
            walkParseTree(nextPayload, ast.name, fn);
            if (ast.type) {
                walkParseTree(nextPayload, ast.type, fn);
            }
            walkParseTree(nextPayload, ast.value, fn);
            break;
        case "pipe":
        case "invocation": {
            walkParseTree(nextPayload, ast.subject, fn);

            if (ast.kind === "invocation" && ast.typeArgs) {
                for (const arg of ast.typeArgs) {
                    walkParseTree(nextPayload, arg, fn);
                }
            }

            for (const arg of ast.args) {
                walkParseTree(nextPayload, arg, fn);
            }
        } break;
        case "binary-operator": {
            walkParseTree(nextPayload, ast.base, fn);
            for (const [op, expr] of ast.ops) {
                walkParseTree(nextPayload, op, fn)
                walkParseTree(nextPayload, expr, fn)
            }
        } break;
        case "negation-operator": {
            walkParseTree(nextPayload, ast.base, fn)
        } break;
        case "element-tag": {
            for (const [name, value] of ast.attributes) {
                walkParseTree(nextPayload, name, fn);
                walkParseTree(nextPayload, value, fn);
            }
            for (const child of ast.children) {
                walkParseTree(nextPayload, child, fn);
            }
        } break;
        case "class-construction": {
            walkParseTree(nextPayload, ast.clazz, fn);
        } break;
        case "indexer": {
            walkParseTree(nextPayload, ast.subject, fn);
            walkParseTree(nextPayload, ast.indexer, fn);
        } break;
        case "if-else-statement": {
            for (const { condition, outcome } of ast.cases) {
                walkParseTree(nextPayload, condition, fn);
                walkParseTree(nextPayload, outcome, fn);
            }
            if (ast.defaultCase != null) {
                walkParseTree(nextPayload, ast.defaultCase, fn);
            }

        } break;
        case "if-else-expression":
        case "switch-expression": {
            if (ast.kind === "switch-expression") {
                walkParseTree(nextPayload, ast.value, fn);
            }
            for (const c of ast.cases) {
                walkParseTree(nextPayload, c, fn);
            }
            if (ast.defaultCase != null) {
                walkParseTree(nextPayload, ast.defaultCase, fn);
            }
        } break;
        case "case": {
            walkParseTree(nextPayload, ast.condition, fn);
            walkParseTree(nextPayload, ast.outcome, fn);
        } break;
        case "parenthesized-expression":
        case "debug": {
            walkParseTree(nextPayload, ast.inner, fn);
        } break;
        case "property-accessor": {
            walkParseTree(nextPayload, ast.subject, fn);
            walkParseTree(nextPayload, ast.property, fn);
        } break;
        case "object-literal": {
            for (const [key, value] of ast.entries) {
                walkParseTree(nextPayload, key, fn);
                walkParseTree(nextPayload, value, fn);
            }
        } break;
        case "array-literal": {
            for (const element of ast.entries) {
                walkParseTree(nextPayload, element, fn);
            }
        } break;
        case "string-literal": {
            for (const segment of ast.segments) {
                if (typeof segment !== "string") {
                    walkParseTree(nextPayload, segment, fn);
                }
            }
        } break;

        case "reaction": {
            walkParseTree(nextPayload, ast.data, fn);
            walkParseTree(nextPayload, ast.effect, fn);
            if (ast.until) {
                walkParseTree(nextPayload, ast.until, fn);
            }
        } break;
        case "let-declaration":
        case "const-declaration-statement": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "assignment": {
            walkParseTree(nextPayload, ast.target, fn);
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "for-loop": {
            walkParseTree(nextPayload, ast.itemIdentifier, fn);
            walkParseTree(nextPayload, ast.iterator, fn);
            walkParseTree(nextPayload, ast.body, fn);
        } break;
        case "while-loop": {
            walkParseTree(nextPayload, ast.condition, fn);
            walkParseTree(nextPayload, ast.body, fn);
        } break;
        case "import-declaration": {
            walkParseTree(nextPayload, ast.path, fn);
            for (const i of ast.imports) {
                walkParseTree(nextPayload, i.name, fn);
                if (i.alias) {
                    walkParseTree(nextPayload, i.alias, fn);
                }
            }
        } break;

        // types
        case "union-type": {
            for (const m of ast.members) {
                walkParseTree(nextPayload, m, fn);
            }
        } break;
        case "named-type": {
            walkParseTree(nextPayload, ast.name, fn);
        } break;
        case "proc-type":
        case "func-type": {
            for (const m of ast.typeParams) {
                walkParseTree(nextPayload, m, fn);
            }
            for (const arg of ast.args) {
                walkParseTree(nextPayload, arg.name, fn);
                if (arg.type) {
                    walkParseTree(nextPayload, arg.type, fn);
                }
            }

            if (ast.kind === "func-type" && ast.returnType) {
                walkParseTree(nextPayload, ast.returnType, fn);
            }
        } break;
        case "object-type": {
            for (const spread of ast.spreads) {
                walkParseTree(nextPayload, spread, fn)
            }
            for (const attribute of ast.entries) {
                walkParseTree(nextPayload, attribute, fn)
            }
        } break;
        case "attribute": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.type, fn);
        } break;
        case "indexer-type": {
            walkParseTree(nextPayload, ast.keyType, fn);
            walkParseTree(nextPayload, ast.valueType, fn);
        } break;
        case "array-type": {
            walkParseTree(nextPayload, ast.element, fn);
        } break;
        case "tuple-type": {
            for (const m of ast.members) {
                walkParseTree(nextPayload, m, fn);
            }
        } break;
        case "literal-type": {
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "nominal-type": {
            walkParseTree(nextPayload, ast.inner, fn);
        } break;
        case "iterator-type": {
            walkParseTree(nextPayload, ast.itemType, fn);
        } break;
        case "plan-type": {
            walkParseTree(nextPayload, ast.resultType, fn);
        } break;
        case "class-instance-type": {
            walkParseTree(nextPayload, ast.clazz, fn);
        } break;

        // atomic
        case "plain-identifier":
        case "range":
        case "local-identifier":
        case "number-literal":
        case "boolean-literal":
        case "exact-string-literal":
        case "nil-literal":
        case "javascript-escape":
        case "element-type":
        case "string-type":
        case "number-type":
        case "boolean-type":
        case "nil-type":
        case "unknown-type":
        case "any-type":
        case "javascript-escape-type":
        case "operator":
            break;

        default:
            // @ts-expect-error
            throw Error("Need to add walk clause for AST node type " + ast.kind)
    }
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

    const mFn =  (arg: A): R => {
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

export const transformify1: <F extends (a1: any) => unknown>(fn: F) => F = createTransformer as any

export function transformify2<F extends (a1: any, a2: any) => unknown>(fn: F): F {
    const transformed = createTransformer(a1 => createTransformer(a2 => fn(a1, a2)))
    return ((a1: any, a2: any) => transformed(a1)(a2)) as any
}
export const cacheDir = () => {
    const tempDir = os.tempDir()
        ?? (os.platform() === "darwin" || os.platform() === "linux" ? "/tmp" : undefined)
    
    if (tempDir == null) {
        throw Error("Unable to determine temporary directory")
    }
    
    return path.resolve(tempDir, 'bagel', 'cache')
}

export function cachedModulePath(module: ModuleName): string {
    return path.resolve(cacheDir(), encodeURIComponent(module))
}

export function pathIsRemote(path: string): boolean {
    return path.match(/^https?:\/\//) != null
}

const NOMINAL_FLAG = Symbol('NOMINAL_FLAG')
export type NominalType<T, S extends symbol> = T & { [NOMINAL_FLAG]: S }


const MODULE_NAME = Symbol('MODULE_NAME')
export type ModuleName = NominalType<string, typeof MODULE_NAME>
