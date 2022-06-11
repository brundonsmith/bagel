import { Colors, path, fs } from "./deps.ts";

import { BagelError, prettyProblem } from "./errors.ts";
import { all, globalCacheDir, cachedFilePath, esOrNone, sOrNone, pathIsRemote, command, flags, target, POSSIBLE_COMMANDS, isWithin, pathIsInProject, entry as _entry, cacheDir, buildFilePath, buildDir, transpileJsPath } from "./utils/misc.ts";

import { allProblems, canonicalModuleName, done, hasProblems, modules } from "./store.ts";
import { ModuleName } from "./_model/common.ts";
import { autofixed, LintProblem } from "./other/lint.ts";
import { compiled } from "./4_compile/index.ts";
import { formatted } from "./other/format.ts";
import { parsed } from "./1_parse/index.ts";
import { action, autorun, invalidate, observe, runInAction, WHOLE_OBJECT } from "../lib/ts/reactivity.ts";
import { watch } from "./watchers.ts";

async function main() {
    if (command == null) {
        fail(`Must provide a valid command:\n${POSSIBLE_COMMANDS.join(', ')}`)
    } else if (command === 'build' || command === 'run') {
        if (!_entry) {
            fail(`Couldn't find entry '${target}'`)
        } else {
            const entry = _entry as ModuleName
            const bundlePath = path.resolve(
                buildDir,
                path.basename(path.basename(entry) === 'index.bgl' 
                    ? path.dirname(entry)
                    : entry) + '.bundle.js'
            )

            if (flags.clean) {
                // TODO: Only clean modules relevant to entry
                const numFiles = await cleanCache()
                console.log(Colors.yellow(pad('Cleaned')) + 'Bagel cache (' + numFiles + ' files)')
            }

            modules[entry] = { source: undefined, loading: false }; invalidate(modules, entry)

            autorun(async () => {
                if (done()) {       
                    if (!parsed(entry)?.ast.declarations.some(decl => decl.kind === 'proc-declaration' && decl.name.name === 'main')) {
                        fail(`Entry module doesn't have a proc named "main". Entry module is:\n${pad('')}${entry}`)
                    }

                    printProblems(allProblems(), flags.watch)

                    if (!hasProblems()) {
                        await Promise.all([...Object.keys(modules)].map(async _module => {
                            const module = _module as ModuleName
                            const jsPath = buildFilePath(module)
                            const js = compiled(module, 'build-dir')
                            
                            // TODO: in run mode, we need to put built files in global build dir
            
                            await fs.ensureDir(path.dirname(jsPath))
                            await Deno.writeTextFile(jsPath, js)
                        }))

                        if (command === 'build') {
                            await bundleOutput(
                                buildFilePath(entry),
                                bundlePath,
                                !flags.watch
                            )

                            if (!flags.watch) {
                                Deno.exit(0)
                            }
                        } else if (command === 'run') {
                            await bundleOutput(
                                buildFilePath(entry),
                                bundlePath,
                                true
                            )

                            const nodePath = Deno.env.get('BAGEL_NODE_BIN')
                            const denoPath = Deno.env.get('BAGEL_DENO_BIN')
                            
                            const nodeCommand = [nodePath || "node", bundlePath]
                            const denoCommand = [denoPath || "deno", "run", "--unstable", "--allow-all", bundlePath]

                            if (flags.node) {
                                console.log(Colors.green('Running (node) ') + bundlePath)
                                await Deno.run({ cmd: nodeCommand }).status()
                                Deno.exit(0)
                            } else if (flags.deno) {
                                console.log(Colors.green('Running (deno) ') + bundlePath)
                                await Deno.run({ cmd: denoCommand }).status()
                                Deno.exit(0)
                            } else if (nodePath) {
                                console.log(Colors.green('Running (' + nodePath + ')     ') + bundlePath)
                                await Deno.run({ cmd: nodeCommand }).status()
                                Deno.exit(0)
                            } else if (denoPath) {
                                console.log(Colors.green('Running (' + denoPath + ')     ') + bundlePath)
                                await Deno.run({ cmd: denoCommand }).status()
                                Deno.exit(0)
                            } else {
                                try {
                                    await Deno.run({ cmd: ["node", "-v"], stdout: 'piped' }).status()
                                    console.log(Colors.green('Running (node) ') + bundlePath)
                                    await Deno.run({ cmd: nodeCommand }).status()
                                    Deno.exit(0)
                                } catch {
                                    try {
                                        await Deno.run({ cmd: ["deno", "--version"], stdout: 'piped' }).status()
                                        console.log(Colors.green('Running (deno) ') + bundlePath)
                                        await Deno.run({ cmd: denoCommand }).status()
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
                }
            }, undefined)
        }
    } else if (command === 'transpile' || command === 'check' || command === 'test' || command === 'format' || command === 'autofix' || command === 'clean') {
        if (!(await fs.exists(target))) {
            fail(`Couldn't find '${target}'`)
        } else {
            if (command === 'clean' || flags.clean) {
                // TODO: Only clean modules relevant to target
                const numFiles = await cleanCache()
                console.log(Colors.yellow(pad('Cleaned')) + 'Bagel cache (' + numFiles + ' files)')
            }

            if (command !== 'clean') {
                const info = await Deno.stat(target)
                const allModules = (
                    info.isDirectory
                        ? (await getAllFiles(target)).filter(f => f.match(/.*\.bgl$/))
                        : [ target ]
                ) as ModuleName[]
                
                runInAction(() => {
                    for (const module of allModules) {
                        modules[module] = { source: undefined, loading: false }; invalidate(modules, module)
                    }
                })

                if (command === 'transpile' || command === 'check') {
                    autorun(async () => {
                        if (done()) {
                            printProblems(allProblems(), flags.watch)

                            if (command === 'transpile' && !hasProblems()) {                                                            
                                await Promise.all([...Object.keys(modules)].map(async _module => {
                                    const module = _module as ModuleName
                                    const jsPath = transpileJsPath(module)
                                    const js = compiled(module, 'adjacent')

                                    await Deno.writeTextFile(jsPath, js)
                                }))
        
                                const localModules = [...Object.entries(modules)].filter(([module]) => pathIsInProject(module)).length
                                console.log(Colors.green(pad('Transpiled')) + `${localModules} Bagel file${sOrNone(localModules)}`)
                            }

                            if (!flags.watch) {
                                Deno.exit(
                                    hasProblems()
                                        ? 1
                                        : 0
                                )
                            }
                        }
                    }, undefined)
                } else if (command === 'format') {
                    observe(modules, WHOLE_OBJECT)

                    await Promise.all([...Object.entries(modules)]
                        .filter(([module]) => pathIsInProject(module))
                        .map(([module]) =>
                            Deno.writeTextFile(module, formatted(module as ModuleName))))
                } else if (command === 'autofix') {
                    observe(modules, WHOLE_OBJECT)

                    await Promise.all([...Object.entries(modules)]
                        .filter(([module]) => pathIsInProject(module))
                        .map(([module]) =>
                            Deno.writeTextFile(module, autofixed(module as ModuleName))))
                }
            }

        }
    } else if (command === 'new' || command === 'init') {
        if (await fs.exists(target)) {
            if (command === 'new') {
                fail(`Cannot create project directory ${target} because it already exists`)
            } else if (command === 'init') {
                fail(`Can't initialize Bagel project here because one already exists`)
            }
        } else {
            if (command === 'new') {
                await fs.ensureDir(target)
                await Deno.writeTextFile(path.resolve(target, 'index.bgl'), DEFAULT_INDEX_BGL)
                console.log(Colors.green(pad('Created')) + `new Bagel project ${target}`)
            } else if(command === 'init') {
                await Deno.writeTextFile(path.resolve(Deno.cwd(), 'index.bgl'), DEFAULT_INDEX_BGL)
                console.log(Colors.green(pad('Initialized')) + `Bagel project in current directory`)
            }
        }
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

function printProblems (problems: Map<ModuleName, (BagelError|LintProblem)[]>, clearConsole: boolean) {
    if (clearConsole) {
        console.clear()
    }

    let totalErrors = 0;

    const modulesWithErrors = new Array(...problems.values()).filter(errs => errs.length > 0).length

    if (modulesWithErrors === 0) {
        const localModules = [...Object.entries(modules)].length
        console.log(Colors.green(pad('Checked')) + `${problems.size} module${sOrNone(localModules)} and found no problems`)
    } else {
        console.log()

        for (const [module, errs] of problems.entries()) {
            totalErrors += errs.length;

            for (const err of errs) {
                console.log(prettyProblem(module, err))
            }
        }

        console.log(`Found ${totalErrors} problem${sOrNone(totalErrors)} across ${modulesWithErrors} module${sOrNone(modulesWithErrors)} (${problems.size} module${sOrNone(problems.size)} checked)`)
    }
}

async function cleanCache() {
    let numFiles = 0;

    for await (const file of Deno.readDir(globalCacheDir)) {
        numFiles++
        await Deno.remove(path.resolve(globalCacheDir, file.name))
    }

    return numFiles
}

// TODO when auto-detecting runtime, incorporate platform-specific functions/procs/consts?

// Utils
const bundleOutput = async (entryFile: string, outfile: string, stopWhenDone: boolean) => {

    // const result = await Deno.emit(windowsPathToModulePath(bagelFileToTsFile(entryFile)), {
    //     bundle: "classic",
    // });
    // const code = result.files['deno:///bundle.js']
    
    // // await Promise.all(Object.entries(result.files).map(([name, code]) => 
    // //     Deno.writeTextFile(name, code)))
    // await Deno.writeTextFile(bundleFile, code)

    const esbuild = await import("https://raw.githubusercontent.com/esbuild/deno-esbuild/main/mod.js")
    const httpFetch = (await import("https://deno.land/x/esbuild_plugin_http_fetch@v1.0.3/index.js")).default

    try {
        await esbuild.build({
            plugins: [ httpFetch ],
            write: true,
            bundle: true,
            minify: false,
            entryPoints: [ entryFile ],
            outfile
        })

        const bundleSize = (await Deno.stat(outfile)).size
        console.log(Colors.green(pad('Bundled')) + `${outfile} (${prettysize(bundleSize)})`)
    } catch (e) {
        console.error(e)
    } finally {
        if (stopWhenDone) {
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

export function fail(msg: string): any {
    console.error(Colors.red(pad('Failed')) + msg)
    Deno.exit(1)
}

export function pad(str: string): string {
    const targetLength = 11;
    let res = str
    while (res.length < targetLength) {
        res += ' '
    }
    return res
}

async function test() {
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

const setSource = action((module: ModuleName, source: string) => {
    const data = observe(modules, module)

    if (source !== data.source) {
        data.source = source; invalidate(data, 'source')
        addImportedModules(module)
    }
})

function addImportedModules(module: ModuleName) {
    const parseResult = parsed(module)
    
    if (parseResult) {
        runInAction(() => {
            for (const decl of parseResult.ast.declarations) {
                if (decl.kind === "import-declaration" || decl.kind === "import-all-declaration") {
                    const importedModule = canonicalModuleName(module, decl.path.value)
    
                    if (observe(modules, importedModule) == null) {
                        modules[importedModule] = {
                            source: undefined,
                            loading: false,
                        }; invalidate(modules, importedModule)
                    }
                }
            }
        })
    }
}

// Load modules from disk or web
autorun(async function loadSource() {
    for (const [_module, data] of Object.entries(observe(modules, WHOLE_OBJECT))) {
        const module = _module as ModuleName
        const isRemote = pathIsRemote(module)
        const cachePath = cachedFilePath(module)
        const isCachable = isRemote || !pathIsInProject(module)

        if (observe(data, 'source') == null && !observe(data, 'loading')) {
            data.loading = true; invalidate(data, 'loading')
            
            async function setAndCache(source: string) {
                if (isCachable) {
                    try {
                        await fs.ensureDir(cacheDir)
                        await Deno.writeTextFile(cachePath, source)
                    } catch {
                        console.warn(Colors.yellow(pad('Warning')) + `failed writing cache of module ${module}`)
                    }
                }

                setSource(module, source)
                data.loading = false; invalidate(data, 'loading')
            }

            async function loadModule() {
                if (isRemote) {
                    await fetch(module)
                        .then(async res => {
                            if (res.status === 200) {
                                console.log(Colors.green(pad('Downloaded')) + module)
                                const source = await res.text()

                                await setAndCache(source)
                            } else {
                                if (await fs.exists(cachePath)) {
                                    await Deno.remove(cachePath)
                                }
                                fail(module)
                            }
                        })
                        .catch(() => {
                            console.error(Colors.red(pad('Error')) + `couldn't load remote module '${module}'`)
                        })
                } else {
                    watch(module, setAndCache)

                    await Deno.readTextFile(module)
                        .then(setAndCache)
                        .catch(() => {
                            console.error(Colors.red(pad('Error')) + `couldn't find local module '${module}'`)
                        })
                }
            }

            if (isRemote && await fs.exists(cachePath)) {
                Deno.readTextFile(cachePath)
                    .then(setAndCache)
                    .catch(loadModule)
            } else {
                loadModule()
            }
        }
    }
}, undefined)


await main();