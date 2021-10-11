import { AST } from "./ast.ts";
import { Statement } from "./statements.ts";
import { TypeExpression } from "./type-expressions.ts";
import { ClassDeclaration } from "./declarations.ts";
import { Expression } from "./expressions.ts";
import { display } from "../debugging.ts";

export type SourceInfo = {
    readonly code: string|undefined,
    readonly startIndex: number|undefined,
    readonly endIndex: number|undefined,
}

export type ParentsMap = Omit<WeakMap<AST, AST>, 'set'|'delete'>

export type ScopesMap = Omit<WeakMap<AST, Scope>, 'set'|'delete'>

export type Scope = {
    readonly types: {readonly [key: string]: TypeDeclarationDescriptor},
    readonly values: {readonly [key: string]: DeclarationDescriptor},
    readonly classes: {readonly [key: string]: ClassDeclaration},
}

export type MutableScope = {
    readonly types: {[key: string]: TypeDeclarationDescriptor},
    readonly values: {[key: string]: DeclarationDescriptor},
    readonly classes: {[key: string]: ClassDeclaration},
}

export type TypeDeclarationDescriptor = {
    readonly isGenericParameter: boolean,
    readonly type: TypeExpression,
}

export type DeclarationDescriptor = {
    readonly mutability: "all"|"properties-only"|"none",
    readonly declaredType?: TypeExpression,
    readonly initialValue?: Expression,
}

export function getScopeFor(parentsMap: ParentsMap, scopesMap: ScopesMap, ast: AST): Scope {
    let current: AST|undefined = ast

    while (current != null) {
        const currentScope = scopesMap.get(current)
        if (currentScope) {
            return currentScope
        } else {
            current = parentsMap.get(current)
        }
    }

    throw Error("No scope found for: " + display(ast));
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
"type", "typeof", "class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "until", "true", "false", "import", "export", "from", "as", "test",
"expr", "block" ] as const;
