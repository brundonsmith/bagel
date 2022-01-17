// deno-lint-ignore-file no-fallthrough
import { ConstDeclarationStatement, LetDeclarationStatement } from "./statements.ts";
import { TypeExpression } from "./type-expressions.ts";
import { ValueDeclaration, FuncDeclaration, ProcDeclaration } from "./declarations.ts";
import { Expression, Func, InlineConst, Proc } from "./expressions.ts";
import { BagelError } from "../errors.ts";
import { NominalType } from "../utils/misc.ts";
import { AST } from "./ast.ts";

const MODULE_NAME = Symbol('MODULE_NAME')
export type ModuleName = NominalType<string, typeof MODULE_NAME>

export type ReportError = (error: BagelError) => void

export type Binding = ValueBinding|TypeBinding

export type ValueBinding =
    | { readonly kind: "basic", readonly ast: ValueDeclaration|ProcDeclaration|FuncDeclaration|LetDeclarationStatement|ConstDeclarationStatement|InlineConst }
    | { readonly kind: "iterator", readonly iterator: Expression }
    | { readonly kind: "arg", readonly holder: Func|Proc, readonly argIndex: number }

export type TypeBinding = {
    readonly kind: 'type-binding',
    readonly type: TypeExpression,
}

export function getBindingMutability(binding: ValueBinding, from: AST): "immutable"|"readonly"|"mutable"|"assignable" {
    switch (binding.kind) {
        case 'basic':
            switch (binding.ast.kind) {
                case 'value-declaration':
                    return binding.ast.isConst || (binding.ast.exported === 'expose' && binding.ast.module !== from.module)
                        ? 'immutable' 
                        : 'assignable'
                case 'const-declaration-statement':
                case 'func-declaration':
                case 'proc-declaration':
                case 'inline-const':
                    return 'immutable'
                case 'let-declaration-statement':
                    return 'assignable'
                default:
                    // @ts-expect-error
                    throw Error('Unreachable!' + binding.ast.kind)
            }
        case 'arg':
        case 'iterator':
            return 'mutable'
        default:
            // @ts-expect-error
            throw Error('Unreachable!' + binding.kind)
    }
}

export type Refinement =
    | { kind: "subtraction", type: TypeExpression, targetExpression: Expression }
    | { kind: "narrowing",   type: TypeExpression, targetExpression: Expression }
