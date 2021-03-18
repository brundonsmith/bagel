import { parse } from "./parse.ts";
import { typecheck } from "./typecheck.ts";
import { DEFAULT_ENVIRONMENT } from "./environment.ts";

const code = `
    concat(add(1, 2), true)
`

console.log(parse(code))
console.log(typecheck(DEFAULT_ENVIRONMENT, parse(code)))