import { Colors, debounce, path, fs } from "./deps.ts";

import { getParentsMap, scopescan } from "./3_checking/scopescan.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { compile, INT } from "./4_compile/index.ts";
import { parse } from "./1_parse/index.ts";
import { reshape } from "./2_reshape/index.ts";
import { BagelError, miscError, prettyError } from "./errors.ts";
import { all, cacheDir, cachedModulePath, esOrNone, given, on, pathIsRemote, sOrNone } from "./utils.ts";
import { Module } from "./_model/ast.ts";

import { ParentsMap, ScopesMap } from "./_model/common.ts";
import { autorun, computed, configure, createTransformer, observable } from "./mobx.ts";

configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});

{ // start
    const command = Deno.args[0]
    const bundle = Deno.args.includes("--bundle");
    const watch = Deno.args.includes("--watch");

    switch (command) {
        case "build": build({ entry: Deno.args[1], bundle, watch, emit: true }); break;
        case "check": build({ entry: Deno.args[1], bundle, watch, emit: false }); break;
        case "test": test(); break; // test(Deno.args[1]); break;
        case "run": throw Error("Unimplemented!"); break;
        case "format": throw Error("Unimplemented!"); break;
        default:
            fail(`Must provide a command: build, check, test, run, format`)
    }
}

const IMPORTED_ITEMS = [ 'autorunUntil',  'observable', 'computed', 'configure', 'makeObservable', 'h', 'render',
'createTransformer', 'range', 'entries', 'log', 'fromEntries', 'Iter', 'RawIter', 'Plan', 'INNER_ITER'
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

async function build({ entry, bundle, watch, emit, includeTests }: { entry: string, bundle?: boolean, watch?: boolean, includeTests?: boolean, emit: boolean }) {
    if (!entry) fail("Bagel: No file or directory provided")
    const entryFileOrDir = path.resolve(Deno.cwd(), entry);
    if (!await fs.exists(entryFileOrDir)) fail(`Bagel: ${entry} not found`)
    const singleEntry = !(await Deno.stat(entryFileOrDir)).isDirectory
    const allFiles = singleEntry ? [ entryFileOrDir ] : await getAllFiles(entryFileOrDir);

    const modules = observable(new Set<string>(allFiles.filter(f => f.match(/\.bgl$/i))));
    const modulesSource = observable(new Map<string, string>())

    fs.ensureDir(cacheDir())

    // Load modules from disk or web
    autorun(async () => {
        for (const module of modules) {
            if (modulesSource.get(module) == null) {
                if (pathIsRemote(module)) {  // http import
                    const path = cachedModulePath(module)
                    if (await fs.exists(path)) {  // module has already been cached locally
                        const source = await Deno.readTextFile(path)
                        modulesSource.set(module, source)
                    } else {  // need to download module before compiling
                        const res = await fetch(module)
    
                        if (res.status === 200) {
                            const source = await res.text()
                            await Deno.writeTextFile(path, source)
                            modulesSource.set(module, source)
                        }
                    }
                } else {  // local disk import
                    const source = await Deno.readTextFile(module)
                    modulesSource.set(module, source)
                }
            }
        }
    })
    
    const parsed = createTransformer((source: string): [Module, readonly BagelError[]] => {
        const errors: BagelError[] = []
        const mod = reshape(parse(source, err => errors.push(err)))
        return [mod, errors]
    });

    const parentsMap = createTransformer(getParentsMap)

    const allParents = computed(() => {
        const set = new Set<ParentsMap>()

        for (const module of modules) {
            const source = modulesSource.get(module)
            
            if (source) {
                const ast = parsed(source)
                set.add(parentsMap(ast[0]))
            }
        }

        return set
    })

    const scopesMap = createTransformer((module: string) => createTransformer((ast: Module): [ScopesMap, readonly BagelError[]] => {
        const errors: BagelError[] = []
        try {
            const scopes = scopescan(
                err => errors.push(err), 
                allParents.get(), 
                new Set(),
                imported => 
                    given(modulesSource.get(canonicalModuleName(module, imported)), 
                        source => parsed(source)[0]), 
                ast
            )
            return [scopes, errors]
        } catch {
            return [new Map(), []]
        }
    }));

    const allScopes = computed(() => {
        const set = new Set<ScopesMap>()

        for (const module of modules) {
            const source = modulesSource.get(module)
            
            if (source) {
                const ast = parsed(source)  
                set.add(scopesMap(module)(ast[0])[0])
            }
        }

        return set
    })

    
    const typeerrors = createTransformer((module: string) => createTransformer((ast: Module): BagelError[] => {
        try {
            const errors: BagelError[] = []
            const [_, scopeErrors] = scopesMap(module)(ast)
            typecheck(
                err => errors.push(err), 
                allParents.get(),
                allScopes.get(), 
                ast
            )
            return [...scopeErrors, ...errors]
        } catch (e) {
            return [ miscError(ast, e.toString()) ]
        }
    }))

    const compiled = createTransformer((module: string) => createTransformer((ast: Module): string => {
        try {
            return (
                LIB_IMPORTS + 
                (ast.hasMain ? MOBX_CONFIGURE : '') + 
                compile(
                    allParents.get(), 
                    allScopes.get(), 
                    ast, 
                    module, 
                    includeTests
                )
            )
        } catch (e) {
            console.error(e)
            return '';
        }
    }))

    // add imported modules to set
    autorun(() => {
        for (const module of modules) {
            const source = modulesSource.get(module)
            if (source) {
                const ast = parsed(source)[0]

                for (const decl of ast.declarations) {
                    if (decl.kind === "import-declaration") {
                        const importedModule = canonicalModuleName(module, decl.path.value)

                        if (!modules.has(importedModule)) {
                            modules.add(importedModule)
                        }
                    }
                }
            }
        }
    })

    const printErrors = debounce((errors: Map<string, BagelError[]>) => {
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
        
    }, 100)
    
    // print errors as they occur
    autorun(() => {
        if (watch) {
            console.clear()
        }

        const allErrors = new Map<string, BagelError[]>()

        for (const module of modules) {
            const source = modulesSource.get(module)
            if (source) {
                const [ast, parseErrors] = parsed(source)
                const errors = [...parseErrors, ...typeerrors(module)(ast)]
                // .filter((err, _, arr) => 
                //     err.kind === "bagel-syntax-error" ||
                //     !arr.some(other =>
                //         other !== err && 
                //         other.kind !== "bagel-syntax-error" && moreSpecificThan(other.ast ?? {}, err.ast ?? {})))

                if (errors.length > 0) {
                    allErrors.set(module, errors)
                }
            }
        }

        printErrors(allErrors)
    })

    // write compiled code to disk
    for (const module of modules) {
        autorun(() => {
            const source = modulesSource.get(module)
            if (source) {
                const jsPath = pathIsRemote(module)
                    ? cachedModulePath(module) + '.ts'
                    : bagelFileToTsFile(module)
            
                const js = compiled(module)(parsed(source)[0])

                Deno.writeFile(jsPath, new TextEncoder().encode(js))
                    .then(() => {
                        // bundle
                        if (singleEntry && bundle) {
                            return bundleOutput(entryFileOrDir)
                        }
                    })
            }
        })
    }

    if (watch) {
        const watchers = new Map<string, Deno.FsWatcher>()

        autorun(() => {
            for (const module of modules) {
                if (watchers.get(module) == null) {
                    const watcher = Deno.watchFs(module);
                    watchers.set(module, watcher);

                    on(watcher, async () => {
                        try {
                            const fileContents = await Deno.readTextFile(module);

                            if (fileContents && fileContents !== modulesSource.get(module)) {
                                modulesSource.set(module, fileContents)
                            }
                        } catch (e) {
                            console.error("Failed to read module " + module + "\n")
                            console.error(e)
                        }
                    })
                }
            }
        })
    }
}

const bundleOutput = async (entryFile: string) => {
    const bundleFile = bagelFileToJsBundleFile(entryFile)

    // const result = await Deno.emit(windowsPathToModulePath(bagelFileToTsFile(entryFile)), {
    //     bundle: "classic",
    // });
    // const code = result.files['deno:///bundle.js']
    
    // // await Promise.all(Object.entries(result.files).map(([name, code]) => 
    // //     Deno.writeTextFile(name, code)))
    // await Deno.writeTextFile(bundleFile, code)

    const esbuild = await import("https://raw.githubusercontent.com/esbuild/deno-esbuild/main/mod.js")
 
    await esbuild.build({
        write: true,
        bundle: true,
        minify: false,
        entryPoints: [ bagelFileToTsFile(entryFile) ],
        outfile: bundleFile
    })
    
    console.log('Bundle written to ' + bundleFile)
}

function test() {
    build({ entry: Deno.cwd(), emit: true, includeTests: true })

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

function bagelFileToTsFile(module: string): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + ".bgl.ts")
}

function bagelFileToJsBundleFile(module: string): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + ".bundle.js")
}

function windowsPathToModulePath(str: string) {
    return str.replaceAll('\\', '/').replace(/^C:/, '/').replace(/^file:\/\/\//i, '')
}

function canonicalModuleName(importerModule: string, importPath: string) {
    if (pathIsRemote(importPath)) {
        return importPath
    } else {
        const moduleDir = path.dirname(importerModule);
        return path.resolve(moduleDir, importPath) + ".bgl"
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