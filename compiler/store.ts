import { parse } from "./1_parse/index.ts";
import { reshape } from "./2_reshape/index.ts";
import { resolve } from "./3_checking/resolve.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { compile } from "./4_compile/index.ts";
import { path } from "./deps.ts";
import { BagelError, errorsEquivalent } from "./errors.ts";
import { computedFn, makeAutoObservable } from "./mobx.ts";
import { pathIsRemote } from "./utils/misc.ts";
import { AST, Module } from "./_model/ast.ts";
import { ModuleName, ReportError } from "./_model/common.ts";
import { areSame, iterateParseTree } from "./utils/ast.ts";

export type Mode =
    | { mode: "build", entryFile: ModuleName, watch: boolean }
    | { mode: "run", entryFile: ModuleName, platform?: 'node'|'deno', watch: boolean }
    | { mode: "check", fileOrDir: string, watch: boolean }
    | { mode: "transpile", fileOrDir: string, watch: boolean }
    | { mode: "test", fileOrDir: string, platform?: 'node'|'deno', watch: boolean }
    | { mode: "format", fileOrDir: string, watch: boolean }
    | { mode: "mock", modules: Record<ModuleName, string>, watch: undefined } // for internal testing only!

class _Store {

    constructor() {
        makeAutoObservable(this)
    }

    
    // State
    mode: undefined | Mode = undefined

    private _modules = new Set<ModuleName>()
    public get modules(): ReadonlySet<ModuleName> {
        return this._modules
    }

    private _modulesSource = new Map<ModuleName, string>()
    public get modulesSource(): ReadonlyMap<ModuleName, string> {
        return this._modulesSource
    }


    // Computed
    get done() {
        return this.mode != null && this.modules.size > 0 && this.modulesSource.size >= this.modules.size
    }

    get allErrors() {
        const allErrors = new Map<ModuleName, BagelError[]>()
        
        for (const module of this._modulesSource.keys()) {
            allErrors.set(module, [])
        }

        for (const module of this._modulesSource.keys()) {
            const parsed = this.parsed(module)
            if (parsed) {
                const { errors: parseErrors } = parsed
                const typecheckErrors = this.typeerrors(module)

                for (const err of [...parseErrors, ...typecheckErrors].filter((err, index, arr) => arr.findIndex(other => errorsEquivalent(err, other)) === index)) {
                    const errorModule = err.ast?.module ?? module;
                    (allErrors.get(errorModule) as BagelError[]).push(err)
                }
            }
        }

        return allErrors
    }


    // Actions
    readonly start = async (mode: Mode) => {
        this.mode = mode

        if (mode.mode === 'mock') {
            this._modulesSource = new Map()

            for (const [k, v] of Object.entries(mode.modules)) {
                const moduleName = k as ModuleName
                this.setSource(moduleName, v)
            }
        } else if (mode.mode === 'build' || mode.mode === 'run') {
            this._modules.add(mode.entryFile)
        } else {
            const singleEntry = !(await Deno.stat(mode.fileOrDir)).isDirectory
            const allFiles = singleEntry 
                ? [ mode.fileOrDir ]
                : await getAllFiles(mode.fileOrDir);

            this._modules = new Set(allFiles as ModuleName[])
        }
    }

    readonly registerModule = (moduleName: ModuleName) => {
        this._modules.add(moduleName)
    }

    readonly setSource = (moduleName: ModuleName, source: string) => {
        this._modulesSource.set(moduleName, (!moduleIsCore(moduleName) ? BGL_PRELUDE : '') + source)
    }


    // Computed fns
    readonly parsed = computedFn((moduleName: ModuleName): { ast: Module, errors: readonly BagelError[] } | undefined => {
        const source = this._modulesSource.get(moduleName)

        if (source) {
            const errors: BagelError[] = []
            const ast = reshape(parse(moduleName, source, err => errors.push(err)))
            return { ast, errors }
        }
    })

    readonly typeerrors = computedFn((moduleName: ModuleName): BagelError[] => {
        const ast = this.parsed(moduleName)?.ast

        if (!ast) {
            return []
        }

        const errors: BagelError[] = []
        typecheck(
            err => errors.push(err), 
            ast
        )
        return errors
    })

    readonly compiled = computedFn((moduleName: ModuleName): string => {
        const ast = this.parsed(moduleName)?.ast

        if (!ast) {
            return ''
        }
        
        return (
            JS_PRELUDE + 
            (ast.hasMain ? MOBX_CONFIGURE : '') + 
            compile(
                ast, 
                moduleName, 
                this.mode?.mode === 'test'
            )
        )
    })

    readonly getModuleByName = computedFn((importer: ModuleName, imported: string) => {
        const importedModuleName = canonicalModuleName(importer, imported)

        return this.parsed(importedModuleName)?.ast
    })

    readonly getParent = computedFn((ast: AST) => {
        for (const [moduleName, _source] of this._modulesSource.entries()) {
            const module = this.parsed(moduleName)?.ast

            if (module) {
                for (const { parent, current } of iterateParseTree(module)) {
                    if (areSame(current, ast)) {
                        return parent
                    }
                }
            }
        }

        return undefined
    })
    
    readonly getBinding = computedFn((reportError: ReportError, name: string, context: AST) => {
        return resolve(
            reportError,
            name,
            context,
            context
        )
    })

}
const Store = new _Store()
export default Store

const moduleIsCore = (moduleName: ModuleName) => {
    // NOTE: This can be made more robust later, probably screened by domain name or something
    return moduleName.includes('wrappers')
}

export const IMPORTED_ITEMS = [ 'autorun',  'observable', 'computed', 'configure', 'makeObservable', 'h',
'computedFn', 'range', 'entries', 'log', 'fromEntries', 'Iter', 'RawIter', 'Plan', 'INNER_ITER', 'withConst'
]

const JS_PRELUDE = `
import { ${IMPORTED_ITEMS.map(s => `${s} as ___${s}`).join(', ')} } from "C:/Users/brundolf/git/bagel/lib/src/core.ts";
`
export const MOBX_CONFIGURE = `
___configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});`

const BGL_PRELUDE = `
from 'C:/Users/brundolf/git/bagel/lib/wrappers/prelude' import { iter, logp, logf, BagelConfig }
`
export const BGL_PRELUDE_COMPILED = compile(parse('foo' as ModuleName, BGL_PRELUDE, () => {}), 'foo' as ModuleName)

export function canonicalModuleName(importerModule: string, importPath: string): ModuleName {
    if (pathIsRemote(importPath)) {
        return importPath as ModuleName
    } else {
        const moduleDir = path.dirname(importerModule);
        return (path.resolve(moduleDir, importPath) + ".bgl") as ModuleName
    }
}

async function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
    for await (const file of Deno.readDir(dirPath)) {
        const filePath = path.resolve(dirPath, file.name);

        if ((await Deno.stat(filePath)).isDirectory) {
            await getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath);
        }
    }
  
    return arrayOfFiles;
}
