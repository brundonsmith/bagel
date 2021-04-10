import { parse } from "./parse.ts";
// import { typecheck } from "./typecheck.ts";
// import { DEFAULT_ENVIRONMENT } from "./environment.ts";
import { compile } from "./compile.ts";

const code = `

func uuid() => '12345'

func classNames(cn) =>
    cn
        |> entries 
        |> fromEntries


myFunc(a, b) => 0..10 |> map((n) => n * 2) |> filter((n) => n < 10)

concat(add(1, 2), 'stuff')

add(concat(1, 2), 12)

myFunc(1, 2)
`

const parsed = parse(code);
console.log(JSON.stringify(parsed, null, 2))
const compiled = compile(parsed)
console.log(compiled)
// console.log(eval(compiled))