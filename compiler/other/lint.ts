import { iterateParseTree, mapParseTree } from "../utils/ast.ts";
import { AST } from "../_model/ast.ts";

export function lint(ast: AST): LintProblem[] {
    const problems: LintProblem[] = []
    const rules = Object.entries(RULES) as [RuleName, LintRule][]

    for (const { current } of iterateParseTree(ast)) {
        for (const [name, rule] of rules) {
            const problemNode = rule.match(current)

            if (problemNode) {
                problems.push({
                    rule,
                    ast: problemNode,
                    severity: DEFAULT_SEVERITY[name]
                })
            }
        }
    }

    return problems
}

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
    readonly message: string,
    readonly match: (ast: AST) => AST|undefined,
    readonly autofix?: (ast: AST) => AST,
}

type Severity = 'error'|'warn'|'info'|'off'

type LintProblem = {
    readonly rule: LintRule,
    readonly ast: AST,
    readonly severity: Severity,
}

const RULES = {
    'unnecessary-parens': {
        message: "Parenthesis aren't needed around this expression",
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
    }
} as const
const _rules: {[name: string]: LintRule} = RULES

type RuleName = keyof typeof RULES

const DEFAULT_SEVERITY: { readonly [rule in RuleName]: Severity } = {
    'unnecessary-parens': 'warn'
}