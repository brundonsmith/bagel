import { parsed } from "../1_parse/index.ts";
import { computedFn } from "../mobx.ts";
import { _Store } from "../store.ts";
import { iterateParseTree, mapParseTree } from "../utils/ast.ts";
import { AST } from "../_model/ast.ts";
import { ModuleName } from "../_model/common.ts";
import { FuncDeclaration, ProcDeclaration, ValueDeclaration } from "../_model/declarations.ts";
import { Func, Proc } from "../_model/expressions.ts";
import { format,DEFAULT_OPTIONS } from "./format.ts";

export function lint(ast: AST): LintProblem[] {
    const problems: LintProblem[] = []
    const rules = Object.entries(RULES) as [RuleName, LintRule][]

    for (const { current } of iterateParseTree(ast)) {
        for (const [name, rule] of rules) {
            const problemNode = rule.match(current)

            if (problemNode) {
                problems.push({
                    kind: 'lint-problem',
                    rule,
                    ast: problemNode,
                    severity: DEFAULT_SEVERITY[name]
                })
            }
        }
    }

    return problems
}

export const autofixed = computedFn((store: _Store, moduleName: ModuleName): string => {
    const ast = parsed(store, moduleName, false)?.ast

    if (!ast) {
        return ''
    }
    
    return (
        format(
            autofix(ast),
            DEFAULT_OPTIONS
        )
    )
})

export function autofix(ast: AST): AST {
    const rules = Object.values(RULES)

    return mapParseTree(ast, ast => {
        let transformed = ast

        for (const rule of rules) {
            if (rule.autofix) {
                transformed = rule.autofix(transformed)
            }
        }

        return transformed
    })
}

type LintRule = {
    readonly message: (ast: AST) => string,
    readonly match: (ast: AST) => AST|undefined,
    readonly autofix?: (ast: AST) => AST,
}

type Severity = 'error'|'warning'|'info'|'off'

export type LintProblem = {
    readonly kind: 'lint-problem',
    readonly rule: LintRule,
    readonly ast: AST,
    readonly severity: Severity,
}

const RULES = {
    'unnecessary-parens': {
        message: () => "Parenthesis aren't needed around this expression",
        match: (ast: AST) => {
            if ((ast.kind === 'case' || ast.kind === 'case-block') && ast.condition.kind === 'parenthesized-expression') {
                return ast.condition
            }
        },
        autofix: (ast: AST) => {
            if ((ast.kind === 'case' || ast.kind === 'case-block') && ast.condition.kind === 'parenthesized-expression') {
                return {
                    ...ast,
                    condition: ast.condition.inner
                }
            }

            return ast
        }
    },
    'func-or-proc-as-value': {
        message: (ast: AST) => {
            const decl = ast as ValueDeclaration
            const val = decl.value as Proc|Func

            return `Top-level const ${val.kind === 'func' ? 'functions' : 'procedures'} should be ${val.kind} declarations, not ${decl.isConst ? 'const' : 'let'} declarations`
        },
        match: (ast: AST) => {
            if (ast.kind === 'value-declaration' && ast.isConst && (ast.value.kind === 'proc' || ast.value.kind === 'func')) {
                return ast
            }
        },
        autofix: (ast: AST) => {
            if (ast.kind === 'value-declaration' && ast.isConst && (ast.value.kind === 'proc' || ast.value.kind === 'func')) {
                const {kind, name, type, value, isConst, exported, ...rest} = ast

                if (value.kind === 'func') {
                    const f: FuncDeclaration = {
                        kind: 'func-declaration',
                        memo: false,
                        exported: exported != null,
                        name,
                        value,
                        ...rest,
                    }

                    return f
                } else {
                    const p: ProcDeclaration = {
                        kind: 'proc-declaration',
                        action: false,
                        exported: exported != null,
                        name,
                        value,
                        ...rest,
                    }

                    return p
                }
            }

            return ast
        }
    },
    // 'unnecessary-nil-coalescing': {
    //     message: "Nil-coalescing operator is redundant because the left operand will never be nil",
    //     match: (ast: AST) => {
    //         if (ast.kind === 'binary-operator') {

    //         }

    //         return ast
    //     }
    // }
} as const
const _rules: {[name: string]: LintRule} = RULES

type RuleName = keyof typeof RULES

const DEFAULT_SEVERITY: { readonly [rule in RuleName]: Severity } = {
    'unnecessary-parens': 'warning',
    'func-or-proc-as-value': 'warning',
    // 'unnecessary-nil-coalescing': 'warning'
}