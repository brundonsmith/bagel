import { parsed } from "./1_parse/index.ts";
import { typeerrors } from "./3_checking/typecheck.ts";
import { path } from "./deps.ts";
import { BagelError, errorsEquivalent, isError } from "./errors.ts";
import { computedFn } from "./mobx.ts";
import { pathIsRemote } from "./utils/misc.ts";
import { ModuleName } from "./_model/common.ts";
import { lint, LintProblem } from "./other/lint.ts";
import { Platform, ValueDeclaration } from "./_model/declarations.ts";
import { PlainIdentifier } from "./_model/ast.ts";
import { ExactStringLiteral, Expression, ObjectEntry } from "./_model/expressions.ts";
import { getName } from "./utils/ast.ts";
import { observable } from './mobx.ts'

type ModuleData = {
    source: string|undefined,
    isEntry: boolean,
    isProjectLocal: boolean
}
export const modules = observable(new Map<ModuleName, ModuleData>())

export const entry = computedFn(() => {
    for (const [module, data] of modules) {
        if (data.isEntry) {
            return module
        }
    }

    return undefined
})

export const done = computedFn(() => {
    if (modules.size === 0) return false

    for (const module of modules.keys()) {
        if (modules.get(module)?.source == null) {
            return false
        }
    }

    return true
})

export const allProblems = computedFn((excludePrelude?: boolean) => {
    const allProblems = new Map<ModuleName, (BagelError|LintProblem)[]>()
    
    for (const module of modules.keys()) {
        allProblems.set(module, [])
    }

    for (const [module, data] of modules) {
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

export const hasProblems = computedFn(() => {
    const problems = allProblems()

    for (const moduleProblems of problems.values()) {
        if (moduleProblems.length > 0) {
            return true
        }
    }

    return false
})

export const getModuleByName = computedFn((importer: ModuleName, imported: string) => {
    const importedModuleName = canonicalModuleName(importer, imported)

    return parsed(importedModuleName)?.ast
})

export type BagelConfig = {
    platforms: Platform[]|undefined,
    markupFunction: Expression|undefined
    lintRules: {[key: string]: string}|undefined
}

export const getConfig = computedFn((): BagelConfig|undefined => {
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
