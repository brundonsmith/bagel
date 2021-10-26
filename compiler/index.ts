import { Colors, debounce, path, fs } from "./deps.ts";

import { getParentsMap, pathIsRemote, scopescan } from "./3_checking/scopescan.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { compile, INT } from "./4_compile/index.ts";
import { parse } from "./1_parse/index.ts";
import { reshape } from "./2_reshape/index.ts";
import { BagelError, prettyError } from "./errors.ts";
import { all, cacheDir, cachedModulePath, esOrNone, given, on, sOrNone } from "./utils.ts";
import { Module } from "./_model/ast.ts";

import { observable, autorun, configure } from "https://jspm.dev/mobx"
import { createTransformer } from "https://jspm.dev/mobx-utils"
import { ScopesMap } from "./_model/common.ts";

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
            throw Error(`Must provide a command: build, check, test, run, format`)
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

function bagelFileToTsFile(module: string): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + ".bgl.ts")
}

function bagelFileToJsBundleFile(module: string): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + ".bundle.js")
}

const IMPORTED_ITEMS = [ 'autorunUntil',  'observable', 'computed', 'configure', 'makeObservable', 'h', 'render',
'createTransformer', 'range', 'entries', 'log', 'fromEntries', 'Iter', 'RawIter', 'Plan'
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
    if (!entry) throw Error("Bagel: No file or directory provided")
    const entryFileOrDir = path.resolve(Deno.cwd(), entry);
    const singleEntry = !(await Deno.stat(entryFileOrDir)).isDirectory
    const allFiles = singleEntry ? [ entryFileOrDir ] : await getAllFiles(entryFileOrDir);

    const modules: Set<string> = observable(new Set<string>(allFiles.filter(f => f.match(/\.bgl$/i))));
    const modulesSource: Map<string, string> = observable(new Map())

    fs.ensureDir(cacheDir())

    // Load modules from disk or web
    autorun(async () => {
        for (const module of modules) {
            if (modulesSource.get(module) == null) {
                if (pathIsRemote(module)) {
                    const path = cachedModulePath(module)
                    if (await fs.exists(path)) {
                        const source = await Deno.readTextFile(path)
                        modulesSource.set(module, source)
                    } else {
                        const res = await fetch(module)
    
                        if (res.status === 200) {
                            const source = await res.text()
                            await Deno.writeTextFile(path, source)
                            modulesSource.set(module, source)
                        }
                    }
                } else {
                    const source = await Deno.readTextFile(module)
                    modulesSource.set(module, source)
                }
            }
        }
    })
    
    const _parsed = (source: string): [Module, readonly BagelError[]] => {
        const errors: BagelError[] = []
        const mod = reshape(parse(source, err => errors.push(err)))
        return [mod, errors]
    };
    const parsed: typeof _parsed = createTransformer(_parsed);

    const _scopesMap = (module: string, ast: Module): [ScopesMap, readonly BagelError[]] => {
        const errors: BagelError[] = []
        const scopes = scopescan(err => errors.push(err), parentsMap(ast), imported => given(modulesSource.get(canonicalModuleName(module, imported)), source => parsed(source)[0]), ast)
        return [scopes, errors]
    };
    const scopesMap: (module: string) => (ast: Module) => [ScopesMap, readonly BagelError[]] = createTransformer((module: string) => createTransformer((ast: Module) => _scopesMap(module, ast)));

    const parentsMap: typeof getParentsMap = createTransformer(getParentsMap)

    const _typeerrors = (module: string, ast: Module): BagelError[] => {
        const errors: BagelError[] = []
        const [scopes, scopeErrors] = scopesMap(module)(ast)
        typecheck(err => errors.push(err), parentsMap(ast), scopes, ast)
        return [...scopeErrors, ...errors]
    }
    const typeerrors: (module: string) => (ast: Module) => BagelError[] = createTransformer((module: string) => createTransformer((ast: Module) => _typeerrors(module, ast)));

    const _compiled = (module: string, ast: Module): string => LIB_IMPORTS + (ast.hasMain ? MOBX_CONFIGURE : '') + compile(parentsMap(ast), scopesMap(module)(ast)[0], ast, module, includeTests)
    const compiled: (module: string) => (ast: Module) => string = createTransformer((module: string) => createTransformer((ast: Module) => _compiled(module, ast)));

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

        const allErrors: Map<string, BagelError[]> = new Map()

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
    autorun(() => {
        for (const module of modules) {
            const source = modulesSource.get(module)
            if (source) {
                const jsPath = pathIsRemote(module)
                    ? cachedModulePath(module) + '.ts'
                    : bagelFileToTsFile(module)

               
                const js = compiled(module)(parsed(source)[0])

                Deno.writeFile(jsPath, new TextEncoder().encode(js));

                // bundle
                if (singleEntry && bundle) {
                    bundleOutput(entryFileOrDir)
                }
            }
        }
    })

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

const bundleOutput = debounce(async (entryFile: string) => {
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
        minify: true,
        entryPoints: [ bagelFileToTsFile(entryFile) ],
        outfile: bundleFile
    })
 
    
    console.log('Bundle written to ' + bundleFile)
}, 100)

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

function windowsPathToModulePath(str: string) {
    return str.replaceAll('\\', '/').replace(/^C:/, '/').replace(/^file:\/\/\//i, '')
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
function canonicalModuleName(importerModule: string, importPath: string) {
    if (pathIsRemote(importPath)) {
        return importPath
    } else {
        const moduleDir = path.dirname(importerModule);
        return path.resolve(moduleDir, importPath) + ".bgl"
    }
}
