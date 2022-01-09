import { Colors, path, fs } from "./deps.ts";

import { BagelError, prettyError } from "./errors.ts";
import { all, cacheDir, cachedFilePath, esOrNone, on, pathIsRemote, sOrNone, bagelFileToTsFile, jsFileLocation } from "./utils/misc.ts";

import { autorun, configure } from "./mobx.ts";
import Store, { Mode } from "./store.ts";
import { ModuleName } from "./_model/common.ts";

configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});

async function modeFromArgs(args: string[]): Promise<Mode> {
    const mode = args[0]
    const providedEntry =  path.resolve(Deno.cwd(), args[1] ?? './')
    const watch = args.includes("--watch");
    const platform = (
        args.includes('--node') ? 'node' :
        args.includes('--deno') ? 'deno' :
        undefined
    )

    switch (mode) {
        case "build":
        case "run": {
            // single file entry
            const entryFile = await (async () => {
                if ((await Deno.stat(providedEntry)).isDirectory) {
                    const index = path.resolve(providedEntry, 'index.bgl')
        
                    if ((await Deno.stat(index)).isFile) {
                        return index;
                    } else {
                        return fail(`Could not find index.bgl in directory ${providedEntry}`);
                    }
                } else {
                    return providedEntry;
                }
            })()

            return { mode, entryFile, watch, platform }
        }
        case "check":
        case "transpile":
        case "test":
        case "format": {
            // operate on whole subdirectory
            if (!(await fs.exists(providedEntry))) {
                fail(`${providedEntry} not found`)
            }

            return { mode, fileOrDir: providedEntry, watch, platform }
        }
        default:
            return fail(`Must provide a command: build, check, test, run, transpile`)
    }
} 

async function main() {
    const mode = await modeFromArgs(Deno.args)

    await fs.ensureDir(cacheDir())

    Store.start(mode)
}

// Load modules from disk or web
autorun(async () => {
    for (const module of Store.modules) {
        if (Store.modulesSource.get(module) == null) {
            if (pathIsRemote(module)) {  // http import
                const path = cachedFilePath(module)
                if (await fs.exists(path)) {  // module has already been cached locally
                    const source = await Deno.readTextFile(path)
                    Store.setSource(module, source)
                } else {  // need to download module before compiling
                    const res = await fetch(module)

                    if (res.status === 200) {
                        const source = await res.text()
                        await Deno.writeTextFile(path, source)
                        Store.setSource(module, source)
                    }
                }
            } else {  // local disk import
                const source = await Deno.readTextFile(module)
                Store.setSource(module, source)
            }
        }
    }
})

// add imported modules to set
autorun(() => {
    for (const module of Store.modules) {
        const parsed = Store.parsed(module)

        if (parsed) {
            for (const decl of parsed.ast.declarations) {
                if (decl.kind === "import-declaration") {
                    const importedModule = canonicalModuleName(module, decl.path.value)

                    if (!Store.modules.has(importedModule)) {
                        Store.registerModule(importedModule)
                    }
                }
            }
        }
    }
})

/**
 * Print list of errors
 */
function printErrors(errors: Map<ModuleName, BagelError[]>, watch?: boolean) {
    if (watch) {
        console.clear()
    }

    let totalErrors = 0;

    const modulesWithErrors = new Array(...errors.values()).filter(errs => errs.length > 0).length

    if (modulesWithErrors === 0) {
        console.log('No errors')
    } else {
        console.log()

        for (const [module, errs] of errors.entries()) {
            totalErrors += errs.length;

            for (const err of errs) {
                console.log(prettyError(module, err))
            }
        }

        console.log(`Found ${totalErrors} error${sOrNone(totalErrors)} across ${modulesWithErrors} module${sOrNone(modulesWithErrors)}`)
    }
}
    
// print errors as they occur
autorun(() => {
    if (Store.done) {
        printErrors(Store.allErrors, Store.mode?.watch)
    }
})

// write compiled code to disk
autorun(() => {
    const mode = Store.mode;
    if (Store.done && (mode?.mode === 'transpile' || mode?.mode === 'build' || mode?.mode === 'run')) {
        const compiledModules = [...Store.modulesSource.keys()].map(module => ({
            jsPath: jsFileLocation(module, mode),
            js: Store.compiled(module)
        }))

        Promise.all(compiledModules.map(({ jsPath, js }) =>
                Deno.writeTextFile(jsPath, js)))
            .then(() => {
                // bundle
                if (mode?.mode === 'build') {
                    bundleOutput(
                        cachedFilePath(mode.entryFile + '.ts'), 
                        bagelFileToTsFile(mode.entryFile, true)
                    )
                } else if (mode?.mode === 'run') {
                    bundleOutput(
                        cachedFilePath(mode.entryFile + '.ts'), 
                        cachedFilePath(bagelFileToTsFile(mode.entryFile, true))
                    )
                }
            })
    }
})

// run bundle or tests, if needed
autorun(() => {
    if (Store.done) {
        if (Store.mode?.mode === 'run') {
            const bundlePath = cachedFilePath(bagelFileToTsFile(Store.mode.entryFile, true))
            
            if (Store.mode?.platform === 'node') {
                Deno.run({ cmd: ["node", bundlePath] })
            } else if (Store.mode?.platform === 'deno') {
                Deno.run({ cmd: ["deno", "run", bundlePath, "--allow-all", "--unstable"] })
            } else {
                throw Error('TODO: Auto-detect platform')
            }
        } else if (Store.mode?.mode === 'test') {
            throw Error('TODO: Run tests')
        }
    }
})

// if watch mode is enabled, reload files from disk when changes detected
const watchers = new Map<ModuleName, Deno.FsWatcher>()

autorun(() => {
    if (Store.mode?.watch) {
        for (const module of Store.modules) {
            if (watchers.get(module) == null) {
                const watcher = Deno.watchFs(module);
                watchers.set(module, watcher);

                on(watcher, async () => {
                    try {
                        const fileContents = await Deno.readTextFile(module);

                        if (fileContents && fileContents !== Store.modulesSource.get(module)) {
                            Store.setSource(module, fileContents)
                        }
                    } catch (e) {
                        console.error("Failed to read module " + module + "\n")
                        console.error(e)
                    }
                })
            }
        }
    }
})


// Utils

const bundleOutput = async (entryFile: string, outfile: string) => {

    // const result = await Deno.emit(windowsPathToModulePath(bagelFileToTsFile(entryFile)), {
    //     bundle: "classic",
    // });
    // const code = result.files['deno:///bundle.js']
    
    // // await Promise.all(Object.entries(result.files).map(([name, code]) => 
    // //     Deno.writeTextFile(name, code)))
    // await Deno.writeTextFile(bundleFile, code)

    const esbuild = await import("https://raw.githubusercontent.com/esbuild/deno-esbuild/main/mod.js")

    try {
        await esbuild.build({
            write: true,
            bundle: true,
            minify: false,
            entryPoints: [ entryFile ],
            outfile
        })

        console.log('Bundle written to ' + outfile)
    } catch {
    } finally {
        esbuild.stop()
    }
}

function windowsPathToModulePath(str: string) {
    return str.replaceAll('\\', '/').replace(/^C:/, '/').replace(/^file:\/\/\//i, '')
}

function canonicalModuleName(importerModule: ModuleName, importPath: string): ModuleName {
    if (pathIsRemote(importPath)) {
        return importPath as ModuleName
    } else {
        const moduleDir = path.dirname(importerModule);
        return (path.resolve(moduleDir, importPath) + ".bgl") as ModuleName
    }
}

function fail(msg: string): any {
    console.error(msg)
    Deno.exit(1)
}


function test() {
    // build({ entry: Deno.cwd(), emit: true, includeTests: true })

    setTimeout(async () => {
        const thisModulePath = windowsPathToModulePath(path.dirname(import.meta.url))

        const filesToTest = await all(fs.walk(Deno.cwd(), {
            // match: given(filePattern, pattern => [ new RegExp(pattern) ]),
            exts: ['.bgl']
        }))
    
        const allTests: { [key: string]: { name: string, passed: boolean }[] } = {}

        for (const file of filesToTest) {
            if (file.isFile) {
                const moduleDir = windowsPathToModulePath(path.dirname(file.path))
                const moduleName = path.basename(file.path)
                const modulePath = windowsPathToModulePath(path.relative(thisModulePath, moduleDir)) + '/' + moduleName

                const { tests } = await import(modulePath + '.ts')
                
                if (tests.testExprs.length > 0 || tests.testBlocks.length > 0) {
                    allTests[modulePath] = []
                }

                for (const test of tests.testExprs) {
                    if (test.expr === false) {
                        allTests[modulePath].push({ name: test.name, passed: false })
                    } else {
                        allTests[modulePath].push({ name: test.name, passed: true })
                    }
                }

                for (const test of tests.testBlocks) {
                    try {
                        test.block()
                        allTests[modulePath].push({ name: test.name, passed: true })
                    } catch {
                        allTests[modulePath].push({ name: test.name, passed: false })
                    }
                }
            }
        }

        const totalModules = Object.keys(allTests).length
        const modulesWithFailures = Object.keys(allTests).filter(module => allTests[module].some(m => !m.passed)).length
        const totalSuccesses = Object.keys(allTests).map(module => allTests[module].filter(m => m.passed)).flat().length
        const totalFailures = Object.keys(allTests).map(module => allTests[module].filter(m => !m.passed)).flat().length
        const totalTests = totalSuccesses + totalFailures

        for (const module of Object.keys(allTests)) {
            console.log('\nIn ' + module)
            for (const test of allTests[module]) {
                const label = test.passed ? Colors.green('[Passed]') : Colors.red('[Failed]')
                console.log(`    ${label} ${test.name}`)
            }
        }

        console.log(`\nFound ${totalTests} test${sOrNone(totalTests)} across ${totalModules} module${sOrNone(totalModules)}; ${Colors.green(String(totalSuccesses) + ' success' + esOrNone(totalSuccesses))}, ${Colors.red(String(totalFailures) + ' failure' + sOrNone(totalFailures))}`)
        Deno.exit(modulesWithFailures > 0 ? 1 : 0)
    }, 1000)
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

await main();