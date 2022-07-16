import { parse } from "../compiler/1_parse/index.ts";
import { compile, IMPORTED_ITEMS, INT } from "../compiler/4_compile/index.ts";
import { prettyProblem } from "../compiler/errors.ts";
import { Module } from "../compiler/_model/ast.ts";
import { AllModules, DEFAULT_CONFIG, ModuleName } from "../compiler/_model/common.ts";

Deno.test({
    name: "Simple autorun",
    fn() {
        testSideEffects(
            `
            let counter = 0

            autorun {
                output(counter);
            }
            forever

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
            } forever
    
            autorun {
                output(counterHolder.prop);
            } forever
    
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
    name: "Simple autorun with until",
    fn() {
        testSideEffects(
            `
            proc runTest() {
                let counter = 0;

                autorun {
                    output(counter);
                }
                until => counter > 1;

                counter = counter + 1;
                counter = counter + 1;
                counter = counter + 1;
            }`,
            [0, 1],
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
            } forever

            // copied from core.bgl
            js func action<
                TArgs extends readonly unknown[]
            >(pr: (...args: TArgs) { }): (...args: TArgs) { } => {#
                return ___action(pr)
            #}
        
            @action
            proc runTest() {
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

    const parseResult = parse(moduleName, bgl);
    const { noPreludeAst: ast, errors } = parseResult ?? {}

    const allModules: AllModules = new Map()
    allModules.set(moduleName, parseResult)
    const ctx = { allModules, config: DEFAULT_CONFIG, moduleName, excludeTypes: true, transpilePath: (m: string) => m + '.ts', canonicalModuleName: (_: ModuleName, m: string) => m as ModuleName }
    
    const compiled = compile(ctx, ast as Module, true);
    if (errors && errors.length > 0) {
        console.log(`\n${bgl}\nFailed to parse:\n` +
        errors.map((err) => prettyProblem(ctx, moduleName, err)).join("\n"))
        throw Error()
    }

    const outputs: any[] = [];
    // deno-lint-ignore no-unused-vars
    const output = (output: any) => outputs.push(output); // Referenced by eval()
    const core = await import("../lib/ts/core.ts"); // Referenced by eval()

    await eval(
        `(function() {
            const { ${IMPORTED_ITEMS.map((s) => `${s}: ${INT}${s}`).join(", ")} } = core;
            ` + compiled + `
            runTest();
        })();`
    );

    if (
        expected.length !== outputs.length ||
        !expected.every((x, i) => x === outputs[i])
    ) {
        console.log(`Side-effects did not match expected:
  bagel:\n${bgl}
  expected:\n${expected.join("\n")}
  received:\n${outputs.join("\n")}`)
        throw Error()
    }
}
