// deno-lint-ignore-file no-fallthrough
import { ConstDeclarationStatement, LetDeclaration } from "./statements.ts";
import { TypeExpression } from "./type-expressions.ts";
import { ConstDeclaration, FuncDeclaration, ProcDeclaration, StoreDeclaration } from "./declarations.ts";
import { Expression, Func, InlineConst, Proc } from "./expressions.ts";
import { BagelError } from "../errors.ts";
import { NominalType } from "../utils/misc.ts";

const MODULE_NAME = Symbol('MODULE_NAME')
export type ModuleName = NominalType<string, typeof MODULE_NAME>

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
