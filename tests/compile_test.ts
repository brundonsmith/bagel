import { parse } from "../compiler/1_parse/index.ts";
import { reshape } from "../compiler/2_reshape/index.ts";
import { getParentsMap, scopescan } from "../compiler/3_checking/scopescan.ts";
import { compile } from "../compiler/4_compile/index.ts";
import { BagelError, prettyError } from "../compiler/errors.ts";

Deno.test({
  name: "Simple func declaration",
  fn() {
    testCompile(
      `func uid() => '12345'`,
      `const uid = () => \`12345\`;`,
    );
  },
});

Deno.test({
  name: "Binary operator",
  fn() {
    testCompile(
      `const x = a < b`,
      `const x = (a < b);`,
    );
  },
});

Deno.test({
  name: "Func with constants",
  fn() {
    testCompile(
      `func uid(n: number) => 
        const double = 2 * n,
        const ten = 5 * double,
        ten`,
      `const uid = (n: number) => {
        const double = (2 * n);
        const ten = (5 * double);
        return ten;
      };`,
    );
  },
});

Deno.test({
  name: "Property access",
  fn() {
    testCompile(
      `const x = a.b.c`,
      `const x = a.b.c;`,
    );
  },
});

Deno.test({
  name: "Method call",
  fn() {
    testCompile(
      `const x = a.b()`,
      `const x = a.b();`,
    );
  },
});

Deno.test({
  name: "Double method call",
  fn() {
    testCompile(
      `const x = a.b()()`,
      `const x = a.b()();`,
    );
  },
});

Deno.test({
  name: "Deep method call",
  fn() {
    testCompile(
      `const x = a.b.c()`,
      `const x = a.b.c();`,
    );
  },
});

Deno.test({
  name: "Method chain",
  fn() {
    testCompile(
      `const x = a.b().c()`,
      `const x = a.b().c();`,
    );
  },
});

Deno.test({
  name: "Property access with space",
  fn() {
    testCompile(
      `const x = a
        .b
        .c`,
      `const x = a.b.c;`,
    );
  },
});

Deno.test({
  name: "Method chain with space",
  fn() {
    testCompile(
      `const x = a
        .b()
        .c()`,
      `const x = a.b().c();`,
    );
  },
});

Deno.test({
  name: "If expression",
  fn() {
    testCompile(
      `func merge() =>
            if (arr1.length <= 0) {
                2
            } else {
                3
            }`,
      `const merge = () => ((arr1.length <= 0) ? 2 : 3);`,
    );
  },
});

Deno.test({
  name: "Chained if expression",
  fn() {
    testCompile(
      `func merge() =>
            if (arr1.length <= 0) {
                2
            } else if (arr1.length <= 1) {
                3
            } else {
              4
            }`,
      `const merge = () => ((arr1.length <= 0) ? 2 : (arr1.length <= 1) ? 3 : 4);`,
    );
  },
});

Deno.test({
  name: "Chained if statements",
  fn() {
    testCompile(
      `proc foo() {
              if (true) {
                log('true');
              } else if (false) {
                log('false');
              } else {
                log('other');
              }
            }`,
      `const foo = (): void => {
        if (true) {
          log(\`true\`);
        } else if (false) {
          log(\`false\`);
        } else {
          log(\`other\`);
        };
      };`,
    );
  },
});

Deno.test({
  name: "Indexer expression",
  fn() {
    testCompile(
      `func uid(arr, i) => arr[i]`,
      `const uid = (arr, i) => arr[i];`,
    );
  },
});

Deno.test({
  name: "Indexing an array",
  fn() {
    testCompile(
      `const x = [ arr1[0] ]`,
      `const x = [arr1[0]];`,
    );
  },
});

Deno.test({
  name: "Simple proc declaration",
  fn() {
    testCompile(
      `proc doStuff(a) { }`,
      `const doStuff = (a): void => { };`,
    );
  },
});

Deno.test({
  name: "Basic proc declaration",
  fn() {
    testCompile(
      `proc doStuff(a) {
            let count = 0;
            
            for (item of items) {
            }

            console.log(count);
        }`,
      `const doStuff = (a): void => {
            const ___locals: {count?: unknown} = ___observable({});
        
            ___locals["count"] = 0;

            for (const item of items) { ; };

            console.log(___locals["count"]);
        };`,
    );
  },
});

Deno.test({
  name: "Proc declaration with statements",
  fn() {
    testCompile(
      `proc doStuff(a) {
            let count = 0;

            for (item of items) {
                if (item.foo) {
                    count = count + 1;
                }

                if (count > 12) {
                    console.log(a);
                } else {
                    console.log(nil);
                }
            }

            console.log(count);
        }`,
      `const doStuff = (a): void => {
            const ___locals: {count?: unknown} = ___observable({});
        
            ___locals["count"] = 0;

            for (const item of items) {
                if (item.foo) {
                    ___locals["count"] = (___locals["count"] + 1);
                };
                
                if ((___locals["count"] > 12)) {
                    console.log(a);
                } else {
                    console.log(undefined);
                };
            };

            console.log(___locals["count"]);
        };`,
    );
  },
});

Deno.test({
  name: "Const declaration with type",
  fn() {
    testCompile(
      `const foo: FooType = 'stuff'`,
      `const foo: FooType = \`stuff\`;`,
    );
  },
});

Deno.test({
  name: "Basic property access",
  fn() {
    testCompile(
      `const foo = bar.prop1.prop2`,
      `const foo = bar.prop1.prop2;`,
    );
  },
});

Deno.test({
  name: "Func declaration with pipe",
  fn() {
    testCompile(
      `func classNames(cn) =>
                cn
                    |> entries 
                    |> fromEntries`,
      `const classNames = (cn) => 
            fromEntries(entries(cn));`,
    );
  },
});

Deno.test({
  name: "Func declaration with iteration",
  fn() {
    testCompile(
      `func myFunc(a, b) => 
                0..10 
                |> map((n) => n * 2) 
                |> filter((n) => n < 10)`,
      `const myFunc = (a, b) =>
            filter((n) => (n < 10))(map((n) => (n * 2))(___range(0)(10)));`,
    );
  },
});

Deno.test({
  name: "Typed func declaration",
  fn() {
    testCompile(
      `func foo(a: string, b: number): number => 0`,
      `const foo = (a: string, b: number): number => 0;`,
    );
  },
});

Deno.test({
  name: "Typed proc declaration",
  fn() {
    testCompile(
      `proc bar(a: string[], b: { foo: number }) { }`,
      `const bar = (a: string[], b: {foo: number}): void => { };`,
    );
  },
});

Deno.test({
  name: "Func type",
  fn() {
    testCompile(
      `export type MyFn = (a: number, b: string) => string[]`,
      `export type MyFn = (a: number, b: string) => string[];`,
    );
  },
});

Deno.test({
  name: "Top-level const reordering",
  fn() {
    testCompile(
      `const a = 12
            func foo() => 13`,
      `const foo = () => 13;
            const a = 12;`,
    );
  },
});

Deno.test({
  name: "Comment test line",
  fn() {
    testCompile(
      `func foo() => 13 // foo bar comment
            const a = 12`,
      `const foo = () => 13;
            const a = 12;`,
    );
  },
});

Deno.test({
  name: "Comment test block",
  fn() {
    testCompile(
      `func foo() => 13 /* foo bar comment
            moar comment*/
            const a = 12`,
      `const foo = () => 13;
            const a = 12;`,
    );
  },
});

const module = "module";
function testCompile(bgl: string, exp: string) {
  let error: string | undefined;

  function printError(error: BagelError) {
    console.log(prettyError('<test>', error))
  }

  const ast = reshape(parse(bgl, printError));
  // console.log(JSON.stringify(withoutSourceInfo(ast), null, 2))
  const parents = getParentsMap(ast)
  const scopes = scopescan(printError, parents, () => undefined, ast, module);

  const compiled = compile(parents, scopes, ast);

  if (error) {
    throw error
  }

  if (normalize(compiled) !== normalize(exp)) {
    throw `Compiler output did not match expected:
    bagel:    ${bgl}
    expected: ${exp}
    received: ${compiled}`;
  }
}

function normalize(ts: string): string {
  return ts.replace(/[\s\n]+/gm, " ");
}
