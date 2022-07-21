import { Colors, path, fs } from "./deps.ts";

import { BagelError, prettyProblem } from "./errors.ts";

import { AllModules, Context, DEFAULT_CONFIG, ModuleName } from "./_model/common.ts";
import { ALL_LINT_RULE_SEVERITIES, DEFAULT_SEVERITY, LintProblem, LintRuleName, LintRuleSeverity } from "./other/lint.ts";
import { command,target,flags,transpilePath,pathIsInProject,entry, bundlePath, pad, allEntries, canonicalModuleName, testFilter } from "./utils/cli.ts";
import { esOrNone, sOrNone, devMode } from "./utils/misc.ts";
import { ALL_PLATFORMS, Platform } from "./_model/declarations.ts";
import { loadAllModules,allProblems,hasProblems,formatted,autofixed,compiled } from "./store.ts";
import { ERROR_SYM } from "https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/ts/core.ts";

async function run() {
    const start = Date.now()
    window.addEventListener("unload", () => {
        console.log(`Took ${((Date.now() - start) / 1000).toFixed(2)}s`);
    });

    switch (command) {
        case 'build':
        case 'run': {
            const allModules = await loadAllModules(allEntries)
            await transpileAll(allModules)
            const config = await loadConfig()

            const ctx = { allModules, config, canonicalModuleName }

            printProblems(ctx, allProblems(ctx), flags.watch)
            
            if (!hasProblems(ctx)) {
                await bundleOutput()

                if (command === 'build') {
                    if (!flags.watch) {
                        Deno.exit(0)
                    }
                } else {
                    const nodePath = Deno.env.get('BAGEL_NODE_BIN')
                    const denoPath = Deno.env.get('BAGEL_DENO_BIN')
                    
                    const nodeCommand = [nodePath || "node", bundlePath]
                    const denoCommand = [denoPath || "deno", "run", "--unstable", "--allow-all", bundlePath]

                    const platforms = config.platforms
                    
                    if (flags.deno || (!platforms?.includes('node') && platforms?.includes('deno'))) {
                        console.log(Colors.green('Running (deno) ') + bundlePath)
                        await Deno.run({ cmd: denoCommand }).status()
                        Deno.exit(0)
                    } else if (flags.node || (platforms?.includes('node') && !platforms?.includes('deno'))) {
                        console.log(Colors.green('Running (node) ') + bundlePath)
                        await Deno.run({ cmd: nodeCommand }).status()
                        Deno.exit(0)
                    } else if (denoPath) {
                        console.log(Colors.green('Running (' + denoPath + ')     ') + bundlePath)
                        await Deno.run({ cmd: denoCommand }).status()
                        Deno.exit(0)
                    } else if (nodePath) {
                        console.log(Colors.green('Running (' + nodePath + ')     ') + bundlePath)
                        await Deno.run({ cmd: nodeCommand }).status()
                        Deno.exit(0)
                    } else {
                        try {
                            await Deno.run({ cmd: ["deno", "--version"], stdout: 'piped' }).status()
                            console.log(Colors.green('Running (deno) ') + bundlePath)
                            await Deno.run({ cmd: denoCommand }).status()
                            Deno.exit(0)
                        } catch {
                            try {
                                await Deno.run({ cmd: ["node", "-v"], stdout: 'piped' }).status()
                                console.log(Colors.green('Running (node) ') + bundlePath)
                                await Deno.run({ cmd: nodeCommand }).status()
                                Deno.exit(0)
                            } catch {
                            }
                        }
                    }

                    console.error(Colors.red('Failed to run: ') + 'Couldn\'t find a Node or Deno installation; please install one of the two or supply a path as BAGEL_NODE_BIN or BAGEL_DENO_BIN')
                    Deno.exit(1)
                }
            } else {
                if (!flags.watch) {
                    Deno.exit(1)
                }
            }
        } break;
        case 'transpile':
        case 'check':
        case 'test':
        case 'format':
        case 'autofix': {
            const allModules = await loadAllModules(allEntries)

            if (command === 'transpile' || command === 'check' || command === 'test') {
                await transpileAll(allModules)
                const config = await loadConfig()
                
                const ctx = { allModules, config, canonicalModuleName }

                printProblems(ctx, allProblems(ctx), flags.watch)

                if (!hasProblems(ctx)) {    
                    if (command === 'transpile') { 
                        const localModules = [...allModules.keys() ?? []].filter(module => pathIsInProject(module)).length
                        console.log(Colors.green(pad('Transpiled')) + `${localModules} Bagel file${sOrNone(localModules)}`)
                    } else if (command === 'test') {
                        await test()
                    }
                }

                if (!flags.watch) {
                    Deno.exit(
                        hasProblems(ctx)
                            ? 1
                            : 0
                    )
                }
            } else if (command === 'format' || command === 'autofix') {
                const transform = command === 'format' ? formatted : autofixed

                for (const module of allModules.keys() ?? []) {
                    if (pathIsInProject(module)) {
                        const transformed = transform(allModules, module)

                        if (transformed != null) {
                            Deno.writeTextFileSync(module, transformed)
                        }
                    }
                }
            } else {
                // test
            }
        } break;
        case 'new':
            fs.ensureDirSync(target)
            Deno.writeTextFileSync(path.resolve(target, 'index.bgl'), DEFAULT_INDEX_BGL)
            console.log(Colors.green(pad('Created')) + `new Bagel project ${target}`)
            Deno.exit(0)
        case 'init':
            Deno.writeTextFileSync(path.resolve(Deno.cwd(), 'index.bgl'), DEFAULT_INDEX_BGL)
            console.log(Colors.green(pad('Initialized')) + `Bagel project in current directory`)
            Deno.exit(0)
    }
}

async function transpileAll(allModules: AllModules) {
    for (const moduleName of allModules.keys() ?? []) {
        const jsPath = transpilePath(moduleName)
        const js = compiled({ allModules, moduleName, transpilePath, canonicalModuleName, includeTests: true })
        
        if (js) {
            await fs.ensureDir(path.dirname(jsPath))
            await Deno.writeTextFile(jsPath, js)
            if(devMode) console.log(Colors.cyan('Info ') + `Wrote transpiled ${jsPath}`)

            if (moduleName === entry) {
                const entryPath = bundleEntryPath(moduleName)
                await Deno.writeTextFile(entryPath, js + "\nsetTimeout(main, 0);\n")
                if(devMode) console.log(Colors.cyan('Info ') + `Wrote transpiled bundle-entry ${entryPath}`)
            }
        }
    }
}

const bundleEntryPath = (moduleName: ModuleName) => {
    const jsPath = transpilePath(moduleName)
    return path.resolve(path.dirname(jsPath), 'bundle-entry-' + path.basename(jsPath))
}

async function loadConfig() {
    if (entry == null) return DEFAULT_CONFIG;

    try {
        const entryModule = await import(transpilePath(entry))

        const config = {
            ...DEFAULT_CONFIG
        }

        if (entryModule != null && typeof entryModule === 'object') {
            const foundConfig = entryModule.config

            if (foundConfig != null && typeof foundConfig === 'object') {
                if (foundConfig.platforms != null && 
                    Array.isArray(foundConfig.platforms) && 
                    foundConfig.platforms.every((platform: any) => ALL_PLATFORMS.includes(platform))
                ) {
                    config.platforms = foundConfig.platforms as readonly Platform[]
                }
                
                if (foundConfig.lintRules != null && 
                    typeof foundConfig.lintRules === 'object'
                ) {
                    const entries = Object.entries(foundConfig.lintRules)

                    const allRuleNames = new Set(Object.keys(DEFAULT_SEVERITY))
                    if (entries.every(([key, value]) => allRuleNames.has(key) && ALL_LINT_RULE_SEVERITIES.includes(value as any))) {
                        config.lintRules = foundConfig.lintRules as {readonly [key in LintRuleName]: LintRuleSeverity}
                    }
                }
            }
        }

        return config
    } catch (e) {
        if(devMode) {
            console.log(Colors.cyan('Info ') + `Failed reading config from entry file, using default config`)
            console.log(e)
        }

        // TODO: More cases and error messaging
        return DEFAULT_CONFIG
    }
}

const DEFAULT_INDEX_BGL = `
export const config: BagelConfig = {

    // Remove entries from this list to enable different platform-specific APIs
    platforms: ['node', 'deno', 'browser'],

    // You can override individual rules here, or leave empty for the default linter behavior
    lintRules: { },
}

proc main() {

}
`

function printProblems (ctx: Pick<Context, "allModules"|"canonicalModuleName">, problems: Map<ModuleName, (BagelError|LintProblem)[]>, clearConsole: boolean) {
    const { allModules } = ctx

    if (clearConsole) {
        console.clear()
    }

    let totalErrors = 0;

    const modulesWithErrors = new Array(...problems.values()).filter(errs => errs.length > 0).length

    if (modulesWithErrors === 0) {
        const localModules = allModules.size
        console.log(Colors.green(pad('Checked')) + `${problems.size} module${sOrNone(localModules)} and found no problems`)
    } else {
        console.log()

        for (const [module, errs] of problems.entries()) {
            totalErrors += errs.length;

            for (const err of errs) {
                console.log(prettyProblem(ctx, module, err))
            }
        }

        console.log(`Found ${totalErrors} problem${sOrNone(totalErrors)} across ${modulesWithErrors} module${sOrNone(modulesWithErrors)} (${problems.size} module${sOrNone(problems.size)} checked)`)
    }
}

const bundleOutput = async () => {
    if (entry == null) return;

    // const result = await Deno.emit(windowsPathToModulePath(bagelFileToTsFile(entryFile)), {
    //     bundle: "classic",
    // });
    // const code = result.files['deno:///bundle.js']
    
    // await Promise.all(Object.entries(result.files).map(([name, code]) => 
    //     Deno.writeTextFile(name, code)))
    // await Deno.writeTextFile(bundleFile, code)

    const esbuild = await import("https://raw.githubusercontent.com/esbuild/deno-esbuild/main/mod.js")
    const httpFetch = (await import("https://deno.land/x/esbuild_plugin_http_fetch@v1.0.3/index.js")).default

    try {
        if(devMode) console.log(Colors.cyan('Info ') + `Began bundling...`)
        await esbuild.build({
            plugins: [ httpFetch ],
            write: true,
            bundle: true,
            minify: false,
            entryPoints: [ bundleEntryPath(entry) ],
            outfile: bundlePath
        })

        const bundleSize = (await Deno.stat(bundlePath)).size
        console.log(Colors.green(pad('Bundled')) + `${bundlePath} (${prettysize(bundleSize)})`)
    } catch (e) {
        if(devMode) console.log(Colors.cyan('Info ') + `Failed to bundle`)
        console.error(e)
    } finally {
        if (command === 'run' || !flags.watch) {
            if(devMode) console.log(Colors.cyan('Info ') + `Done with bundling, stopped esbuild`)
            esbuild.stop()
        }
    }
}

function prettysize(bytes: number): string {
    if (bytes < 1_000) {
        return `${bytes} bytes`
    }
    if (bytes < 1_000_000) {
        return `${(bytes / 1_000).toFixed(1)}KB`
    }
    if (bytes < 1_000_000_000) {
        return `${(bytes / 1_000_000).toFixed(1)}MB`
    }
    return `${(bytes / 1_000_000_000).toFixed(1)}GB`
}

function windowsPathToModulePath(str: string) {
    return str.replaceAll('\\', '/').replace(/^C:/, '/').replace(/^file:\/\/\//i, '')
}

type Tests = {
    readonly testExprs: readonly ({ name: string, expr: unknown })[],
    readonly testBlocks: readonly ({ name: string, block: () => unknown })[]
}

// TODO: Don't run tests in modules outside of the local project or specified directory or file
async function test() {
    let totalModules = 0
    let modulesWithFailures = 0
    let totalSuccesses = 0
    let totalFailures = 0
    let totalTests = 0

    for (const moduleName of allEntries) {
        totalModules++

        try {
            const transpiled = await import(transpilePath(moduleName))
            const tests = transpiled.___tests as Tests | undefined

            if (tests) {
                console.log('\nIn ' + moduleName)
                let failed = false

                function runTest(name: string, err: any) {
                    if (!testFilter || name.includes(testFilter)) {
                        totalTests++
                        let label: string
                        let details = ''

                        if (err == null || err.kind !== ERROR_SYM) {
                            totalSuccesses++
                            label = Colors.green('[Passed]')
                        } else {
                            failed = true
                            totalFailures++
                            label = Colors.red('[Failed]')
                            details = err.value ? ' - ' + err.value : ''
                        }
                        
                        console.log(`    ${label} ${name}${details}`)
                    }
                }

                for (const test of tests.testExprs) {
                    runTest(test.name, test.expr)
                }

                for (const test of tests.testBlocks) {
                    runTest(test.name, test.block())
                }

                if (failed) {
                    modulesWithFailures++
                }
            }
        } catch (e) {
            if(devMode) console.log(Colors.cyan('Info ') + `Error encountered while trying to run tests for module ${moduleName}:`)
            if(devMode) console.error(e)
        }
    }

    console.log(`\nFound ${totalTests} test${sOrNone(totalTests)} across ${totalModules} module${sOrNone(totalModules)}${testFilter ? ` matching filter "${testFilter}"` : ''}; ${Colors.green(String(totalSuccesses) + ' success' + esOrNone(totalSuccesses))}, ${Colors.red(String(totalFailures) + ' failure' + sOrNone(totalFailures))}`)
    Deno.exit(modulesWithFailures > 0 ? 1 : 0)
}

// testInWorker(file.path)
//     .then(failed => {
//         for (const name of failed) {
//             console.error(name)
//         }
//     })

// function testInWorker(fileToTest: string): Promise<string[]> {
//     const code = `
//         // import { tests } from '${fileToTest.replace(/^[a-z]+:/i, '').replaceAll('\\', '/')}.ts';
//         import { tests } from '../tests/sample-files-3/tests-sample.bgl.ts';

//         const failed = [];

//         for (const test of tests.testExprs) {
//             if (test.expr === false) {
//                 failed.push(test.name)
//             }
//         }

//         for (const test of tests.testBlocks) {
//             try {
//                 test.block()
//             } catch {
//                 failed.push(test.name)
//             }
//         }

//         postMessage(JSON.stringify(failed));
//     `
//     console.log(code)

//     const worker = new Worker(`data:text/javascript;base64,${btoa(code)}`, { type: "module" });

//     return new Promise(res => {
//         worker.onmessage = function (event) {
//             res(JSON.parse(event.data))
//         }
//     })
// }

run()