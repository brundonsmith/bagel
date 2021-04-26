import { promises as fs } from "fs";
import path from "path";

import { parse } from "./parse";
// import { typecheck } from "./typecheck";
// import { DEFAULT_ENVIRONMENT } from "./environment";
import { compile, LOCALS_OBJ } from "./compile";
import { typecheckModule } from "./typecheck";

// @ts-ignore
// window.parse = parse;

const entry = process.argv[2];
const output = process.argv[3] || path.resolve(path.dirname(entry), path.basename(entry).split(".")[0] + ".js");

fs.readFile(entry).then(async code => {
    const startParse = Date.now();
    const parsed = parse(code.toString());
    const endParse = Date.now();
    
    // console.log(JSON.stringify(parsed, null, 4))
    const compiled = compile(parsed)
    // console.log(compiled)
    
    

    // Add this stuff when bundling:
    // Object.entries(window["bagel-lib"]).forEach(([key, value]) => window[key] = value)
    // main();
    //
    // const bagelLibBundle = (await fs.readFile(path.resolve(__dirname, "lib.js"))).toString();

    const startTypecheck = Date.now();
    const types = typecheckModule(parsed);
    const endTypecheck = Date.now();
    console.log(types);
    fs.writeFile(output, compiled);
    // console.log(eval(compiled))
    
    console.log();
    console.log(`Parsed in ${endParse - startParse}ms`)
    console.log(`Typechecked in ${endTypecheck - startTypecheck}ms`)
});
