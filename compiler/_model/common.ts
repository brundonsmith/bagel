// deno-lint-ignore-file no-fallthrough
import { AST, Module } from "./ast.ts";
import { ConstDeclarationStatement, LetDeclaration, Statement } from "./statements.ts";
import { GenericParamType, NamedType, TypeExpression } from "./type-expressions.ts";
import { ConstDeclaration, FuncDeclaration, ProcDeclaration, StoreDeclaration } from "./declarations.ts";
import { Expression, Func, InlineConst, LocalIdentifier, Proc } from "./expressions.ts";
import { withoutSourceInfo, display } from "../debugging.ts";
import { deepEquals, ModuleName } from "../utils.ts";
import { BagelError } from "../errors.ts";

export type SourceInfo = {
    readonly module: ModuleName|undefined,
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

// HACK
export function areSame(a: AST|undefined, b: AST|undefined) {
    return a?.kind === b?.kind &&
        a?.module === b?.module && a?.module != null &&
        a?.code === b?.code && a?.code != null && 
        a?.startIndex === b?.startIndex && a?.startIndex != null && 
        a?.endIndex === b?.endIndex && a?.endIndex != null
}

export type GetModule = (module: string) => Module|undefined
export type GetParent = (ast: AST) => AST|undefined
export type GetBinding = (reportError: ReportError, identifier: LocalIdentifier|PlainIdentifier|NamedType|GenericParamType) => Binding|undefined
export type ReportError = (error: BagelError) => void

export type Binding = ValueBinding|TypeBinding

export type ValueBinding =
    | { readonly kind: "basic", readonly ast: ConstDeclaration|ProcDeclaration|FuncDeclaration|LetDeclaration|ConstDeclarationStatement|InlineConst|StoreDeclaration }
    | { readonly kind: "iterator", readonly iterator: Expression }
    | { readonly kind: "arg", readonly holder: Func|Proc, readonly argIndex: number }
    | { readonly kind: "this", readonly store: StoreDeclaration }

export type TypeBinding = {
    readonly kind: 'type-binding',
    readonly type: TypeExpression,
}


export function getBindingMutability(binding: ValueBinding): "immutable"|"readonly"|"mutable"|"assignable" {
    switch (binding.kind) {
        case 'basic':
            switch (binding.ast.kind) {
                case 'const-declaration':
                case 'const-declaration-statement':
                case 'func-declaration':
                case 'proc-declaration':
                case 'inline-const':
                    return 'immutable'
                case 'let-declaration':
                    return 'assignable'
                case 'store-declaration':
                    return 'mutable'
                default:
                    // @ts-expect-error
                    throw Error('Unreachable!' + binding.ast.kind)
            }
        case 'arg':
        case 'iterator':
        case 'this':
            return 'mutable'
        default:
            // @ts-expect-error
            throw Error('Unreachable!' + binding.kind)
    }
}

export type Refinement =
    | { kind: "subtraction", type: TypeExpression, targetExpression: Expression }
    | { kind: "narrowing",   type: TypeExpression, targetExpression: Expression }

export function equivalent(a: Expression, b: Expression): boolean {
    return deepEquals(withoutSourceInfo(a), withoutSourceInfo(b))
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
//"type", 
"class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "until", "true", "false", "import", "export", "from", "as", "test",
"expr", "block" ] as const;
