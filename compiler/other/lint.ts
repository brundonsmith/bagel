import { computedFn } from "../../lib/ts/reactivity.ts";
import { parsed } from "../1_parse/index.ts";
import { resolve } from "../3_checking/resolve.ts";
import { resolveType, subsumationIssues } from "../3_checking/typecheck.ts";
import { inferType } from "../3_checking/typeinfer.ts";
import { BagelConfig } from "../store.ts";
import { findAncestor, iterateParseTree, mapParseTree } from "../utils/ast.ts";
import { AST } from "../_model/ast.ts";
import { ModuleName } from "../_model/common.ts";
import { FuncDeclaration, ProcDeclaration, ValueDeclaration } from "../_model/declarations.ts";
import { Expression, Func, Proc } from "../_model/expressions.ts";
import { BOOLEAN_TYPE, FALSY, NUMBER_TYPE, STRING_TYPE, TypeExpression } from "../_model/type-expressions.ts";
import { format,DEFAULT_OPTIONS } from "./format.ts";

export function lint(config: BagelConfig|undefined, ast: AST): LintProblem[] {
    const problems: LintProblem[] = []
    const rules = (Object.entries(RULES) as [LintRuleName, LintRule][]).filter(rule => (config?.lintRules?.[rule[0]] ?? DEFAULT_SEVERITY[rule[0]]) !== 'off')

    for (const { current } of iterateParseTree(ast)) {
        for (const [name, rule] of rules) {
            const problemNode = rule.match(current)

            if (problemNode) {
                problems.push({
                    kind: 'lint-problem',
                    name,
                    rule,
                    ast: problemNode,
                    severity: (config?.lintRules?.[name] as LintRuleSeverity|undefined ?? DEFAULT_SEVERITY[name])
                })
            }
        }
    }

    return problems
}

export const autofixed = computedFn(function autofixed (moduleName: ModuleName): string {
    const ast = parsed(moduleName)?.ast

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
    readonly autofix: ((ast: AST) => AST) | undefined,
}

export type LintRuleSeverity = 'error'|'warning'|'info'|'off'

export type LintProblem = {
    readonly kind: 'lint-problem',
    readonly name: LintRuleName,
    readonly rule: LintRule,
    readonly ast: AST,
    readonly severity: LintRuleSeverity,
}

const RULES = {
    'unnecessaryParens': {
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
    'funcOrProcAsValue': {
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
                        exported: exported != null,
                        decorators: [],
                        name,
                        value,
                        ...rest,
                    }

                    return f
                } else {
                    const p: ProcDeclaration = {
                        kind: 'proc-declaration',
                        exported: exported != null,
                        decorators: [],
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
    'redundantConditional': {
        message: (ast: AST) => {
            const condType = resolveType(inferType(ast as Expression))
            const always = isAlways(ast as Expression)
            return `This condition is redundant, because it can only ever be ${String(always)} (type: '${format(condType)}')`
        },
        match: (ast: AST) => {
            const condition = conditionFrom(ast)

            if (condition) {
                const always = isAlways(condition)
                if (always != null) {
                    return condition
                }
            }
        },
        autofix: undefined
    },
    'stringNumberConditional': {
        message: (ast: AST) => `Condition has type '${format(inferType(ast as Expression))}'. Beware using string or numbers in conditionals; in Bagel all strings and numbers are truthy!`,
        match: (ast: AST) => {
            const condition = conditionFrom(ast)

            if (condition) {
                const conditionType = inferType(condition)
                if (!subsumationIssues(conditionType, STRING_TYPE) || !subsumationIssues(conditionType, NUMBER_TYPE)) {
                    return condition
                }
            }
        },
        autofix: undefined
    },
    'explicitBooleansOnly': {
        message: (ast: AST) => `Should only use explicit boolean expressions in conditionals; this expression is of type '${format(inferType(ast as Expression))}'`,
        match: (ast: AST) => {
            const condition = conditionFrom(ast)

            if (condition) {
                const conditionType = inferType(condition)
                if (subsumationIssues(BOOLEAN_TYPE, conditionType)) {
                    return condition
                }
            }
        },
        autofix: undefined
    },
    'autorunDeclarationsOnly': {
        message: () => 'Autoruns should only be written as top-level declarations; they shouldn\'t be created in procs',
        match: (ast: AST) => {
            if (ast.kind === 'autorun' && ast.parent?.kind === 'block') {
                return ast
            }
        },
        autofix: undefined
    },
    // TODO: Lint against derivations, remotes, and autoruns that don't actually reference any observable values

    // 'pureFunctions': {
    //     message: (ast: AST) => `Function declarations should not reference global state (referencing '${format(ast)}'). Convert "let" to "const" if the value is never mutated, or consider passing state in as an explicit function argument.`,
    //     match: (ast: AST) => {
            
    //         // local identifier, inside a func declaration
    //         if (ast.kind === 'local-identifier' && findAncestor(ast, a => a.kind === 'func-declaration') != null) {
    //             const binding = resolve(ast.name, ast)

    //             // bound to let-declaration
    //             if (binding?.owner.kind === 'value-declaration' && !binding.owner.isConst) {
    //                 return ast
    //             }
    //         }

    //         return undefined
    //     },
    //     autofix: undefined
    // },
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

// TODO: Lint for camel case vs underscores

function conditionFrom(ast: AST): Expression|undefined {
    if (ast.kind === 'if-else-expression' || ast.kind === 'if-else-statement') {
        for (const { condition } of ast.cases) {
            // TODO: Return multiple at once
            return condition
        }
    }

    if (ast.kind === 'while-loop') {
        return ast.condition
    }

    if (ast.kind === 'binary-operator' && (ast.op.op === '&&' || ast.op.op === '||')) {
        return ast.left
    }

    if (ast.kind === 'negation-operator') {
        return ast.base
    }
}

function isAlways(condition: Expression): boolean|undefined {
    const condType = resolveType(inferType(condition))

    if (!subsumationIssues(FALSY, condType)) {
        return false
    }

    if (!overlaps(FALSY, condType)) {
        return true
    }

    return undefined
}

/**
 * Determine whether or not two types have any overlap at all
 */
 function overlaps(a: TypeExpression, b: TypeExpression): boolean {
    const resolvedA = resolveType(a)
    const resolvedB = resolveType(b)

    if (!subsumationIssues(resolvedA, resolvedB) || !subsumationIssues(resolvedB, resolvedA)) {
        return true
    } else if (resolvedA.kind === 'union-type' && resolvedB.kind === 'union-type') {
        return resolvedA.members.some(memberA => resolvedB.members.some(memberB => overlaps(memberA, memberB)))
    } else if (resolvedA.kind === 'union-type') {
        return resolvedA.members.some(memberA => overlaps(memberA, resolvedB))
    } else if (resolvedB.kind === 'union-type') {
        return resolvedB.members.some(memberB => overlaps(memberB, resolvedA))
    }

    return false
}

// optional lint against all non-boolean conditionals?
// lint about declarations that can be hoisted because they don't reference anything in the inner scope

export type LintRuleName = keyof typeof RULES

const DEFAULT_SEVERITY: { readonly [rule in LintRuleName]: LintRuleSeverity } = {
    'unnecessaryParens': 'warning',
    'funcOrProcAsValue': 'warning',
    'redundantConditional': 'error',
    'stringNumberConditional': 'warning',
    'explicitBooleansOnly': 'off',
    'autorunDeclarationsOnly': 'off',
    // 'pureFunctions': 'error',
    // 'unnecessary-nil-coalescing': 'warning'
}