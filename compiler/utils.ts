import { os, path } from "./deps.ts";
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

const NON_AST_PROPERTIES = new Set(["kind", "mutability", "module", "code", "startIndex", "endIndex"])

// very HACKy but needed!
export function* iterateParseTree(ast: AST, parent?: AST): Iterable<{ parent?: AST, current: AST }> {
    yield { parent, current: ast }

    for (const key in ast) {
        if (!NON_AST_PROPERTIES.has(key)) {
            // @ts-ignore
            const prop = ast[key] as AST|AST[]|[AST, AST][]|undefined|string|number|boolean|null

            if (typeof prop === 'object' && prop != null) {
                if (Array.isArray(prop)) {
                    for (const el of prop) {
                        if (Array.isArray(el)) {
                            for (const x of el) {
                                yield* iterateParseTree(x, ast)
                            }
                        } else {
                            yield* iterateParseTree(el, ast)
                        }
                    }
                } else {
                    yield* iterateParseTree(prop, ast)
                }
            }
        }
    }
}

export function mapParseTree(ast: AST, transform: (ast: AST) => AST): AST {
    const newAst = {...ast}

    for (const key in newAst) {
        if (!NON_AST_PROPERTIES.has(key)) {
            // @ts-ignore
            const prop = newAst[key] as AST|AST[]|[AST, AST][]|undefined|string|number|boolean|null

            if (typeof prop === 'object' && prop != null) {
                if (Array.isArray(prop)) {
                    (newAst as any)[key] = prop.map(el => 
                        Array.isArray(el)
                            ? el.map(x => mapParseTree(x, transform))
                            : mapParseTree(el, transform))
                } else {
                    (newAst as any)[key] = mapParseTree(prop, transform)
                }
            }
        }
    }

    return transform(newAst)
}

// export function* iterateParseTree(ast: AST, parent?: AST): Iterable<{ parent?: AST, current: AST }> {
//     yield { parent, current: ast }

//     switch(ast.kind) {
//         case "module": {
//             for (const declaration of ast.declarations) {
//                 yield* iterateParseTree(declaration, ast)
//             }
//         } break;
//         case "block": {
//             for(const statement of ast.statements) {
//                 yield* iterateParseTree(statement, ast)
//             }
//         } break;
//         case "type-declaration":
//         case "attribute":
//         case "arg": {
//             yield* iterateParseTree(ast.name, ast)
//             if (ast.type) {
//                 yield* iterateParseTree(ast.type, ast)
//             }
//         } break;
//         case "const-declaration":
//         case "let-declaration":
//         case "const-declaration-statement":
//         case "inline-const": {
//             yield* iterateParseTree(ast.name, ast)
//             if (ast.type) {
//                 yield* iterateParseTree(ast.type, ast)
//             }
//             yield* iterateParseTree(ast.value, ast)
//             if (ast.next) {
//                 yield* iterateParseTree(ast.next, ast)
//             }
//         } break;
//         case "store-declaration": {
//             yield* iterateParseTree(ast.name, ast)
//             for(const member of ast.members) {
//                 yield* iterateParseTree(member, ast)
//             }
//         } break;
//         case "func-declaration":
//         case "proc-declaration":
//         case "store-property":
//         case "store-function":
//         case "store-procedure": {
//             yield* iterateParseTree(ast.name, ast)
//             if (ast.kind === "store-property" && ast.type) {
//                 yield* iterateParseTree(ast.type, ast)
//             }
//             yield* iterateParseTree(ast.value, ast)
//         } break;
//         case "test-expr-declaration": {
//             yield* iterateParseTree(ast.name, ast)
//             yield* iterateParseTree(ast.expr, ast)
//         } break;
//         case "test-block-declaration": {
//             yield* iterateParseTree(ast.name, ast)
//             yield* iterateParseTree(ast.block, ast)
//         } break;
//         case "proc":
//         case "func": {
//             yield* iterateParseTree(ast.type, ast)
//             yield* iterateParseTree(ast.body, ast)
//         } break;
//         case "pipe":
//         case "invocation": {
//             yield* iterateParseTree(ast.subject, ast)

//             if (ast.kind === "invocation" && ast.typeArgs) {
//                 for (const arg of ast.typeArgs) {
//                     yield* iterateParseTree(arg, ast)
//                 }
//             }

//             for (const arg of ast.args) {
//                 yield* iterateParseTree(arg, ast)
//             }
//         } break;
//         case "binary-operator": {
//             yield* iterateParseTree(ast.base, ast)
//             for (const [op, expr] of ast.ops) {
//                 yield* iterateParseTree(op, ast)
//                 yield* iterateParseTree(expr, ast)
//             }
//         } break;
//         case "negation-operator": {
//             yield* iterateParseTree(ast.base, ast)
//         } break;
//         case "element-tag": {
//             for (const [name, value] of ast.attributes) {
//                 yield* iterateParseTree(name, ast)
//                 yield* iterateParseTree(value, ast)
//             }
//             for (const child of ast.children) {
//                 yield* iterateParseTree(child, ast)
//             }
//         } break;
//         case "indexer": {
//             yield* iterateParseTree(ast.subject, ast)
//             yield* iterateParseTree(ast.indexer, ast)
//         } break;
//         case "if-else-statement":
//         case "if-else-expression":
//         case "switch-expression": {
//             if (ast.kind === "switch-expression") {
//                 yield* iterateParseTree(ast.value, ast)
//             }
//             for (const c of ast.cases) {
//                 yield* iterateParseTree(c, ast)
//             }
//             if (ast.defaultCase != null) {
//                 yield* iterateParseTree(ast.defaultCase, ast)
//             }
//         } break;
//         case "case":
//         case "case-block": {
//             yield* iterateParseTree(ast.condition, ast)
//             yield* iterateParseTree(ast.outcome, ast)
//         } break;
//         case "parenthesized-expression":
//         case "debug":
//         case "nominal-type": {
//             yield* iterateParseTree(ast.inner, ast)
//         } break;
//         case "property-accessor": {
//             yield* iterateParseTree(ast.subject, ast)
//             yield* iterateParseTree(ast.property, ast)
//         } break;
//         case "object-literal": {
//             for (const [key, value] of ast.entries) {
//                 yield* iterateParseTree(key, ast)
//                 yield* iterateParseTree(value, ast)
//             }
//         } break;
//         case "array-literal": {
//             for (const element of ast.entries) {
//                 yield* iterateParseTree(element, ast)
//             }
//         } break;
//         case "string-literal": {
//             for (const segment of ast.segments) {
//                 if (typeof segment !== "string") {
//                     yield* iterateParseTree(segment, ast)
//                 }
//             }
//         } break;
//         case "reaction": {
//             yield* iterateParseTree(ast.data, ast)
//             yield* iterateParseTree(ast.effect, ast)
//             if (ast.until) {
//                 yield* iterateParseTree(ast.until, ast)
//             }
//         } break;
//         case "assignment": {
//             yield* iterateParseTree(ast.target, ast)
//             yield* iterateParseTree(ast.value, ast)
//         } break;
//         case "for-loop": {
//             yield* iterateParseTree(ast.itemIdentifier, ast)
//             yield* iterateParseTree(ast.iterator, ast)
//             yield* iterateParseTree(ast.body, ast)
//         } break;
//         case "while-loop": {
//             yield* iterateParseTree(ast.condition, ast)
//             yield* iterateParseTree(ast.body, ast)
//         } break;
//         case "import-declaration": {
//             yield* iterateParseTree(ast.path, ast)
//             for (const i of ast.imports) {
//                 yield* iterateParseTree(i, ast)
//             }
//         } break;
//         case "import-item": {
//             yield* iterateParseTree(ast.name)
//             if (ast.alias) {
//                 yield* iterateParseTree(ast.alias, ast)
//             }
//         } break;
//         case "union-type":
//         case "tuple-type": {
//             for (const m of ast.members) {
//                 yield* iterateParseTree(m, ast)
//             }
//         } break;
//         case "named-type": {
//             yield* iterateParseTree(ast.name, ast)
//         } break;
//         case "generic-param-type": {
//             yield* iterateParseTree(ast.name, ast)
//             if (ast.extends) {
//                 yield* iterateParseTree(ast.extends, ast)
//             }
//         } break;
//         case "proc-type":
//         case "func-type": {
//             for (const m of ast.typeParams) {
//                 yield* iterateParseTree(m, ast)
//             }
//             for (const arg of ast.args) {
//                 yield* iterateParseTree(arg.name, ast)
//                 if (arg.type) {
//                     yield* iterateParseTree(arg.type, ast)
//                 }
//             }

//             if (ast.kind === "func-type" && ast.returnType) {
//                 yield* iterateParseTree(ast.returnType, ast)
//             }
//         } break;
//         case "object-type": {
//             for (const spread of ast.spreads) {
//                 yield* iterateParseTree(spread, ast)
//             }
//             for (const attribute of ast.entries) {
//                 yield* iterateParseTree(attribute, ast)
//             }
//         } break;
//         case "indexer-type": {
//             yield* iterateParseTree(ast.keyType, ast)
//             yield* iterateParseTree(ast.valueType, ast)
//         } break;
//         case "array-type": {
//             yield* iterateParseTree(ast.element, ast)
//         } break;
//         case "literal-type": {
//             yield* iterateParseTree(ast.value, ast)
//         } break;
//         case "iterator-type": {
//             yield* iterateParseTree(ast.itemType, ast)
//         } break;
//         case "plan-type": {
//             yield* iterateParseTree(ast.resultType, ast)
//         } break;
//         case "store-type": {
//             yield* iterateParseTree(ast.store, ast)
//         } break;

//         // atomic
//         case "plain-identifier":
//         case "range":
//         case "local-identifier":
//         case "number-literal":
//         case "boolean-literal":
//         case "exact-string-literal":
//         case "nil-literal":
//         case "javascript-escape":
//         case "element-type":
//         case "string-type":
//         case "number-type":
//         case "boolean-type":
//         case "nil-type":
//         case "unknown-type":
//         case "any-type":
//         case "javascript-escape-type":
//         case "operator":
//             break;

//         default:
//             // @ts-expect-error
//             throw Error("Need to add walk clause for AST node type " + ast.kind)
//     }
// }

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
