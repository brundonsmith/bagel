import { path } from "./deps.ts";

import { ModulesStore } from "./3_checking/modules-store.ts";
import { canonicalModuleName, scopescan } from "./3_checking/scopescan.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { typescan } from "./3_checking/typescan.ts";
import { compile, HIDDEN_IDENTIFIER_PREFIX } from "./4_compile/index.ts";
import { parse } from "./1_parse/index.ts";
import { reshape } from "./2_reshape/index.ts";
import { printError } from "./utils.ts";

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

function bagelFileToTsFile(module: string, bundle?: boolean): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + (bundle ? ".bundle" : "") + ".bgl.ts")
}

const IMPORTED_ITEMS = ['observable', 'computed', 'reactionUntil', 'configure', 
'h', 'render', 'range', 'entries', 'log', 'floor', 'arrayFrom', 'fromEntries', 'Iter', 'RawIter'
].map(s => `${s} as ${HIDDEN_IDENTIFIER_PREFIX}${s}`).join(', ')

const LIB_IMPORTS = `
import { ${IMPORTED_ITEMS} } from "../../lib/src/index.ts";

___configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});
`

{
    const fileOrDirArg = Deno.args[0]
    if (!fileOrDirArg) throw Error("Bagel: No file or directory provided")
    const fileOrDir = path.resolve(Deno.cwd(), fileOrDirArg);
    const allFiles = (await Deno.stat(fileOrDir)).isDirectory ? await getAllFiles(fileOrDir) : [ fileOrDir ];
    // const outDir = Deno.args[1] || path.dirname(fileOrDir);
    // const bundle = true;
    const watch = Deno.args.includes("--watch");
    const emit = !Deno.args.includes("--noEmit");
    
    const modulesStore = new ModulesStore();
    
    const allModules = new Set<string>(allFiles.filter(f => f.match(/\.bgl$/i)));
    const doneModules = new Set<string>();

    let timeSpentParsing = 0;

    // parse all modules
    while (doneModules.size < allModules.size) {
        const module = Array.from(allModules).find(m => !doneModules.has(m)) as string;
        doneModules.add(module);
    
        if (!modulesStore.modules.has(module)) {
            try {
                const fileContents = await Deno.readTextFile(module);
            
                const startParse = Date.now();
                const parsed = reshape(parse(fileContents, printError(path.basename(module))));
                timeSpentParsing += Date.now() - startParse;

                for (const declaration of parsed.declarations) {
                    if (declaration.kind === "import-declaration") {
                        const importedModule = canonicalModuleName(module, declaration.path);
                        allModules.add(importedModule);
                    }
                }

                modulesStore.modules.set(module, parsed);
            } catch (e) {
                console.error("Failed to read module " + module + "\n")
                console.error(e)
            }
        }
    }

    const startTypecheck = Date.now();
    // scopescan all parsed modules
    for (const [module, ast] of modulesStore.modules) {
        scopescan(printError(path.basename(module)), modulesStore, ast, module);
    }

    // typescan all parsed modules
    for (const [module, ast] of modulesStore.modules) {
        try {
            typescan(printError(path.basename(module)), modulesStore, ast);
        } catch {
            console.error("Failed to typecheck module " + module + "\n")
        }
    }

    // typecheck all parsed modules
    for (const [module, ast] of modulesStore.modules) {
        try {
            typecheck(modulesStore, ast, printError(path.basename(module)));
        } catch (e: any) {
            console.error(`Encountered exception typechecking module "${module}":\n${e.stack}\n`);
        }
    }
    const endTypecheck = Date.now();

    // compile to TS
    if (emit) {
        await Promise.all(Array.from(modulesStore.modules.entries()).map(([ module, ast ]) => {
            const jsPath = bagelFileToTsFile(module);
            const compiled = compile(modulesStore, ast);
            const compiledWithLib = LIB_IMPORTS + compiled;
            return Deno.writeFile(jsPath, new TextEncoder().encode(compiledWithLib));
        }))
    }

    // TODO
    // if (bundle) {
    //     await bundleOutput(entry)
    // }
    
    console.log();
    console.log(`Spent ${timeSpentParsing}ms parsing`)
    console.log(`Spent ${endTypecheck - startTypecheck}ms typechecking`)

    if (watch) {
        for (const module of modulesStore.modules.keys()) {
            let lastFileContents: string|undefined
            (async () => {
                const watcher = Deno.watchFs(module)
                for await (const _ of watcher) {
    
                    try {
                        const fileContents = await Deno.readTextFile(module);

                        if (fileContents && (lastFileContents == null || lastFileContents !== fileContents)) {
                            lastFileContents = fileContents

                            console.log(`Typechecking ${module}...`)
                            const parsed = reshape(parse(fileContents, printError(path.basename(module))));
                            modulesStore.modules.set(module, parsed);
        
                            scopescan(printError(path.basename(module)), modulesStore, parsed, module);
                            typescan(printError(path.basename(module)), modulesStore, parsed);
        
                            let hadError = false;
                            try {
                                typecheck(modulesStore, parsed, err => {
                                    hadError = true;
                                    printError(path.basename(module))(err)
                                });
                            } catch (e: any) {
                                console.error(`Encountered exception typechecking module "${module}":\n${e.stack}`);
                                hadError = true;
                            }
        
                            if (!hadError) {
                                console.log("No errors")
                            }
                            
                            if (emit) {
                                const jsPath = bagelFileToTsFile(module);
                                const compiled = compile(modulesStore, parsed);
                                const compiledWithLib = LIB_IMPORTS + compiled;
                                await Deno.writeFile(jsPath, new TextEncoder().encode(compiledWithLib));
                            }
        
                            // TODO
                            // if (bundle) {
                            //     await bundleOutput(entry)
                            // }
                        }
                    } catch (e) {
                        console.error("Failed to read module " + module + "\n")
                        console.error(e)
                    }
                }
            })()
        }
    }
}

// async function bundleOutput(entry: string) {
//     try {
//         await build({
//             entryPoints: [ bagelFileToTsFile(entry) ],
//             outfile: bagelFileToTsFile(entry, true),
//             bundle: true,
//         })
//     } catch(err) {
//         console.error(err.message);
//     }
// }
