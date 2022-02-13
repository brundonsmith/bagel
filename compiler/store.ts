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
import { stripSourceInfo } from "./utils/debugging.ts";

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

    private _modules = new Set<ModuleName>([])
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
                // console.log(withoutSourceInfo(parsed.ast))
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
                : (await getAllFiles(mode.fileOrDir)).filter(f => f.match(/.*\.bgl$/));

            this._modules = new Set([...allFiles as ModuleName[]])
        }
    }

    readonly registerModule = (moduleName: ModuleName) => {
        this._modules.add(moduleName)
    }

    readonly setSource = (moduleName: ModuleName, source: string) => {
        this._modulesSource.set(moduleName, source)
    }


    // Computed fns
    readonly parsed = computedFn((moduleName: ModuleName, typecheckReady: boolean): { ast: Module, errors: readonly BagelError[] } | undefined => {
        const source = this._modulesSource.get(moduleName)
        if (source) {
            const errors: BagelError[] = []
            const ast = parse(
                moduleName,  
                source + (typecheckReady ? preludeFor(moduleName) : ''), 
                err => errors.push(err)
            )

            if (typecheckReady) {
                return { ast: reshape(ast), errors }
            } else {
                return { ast, errors }
            }
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

export const IMPORTED_ITEMS = [ 'observe', 'invalidate', 'computedFn', 
'autorun', 'action', 'WHOLE_OBJECT', 'h', 'range', 'entries', 'Iter',
'RawIter', 'Plan', 'Remote', 'INNER_ITER', 'instanceOf', 'RT_UNKNOWN', 
'RT_NIL', 'RT_BOOLEAN', 'RT_NUMBER', 'RT_STRING', 'RT_LITERAL', 'RT_ITERATOR',
'RT_PLAN', 'RT_REMOTE', 'RT_ARRAY', 'RT_RECORD', 'RT_OBJECT' ]

const JS_PRELUDE = `
import { ${
    IMPORTED_ITEMS.map(s => `${s} as ___${s}`).join(', ')
} } from "https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/src/core.ts";

`

const BGL_PRELUDE_DATA = [
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/core.bgl' as ModuleName, imports: [ 'log', 'logf', 'iter', 'UnknownObject' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/bagel.bgl' as ModuleName, imports: [ 'BagelConfig' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/arrays.bgl' as ModuleName, imports: [ 'push', 'unshift', 'pop', 'shift', 'splice' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/strings.bgl' as ModuleName, imports: [ 'includes', 'indexOf', 'replace', 'split', 'startsWith', 'substring', 'toLowerCase', 'toUpperCase', 'trim' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/objects.bgl' as ModuleName, imports: [ 'keys', 'values', 'entries' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/numbers.bgl' as ModuleName, imports: [ 'parseNumber', 'stringifyNumber', 'abs', 'pow', 'sqrt', 'ceil', 'floor', 'sin', 'cos', 'tan' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/booleans.bgl' as ModuleName, imports: [ 'parseBoolean', 'stringifyBoolean' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/iterators.bgl' as ModuleName, imports: [ 'map', 'filter', 'slice', 'sorted', 'every', 'some', 'count', 'concat', 'zip', 'collectArray', 'collectObject' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/plans.bgl' as ModuleName, imports: [ 'timeout' ] },
    { module: 'https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/bgl/json.bgl' as ModuleName, imports: [ 'parseJson', 'stringifyJson', 'JSON' ] },
] as const

function normalizeName(module: ModuleName): string {
    return module
        .replace(/^[a-zA-Z]:/, '')
        .split(/[\\/]+/)
        .filter(s => !!s)
        .map(s => s.split('.')[0])
        .join('/')
}

function preludeFor(module: ModuleName) {
    const normalizedModule = normalizeName(module)

    return '\n\n' + BGL_PRELUDE_DATA
        .filter(m => normalizeName(m.module) !== normalizedModule)
        .map(({ module, imports }) =>
            `from '${module}' import { ${imports.join(', ')} }`)
        .join('\n')
}

export function canonicalModuleName(importerModule: string, importPath: string): ModuleName {
    if (pathIsRemote(importPath)) {
        return importPath as ModuleName
    } else {
        const moduleDir = path.dirname(importerModule);
        return path.resolve(moduleDir, importPath) as ModuleName
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
