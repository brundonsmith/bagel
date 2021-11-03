import { AST } from "./ast.ts";
import { Statement } from "./statements.ts";
import { TypeExpression } from "./type-expressions.ts";
import { ClassDeclaration } from "./declarations.ts";
import { Expression } from "./expressions.ts";
import { withoutSourceInfo, display } from "../debugging.ts";
import { deepEquals } from "../utils.ts";

export type SourceInfo = {
    readonly code: string|undefined,
    readonly startIndex: number|undefined,
    readonly endIndex: number|undefined,
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

type ReadonlyWeakMap<K extends {}, V> = Omit<WeakMap<K, V>, 'set'|'delete'>

export type ParentsMap = ReadonlyWeakMap<AST, AST>
export type AllParents = Set<ParentsMap>

export type ScopesMap = ReadonlyWeakMap<AST, Scope>
export type AllScopes = Set<ScopesMap>

export function anyHas<K extends {}, V>(all: Set<ReadonlyWeakMap<K, V>>, key: K): boolean {
    for (const map of all) {
        if (map.has(key)) {
            return true;
        }
    }

    return false;
}

export function anyGet<K extends {}, V>(all: Set<ReadonlyWeakMap<K, V>>, key: K): V | undefined {
    for (const map of all) {
        if (map.has(key)) {
            return map.get(key);
        }
    }

    return undefined;
}

export function and<T>(all: Set<T>, addition: T): Set<T> {
    const m = new Set(all);
    m.add(addition);
    return m;
}

export type Scope = {
    readonly types: {readonly [key: string]: TypeDeclarationDescriptor},
    readonly values: {readonly [key: string]: DeclarationDescriptor},
    readonly classes: {readonly [key: string]: ClassDeclaration},
    readonly refinements: readonly Refinement[],
}

export type MutableScope = {
    readonly types: {[key: string]: TypeDeclarationDescriptor},
    readonly values: {[key: string]: DeclarationDescriptor},
    readonly classes: {[key: string]: ClassDeclaration},
    readonly refinements: Refinement[],
}

export type TypeDeclarationDescriptor = {
    readonly isGenericParameter: boolean,
    readonly type: TypeExpression,
}

export type DeclarationDescriptor = {
    readonly mutability: "all"|"contents-only"|"none",
    readonly declaredType?: TypeExpression,
    readonly initialValue?: Expression,
}

export type Refinement =
    | { kind: "subtraction", type: TypeExpression, targetExpression: Expression }
    | { kind: "narrowing",   type: TypeExpression, targetExpression: Expression }

export function equivalent(a: Expression, b: Expression): boolean {
    return deepEquals(withoutSourceInfo(a), withoutSourceInfo(b))
}

export function getScopeFor(parents: AllParents, scopes: AllScopes, ast: AST): Scope {
    let current: AST|undefined = ast

    while (current != null) {
        const currentScope = anyGet(scopes, current)
        if (currentScope) {
            return currentScope
        } else {
            current = anyGet(parents, current)
        }
    }

    if (ast.kind === "local-identifier") {
        throw Error("Failed to find a Scope in which to resolve identifier '" + ast.name + "'")
    }

    return EMPTY_SCOPE
}

const EMPTY_SCOPE: Scope = {
    types: {},
    values: {},
    classes: {},
    refinements: [],
}

export type PlainIdentifier = SourceInfo & {
    readonly kind: "plain-identifier",
    readonly name: string,
}

export type Block = SourceInfo & {
    readonly kind: "block",
    readonly statements: readonly Statement[],
}

export const KEYWORDS = [ "func", "proc", "if", "else", "switch", "case",
"type", "class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "until", "true", "false", "import", "export", "from", "as", "test",
"expr", "block" ] as const;
