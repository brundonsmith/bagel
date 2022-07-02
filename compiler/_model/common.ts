import { ForLoop, TryCatch, DeclarationStatement } from "./statements.ts";
import { GenericParamType, TypeExpression } from "./type-expressions.ts";
import { ValueDeclaration, FuncDeclaration, ProcDeclaration, ImportAllDeclaration, RemoteDeclaration, DeriveDeclaration, TypeDeclaration, ImportItem, ALL_PLATFORMS, Platform } from "./declarations.ts";
import { Expression, Func, InlineDeclaration, Proc } from "./expressions.ts";
import { BagelError } from "../errors.ts";
import { NominalType } from "../utils/misc.ts";
import { AST, Module, PlainIdentifier } from "./ast.ts";
import { LintRuleName,LintRuleSeverity,DEFAULT_SEVERITY } from "../other/lint.ts";

const MODULE_NAME = Symbol('MODULE_NAME')
export type ModuleName = NominalType<string, typeof MODULE_NAME>

export type AllModules = Map<ModuleName, { ast: Module, noPreludeAst: Module, errors: readonly BagelError[] } | undefined>

export type ReportError = (error: BagelError) => void

export type Context = {
    allModules: AllModules,
    sendError: ReportError,
    config: BagelConfig,
    encounteredNames?: readonly string[],
    visited?: readonly AST[],
    canonicalModuleName: (importerModule: ModuleName, importPath: string) => ModuleName
}

// config
export type BagelConfig = {
    readonly platforms: readonly Platform[] | undefined,
    readonly lintRules: {readonly [key in LintRuleName]: LintRuleSeverity} | undefined
}

export const DEFAULT_CONFIG: BagelConfig = {
    platforms: [...ALL_PLATFORMS],
    lintRules: DEFAULT_SEVERITY
}

export type Binding = {
    readonly identifier: PlainIdentifier
    readonly owner:
        | ValueDeclaration
        | ProcDeclaration
        | FuncDeclaration
        | DeclarationStatement
        | DeriveDeclaration
        | RemoteDeclaration
        | ForLoop
        | Func
        | Proc
        | ImportAllDeclaration
        | ImportItem
        | InlineDeclaration
        | TypeDeclaration
        | GenericParamType
        | TryCatch
}

export function getBindingMutability(binding: Binding, from: AST): "immutable"|"readonly"|"mutable"|"assignable" {
    switch (binding.owner.kind) {
        case 'value-declaration':
            return binding.owner.isConst || (binding.owner.exported === 'expose' && binding.owner.module !== from.module)
                ? 'immutable'
                : 'assignable'
        case 'func':
        case 'proc':
        case 'for-loop':
        case 'import-all-declaration':
        case 'import-item':
            return 'mutable'
        case 'func-declaration':
        case 'proc-declaration':
        case 'derive-declaration':
        case 'remote-declaration':
        case 'inline-declaration':
        case 'type-declaration':
        case 'generic-param-type':
        case 'try-catch':
            return 'immutable'
        case 'declaration-statement':
            return !binding.owner.isConst ? 'assignable' : 'immutable'
        default:
            // @ts-expect-error: exhaustiveness
            throw Error('Unreachable!' + binding.owner.kind)
    }
}

export type Refinement =
    | { kind: "subtraction", type: TypeExpression, targetExpression: Expression }
    | { kind: "narrowing",   type: TypeExpression, targetExpression: Expression }
