import { resolveType, subsumationIssues } from "../3_checking/typecheck.ts";
import { inferType } from "../3_checking/typeinfer.ts";
import { iterateParseTree, mapParseTree } from "../utils/ast.ts";
import { AST } from "../_model/ast.ts";
import { Context } from "../_model/common.ts";
import { FuncDeclaration, ProcDeclaration, ValueDeclaration } from "../_model/declarations.ts";
import { Expression, Func, Proc } from "../_model/expressions.ts";
import { BOOLEAN_TYPE, FALSY, NUMBER_TYPE, STRING_TYPE, TypeExpression } from "../_model/type-expressions.ts";
import { format } from "./format.ts";

export function lint(ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST): LintProblem[] {
    const { config } = ctx
    
    const problems: LintProblem[] = []
    const rules = (Object.entries(RULES) as [LintRuleName, LintRule][]).filter(rule => (config?.lintRules?.[rule[0]] ?? DEFAULT_SEVERITY[rule[0]]) !== 'off')

    for (const { current } of iterateParseTree(ast)) {
        for (const [name, rule] of rules) {
            const problemNode = rule.match(ctx, current)

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
    readonly message: (ctx: Pick<Context, "allModules" | "canonicalModuleName">, ast: AST) => string,
    readonly match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => AST|undefined,
    readonly autofix: ((ast: AST) => AST) | undefined,
}

export const ALL_LINT_RULE_SEVERITIES = ['error', 'warning', 'info', 'off'] as const
export type LintRuleSeverity = typeof ALL_LINT_RULE_SEVERITIES[number]

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
        match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => {
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
        message: (ctx: Pick<Context, "allModules" | "canonicalModuleName">, ast: AST) => {
            const decl = ast as ValueDeclaration
            const val = decl.value as Proc|Func

            return `Top-level const ${val.kind === 'func' ? 'functions' : 'procedures'} should be ${val.kind} declarations, not ${decl.isConst ? 'const' : 'let'} declarations`
        },
        match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => {
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
        message: (ctx: Pick<Context, "allModules" | "canonicalModuleName">, ast: AST) => {
            const condType = resolveType(ctx, inferType(ctx, ast as Expression))
            const always = isAlways(ctx, ast as Expression)
            return `This condition is redundant, because it can only ever be ${String(always)} (type: '${format(condType)}')`
        },
        match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => {
            const condition = conditionFrom(ast)

            if (condition) {
                const always = isAlways(ctx, condition)
                if (always != null) {
                    return condition
                }
            }
        },
        autofix: undefined
    },
    'stringNumberConditional': {
        message: (ctx: Pick<Context, "allModules" | "canonicalModuleName">, ast: AST) => `Condition has type '${format(inferType(ctx, ast as Expression))}'. Beware using string or numbers in conditionals; in Bagel all strings and numbers are truthy!`,
        match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => {
            const condition = conditionFrom(ast)

            if (condition) {
                const conditionType = inferType(ctx, condition)
                if (!subsumationIssues(ctx, conditionType, STRING_TYPE) || !subsumationIssues(ctx, conditionType, NUMBER_TYPE)) {
                    return condition
                }
            }
        },
        autofix: undefined
    },
    'explicitBooleansOnly': {
        message: (ctx: Pick<Context, "allModules" | "canonicalModuleName">, ast: AST) =>
            `Should only use explicit boolean expressions in conditionals; this expression is of type '${format(inferType(ctx, ast as Expression))}'`,
        match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => {
            const condition = conditionFrom(ast)

            if (condition) {
                const conditionType = inferType(ctx, condition)
                if (subsumationIssues(ctx, BOOLEAN_TYPE, conditionType)) {
                    return condition
                }
            }
        },
        autofix: undefined
    },
    'autorunDeclarationsOnly': {
        message: () => 'Autoruns should only be written as top-level declarations; they shouldn\'t be created in procs',
        match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => {
            if (ast.kind === 'autorun' && ast.parent?.kind === 'block') {
                return ast
            }
        },
        autofix: undefined
    },
    // TODO: Lint against autoruns that don't actually reference any observable values

    // 'pureFunctions': {
    //     message: (ctx: Pick<Context, "allModules" | "canonicalModuleName">, ast: AST) => `Function declarations should not reference global state (referencing '${format(ast)}'). Convert "let" to "const" if the value is never mutated, or consider passing state in as an explicit function argument.`,
    //     match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => {
            
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
    //     match: (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: AST) => {
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

function isAlways(ctx: Pick<Context, "allModules" | "canonicalModuleName">, condition: Expression): boolean|undefined {
    const condType = resolveType(ctx, inferType(ctx, condition))

    if (!subsumationIssues(ctx, FALSY, condType)) {
        return false
    }

    if (!overlaps(ctx, FALSY, condType)) {
        return true
    }

    return undefined
}

/**
 * Determine whether or not two types have any overlap at all
 */
 function overlaps(ctx: Pick<Context, "allModules" | "encounteredNames" | "canonicalModuleName">, a: TypeExpression, b: TypeExpression): boolean {
    const resolvedA = resolveType(ctx, a)
    const resolvedB = resolveType(ctx, b)

    if (!subsumationIssues(ctx, resolvedA, resolvedB) || !subsumationIssues(ctx, resolvedB, resolvedA)) {
        return true
    } else if (resolvedA.kind === 'union-type' && resolvedB.kind === 'union-type') {
        return resolvedA.members.some(memberA => resolvedB.members.some(memberB => overlaps(ctx, memberA, memberB)))
    } else if (resolvedA.kind === 'union-type') {
        return resolvedA.members.some(memberA => overlaps(ctx, memberA, resolvedB))
    } else if (resolvedB.kind === 'union-type') {
        return resolvedB.members.some(memberB => overlaps(ctx, memberB, resolvedA))
    }

    return false
}

// optional lint against all non-boolean conditionals?
// lint about declarations that can be hoisted because they don't reference anything in the inner scope

export type LintRuleName = keyof typeof RULES

export const DEFAULT_SEVERITY: { readonly [rule in LintRuleName]: LintRuleSeverity } = {
    'unnecessaryParens': 'warning',
    'funcOrProcAsValue': 'warning',
    'redundantConditional': 'error',
    'stringNumberConditional': 'warning',
    'explicitBooleansOnly': 'off',
    'autorunDeclarationsOnly': 'off',
    // 'pureFunctions': 'error',
    // 'unnecessary-nil-coalescing': 'warning'
}

// TODO: Lint against certain cases where `readonly` is obviously redundant (primitives, etc)