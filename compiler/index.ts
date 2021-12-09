import { Colors, path, fs } from "./deps.ts";

import { BagelError, prettyError } from "./errors.ts";
import { all, cacheDir, cachedModulePath, esOrNone, given, ModuleName, on, pathIsRemote, sOrNone } from "./utils.ts";

import { autorun, configure, runInAction } from "./mobx.ts";
import Store from "./store.ts";
import { display } from "./debugging.ts";

configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});

async function main() {
    const command = Deno.args[0]
    const entry = command === 'test' ? Deno.cwd() : Deno.args[1]
    const bundle = Deno.args.includes("--bundle");
    const watch = Deno.args.includes("--watch");
    const includeTests = command === 'test'
    const emit = command === 'build'

    if (!command) fail(`Must provide a command: build, check, test, run, format`)
    if (!entry) fail("Bagel: No file or directory provided")

    const entryFileOrDir = path.resolve(Deno.cwd(), entry) as ModuleName;
    if (!await fs.exists(entryFileOrDir)) fail(`Bagel: ${entry} not found`)
    const singleEntry = !(await Deno.stat(entryFileOrDir)).isDirectory
    const allFiles = singleEntry ? [ entryFileOrDir ] : await getAllFiles(entryFileOrDir);

    fs.ensureDir(cacheDir())
    
    runInAction(() => {
        Store.config = { entryFileOrDir, singleEntry, bundle, watch, emit, includeTests }
        Store.modules = new Set(allFiles.filter(f => f.match(/\.bgl$/i)) as ModuleName[])
    })

    // switch (command) {
    //     case "build": await build({ entry: Deno.args[1], bundle, watch, emit: true }); break;
    //     case "check": await build({ entry: Deno.args[1], bundle, watch, emit: false }); break;
    //     case "test": test(); break; // test(Deno.args[1]); break;
    //     case "run": throw Error("Unimplemented!"); break;
    //     case "format": throw Error("Unimplemented!"); break;
    //     default:
    //         fail(`Must provide a command: build, check, test, run, format`)
    // }
}

// Load modules from disk or web
autorun(async () => {
    for (const module of Store.modules) {
        if (Store.modulesSource.get(module) == null) {
            if (pathIsRemote(module)) {  // http import
                const path = cachedModulePath(module)
                if (await fs.exists(path)) {  // module has already been cached locally
                    const source = await Deno.readTextFile(path)
                    Store.modulesSource.set(module, source)
                } else {  // need to download module before compiling
                    const res = await fetch(module)

                    if (res.status === 200) {
                        const source = await res.text()
                        await Deno.writeTextFile(path, source)
                        Store.modulesSource.set(module, source)
                    }
                }
            } else {  // local disk import
                const source = await Deno.readTextFile(module)
                Store.modulesSource.set(module, source)
            }
        }
    }
})

// add imported modules to set
autorun(() => {
    for (const module of Store.modules) {
        const source = Store.modulesSource.get(module)
        if (source) {
            const { ast } = Store.parsed(source)

            for (const decl of ast.declarations) {
                if (decl.kind === "import-declaration") {
                    const importedModule = canonicalModuleName(module, decl.path.value)

                    if (!Store.modules.has(importedModule)) {
                        Store.modules.add(importedModule)
                    }
                }
            }
        }
    }
})

// print errors as they occur
autorun(() => {
    const config = Store.config

    if (config != null && !Store.modulesOutstanding) {
        const allErrors = new Map<ModuleName, BagelError[]>()
        
        for (const module of Store.modules) {
            allErrors.set(module, [])
        }

        for (const module of Store.modules) {
            const source = Store.modulesSource.get(module)

            if (source) {
                const { ast, errors: parseErrors } = Store.parsed(source)

                for (const err of parseErrors) {
                    const errorModule = given(err.ast, Store.getModuleFor) ?? module;
                    (allErrors.get(errorModule) as BagelError[]).push(err)
                }

                const typecheckErrors = Store.typeerrors(module, ast)
                
                for (const err of typecheckErrors) {
                    const errorModule = given(err.ast, Store.getModuleFor) ?? module;
                    (allErrors.get(errorModule) as BagelError[]).push(err)
                }
            }
        }

        printErrors(allErrors, config.watch)
    }
})

// write compiled code to disk
autorun(() => {
    const config = Store.config

    if (config != null && !Store.modulesOutstanding) {
        const compiledModules = [...Store.modulesSource.entries()].map(([module, source]) => ({
            jsPath: pathIsRemote(module)
                ? cachedModulePath(module) + '.ts'
                : bagelFileToTsFile(module),
            js: Store.compiled(module, Store.parsed(source).ast)
        }))

        if (config.emit && !Store.modulesOutstanding) {
            Promise.all(compiledModules.map(({ jsPath, js }) =>
                    Deno.writeTextFile(jsPath, js)))
                .then(() => {
                    // bundle
                    if (config.singleEntry && config.bundle) {
                        bundleOutput(config.entryFileOrDir)
                    }
                })
        }
    }
})

// if watch mode is enabled, reload files from disk when changes detected
const watchers = new Map<ModuleName, Deno.FsWatcher>()

autorun(() => {
    const config = Store.config

    if (config != null && config.watch) {
        for (const module of Store.modules) {
            if (watchers.get(module) == null) {
                const watcher = Deno.watchFs(module);
                watchers.set(module, watcher);

                on(watcher, async () => {
                    try {
                        const fileContents = await Deno.readTextFile(module);

                        if (fileContents && fileContents !== Store.modulesSource.get(module)) {
                            Store.modulesSource.set(module, fileContents)
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

/**
 * Print list of errors
 */
const printErrors = (errors: Map<ModuleName, BagelError[]>, watch?: boolean) => {
    if (watch) {
        console.clear()
    }

    let totalErrors = 0;

    if (errors.size === 0) {
        console.log('No errors')
    } else {
        console.log()

        for (const [module, errs] of errors.entries()) {
            totalErrors += errs.length;

            for (const err of errs) {
                console.log(prettyError(module, err))
            }
        }

        console.log(`Found ${totalErrors} error${sOrNone(totalErrors)} across ${errors.size} module${sOrNone(errors.size)}`)
    }
}
    
const bundleOutput = async (entryFile: ModuleName) => {
    const bundleFile = bagelFileToJsBundleFile(entryFile)

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
            entryPoints: [ bagelFileToTsFile(entryFile) ],
            outfile: bundleFile
        })

        console.log('Bundle written to ' + bundleFile)
    } catch {
    } finally {
        esbuild.stop()
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

function bagelFileToTsFile(module: ModuleName): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + ".bgl.ts")
}

function bagelFileToJsBundleFile(module: ModuleName): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + ".bundle.js")
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

function fail(msg: string) {
    console.error(msg)
    Deno.exit(1)
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