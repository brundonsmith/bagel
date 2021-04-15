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
    const start = Date.now();
    const parsed = parse(code.toString());
    console.log(`Parsed in ${Date.now() - start}ms`)
    console.log(JSON.stringify(parsed, null, 2))
    const compiled = compile(parsed)
    console.log(compiled)
    
    const bagelLibBundle = (await fs.readFile(path.resolve(__dirname, "lib.js"))).toString();

    const compiledWithLib = `${bagelLibBundle}

Object.entries(this["bagel-lib"]).forEach(([key, value]) => this[key] = value);

${compiled}`;

    console.log(typecheckFile(parsed))
    fs.writeFile(output, compiledWithLib);
    // console.log(eval(compiled))
    
});
