import { parsed } from "./1_parse/index.ts";
import { typeerrors } from "./3_checking/typecheck.ts";
import { path } from "./deps.ts";
import { BagelError, errorsEquivalent, isError } from "./errors.ts";
import { computedFn, makeAutoObservable } from "./mobx.ts";
import { pathIsRemote } from "./utils/misc.ts";
import { ModuleName } from "./_model/common.ts";
import { lint, LintProblem } from "./other/lint.ts";

export type Mode =
    | { mode: "build", entryFile: ModuleName, watch: boolean }
    | { mode: "run", entryFile: ModuleName, platform?: 'node'|'deno', watch: boolean }
    | { mode: "check", fileOrDir: string, watch: boolean }
    | { mode: "transpile", fileOrDir: string, watch: boolean }
    | { mode: "test", fileOrDir: string, platform?: 'node'|'deno', watch: boolean }
    | { mode: "format", fileOrDir: string, watch: undefined }
    | { mode: "autofix", fileOrDir: string, watch: undefined }
    | { mode: "mock", modules: Record<ModuleName, string>, watch: undefined } // for internal testing only!

export class _Store {

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

}
const Store = new _Store()
export default Store

export const done = computedFn((store: _Store) =>
    store.mode != null && store.modules.size > 0 && store.modulesSource.size >= store.modules.size)

export const allProblems = computedFn((store: _Store) => {
    const allProblems = new Map<ModuleName, (BagelError|LintProblem)[]>()
    
    for (const module of store.modulesSource.keys()) {
        allProblems.set(module, [])
    }

    for (const module of store.modulesSource.keys()) {
        const parseResult = parsed(store, module, true)
        if (parseResult) {
            // console.log(withoutSourceInfo(parsed.ast))
            const { errors: parseErrors } = parseResult
            const typecheckErrors = typeerrors(store, module)
            const lintProblems = lint(parseResult.ast)

            for (const err of [...parseErrors, ...typecheckErrors, ...lintProblems].filter((err, index, arr) => !isError(err) || arr.findIndex(other => isError(other) && errorsEquivalent(err, other)) === index)) {
                const errorModule = err.ast?.module ?? module;
                (allProblems.get(errorModule) as (BagelError|LintProblem)[]).push(err)
            }
        }
    }

    return allProblems
})

export const getModuleByName = computedFn((store: _Store, importer: ModuleName, imported: string) => {
    const importedModuleName = canonicalModuleName(importer, imported)

    return parsed(store, importedModuleName, true)?.ast
})

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
