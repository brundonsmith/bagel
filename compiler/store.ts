import { parse } from "./1_parse/index.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { BagelError, errorsEquivalent, isError } from "./errors.ts";
import { AllModules, Context, ModuleName } from "./_model/common.ts";
import { autofix, lint, LintProblem } from "./other/lint.ts";
import { ImportAllDeclaration, ImportDeclaration } from "./_model/declarations.ts";
import { memo } from "../lib/ts/reactivity.ts";
import { cacheDir, diskModulePath, pad, pathIsInProject, pathIsRemote, canonicalModuleName, target } from "./utils/cli.ts";
import { Module } from "./_model/ast.ts";
import { compile, CompileContext } from "./4_compile/index.ts";
import { format,DEFAULT_OPTIONS } from "./other/format.ts";
import { fs,Colors, path } from "./deps.ts";
import { devMode } from "./utils/misc.ts";

export const loadAllModules = async (): Promise<AllModules> => {
    let frontier = new Set<ModuleName>(
        target.kind === 'script' || target.kind === 'project-dir'
            ? [target.entry]
            : getAllFiles(target.path)
    )
    const modules = new Map<ModuleName, ReturnType<typeof parse>>()

    while (frontier.size > 0) {
        const newFrontier = new Set<ModuleName>()

        await Promise.all([...frontier]
            .map(async module => {
                const source = await loadModuleSource(module)

                if (source == null) {
                    modules.set(module, undefined)
                } else {
                    const parsed = parse(module, source)
                    modules.set(module, parsed)

                    if (parsed?.ast != null) {
                        const importedModules = (
                            parsed.ast.declarations
                                .filter((decl): decl is ImportDeclaration|ImportAllDeclaration => decl.kind === 'import-declaration' || decl.kind === 'import-all-declaration')
                                .map(decl => canonicalModuleName(module, decl.path.value))
                        )

                        for (const moduleName of importedModules) {
                            if (!modules.has(moduleName) && !frontier.has(moduleName)) {
                                newFrontier.add(moduleName)
                            }
                        }
                    }
                }
            }))

        frontier = newFrontier
    }

    return modules
}

function getAllFiles(dirPath: string, arrayOfFiles: ModuleName[] = []): ModuleName[] {
    for (const file of Deno.readDirSync(dirPath)) {
        const filePath = path.resolve(dirPath, file.name);

        if (Deno.statSync(filePath).isDirectory) {
            getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath as ModuleName);
        }
    }
  
    return arrayOfFiles;
}

const loadModuleSource = async (module: ModuleName): Promise<string | undefined> => {
    if (pathIsRemote(module)) {
        if(devMode) console.log(Colors.cyan('Info ') + `Loading remote module ${module}`)

        try {
            const cachePath = diskModulePath(module)
            const cached = await Deno.readTextFile(cachePath).catch(() => undefined)

            if (cached != null) {
                if(devMode) console.log(Colors.cyan('Info ') + `Loaded from cache ${module}`)
                return cached
            } else {
                if(devMode) console.log(Colors.cyan('Info ') + `Failed to load from cache, fetching remotely ${module}`)
                const res = await fetch(module)
                
                if (res.status === 200) {
                    console.log(Colors.green(pad('Downloaded')) + module)
                    const source = await res.text()

                    void cache(module, source)

                    return source
                } else {
                    const cachePath = diskModulePath(module)

                    if (await fs.exists(cachePath)) {
                        await Deno.remove(cachePath)
                    }
                }
            }
        } catch {
            console.error(Colors.red(pad('Error')) + `couldn't load remote module '${module}'`)
        }
    } else {
        const source = await Deno.readTextFile(module)

        if (!pathIsInProject(module)) {
            void cache(module, source)
        }

        return source
    }
}

async function cache(module: ModuleName, source: string) {
    try {
        await fs.ensureDir(cacheDir)

        const cachePath = diskModulePath(module)
        await Deno.writeTextFile(cachePath, source)

        if(devMode) console.log(Colors.cyan('Info ') + `Cached module ${module}`)
        if(devMode) console.log(Colors.cyan('Info ') + `...at ${cachePath}`)
    } catch {
        console.warn(Colors.yellow(pad('Warning')) + `failed writing cache of module ${module}`)
    }
}

export const allProblems = memo(function allProblems (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">) {
    const { allModules } = ctx
    const allProblems = new Map<ModuleName, (BagelError|LintProblem)[]>()
    
    for (const [module, _] of allModules) {
        allProblems.set(module, [])
    }

    for (const [module, parseResult] of allModules) {
        if (parseResult) {
            // console.log(withoutSourceInfo(parsed.ast))
            const { ast, errors: parseErrors } = parseResult

            if (parseErrors.length > 0) {
                (allProblems.get(module) as (BagelError|LintProblem)[]).push(...parseErrors)
            } else {
                const typecheckErrors = typeerrors(ctx, ast)
                const lintProblems = (
                    pathIsInProject(module)
                        ? lint(ctx, parseResult.ast)
                        : []
                )
                
                for (const err of [...typecheckErrors, ...lintProblems].filter((err, index, arr) => !isError(err) || arr.findIndex(other => isError(other) && errorsEquivalent(err, other)) === index)) {
                    const errorModule = err.ast?.module ?? module;
                    (allProblems.get(errorModule) as (BagelError|LintProblem)[]).push(err)
                }
            }
        }
    }

    return allProblems
})

export const hasProblems = memo(function hasProblems (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">) {
    const problems = allProblems(ctx)

    for (const moduleProblems of problems.values()) {
        if (moduleProblems.length > 0) {
            return true
        }
    }

    return false
})

const typeerrors = memo(function typeerrors (ctx: Pick<Context, "allModules" | "config" | "canonicalModuleName">, ast: Module): BagelError[] {
    const errors: BagelError[] = []
    const sendError = (err: BagelError) => errors.push(err)

    typecheck(
        { ...ctx, sendError },
        ast
    )
    
    return errors
})

export const compiled = memo(function compiled(ctx: CompileContext): string {
    const { allModules, moduleName } = ctx
    const ast = allModules.get(moduleName)?.ast

    if (ast) {
        return compile(ctx, ast)
    }

    return ''
})

export const formatted = memo(function formatted (allModules: AllModules, moduleName: ModuleName): string | undefined {
    const ast = allModules.get(moduleName)?.ast

    if (ast?.moduleType === 'bgl') {
        return (
            format(
                ast,
                DEFAULT_OPTIONS
            )
        )
    }
})

export const autofixed = memo(function autofixed (allModules: AllModules, moduleName: ModuleName): string {
    const ast = allModules.get(moduleName)?.ast
    
    if (ast?.moduleType === 'bgl') {
        return (
            format(
                autofix(ast),
                DEFAULT_OPTIONS
            )
        )
    }

    return ''
})
