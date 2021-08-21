import { build } from "esbuild";
import { promises as fs, watchFile } from "fs";
import path from "path";
import { ModulesStore } from "./3_checking/modules-store";
import { canonicalModuleName, scopescan } from "./3_checking/scopescan";
import { BagelTypeError, errorMessage, typecheck } from "./3_checking/typecheck";
import { typescan } from "./3_checking/typescan";
import { compile, HIDDEN_IDENTIFIER_PREFIX } from "./4_compile";
import { parse } from "./1_parse";
import { reshape } from "./2_reshape";

async function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
    
    for (const file of await fs.readdir(dirPath)) {
        const filePath = path.resolve(dirPath, file);

        if ((await fs.stat(filePath)).isDirectory()) {
            await getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath);
        }
    }
  
    return arrayOfFiles;
}

const printError = (module: string) => (error: BagelTypeError) => {
    console.error(module + "|" + errorMessage(error));
}

(async function() {
    const dir = path.resolve(process.cwd(), process.argv[2]);
    const allFilesInDir = await getAllFiles(dir);
    const outDir = process.argv[3] || path.dirname(dir);
    const bundle = true;
    const watch = process.argv.includes("--watch");
    const emit = !process.argv.includes("--noEmit");
    
    const modulesStore = new ModulesStore();
    
    const allModules = new Set<string>(allFilesInDir.filter(f => f.match(/\.bgl$/i)));
    const doneModules = new Set<string>();

    let timeSpentParsing = 0;

    // parse all modules
    while (doneModules.size < allModules.size) {
        const module = Array.from(allModules).find(m => !doneModules.has(m)) as string;
        doneModules.add(module);
    
        if (!modulesStore.modules.has(module)) {
            try {
                const fileContents = await fs.readFile(module);
            
                const startParse = Date.now();
                const parsed = reshape(parse(fileContents.toString(), path.basename(module)));
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
        } catch (e) {
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
            return fs.writeFile(jsPath, compiledWithLib);
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
            watchFile(module, async () => {
                console.log(`Typechecking ${module}...`)

                try {
                    const fileContents = await fs.readFile(module);
                    const parsed = reshape(parse(fileContents.toString(), path.basename(module)));
                    modulesStore.modules.set(module, parsed);

                    scopescan(printError(path.basename(module)), modulesStore, parsed, module);
                    typescan(printError(path.basename(module)), modulesStore, parsed);

                    let hadError = false;
                    try {
                        typecheck(modulesStore, parsed, err => {
                            hadError = true;
                            printError(path.basename(module))(err)
                        });
                    } catch (e) {
                        console.error(`Encountered exception typechecking module "${module}":\n${e.stack}`);
                        hadError = true;
                    }

                    if (!hadError) {
                        console.log("No errors")
                    }
                    
                    const jsPath = bagelFileToTsFile(module);
                    const compiled = compile(modulesStore, parsed);
                    const compiledWithLib = LIB_IMPORTS + compiled;
                    await fs.writeFile(jsPath, compiledWithLib);

                    // TODO
                    // if (bundle) {
                    //     await bundleOutput(entry)
                    // }
                } catch (e) {
                    console.error("Failed to read module " + module + "\n")
                    console.error(e)
                }
            })
        }
    }

})()

function bagelFileToTsFile(module: string, bundle?: boolean): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + (bundle ? ".bundle" : "") + ".bgl.ts")
}

const LIB_IMPORTS = `
import { observable as ___observable, reaction as ___reaction, computed as ___computed, reactionUntil as ___reactionUntil, configure as ___configure,
    range as ___range, slice, map, filter, entries, count, join, concat, log, floor, arrayFrom, fromEntries } from "../../lib/src";

___configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});
`

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
