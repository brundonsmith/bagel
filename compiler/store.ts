import { parse } from "./1_parse/index.ts";
import { reshape } from "./2_reshape/index.ts";
import { resolveLazy } from "./3_checking/scopescan.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { compile, INT } from "./4_compile/index.ts";
import { withoutSourceInfo } from "./debugging.ts";
import { path } from "./deps.ts";
import { BagelError, errorsEquivalent, miscError } from "./errors.ts";
import { computedFn, makeAutoObservable } from "./mobx.ts";
import { given, iterateParseTree, ModuleName, pathIsRemote } from "./utils.ts";
import { AST, Module } from "./_model/ast.ts";
import { areSame, GetParent, GetBinding } from "./_model/common.ts";

type Config = {
    readonly entryFileOrDir: ModuleName,
    readonly singleEntry: boolean,
    readonly bundle: boolean,
    readonly watch: boolean,
    readonly includeTests: boolean,
    readonly emit: boolean
}
class _Store {

    constructor() {
        makeAutoObservable(this)
    }

    config: undefined | Config = undefined
    modules = new Set<ModuleName>()
    modulesSource = new Map<ModuleName, string>()

    readonly initializeFromEntry = (modules: readonly ModuleName[], config: Config) => {
        this.modules =new Set(modules)
        this.config = config
    }

    readonly initializeFromSource = (modulesSource: Record<ModuleName, string>, config: Config) => {
        this.modulesSource = new Map()
        for (const [k, v] of Object.entries(modulesSource)) {
            this.modulesSource.set(k as ModuleName, v)
        }

        this.config = config
    }

    get modulesOutstanding() {
        return this.modules.size === 0 || this.modules.size > this.modulesSource.size
    }

    readonly parsed = computedFn((module: ModuleName, source: string): { ast: Module, errors: readonly BagelError[] } => {
        const errors: BagelError[] = []
        const ast = reshape(parse(module, source, err => errors.push(err)))
        return { ast, errors }
    }, { requiresReaction: false })

    readonly getModuleForNode = computedFn((ast: AST): ModuleName|undefined => {
        for (const moduleName of this.modulesSource.keys()) {
            const source = this.modulesSource.get(moduleName)

            if (source) {
                const { ast: moduleAst } = this.parsed(moduleName, source)

                for (const { current } of iterateParseTree(moduleAst)) {
                    if (areSame(current, ast)) {
                        return moduleName
                    }
                }
            }
        }
    }, { requiresReaction: false })

    readonly typeerrors = computedFn((module: ModuleName, ast: Module): BagelError[] => {
        const errors: BagelError[] = []
        try {
            typecheck(
                {
                    reportError: err => errors.push(err),
                    getModule: imported => 
                        given(module, module => this.getModuleByName(module, imported)), 
                    getParent: this.getParent,
                    getBinding: this.getBinding
                }, 
                ast
            )
            return errors
        } catch (e) {
            return [ ...errors, miscError(ast, e.toString()) ]
        }
    }, { requiresReaction: false })

    get allErrors() {
        const allErrors = new Map<ModuleName, BagelError[]>()
        
        for (const module of this.modules) {
            allErrors.set(module, [])
        }

        for (const module of this.modules) {
            const source = this.modulesSource.get(module)

            if (source) {
                const { ast, errors: parseErrors } = this.parsed(module, source)
                const typecheckErrors = this.typeerrors(module, ast)

                for (const err of [...parseErrors, ...typecheckErrors].filter((err, index, arr) => arr.findIndex(other => errorsEquivalent(err, other)) === index)) {
                    const errorModule = err.ast?.module ?? module;
                    (allErrors.get(errorModule) as BagelError[]).push(err)
                }
            }
        }

        return allErrors
    }

    readonly compiled = computedFn((module: ModuleName, ast: Module): string => {
        try {
            return (
                LIB_IMPORTS + 
                (ast.hasMain ? MOBX_CONFIGURE : '') + 
                compile(
                    this.getBinding, 
                    ast, 
                    module, 
                    this.config?.includeTests
                )
            )
        } catch (e) {
            console.error(e)
            return '';
        }
    }, { requiresReaction: false })

    readonly getModuleByName = computedFn((importer: ModuleName, imported: string) => {
        const importedModuleName = canonicalModuleName(importer, imported)

        return given(this.modulesSource.get(importedModuleName), source =>
            this.parsed(importedModuleName, source).ast)
    }, { requiresReaction: false })

    readonly getParent: GetParent = computedFn((ast) => {
        for (const [moduleName, source] of this.modulesSource.entries()) {
            const { ast: module } = this.parsed(moduleName, source)

            for (const { parent, current } of iterateParseTree(module)) {
                
                if (areSame(current, ast)) {
                    return parent
                }
            }
        }

        return undefined
    }, { requiresReaction: false })
    
    readonly getBinding: GetBinding = computedFn((reportError, identifier) => {
        const currentModule = this.getModuleForNode(identifier)

        return resolveLazy(
            {
                reportError,
                getModule: imported => 
                    given(currentModule, module => this.getModuleByName(module, imported)), 
                getParent: this.getParent
            },
            identifier,
            identifier
        )
    }, { requiresReaction: false })

}
const Store = new _Store()
export default Store

const IMPORTED_ITEMS = [ 'reactionUntil',  'observable', 'computed', 'configure', 'makeObservable', 'h',
'computedFn', 'range', 'entries', 'log', 'fromEntries', 'Iter', 'RawIter', 'Plan', 'INNER_ITER', 'withConst'
].map(s => `${s} as ${INT}${s}`).join(', ')

const LIB_IMPORTS = `
import { ${IMPORTED_ITEMS} } from "../../lib/src/core.ts";
`
const MOBX_CONFIGURE = `
${INT}configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});`

export function canonicalModuleName(importerModule: ModuleName, importPath: string): ModuleName {
    if (pathIsRemote(importPath)) {
        return importPath as ModuleName
    } else {
        const moduleDir = path.dirname(importerModule);
        return (path.resolve(moduleDir, importPath) + ".bgl") as ModuleName
    }
}
