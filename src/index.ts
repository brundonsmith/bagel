import { promises as fs } from "fs";

import { parse } from "./parse";
// import { typecheck } from "./typecheck";
// import { DEFAULT_ENVIRONMENT } from "./environment";
import { compile } from "./compile";
import { typecheckFile } from "./typecheck";

const entry = process.argv[2];
const output = process.argv[3];

fs.readFile(entry).then(code => {
    const parsed = parse(code.toString());
    console.log(JSON.stringify(parsed, null, 2))
    const compiled = compile(parsed)
    console.log(compiled)
    console.log(typecheckFile(parsed))
    // console.log(eval(compiled))
    
    fs.writeFile(output, compiled);
});
