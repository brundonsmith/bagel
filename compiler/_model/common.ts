import { AST } from "./ast.ts";
import { Statement } from "./statements.ts";
import { isTypeExpression, TypeExpression } from "./type-expressions.ts";
import { displayForm } from "../3_checking/typecheck.ts";
import { ClassDeclaration } from "./declarations.ts";
import { Expression } from "./expressions.ts";
import { ModulesStore } from "../3_checking/modules-store.ts";

export type SourceInfo = {
    readonly code: string|undefined,
    readonly startIndex: number|undefined,
    readonly endIndex: number|undefined,
    scope?: Scope,  // TODO: Make this readonly
}

export type Scope = {
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

export function getScopeFor(modulesStore: ModulesStore, ast: AST): Scope {
    let current: AST|undefined = ast

    while (current != null) {
        if (current.scope) {
            return current.scope
        } else {
            current = modulesStore.parentAst.get(current)
        }
    }

    throw Error("No scope found for:" + display(ast));
}

export function display(ast: AST): string {
    if (isTypeExpression(ast)) {
        return displayForm(ast)
    }

    const { code, startIndex, endIndex } = ast
    if (code == null || startIndex == null || endIndex == null) {
        return `<${ast.kind}>`
    } else {
        return code.substring(startIndex, endIndex)
    }
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
"triggers", "until", "true", "false", "import", "export", "from", "as" ] as const;
