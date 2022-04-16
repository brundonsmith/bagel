import { parse } from "../compiler/1_parse/index.ts";
import { compile, IMPORTED_ITEMS, INT } from "../compiler/4_compile/index.ts";
import { BagelError, prettyProblem } from "../compiler/errors.ts";
import { Module } from "../compiler/_model/ast.ts";
import { ModuleName } from "../compiler/_model/common.ts";

Deno.test({
    name: "Simple autorun",
    fn() {
        testSideEffects(
            `
            let counter = 0

            autorun {
                output(counter);
            }

            proc runTest() {
                counter = counter + 1;
                counter = counter + 1;
                counter = counter + 1;
            }`,
            [0, 1, 2, 3],
        );
    },
});

Deno.test({
    name: "Simple autorun deep property",
    fn() {
        testSideEffects(
            `
            let counterHolder: { prop: number, other: string } = { prop: 0, other: 'stuff' }
    
            autorun {
                // should be ignored in reactions!
                output(counterHolder.other);
            }
    
            autorun {
                output(counterHolder.prop);
            }
    
            proc runTest() {
                counterHolder.prop = counterHolder.prop + 1;
                counterHolder.prop = counterHolder.prop + 1;
                counterHolder.prop = counterHolder.prop + 1;
            }`,
            ['stuff', 0, 1, 2, 3],
        );
    },
});

Deno.test({
    name: "Action",
    fn() {
        testSideEffects(
            `
            let counter = 0

            autorun {
                output(counter);
            }

            proc action runTest() {
                counter = counter + 1;
                counter = counter + 1;
                counter = counter + 1;
            }`,
            [0, 3],
        );
    },
});

Deno.test({
    name: "Try/catch 1",
    fn() {
        testSideEffects(
            `
            proc foo(n: number) {
                if n < 10 {
                    output('all good!');
                } else {
                    throw Error('it errored!');
                }
            }

            proc runTest() {
                try {
                    foo(5);
                    output('passed');
                } catch e {
                    output(e);
                }
            }`,
            ['all good!', 'passed']
        )
    }
})

Deno.test({
    name: "Try/catch 2",
    fn() {
        testSideEffects(
            `
            proc foo(n: number) {
                if n < 10 {
                    output('all good!');
                } else {
                    throw Error('it errored!');
                }
            }

            proc runTest() {
                try {
                    foo(15);
                    output('passed');
                } catch e {
                    output(e.value);
                }
            }`,
            ['it errored!']
        )
    }
})

async function testSideEffects(bgl: string, expected: any[]) {
    const moduleName = "<test>.bgl" as ModuleName;

    const { ast, errors } = parse(moduleName, bgl, true) as { ast: Module, errors: BagelError[] };
    const compiled = compile(moduleName, ast, 'cache', true, false, true);
    if (errors.length > 0) {
        throw `\n${bgl}\nFailed to parse:\n` +
        errors.map((err) => prettyProblem(moduleName, err)).join("\n");
    }

    const outputs: any[] = [];
    // deno-lint-ignore no-unused-vars
    const output = (output: any) => outputs.push(output); // Referenced by eval()

    await eval(
        `(async function() {
            const { ${IMPORTED_ITEMS.map((s) => `${s}: ${INT}${s}`).join(", ")
        } } = await import("../lib/ts/core.ts");
            ` + compiled + `
            runTest();
        })();`
    );

    if (
        expected.length !== outputs.length ||
        !expected.every((x, i) => x === outputs[i])
    ) {
        throw `Side-effects did not match expected:
  bagel:\n${bgl}
  expected:\n${expected.join("\n")}
  received:\n${outputs.join("\n")}`;
    }
}
