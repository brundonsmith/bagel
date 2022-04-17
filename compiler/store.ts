import { parsed } from "./1_parse/index.ts";
import { typeerrors } from "./3_checking/typecheck.ts";
import { path } from "./deps.ts";
import { BagelError, errorsEquivalent, isError } from "./errors.ts";
import { pathIsRemote } from "./utils/misc.ts";
import { ModuleName } from "./_model/common.ts";
import { lint, LintProblem } from "./other/lint.ts";
import { Platform, ValueDeclaration } from "./_model/declarations.ts";
import { PlainIdentifier } from "./_model/ast.ts";
import { ExactStringLiteral, Expression, ObjectEntry } from "./_model/expressions.ts";
import { getName } from "./utils/ast.ts";
import { computedFn, observe, WHOLE_OBJECT } from "../lib/ts/reactivity.ts";

type ModuleData = {
    source: string|undefined,
    isEntry: boolean,
    isProjectLocal: boolean
}
export const modules: Record<ModuleName, ModuleData> = {}

export const entry = computedFn(function entry() {
    observe(modules, WHOLE_OBJECT)

    for (const _module in modules) {
        const module = _module as ModuleName
        const data = modules[module]

        if (data.isEntry) {
            return module
        }
    }

    return undefined
})

export const done = computedFn(function done () {
    observe(modules, WHOLE_OBJECT)

    if (Object.keys(modules).length === 0) return false

    for (const _module in modules) {
        const module = _module as ModuleName
        const data = modules[module]

        if (data?.source == null) {
            return false
        }
    }

    return true
})

export const allProblems = computedFn(function allProblems (excludePrelude?: boolean) {
    observe(modules, WHOLE_OBJECT)

    const allProblems = new Map<ModuleName, (BagelError|LintProblem)[]>()
    
    for (const module in modules) {
        allProblems.set(module as ModuleName, [])
    }

    for (const _module in modules) {
        const module = _module as ModuleName
        const data = modules[module]

        const parseResult = parsed(module, excludePrelude)
        if (parseResult) {
            // console.log(withoutSourceInfo(parsed.ast))
            const { ast, errors: parseErrors } = parseResult
            const typecheckErrors = typeerrors(ast)
            const lintProblems = (
                data.isProjectLocal
                    ? lint(getConfig(), parseResult.ast)
                    : []
            )

            for (const err of [...parseErrors, ...typecheckErrors, ...lintProblems].filter((err, index, arr) => !isError(err) || arr.findIndex(other => isError(other) && errorsEquivalent(err, other)) === index)) {
                const errorModule = err.ast?.module ?? module;
                (allProblems.get(errorModule) as (BagelError|LintProblem)[]).push(err)
            }
        }
    }

    return allProblems
})

export const hasProblems = computedFn(function hasProblems () {
    const problems = allProblems()

    for (const moduleProblems of problems.values()) {
        if (moduleProblems.length > 0) {
            return true
        }
    }

    return false
})

export const getModuleByName = computedFn(function getModuleByName (importer: ModuleName, imported: string) {
    const importedModuleName = canonicalModuleName(importer, imported)

    return parsed(importedModuleName)?.ast
})

export type BagelConfig = {
    platforms: Platform[]|undefined,
    markupFunction: Expression|undefined
    lintRules: {[key: string]: string}|undefined
}

export const getConfig = computedFn(function getConfig (): BagelConfig|undefined {
    const entryFile = entry()

    if (!entryFile) return undefined

    const res = parsed(entryFile)
    const configDecl = res?.ast.declarations.find(decl =>
        decl.kind === 'value-declaration' && decl.isConst && decl.name.name === 'config') as ValueDeclaration|undefined

    // TODO: Eventually we want to actually evaluate the const, not
    // just walk its AST
    if (configDecl?.value.kind === 'object-literal') {
        let platforms: Platform[]|undefined
        let markupFunction: Expression|undefined
        let lintRules: {[key: string]: string}|undefined
        
        {
            const platformsExpr = (configDecl.value.entries.find(e =>
                Array.isArray(e) && (e[0] as PlainIdentifier).name === 'platforms') as any)?.[1] as Expression|undefined
            
            platforms = platformsExpr?.kind === 'array-literal' ?
                platformsExpr.entries.filter(e => e.kind === 'exact-string-literal').map(e => (e as ExactStringLiteral).value as Platform)
            : undefined
        }
        
        {
            markupFunction = (configDecl.value.entries.find(e =>
                Array.isArray(e) && (e[0] as PlainIdentifier).name === 'markupFunction') as any)?.[1] as Expression|undefined
        }

        {
            const lintRulesExpr = (configDecl.value.entries.find(e =>
                Array.isArray(e) && (e[0] as PlainIdentifier).name === 'lintRules') as any)?.[1] as Expression|undefined
            
            lintRules = lintRulesExpr?.kind === 'object-literal' ?
                Object.fromEntries(lintRulesExpr.entries
                    .filter((e): e is ObjectEntry => e.kind === 'object-entry' && e.value.kind === 'exact-string-literal')
                    .map(e => [
                        getName(e.key as PlainIdentifier | ExactStringLiteral),
                        (e.value as ExactStringLiteral).value,
                    ]))
            : undefined
        }
        
        return {
            platforms,
            markupFunction,
            lintRules
        }
    }
})

export function canonicalModuleName(importerModule: ModuleName, importPath: string): ModuleName {
    if (pathIsRemote(importPath)) {
        return importPath as ModuleName
    } else {
        const moduleDir = path.dirname(importerModule);
        return path.resolve(moduleDir, importPath) as ModuleName
    }
}
