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

export function displayAST(ast: AST): string {
    if (isTypeExpression(ast)) {
        return displayType(ast)
    }

    const { code, startIndex, endIndex } = ast
    if (code == null || startIndex == null || endIndex == null) {
        return JSON.stringify(ast)
    } else {
        return code.substring(startIndex, endIndex)
    }
}

export function displayType(typeExpression: TypeExpression): string {
    let str: string;

    switch (typeExpression.kind) {
        case "union-type": str = '(' + typeExpression.members.map(displayType).join(" | ") + ')'; break;
        case "maybe-type": str = displayType(typeExpression.inner) + '?'; break;
        case "named-type":
        case "generic-param-type": str = typeExpression.name.name; break;
        case "generic-type": str = `<${typeExpression.typeParams.map(p => p.name.name + (p.extends ? ` extends ${displayType(p.extends)}` : '')).join(',')}>${displayType(typeExpression.inner)}`; break;
        case "bound-generic-type": str = `${displayType(typeExpression.generic)}<${typeExpression.typeArgs.map(displayType).join(',')}>`; break;
        case "proc-type": str = `(${typeExpression.args.map(arg => arg.name.name + (arg.type ? `: ${displayType(arg.type)}` : '')).join(', ')}) {}`; break;
        case "func-type": str = `(${typeExpression.args.map(arg => arg.name.name + (arg.type ? `: ${displayType(arg.type)}` : '')).join(', ')}) => ${displayType(typeExpression.returnType ?? UNKNOWN_TYPE)}`; break;
        case "object-type": str = `{${typeExpression.spreads.map(s => '...' + displayType(s)).concat(typeExpression.entries.map(({ name, type }) => `${name.name}: ${displayType(type)}`)).join(', ')}}`; break;
        case "indexer-type": str = `{ [${displayType(typeExpression.keyType)}]: ${displayType(typeExpression.valueType)} }`; break;
        case "array-type": str = `${displayType(typeExpression.element)}[]`; break;
        case "tuple-type": str = `[${typeExpression.members.map(displayType).join(", ")}]`; break;
        case "string-type": str = `string`; break;
        case "number-type": str = `number`; break;
        case "boolean-type": str = `boolean`; break;
        case "nil-type": str = `nil`; break;
        case "literal-type": str = JSON.stringify(typeExpression.value.value).replaceAll('"', "'"); break;
        case "nominal-type": str = typeExpression.name.description ?? '<unnamed nominal>'; break;
        case "iterator-type": str = `Iterator<${displayType(typeExpression.inner)}>`; break;
        case "plan-type": str = `Plan<${displayType(typeExpression.inner)}>`; break;
        case "unknown-type": str = "unknown"; break;
        case "any-type": str = "any"; break;
        case "element-type": str = `Element`; break;
        case "parenthesized-type": str = `(${displayType(typeExpression.inner)})`; break;
        // case "element-type": str = `<${typeExpression.tagName}>`;
        case "javascript-escape-type": str = "<js escape>"; break;
        case "store-type": str = typeExpression.store.name.name; break;
    }

    return (typeExpression.mutability === 'immutable' || typeExpression.mutability === 'readonly' ? 'const ' : '') + str
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
