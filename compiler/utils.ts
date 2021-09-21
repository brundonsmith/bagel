import { BagelSyntaxError, getLineContents, lineAndColumn } from "./1_parse/common.ts";
import { BagelTypeError,errorMessage } from "./3_checking/typecheck.ts";
import { Colors } from "./deps.ts";
import { AST } from "./_model/ast.ts";

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
        case "proc":
        case "func": {
            walkParseTree(nextPayload, ast.type, fn);
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
        case "invocation": {
            walkParseTree(nextPayload, ast.subject, fn);
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

        case "reaction": {
            walkParseTree(nextPayload, ast.data, fn);
            walkParseTree(nextPayload, ast.effect, fn);
            if (ast.until) {
            walkParseTree(nextPayload, ast.until, fn);
            }
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

        // types
        case "union-type": {
            for (const m of ast.members) {
                walkParseTree(nextPayload, m, fn);
            }
        } break;
        case "named-type": {
            walkParseTree(nextPayload, ast.name, fn);
        } break;
        case "proc-type": {
            for (const m of ast.typeParams) {
                walkParseTree(nextPayload, m, fn);
            }
            for (const arg of ast.args) {
                walkParseTree(nextPayload, arg.name, fn);
                walkParseTree(nextPayload, arg.type, fn);
            }
        } break;
        case "func-type": {
            for (const m of ast.typeParams) {
                walkParseTree(nextPayload, m, fn);
            }
            for (const arg of ast.args) {
                walkParseTree(nextPayload, arg.name, fn);
                walkParseTree(nextPayload, arg.type, fn);
            }
            walkParseTree(nextPayload, ast.returnType, fn);
        } break;
        case "object-type": {
            for (const [k, v] of ast.entries) {
                walkParseTree(nextPayload, k, fn);
                walkParseTree(nextPayload, v, fn);
            }
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
        case "promise-type": {
            walkParseTree(nextPayload, ast.resultType, fn);
        } break;

        // atomic
        case "type-declaration":
        case "plain-identifier":
        case "range":
        case "local-identifier":
        case "number-literal":
        case "boolean-literal":
        case "nil-literal":
        case "javascript-escape":
        case "element-type":
        case "string-type":
        case "number-type":
        case "boolean-type":
        case "nil-type":
        case "unknown-type":
        case "javascript-escape-type":
            break;

        default:
            // @ts-expect-error
            throw Error("Need to add walk clause for AST node type " + ast.kind)
    }
}

export function sOrNone(num: number): string {
    return num > 1 ? 's' : '';
}
export function wasOrWere(num: number): string {
    return num > 1 ? 'were' : 'was';
}

export const printError = (modulePath: string) => (error: BagelTypeError|BagelSyntaxError) => {
    const code = error.kind === 'bagel-syntax-error' ? error.code : error.ast?.kind !== "module" ? error.ast?.code : undefined
    const startIndex = error.kind === 'bagel-syntax-error' ? error.index : error.ast?.kind !== "module" ? error.ast?.startIndex : undefined
    const endIndex = error.kind === 'bagel-syntax-error' ? undefined : error.ast?.kind !== "module" ? error.ast?.endIndex : undefined

    let infoLine = Colors.cyan(modulePath)
    
    const { line, column } = 
        given(code, code => 
        given(startIndex, startIndex => 
            lineAndColumn(code, startIndex))) ?? {}
    if (line != null && column != null) {
        infoLine += Colors.white(":") 
            + Colors.yellow(String(line)) 
            + Colors.white(":") 
            + Colors.yellow(String(column))
    }
    
    infoLine += Colors.white(" - ")
        + Colors.red("error")
        + Colors.white(" " + (error.kind === "bagel-syntax-error" ? error.message : errorMessage(error)))

    console.log(infoLine)

    // print the problematic line of code, with the issue underlined
    if (code != null && startIndex != null && line != null) {
        const lineContent = getLineContents(code, line);

        if (lineContent) {
            const padding = '  '

            console.log(Colors.bgWhite(Colors.black(String(line))) + padding + lineContent.content)

                const digitsInLineNum = String(line).length
                const underlineSpacing = padding + new Array(digitsInLineNum + startIndex - lineContent.startIndex).fill(' ').join('')

            if (endIndex != null) {
                const underline = new Array(endIndex - startIndex).fill('~').join('')
                console.log(Colors.red(underlineSpacing + underline))
            } else {
                console.log(Colors.red(underlineSpacing + Colors.red("^")))
            }
        }
    }

    console.log()
}
