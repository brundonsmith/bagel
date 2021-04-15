import { promises as fs } from "fs";
import path from "path";

import { parse } from "./parse";
// import { typecheck } from "./typecheck";
// import { DEFAULT_ENVIRONMENT } from "./environment";
import { compile } from "./compile";
import { typecheckFile } from "./typecheck";

const entry = process.argv[2];
const output = process.argv[3];

fs.readFile(entry).then(async code => {
    const startParse = Date.now();
    const parsed = parse(code.toString());
    const endParse = Date.now();
    
    console.log(JSON.stringify(parsed, null, 2))
    const compiled = compile(parsed)
    console.log(compiled)
    
    const bagelLibBundle = (await fs.readFile(path.resolve(__dirname, "lib.js"))).toString();

    const compiledWithLib = `${bagelLibBundle}

Object.entries(this["bagel-lib"]).forEach(([key, value]) => this[key] = value);

${compiled}

main();`;

    const startTypecheck = Date.now();
    const types = typecheckFile(parsed);
    const endTypecheck = Date.now();
    console.log(types);
    fs.writeFile(output, compiledWithLib);
    // console.log(eval(compiled))
    
    console.log();
    console.log(`Parsed in ${endParse - startParse}ms`)
    console.log(`Typechecked in ${endTypecheck - startTypecheck}ms`)
});
