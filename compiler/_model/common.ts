import { AST } from "./ast.ts";
import { Statement } from "./statements.ts";
import { TypeExpression } from "./type-expressions.ts";
import { ClassDeclaration } from "./declarations.ts";
import { Expression } from "./expressions.ts";
import { withoutSourceInfo, display } from "../debugging.ts";
import { deepEquals } from "../utils.ts";

export type Identifier = { readonly id: symbol }

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

type ReadonlyMap<K extends {}, V> = Omit<Map<K, V>, 'set'|'delete'>

export type ParentsMap = ReadonlyMap<symbol, AST>
export type AllParents = Set<ParentsMap>

export type ScopesMap = ReadonlyMap<symbol, Scope>
export type AllScopes = Set<ScopesMap>

export function anyHas<K extends {}, V>(all: Set<ReadonlyMap<K, V>>, key: K): boolean {
    for (const map of all) {
        if (map.has(key)) {
            return true;
        }
    }

    return false;
}

export function anyGet<K extends {}, V>(all: Set<ReadonlyMap<K, V>>, key: K): V | undefined {
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
    readonly types: ReadonlyTieredMap<string, TypeDeclarationDescriptor>,
    readonly values: ReadonlyTieredMap<string, DeclarationDescriptor>,
    readonly classes: ReadonlyTieredMap<string, ClassDeclaration>,
    readonly refinements: readonly Refinement[],
}

export type MutableScope = {
    readonly types: TieredMap<string, TypeDeclarationDescriptor>,
    readonly values: TieredMap<string, DeclarationDescriptor>,
    readonly classes: TieredMap<string, ClassDeclaration>,
    readonly refinements: Refinement[],
}

export type TypeDeclarationDescriptor = {
    readonly isGenericParameter: boolean,
    readonly type: TypeExpression,
}

export type DeclarationDescriptor = {
    readonly mutability: "all"|"contents-only"|"none"|"absolute-none",
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
        const currentScope = anyGet(scopes, current.id)
        if (currentScope) {
            return currentScope
        } else {
            current = anyGet(parents, current.id)
        }
    }

    if (ast.kind === "local-identifier") {
        throw Error("Failed to find a Scope in which to resolve identifier '" + ast.name + "'")
    }

    return EMPTY_SCOPE
}

export class TieredMap<K, V> {

    get contents(): ReadonlyMap<K, V> {
        return this._contents
    }

    get parent(): ReadonlyTieredMap<K, V>|undefined {
        return this._parent
    }

    private readonly _contents = new Map<K, V>();

    constructor(private readonly _parent?: ReadonlyTieredMap<K, V>) {
        this._parent = _parent;
    }

    get(key: K): V|undefined {
        // deno-lint-ignore no-this-alias
        let current: ReadonlyTieredMap<K, V>|undefined = this;

        while (current) {
            if (current.contents.get(key)) {
                return current.contents.get(key)
            }

            current = current.parent
        }
    }

    set(key: K, value: V) {
        this._contents.set(key, value);
    }

    entries(): [K, V][] {
        // deno-lint-ignore no-this-alias
        let current: ReadonlyTieredMap<K, V>|undefined = this;

        const all = []
        
        while (current) {
            all.push(...current.contents.entries())
            current = current.parent
        }

        return all
    }
}

export type ReadonlyTieredMap<K, V> = Omit<TieredMap<K, V>, 'set'>

const EMPTY_SCOPE: Scope = {
    types: new TieredMap(),
    values: new TieredMap(),
    classes: new TieredMap(),
    refinements: [],
}

export type PlainIdentifier = SourceInfo & Identifier & {
    readonly kind: "plain-identifier",
    readonly name: string,
}

export type Block = SourceInfo & Identifier & {
    readonly kind: "block",
    readonly statements: readonly Statement[],
}

export const KEYWORDS = [ "func", "proc", "if", "else", "switch", "case",
//"type", 
"class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "until", "true", "false", "import", "export", "from", "as", "test",
"expr", "block" ] as const;
