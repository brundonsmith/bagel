import { AST,SourceInfo } from "../_model/ast.ts";
import { isTypeExpression, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals } from "./misc.ts";

export function areSame(a: AST|undefined, b: AST|undefined) {
    return a?.kind === b?.kind &&
        a?.module === b?.module && a?.module != null &&
        a?.code === b?.code && a?.code != null && 
        a?.startIndex === b?.startIndex && a?.startIndex != null && 
        a?.endIndex === b?.endIndex && a?.endIndex != null
}

export function moreSpecificThan(a: Partial<SourceInfo>, b: Partial<SourceInfo>): boolean {
    const missingInA = a.code == null
    const missingInB = b.code == null

    if (!missingInA && missingInB) {
        return true
    } else if (missingInA && !missingInB) {
        return false
    } else if (missingInA && missingInB) {
        return false
    } else if ((a.startIndex as number) === (b.startIndex as number) && (a.endIndex as number) === (b.endIndex as number)) {
        return false
    }

    return (a.startIndex as number) >= (b.startIndex as number) && (a.endIndex as number) <= (b.endIndex as number)
}

export function typesEqual(a: TypeExpression, b: TypeExpression): boolean {
    return deepEquals(a, b, ["module", "code", "startIndex", "endIndex"])
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
