import { memo } from "../../lib/ts/reactivity.ts";
import { resolveType } from "../3_checking/typecheck.ts";
import { inferType,propertiesOf } from "../3_checking/typeinfer.ts";
import { AST,PlainIdentifier,SourceInfo } from "../_model/ast.ts";
import { Context } from "../_model/common.ts";
import { BooleanLiteral, ElementTag, ExactStringLiteral, Expression, Invocation, LocalIdentifier, NumberLiteral, ObjectLiteral } from "../_model/expressions.ts";
import { Args, ArrayType, AST_NOISE, Attribute, ElementofType, ErrorType, FALSE_TYPE, IteratorType, LiteralType, MaybeType, PlanType, SpreadArgs, TRUE_TYPE, TupleType, TypeExpression, TYPE_AST_NOISE, UnionType } from "../_model/type-expressions.ts";
import { deepEquals } from "./misc.ts";

export function areSame(a: AST|undefined, b: AST|undefined) {
    return a?.kind === b?.kind &&
        a?.module === b?.module && a?.module != null &&
        a?.code === b?.code && a?.code != null && 
        a?.startIndex === b?.startIndex && a?.startIndex != null && 
        a?.endIndex === b?.endIndex && a?.endIndex != null
}

export function within(a: AST|undefined, ancestor: AST|undefined) {
    return findAncestor(a, other => other === ancestor) != null
}

export function findAncestor(a: AST|undefined, fn: (ast: AST) => boolean) {
    if (a) {
        for (const node of ancestors(a)) {
            if (fn(node)) {
                return node
            }
        }
    }
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

export function unionOf(members: readonly TypeExpression[], basedOn?: SourceInfo): UnionType {
    const { parent, module, code, startIndex } = basedOn ?? members[0]

    return {
        kind: 'union-type',
        members,
        mutability: undefined,
        parent, module, code, startIndex,
        endIndex: members[members.length - 1]?.endIndex
    }
}

export function tupleOf(members: TypeExpression[], mutability?: 'constant'|"readonly"|"mutable"|"literal", basedOn?: SourceInfo): TupleType {
    const { parent, module, code, startIndex } = basedOn ?? members[0] ?? {}
    const memberMutability = members.map(m => m.mutability).filter((el, index, arr) => arr.indexOf(el) === index)

    return {
        kind: 'tuple-type',
        members,
        mutability: mutability ?? (
            memberMutability.length === 0 ? "readonly" :
            memberMutability.length === 1 ? memberMutability[0] as 'constant'|"readonly"|"mutable"|"literal" :
            memberMutability.includes('constant') || memberMutability.includes('readonly') ? 'readonly' :
            'mutable'
        ),
        parent, module, code, startIndex,
        endIndex: members[members.length - 1]?.endIndex
    }
}

export function arrayOf(element: TypeExpression, mutability?: 'constant'|"readonly"|"mutable"|"literal", basedOn?: SourceInfo): ArrayType {
    const { parent, module, code, startIndex, endIndex } = basedOn ?? element

    return {
        kind: 'array-type',
        element,
        mutability: element.mutability ?? 'readonly',
        parent, module, code, startIndex, endIndex
    }
}

export function maybeOf(inner: TypeExpression, basedOn?: SourceInfo): MaybeType {
    const { parent, module, code, startIndex, endIndex } = basedOn ?? inner

    return {
        kind: 'maybe-type',
        inner,
        mutability: undefined,
        parent, module, code, startIndex, endIndex
    }
}

export function iteratorOf(inner: TypeExpression, basedOn?: SourceInfo): IteratorType {
    const { parent, module, code, startIndex, endIndex } = basedOn ?? inner

    return {
        kind: 'iterator-type',
        inner,
        mutability: undefined,
        parent, module, code, startIndex, endIndex
    }
}

export function planOf(inner: TypeExpression, basedOn?: SourceInfo): PlanType {
    const { parent, module, code, startIndex, endIndex } = basedOn ?? inner

    return {
        kind: 'plan-type',
        inner,
        mutability: undefined,
        parent, module, code, startIndex, endIndex
    }
}

export function elementOf(arrType: TypeExpression, basedOn?: SourceInfo): ElementofType {
    const { parent, module, code, startIndex, endIndex } = basedOn ?? arrType

    return {
        kind: 'elementof-type',
        inner: arrType,
        mutability: undefined,
        parent, module, code, startIndex, endIndex
    }
}

export function errorOf(inner: TypeExpression, basedOn?: SourceInfo): ErrorType {
    const { parent, module, code, startIndex, endIndex } = basedOn ?? inner

    return {
        kind: 'error-type',
        inner,
        mutability: undefined,
        parent, module, code, startIndex, endIndex
    }
}

/**
 * Convenience function for creating a simple Attribute
 */
export function attribute(name: string, type: TypeExpression, forceReadonly: boolean): Attribute {
    return {
        kind: "attribute",
        name: { kind: "plain-identifier", name, parent: type.parent, ...AST_NOISE },
        type,
        optional: false,
        forceReadonly,
        parent: type.parent,
        ...TYPE_AST_NOISE
    }
}

export const identifierToExactString = (ident: PlainIdentifier): ExactStringLiteral => ({
    kind: 'exact-string-literal',
    value: ident.name,
    module: ident.module,
    code: ident.code,
    startIndex: ident.startIndex,
    endIndex: ident.endIndex,
})

export const elementTagToObject = memo((tag: ElementTag): ObjectLiteral => {
    const { parent, module, code, startIndex, endIndex } = tag

    return {
        kind: 'object-literal',
        entries: [
            {
                kind: 'object-entry',
                key: { kind: 'plain-identifier', name: 'tag', ...AST_NOISE },
                value: {
                    kind: 'exact-string-literal',
                    value: tag.tagName.name,
                    module: tag.tagName.module,
                    code: tag.tagName.code,
                    parent: tag.tagName.parent,
                    startIndex: tag.tagName.startIndex,
                    endIndex: tag.tagName.endIndex
                },
                module: tag.tagName.module,
                code: tag.tagName.code,
                parent: tag.tagName.parent,
                startIndex: tag.tagName.startIndex,
                endIndex: tag.tagName.endIndex
            },
            {
                kind: 'object-entry',
                key: { kind: 'plain-identifier', name: 'attributes', ...AST_NOISE },
                value: {
                    kind: 'object-literal',
                    entries: tag.attributes,
                    parent, module, code,
                    startIndex: tag.attributes[0]?.startIndex,
                    endIndex: tag.attributes[tag.children.length - 1]?.endIndex
                },
                parent, module, code, startIndex, endIndex
            },
            {
                kind: 'object-entry',
                key: { kind: 'plain-identifier', name: 'children', ...AST_NOISE },
                value: {
                    kind: 'array-literal',
                    entries: tag.children,
                    parent, module, code,
                    startIndex: tag.children[0]?.startIndex,
                    endIndex: tag.children[tag.children.length - 1]?.endIndex
                },
                parent, module, code, startIndex, endIndex
            }
        ],
        parent, module, code, startIndex, endIndex
    }
})

export function argType(ctx: Pick<Context, "allModules" | "encounteredNames"|"canonicalModuleName">, args: Args | SpreadArgs, index: number): TypeExpression | undefined {
    if (args.kind === 'args') {
        return args.args[index]?.type
    } else {
        const resolved = resolveType(ctx, args.type)

        if (resolved.kind === 'tuple-type') {
            return resolved.members[index]
        } else if (resolved.kind === 'array-type') {
            return maybeOf(resolved.element)
        } else {
            return undefined
        }
    }
}

export function argsBounds(ctx: Pick<Context, "allModules" | "encounteredNames"|"canonicalModuleName">, args: Args | SpreadArgs) {
    if (args.kind === 'args') {
        return {
            min: args.args.filter(a => !a.optional).length,
            max: args.args.length
        }
    } else {
        const resolved = resolveType(ctx, args.type)

        if (resolved.kind === 'tuple-type') {
            return {
                min: resolved.members.length,
                max: resolved.members.length
            }
        }
    }
}

/**
 * Convert a.foo() to foo(a)
 */
 export function invocationFromMethodCall(ctx: Pick<Context, "allModules" | "visited" | "canonicalModuleName">, expr: Expression): Invocation|undefined {
    if (expr.kind === 'invocation' && expr.subject.kind === 'property-accessor' && expr.subject.property.kind === 'plain-identifier') {
        const fnName = expr.subject.property.name
        const subjectType = inferType(ctx, expr.subject.subject)

        if (!propertiesOf(ctx, subjectType)?.some(p => getName(p.name) === fnName)) {
            const { module, code, startIndex, endIndex } = expr.subject.property

            const inv: Invocation = {
                ...expr,
                module,
                code,
                startIndex,
                endIndex,
                subject: {
                    kind: 'local-identifier',
                    name: fnName,
                    parent: expr.parent,
                    module,
                    code,
                    startIndex,
                    endIndex
                },
                args: [
                    expr.subject.subject,
                    ...expr.args
                ]
            }

            return inv
        }
    }
}

export function literalType(value: ExactStringLiteral|NumberLiteral|BooleanLiteral|PlainIdentifier|string|number|boolean): LiteralType {
    if (typeof value === 'boolean') {
        if (value) {
            return TRUE_TYPE
        } else {
            return FALSE_TYPE
        }
    }
    
    if (typeof value === 'string' || typeof value === 'number') {
        return {
            kind: 'literal-type',
            value: {
                kind: typeof value === 'string' ? 'exact-string-literal' : 'number-literal',
                value,
                ...AST_NOISE
            } as ExactStringLiteral|NumberLiteral,
            mutability: undefined,
            ...AST_NOISE
        }
    }
    
    const { parent, module, code, startIndex, endIndex } = value

    if (value.kind === 'plain-identifier') {
        return {
            kind: 'literal-type',
            value: {
                kind: 'exact-string-literal',
                value: value.name,
                parent, module, code, startIndex, endIndex
            },
            mutability: undefined,
            parent, module, code, startIndex, endIndex
        }
    } else {
        return {
            kind: 'literal-type',
            value,
            mutability: undefined,
            parent, module, code, startIndex, endIndex
        }
    }
}

export const getName = (ast: PlainIdentifier | LocalIdentifier | ExactStringLiteral): string =>
    ast.kind === 'plain-identifier' || ast.kind === 'local-identifier'
        ? ast.name
        : ast.value