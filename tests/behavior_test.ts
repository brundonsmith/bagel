import { compile, INT } from "../compiler/4_compile/index.ts";
import { BagelError, prettyProblem } from "../compiler/errors.ts";
import Store, { IMPORTED_ITEMS } from "../compiler/store.ts";
import { Module } from "../compiler/_model/ast.ts";
import { ModuleName } from "../compiler/_model/common.ts";

Deno.test({
    name: "Simple autorun",
    fn() {
        testSideEffects(
            `
            let counter = 0

            autorun () {
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
    
            autorun () {
                // should be ignored in reactions!
                output(counterHolder.other);
            }
    
            autorun () {
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

            autorun () {
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

// deno-lint-ignore require-await
async function testSideEffects(bgl: string, expected: any[]) {
    const moduleName = "<test>" as ModuleName;

    Store.start({
        mode: "mock",
        modules: {
            [moduleName]: bgl
        },
        watch: undefined
    });

    const { ast, errors } = Store.parsed(moduleName, false) as { ast: Module, errors: BagelError[] };
    const compiled = compile(ast, moduleName, false, true);

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
        } } = await import("../lib/src/core.ts");
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
