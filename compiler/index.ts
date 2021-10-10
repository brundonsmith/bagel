import { path, walk } from "./deps.ts";

import { canonicalModuleName, getParentsMap, scopescan } from "./3_checking/scopescan.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { compile, HIDDEN_IDENTIFIER_PREFIX } from "./4_compile/index.ts";
import { parse } from "./1_parse/index.ts";
import { reshape } from "./2_reshape/index.ts";
import { printError, BagelError } from "./errors.ts";
import { given, on } from "./utils.ts";
import { Module } from "./_model/ast.ts";

import { observable, action, autorun, configure } from "https://jspm.dev/mobx"
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
        case "build": buildMobX({ entry: Deno.args[1], bundle, watch, emit: true }); break;
        case "check": buildMobX({ entry: Deno.args[1], bundle, watch, emit: false }); break;
        case "test": throw Error("Unimplemented!"); break; // test(Deno.args[1]); break;
        case "run": throw Error("Unimplemented!"); break;
        case "format": throw Error("Unimplemented!"); break;
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

const IMPORTED_ITEMS = ['observable', 'computed', 'reactionUntil', 'configure', 
'h', 'render', 'range', 'entries', 'log', 'fromEntries', 'Iter', 'RawIter', 'Plan'
].map(s => `${s} as ${HIDDEN_IDENTIFIER_PREFIX}${s}`).join(', ')

const LIB_IMPORTS = `
import { ${IMPORTED_ITEMS} } from "../../lib/src/core.ts";

___configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});
`

async function buildMobX({ entry, bundle, watch, emit }: { entry: string, bundle?: boolean, watch?: boolean, emit: boolean }) {
    if (!entry) throw Error("Bagel: No file or directory provided")
    const entryFileOrDir = path.resolve(Deno.cwd(), entry);
    const singleEntry = !(await Deno.stat(entryFileOrDir)).isDirectory
    const allFiles = singleEntry ? [ entryFileOrDir ] : await getAllFiles(entryFileOrDir);

    const modules: Set<string> = observable(new Set<string>(allFiles.filter(f => f.match(/\.bgl$/i))));
    const modulesSource: Map<string, string> = observable(new Map())

    // HACK
    autorun(() => {
        for (const module of modules) {
            if (modulesSource.get(module) == null) {
                Deno.readTextFile(module).then(action((source: string) => {
                    modulesSource.set(module, source)
                }))
            }
        }
    })
    
    const _parsed = (module: string, source: string): Module =>
        reshape(parse(source, printError(path.basename(module))));
    const parsed: (module: string) => (source: string) => Module = createTransformer((module: string) => createTransformer((source: string) => _parsed(module, source)));

    const _scopesMap = (module: string, ast: Module): ScopesMap =>
        scopescan(printError(path.basename(module)), parentsMap(ast), module => given(modulesSource.get(module), source => parsed(module)(source)), ast, module);
    const scopesMap: (module: string) => (ast: Module) => ScopesMap = createTransformer((module: string) => createTransformer((ast: Module) => _scopesMap(module, ast)));

    const parentsMap: typeof getParentsMap = createTransformer(getParentsMap)

    const _typeerrors = (module: string, ast: Module): BagelError[] => {
        const errors: BagelError[] = []
        typecheck(err => errors.push(err), parentsMap(ast), scopesMap(module)(ast), ast)
        return errors
    }
    const typeerrors: (module: string) => (ast: Module) => BagelError[] = createTransformer((module: string) => createTransformer((ast: Module) => _typeerrors(module, ast)));

    const _compiled = (module: string, ast: Module): string => LIB_IMPORTS + compile(parentsMap(ast), scopesMap(module)(ast), ast)
    const compiled: (module: string) => (ast: Module) => string = createTransformer((module: string) => createTransformer((ast: Module) => _compiled(module, ast)));

    // add imported modules to set
    autorun(() => {
        for (const module of modules) {
            const source = modulesSource.get(module)
            if (source) {
                const ast = parsed(module)(source)
                // console.log({ ast })
                for (const decl of ast.declarations) {
                    if (decl.kind === "import-declaration") {
                        // console.log({ decl })
                        const importedModule = canonicalModuleName(module, decl.path)

                        if (!modules.has(importedModule)) {
                            modules.add(importedModule)
                        }
                    }
                }
            }
        }
    })

    // print errors as they occur
    setTimeout(() => {
        autorun(() => {
            for (const module of modules) {
                const source = modulesSource.get(module)
                if (source) {
                    const ast = parsed(module)(source)
                    for (const err of typeerrors(module)(ast)) {
                        printError(module)(err)
                    }
                }
            }
        })
    }, 1000)

    // write compiled code to disk
    autorun(() => {
        for (const module of modules) {
            const source = modulesSource.get(module)
            if (source) {
                const jsPath = bagelFileToTsFile(module);
                const js = compiled(module)(parsed(module)(source))
                Deno.writeFile(jsPath, new TextEncoder().encode(js));
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

async function bundleOutput(entryFile: string) {
    const esbuild = await import("https://raw.githubusercontent.com/esbuild/deno-esbuild/main/mod.js")
 
    await esbuild.build({
        write: true,
        bundle: true,
        minify: true,
        entryPoints: [ bagelFileToTsFile(entryFile) ],
        outfile: bagelFileToJsBundleFile(entryFile)
    })
 
    console.log('done')
}

// function test(filePattern?: string) {
//     const filesToTest = walk(Deno.cwd(), {
//         match: given(filePattern, pattern => [ new RegExp(pattern) ]),
//         exts: ['.bgl']
//     })

//     for await (const file of filesToTest) {
//         if (file.isFile) {
//             (async function() {
//                 const module = (await build({ entry: file.path, emit: true })) as Module
//                 const tests = module.declarations
//                     // .filter(decl => decl.kind === "test-declaration")
//                     // .map(decl => decl.name.name)

//                 for (const test of tests) {
                    
//                 }
//             })()
//         }
//     }
// }