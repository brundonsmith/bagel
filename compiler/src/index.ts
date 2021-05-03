import { promises as fs, watchFile } from "fs";
import path from "path";

import { build, BuildOptions } from "esbuild";

import { parse } from "./parse";
import { ModulesStore } from "./modules-store";
import { scopescan } from "./scopescan";
import { typescan } from "./typescan";
import { typecheck, errorMessage, BagelTypeError } from "./typecheck";
import { compile } from "./compile";

// @ts-ignore
// window.parse = parse;

function canonicalModuleName(importerModule: string, relativePath: string) {
    const moduleDir = path.dirname(importerModule);
    return path.resolve(moduleDir, relativePath)
}

function printError(error: BagelTypeError) {
    console.error(errorMessage(error));
}

(async function() {
    const entry = path.resolve(process.cwd(), process.argv[2]);
    const outDir = process.argv[3] || path.dirname(entry);
    const bundle = true;
    const watch = true;
    
    const modulesStore = new ModulesStore();

    const allModules = new Set<string>([entry]);
    const doneModules = new Set<string>();

    let timeSpentParsing = 0;
    
    // parse all modules
    while (doneModules.size < allModules.size) {
        const module = Array.from(allModules).find(m => !doneModules.has(m)) as string;
        doneModules.add(module);
    
        if (!modulesStore.modules.has(module)) {
        
            const fileContents = await fs.readFile(module);
        
            const startParse = Date.now();
            const parsed = parse(fileContents.toString());
            timeSpentParsing += Date.now() - startParse;

            for (const declaration of parsed.declarations) {
                if (declaration.kind === "import-declaration") {
                    const importedModule = canonicalModuleName(module, declaration.path.segments.join(""));
                    allModules.add(importedModule);
                }
            }

            modulesStore.modules.set(module, parsed);
        }
    }


    const startTypecheck = Date.now();
    // scopescan all parsed modules
    for (const [_, ast] of modulesStore.modules) {
        scopescan(modulesStore, ast);
    }

    // typescan all parsed modules
    for (const [_, ast] of modulesStore.modules) {
        typescan(modulesStore, ast);
    }

    // typecheck all parsed modules
    for (const [_, ast] of modulesStore.modules) {
        typecheck(modulesStore, ast, printError);
    }
    const endTypecheck = Date.now();

    // compile to JS
    await Promise.all(Array.from(modulesStore.modules.entries()).map(([ module, ast ]) => {
        // TODO: use specified outDir
        const jsPath = bagelFileToJsFile(module);
        const compiled = compile(modulesStore, ast);
        const compiledWithLib = `
            import { observable as ___observable } from "./crowdx";
            import { range } from "./lib";
        ` + compiled + (module === entry ? '\nmain();' : '');
        return fs.writeFile(jsPath, compiledWithLib);
    }))

    if (bundle) {
        await build({
            entryPoints: [ bagelFileToJsFile(entry) ],
            outfile: bagelFileToJsFile(entry, true),
            bundle: true,
        })
    }
    

    console.log();
    console.log(`Spent ${timeSpentParsing}ms parsing`)
    console.log(`Typechecked in ${endTypecheck - startTypecheck}ms`)

    

    if (watch) {
        for (const module of modulesStore.modules.keys()) {
            watchFile(module, async (curr, prev) => {
                console.log("Typechecking...")
                const fileContents = await fs.readFile(module);
                const parsed = parse(fileContents.toString());
                modulesStore.modules.set(module, parsed);

                scopescan(modulesStore, parsed);
                typescan(modulesStore, parsed);

                // console.log(JSON.stringify(parsed, null, 2))
                // console.log(modulesStore.)
                // console.log(modulesStore.getScopeFor(parsed).types)
                // console.log(modulesStore.getScopeFor(parsed).values)

                let hadError = false;
                typecheck(modulesStore, parsed, err => {
                    hadError = true;
                    printError(err)
                });

                if (!hadError) {
                    console.log("No errors")
                }
                
                const jsPath = bagelFileToJsFile(module);
                const compiled = compile(modulesStore, parsed);
                const compiledWithLib = `
                    import { observable as ___observable } from "./crowdx";
                    import { range } from "./lib";
                ` + compiled;
                await fs.writeFile(jsPath, compiledWithLib);

                
                if (bundle) {
                    await build({
                        entryPoints: [ bagelFileToJsFile(entry) ],
                        outfile: bagelFileToJsFile(entry, true),
                        bundle: true,
                    })
                }
            })
        }
    }

})()

function bagelFileToJsFile(module: string, bundle?: boolean): string {
    return path.resolve(path.dirname(module), path.basename(module).split(".")[0] + (bundle ? ".bundle" : "") + ".js")
}


// fs.readFile(entry).then(async code => {
//     const parsed = parse(code.toString());
    
//     // console.log(JSON.stringify(parsed, null, 4))
//     const compiled = compile(parsed)
//     // console.log(compiled)
    
    

//     // Add this stuff when bundling:
//     // Object.entries(window["bagel-lib"]).forEach(([key, value]) => window[key] = value)
//     // main();
//     //
//     // const bagelLibBundle = (await fs.readFile(path.resolve(__dirname, "lib.js"))).toString();

//     const startTypecheck = Date.now();
//     const types = typecheckModule(parsed);
//     const endTypecheck = Date.now();
//     console.log(types);
//     fs.writeFile(output, compiled);
//     // console.log(eval(compiled))
    
//     console.log();
//     console.log(`Parsed in ${endParse - startParse}ms`)
//     console.log(`Typechecked in ${endTypecheck - startTypecheck}ms`)
// });
