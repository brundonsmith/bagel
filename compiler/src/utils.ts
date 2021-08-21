import { AST } from "./_model/ast";

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

export type DeepReadonly<T extends BasicData> = T
    // T extends {[key: string]: BasicData} ? Readonly<{[key in keyof T]: DeepReadonly<T[key]>}> :
    // T extends BasicData[] ? Readonly<DeepReadonly<T[number]>[]> :
    // T

export function deepEquals(a: DeepReadonly<BasicData>, b: DeepReadonly<BasicData>, ignorePropNames: string[] = []): boolean {
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
            const keysSet = Array.from(new Set([...Object.keys(a as {}), ...Object.keys(b as {})]));
            
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

export function withoutSourceInfo(ast: AST) {
    const clone = JSON.parse(JSON.stringify(ast))

    walkParseTree(undefined, clone, (_, ast) => {
        // @ts-ignore
        delete ast.code
        // @ts-ignore
        delete ast.startIndex
        // @ts-ignore
        delete ast.endIndex

        return undefined
    })

    return clone
}

export function walkParseTree<T>(payload: T, ast: AST, fn: (payload: T, ast: AST) => T) {
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
        case "func-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.func, fn);
        } break;
        case "proc-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.proc, fn);
        } break;
        case "const-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "class-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            for(const member of ast.members) {
                walkParseTree(nextPayload, member, fn);
            }
        } break;
        case "class-property": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "class-function": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.func, fn);
        } break;
        case "class-procedure": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.proc, fn);
        } break;
        case "proc": {
            for (const argName of ast.argNames) {
                walkParseTree(nextPayload, argName, fn);
            }
            walkParseTree(nextPayload, ast.body, fn);
        } break;
        case "func": {
            for (const argName of ast.argNames) {
                walkParseTree(nextPayload, argName, fn);
            }
            walkParseTree(nextPayload, ast.body, fn);
        } break;
        case "pipe": {
            for (const stage of ast.expressions) {
                walkParseTree(nextPayload, stage, fn);
            }
        } break;
        case "binary-operator": {
            walkParseTree(nextPayload, ast.left, fn);
            walkParseTree(nextPayload, ast.right, fn);
        } break;
        case "funcall": {
            walkParseTree(nextPayload, ast.func, fn);
            for (const arg of ast.args) {
                walkParseTree(nextPayload, arg, fn);
            }
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
            walkParseTree(nextPayload, ast.base, fn);
            walkParseTree(nextPayload, ast.indexer, fn);
        } break;
        case "if-else-expression": {
            walkParseTree(nextPayload, ast.ifCondition, fn);
            walkParseTree(nextPayload, ast.ifResult, fn);
            if (ast.elseResult != null) {
                walkParseTree(nextPayload, ast.elseResult, fn);
            }
        } break;
        case "parenthesized-expression": {
            walkParseTree(nextPayload, ast.inner, fn);
        } break;
        case "property-accessor": {
            walkParseTree(nextPayload, ast.base, fn);
            for (const property of ast.properties) {
                walkParseTree(nextPayload, property, fn);
            }
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

        // not expressions, but should have their contents checked
        case "reaction": {
            walkParseTree(nextPayload, ast.data, fn);
            walkParseTree(nextPayload, ast.effect, fn);
            walkParseTree(nextPayload, ast.until, fn);
        } break;
        case "computation": {
            walkParseTree(nextPayload, ast.expression, fn);
        } break;
        case "let-declaration": {
            walkParseTree(nextPayload, ast.name, fn);
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "assignment": {
            walkParseTree(nextPayload, ast.target, fn);
            walkParseTree(nextPayload, ast.value, fn);
        } break;
        case "proc-call": {
            walkParseTree(nextPayload, ast.proc, fn);
            for (const arg of ast.args) {
                walkParseTree(nextPayload, arg, fn);
            }
        } break;
        case "if-else-statement": {
            walkParseTree(nextPayload, ast.ifCondition, fn);
            walkParseTree(nextPayload, ast.ifResult, fn);
            if (ast.elseResult != null) {
                walkParseTree(nextPayload, ast.elseResult, fn);
            }
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

        // atomic
        case "type-declaration":
        case "plain-identifier":
        case "range":
        case "local-identifier":
        case "number-literal":
        case "boolean-literal":
        case "nil-literal":
            break;

        default:
            throw Error("Need to add walk clause for AST node type " + ast.kind)
    }
}

export function sOrNone(num: number): string {
    return num > 1 ? 's' : '';
}
export function wasOrWere(num: number): string {
    return num > 1 ? 'were' : 'was';
}