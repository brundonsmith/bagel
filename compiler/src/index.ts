import { build } from "esbuild";
import { promises as fs, watchFile } from "fs";
import path from "path";
import { ModulesStore } from "./checking/modules-store";
import { canonicalModuleName, scopescan } from "./checking/scopescan";
import { BagelTypeError, errorMessage, typecheck } from "./checking/typecheck";
import { typescan } from "./checking/typescan";
import { compile } from "./compile";
import { parse } from "./parse";



function printError(module: string, error: BagelTypeError) {
    console.error(module + "|" + errorMessage(error));
}

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

(async function() {
    const dir = path.resolve(process.cwd(), process.argv[2]);
    const allFilesInDir = await getAllFiles(dir);
    const outDir = process.argv[3] || path.dirname(dir);
    const bundle = true;
    const watch = true;
    const emit = true;
    
    const modulesStore = new ModulesStore();
    
    const allModules = new Set<string>(allFilesInDir.filter(f => f.includes(".bgl")));
    const doneModules = new Set<string>();

    let timeSpentParsing = 0;
    
    // parse all modules
    while (doneModules.size < allModules.size) {
        const module = Array.from(allModules).find(m => !doneModules.has(m)) as string;
        doneModules.add(module);
    
        if (!modulesStore.modules.has(module)) {
            // console.log("parsing", path.basename(module))
        
            try {
                const fileContents = await fs.readFile(module);
            
                const startParse = Date.now();
                const parsed = parse(fileContents.toString());
                timeSpentParsing += Date.now() - startParse;

                for (const declaration of parsed.declarations) {
                    if (declaration.kind === "import-declaration") {
                        const importedModule = canonicalModuleName(module, declaration.path);
                        allModules.add(importedModule);
                    }
                }

                modulesStore.modules.set(module, parsed);
            } catch {
                console.error("Failed to read module " + module + "\n")
            }
        }
    }


    const startTypecheck = Date.now();
    // scopescan all parsed modules
    for (const [module, ast] of modulesStore.modules) {
        scopescan(modulesStore, ast, module);
    }

    // typescan all parsed modules
    for (const [module, ast] of modulesStore.modules) {
        try {
            typescan(modulesStore, ast);
        } catch {
            console.error("Failed to typecheck module " + module + "\n")
        }
    }

    // typecheck all parsed modules
    for (const [module, ast] of modulesStore.modules) {
        try {
            typecheck(modulesStore, ast, err => printError(path.basename(module), err));
        } catch (e) {
            console.error(`Encountered exception typechecking module "${module}":\n${e}\n`);
        }
    }
    const endTypecheck = Date.now();

    // compile to TS
    if (emit) {
        await Promise.all(Array.from(modulesStore.modules.entries()).map(([ module, ast ]) => {
            // TODO: use specified outDir
            const jsPath = bagelFileToTsFile(module);
            const compiled = compile(modulesStore, ast);
            const compiledWithLib = LIB_IMPORTS + compiled;// + (module === entry ? '\nmain();' : '');
            return fs.writeFile(jsPath, compiledWithLib);
        }))
    }

    // TODO
    // if (bundle) {
    //     await bundleOutput(entry)
    // }
    

    console.log();
    console.log(`Spent ${timeSpentParsing}ms parsing`)
    console.log(`Typechecked in ${endTypecheck - startTypecheck}ms`)
    

    if (watch) {
        for (const module of modulesStore.modules.keys()) {
            watchFile(module, async (curr, prev) => {
                console.log(`Typechecking ${module}...`)

                try {
                    const fileContents = await fs.readFile(module);
                    const parsed = parse(fileContents.toString());
                    modulesStore.modules.set(module, parsed);

                    scopescan(modulesStore, parsed, module);
                    typescan(modulesStore, parsed);

                    // console.log(JSON.stringify(parsed, null, 2))
                    // console.log(modulesStore.)
                    // console.log(modulesStore.getScopeFor(parsed).types)
                    // console.log(modulesStore.getScopeFor(parsed).values)

                    let hadError = false;
                    try {
                        typecheck(modulesStore, parsed, err => {
                            hadError = true;
                            printError(path.basename(module), err)
                        });
                    } catch (e) {
                        console.error(`Encountered exception typechecking module "${module}":\n${e}`);
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
                } catch {
                    console.error("Failed to read module " + module)
                }
            })
        }
    }

})()

const LIB_IMPORTS = `
import { observable as ___observable } from "./crowdx";
import { range as ___range, slice, map, filter, entries, count, join, concat, log, floor, arrayFrom, fromEntries } from "./lib";

`

async function bundleOutput(entry: string) {
    try {
        await build({
            entryPoints: [ bagelFileToTsFile(entry) ],
            outfile: bagelFileToTsFile(entry, true),
            bundle: true,
        })
    } catch(err) {
        console.error(err.message);
    }
}

function bagelFileToTsFile(module: string, bundle?: boolean): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + (bundle ? ".bundle" : "") + ".bagel.ts")
}
