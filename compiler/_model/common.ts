// deno-lint-ignore-file no-fallthrough
import { AwaitStatement, DestructuringDeclarationStatement, ForLoop, ValueDeclarationStatement } from "./statements.ts";
import { TypeExpression } from "./type-expressions.ts";
import { ValueDeclaration, FuncDeclaration, ProcDeclaration, ImportAllDeclaration, RemoteDeclaration } from "./declarations.ts";
import { Expression, Func, InlineConstDeclaration, InlineDestructuringDeclaration, Proc } from "./expressions.ts";
import { BagelError } from "../errors.ts";
import { NominalType } from "../utils/misc.ts";
import { AST, PlainIdentifier } from "./ast.ts";

const MODULE_NAME = Symbol('MODULE_NAME')
export type ModuleName = NominalType<string, typeof MODULE_NAME>

export type ReportError = (error: BagelError) => void

export type Binding = ValueBinding|TypeBinding
export type ValueBinding = {
    readonly kind: 'value-binding',
    readonly owner:
        | ValueDeclaration
        | ProcDeclaration
        | FuncDeclaration
        | ValueDeclarationStatement
        | InlineConstDeclaration
        | RemoteDeclaration
        | AwaitStatement
        | ForLoop
        | Func
        | Proc
        | ImportAllDeclaration
        | InlineDestructuringDeclaration
        | DestructuringDeclarationStatement
    readonly identifier: PlainIdentifier
}

export type TypeBinding = {
    readonly kind: 'type-binding',
    readonly type: TypeExpression,
}

export function getBindingMutability(binding: ValueBinding, from: AST): "immutable"|"readonly"|"mutable"|"assignable" {
    switch (binding.owner.kind) {
        case 'value-declaration':
            return binding.owner.isConst || (binding.owner.exported === 'expose' && binding.owner.module !== from.module)
                ? 'immutable'
                : 'assignable'
        case 'func':
        case 'proc':
        case 'for-loop':
        case 'import-all-declaration':
            return 'mutable'
        case 'func-declaration':
        case 'proc-declaration':
        case 'inline-const-declaration':
        case 'remote-declaration':
        case 'await-statement':
        case 'inline-destructuring-declaration':
        case 'destructuring-declaration-statement':
            return 'immutable'
        case 'value-declaration-statement':
            return !binding.owner.isConst ? 'assignable' : 'immutable'
        default:
            // @ts-expect-error
            throw Error('Unreachable!' + binding.ast.kind)
    }
}

export type Refinement =
    | { kind: "subtraction", type: TypeExpression, targetExpression: Expression }
    | { kind: "narrowing",   type: TypeExpression, targetExpression: Expression }
