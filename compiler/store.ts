import { parse } from "./1_parse/index.ts";
import { reshape } from "./2_reshape/index.ts";
import { resolve } from "./3_checking/resolve.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { compile } from "./4_compile/index.ts";
import { path } from "./deps.ts";
import { BagelError, errorsEquivalent, isError } from "./errors.ts";
import { computedFn, makeAutoObservable } from "./mobx.ts";
import { pathIsRemote } from "./utils/misc.ts";
import { AST, Module } from "./_model/ast.ts";
import { ModuleName, ReportError } from "./_model/common.ts";
import { areSame, iterateParseTree } from "./utils/ast.ts";
import { autofix, lint, LintProblem } from "./other/lint.ts";
import { DEFAULT_OPTIONS, format } from "./other/format.ts";

export type Mode =
    | { mode: "build", entryFile: ModuleName, watch: boolean }
    | { mode: "run", entryFile: ModuleName, platform?: 'node'|'deno', watch: boolean }
    | { mode: "check", fileOrDir: string, watch: boolean }
    | { mode: "transpile", fileOrDir: string, watch: boolean }
    | { mode: "test", fileOrDir: string, platform?: 'node'|'deno', watch: boolean }
    | { mode: "format", fileOrDir: string, watch: undefined }
    | { mode: "autofix", fileOrDir: string, watch: undefined }
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

    get allProblems() {
        const allProblems = new Map<ModuleName, (BagelError|LintProblem)[]>()
        
        for (const module of this._modulesSource.keys()) {
            allProblems.set(module, [])
        }

        for (const module of this._modulesSource.keys()) {
            const parsed = this.parsed(module, true)
            if (parsed) {
                const { errors: parseErrors } = parsed
                const typecheckErrors = this.typeerrors(module)
                const lintProblems = lint(parsed.ast)

                for (const err of [...parseErrors, ...typecheckErrors, ...lintProblems].filter((err, index, arr) => !isError(err) || arr.findIndex(other => isError(other) && errorsEquivalent(err, other)) === index)) {
                    const errorModule = err.ast?.module ?? module;
                    (allProblems.get(errorModule) as (BagelError|LintProblem)[]).push(err)
                }
            }
        }

        return allProblems
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
        this._modulesSource.set(moduleName, source)
    }


    // Computed fns
    readonly parsed = computedFn((moduleName: ModuleName, withPrelude: boolean): { ast: Module, errors: readonly BagelError[] } | undefined => {
        const source = this._modulesSource.get(moduleName)
        if (source) {
            const errors: BagelError[] = []
            const ast = reshape(parse(
                moduleName,  
                (withPrelude && !moduleIsCore(moduleName) ? BGL_PRELUDE : '') + source, 
                err => errors.push(err)
            ))
            return { ast, errors }
        }
    })

    readonly typeerrors = computedFn((moduleName: ModuleName): BagelError[] => {
        const ast = this.parsed(moduleName, true)?.ast

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
        const ast = this.parsed(moduleName, true)?.ast

        if (!ast) {
            return ''
        }
        
        return (
            JS_PRELUDE + 
            compile(
                ast, 
                moduleName, 
                this.mode?.mode === 'test'
            )
        )
    })

    readonly formatted = computedFn((moduleName: ModuleName): string => {
        const ast = this.parsed(moduleName, false)?.ast

        if (!ast) {
            return ''
        }
        
        return (
            format(
                ast,
                DEFAULT_OPTIONS
            )
        )
    })

    readonly autofixed = computedFn((moduleName: ModuleName): string => {
        const ast = this.parsed(moduleName, false)?.ast

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

    readonly getModuleByName = computedFn((importer: ModuleName, imported: string) => {
        const importedModuleName = canonicalModuleName(importer, imported)

        return this.parsed(importedModuleName, true)?.ast
    })

    readonly getParent = computedFn((ast: AST) => {
        for (const [moduleName, _source] of this._modulesSource.entries()) {
            const asts = [this.parsed(moduleName, true)?.ast, this.parsed(moduleName, false)?.ast]

            for (const module of asts) {
                if (module) {
                    for (const { parent, current } of iterateParseTree(module)) {
                        if (areSame(current, ast)) {
                            return parent
                        }
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

export const IMPORTED_ITEMS = [ 'observe', 'invalidate', 'computedFn', 'autorun', 'action', 'h',
'range', 'entries', 'log', 'fromEntries', 'Iter', 'RawIter', 'Plan', 'INNER_ITER', 'withConst'
]

const JS_PRELUDE = `
import { ${IMPORTED_ITEMS.map(s => `${s} as ___${s}`).join(', ')} } from "C:/Users/brundolf/git/bagel/lib/src/core.ts";
`

const BGL_PRELUDE = `
from 'C:/Users/brundolf/git/bagel/lib/wrappers/prelude' import { iter, Iterator, Plan, BagelConfig }
`

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
