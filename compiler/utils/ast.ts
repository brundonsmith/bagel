import { AST,SourceInfo } from "../_model/ast.ts";
import { Expression } from "../_model/expressions.ts";
import { TypeExpression } from "../_model/type-expressions.ts";
import { deepEquals } from "./misc.ts";

export function areSame(a: AST|undefined, b: AST|undefined) {
    return a?.kind === b?.kind &&
        a?.module === b?.module && a?.module != null &&
        a?.code === b?.code && a?.code != null && 
        a?.startIndex === b?.startIndex && a?.startIndex != null && 
        a?.endIndex === b?.endIndex && a?.endIndex != null
}

export function within(a: AST|undefined, ancestor: AST|undefined) {
    if (a) {
        for (const node of ancestors(a)) {
            if (areSame(node, ancestor)) {
                return true
            }
        }
    }

    return false
}

export function* ancestors(a: AST) {
    for (let node: AST|undefined = a; node != null; node = node.parent) {
        yield node;
    }
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

export function expressionsEqual(a: Expression, b: Expression): boolean {
    return deepEquals(a, b, SOURCE_INFO_PROPERTIES)
}

export function typesEqual(a: TypeExpression, b: TypeExpression): boolean {
    return deepEquals(a, b, SOURCE_INFO_PROPERTIES)
}

export const SOURCE_INFO_PROPERTIES = ["parent", "module", "code", "startIndex", "endIndex"] as const
const NON_AST_PROPERTIES = new Set([...SOURCE_INFO_PROPERTIES, "kind", "mutability"])

export function* iterateParseTree(ast: AST, parent?: AST): Iterable<{ parent?: AST, current: AST }> {
    yield* iterateParseTreeInner(ast, parent)
}

// very HACKy but needed!
function* iterateParseTreeInner(treeNode: AST|AST[]|[AST, AST][]|undefined|string|number|boolean|null, parent?: AST): Iterable<{ parent?: AST, current: AST }> {
    if (Array.isArray(treeNode)) {
        for (const el of treeNode) {
            yield* iterateParseTreeInner(el, parent)
        }
    } else if (typeof treeNode === 'object' && treeNode != null) {
        const isAST = !!treeNode.kind

        if (isAST) {
            yield { parent, current: treeNode }
        }

        for (const key in treeNode) {
            if (!NON_AST_PROPERTIES.has(key)) {
                // @ts-ignore
                const prop = treeNode[key] as AST|AST[]|[AST, AST][]|undefined|string|number|boolean|null

                yield* iterateParseTreeInner(prop, isAST ? treeNode : parent)
            }
        }
    }
}

export function mapParseTree(ast: AST, transform: (ast: AST) => AST): AST {
    return mapParseTreeInner(ast, transform)
}

function mapParseTreeInner<T extends AST|AST[]|[AST, AST][]|undefined|string|number|boolean|null>(treeNode: T, transform: (ast: AST) => AST): T {
    if (Array.isArray(treeNode)) {
        return treeNode.map(el => mapParseTreeInner(el, transform)) as T
    } else if (typeof treeNode === 'object' && treeNode != null) {
        const newTreeNode = {...(treeNode as AST)}
        
        for (const key in treeNode) {
            if (!NON_AST_PROPERTIES.has(key)) {
                // @ts-ignore
                const prop = treeNode[key] as AST|AST[]|[AST, AST][]|undefined|string|number|boolean|null

                (newTreeNode as any)[key] = mapParseTreeInner(prop, transform)
            }
        }

        if (newTreeNode.kind) {
            return transform(newTreeNode as AST) as T
        } else {
            return newTreeNode
        }
    }

    return treeNode
}

export function setParents(ast: AST) {
    for (const { current, parent } of iterateParseTree(ast)) {
        (current as { parent: AST|undefined }).parent = parent
    }
}