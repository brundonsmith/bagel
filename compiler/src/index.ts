import { promises as fs } from "fs";
import path from "path";

import { parse } from "./parse";
import { ModulesStore } from "./modules-store";
import { scopescan } from "./scopescan";
import { typescan } from "./typescan";
import { typecheck, errorMessage } from "./typecheck";
import { compile, LOCALS_OBJ } from "./compile";

// @ts-ignore
// window.parse = parse;

const entry = path.resolve(__dirname, process.argv[2]);
const output = process.argv[3] || path.resolve(path.dirname(entry), path.basename(entry).split(".")[0] + ".js");

function canonicalModuleName(importerModule: string, relativePath: string) {
    const moduleDir = path.dirname(importerModule);
    return path.resolve(moduleDir, relativePath)
}

(async function() {
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
            timeSpentParsing += startParse - Date.now();

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
        typecheck(modulesStore, ast, error => console.error(errorMessage(error)));
    }
    const endTypecheck = Date.now();


    // compile to JS
    // const compiled = compile(parsed)
    // fs.writeFile(output, compiled);
    

    console.log();
    console.log(`Spent ${timeSpentParsing}ms parsing`)
    console.log(`Typechecked in ${endTypecheck - startTypecheck}ms`)
})()

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
