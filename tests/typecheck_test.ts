import { ModulesStore } from "../compiler/3_checking/modules-store.ts";
import { scopescan } from "../compiler/3_checking/scopescan.ts";
import { BagelTypeError, typecheck } from "../compiler/3_checking/typecheck.ts";
import { typeinfer } from "../compiler/3_checking/typeinfer.ts";
import { parse } from "../compiler/1_parse/index.ts";
import { prettyError } from "../compiler/utils.ts";
import { BagelSyntaxError } from "../compiler/1_parse/common.ts";

Deno.test({
  name: "Basic constant",
  fn() {
    testTypecheck(
      `const x: string = 'foo'`,
      false,
    );
  },
});

Deno.test({
  name: "Basic constant mismatch",
  fn() {
    testTypecheck(
      `const x: number = 'foo'`,
      true,
    );
  },
});

Deno.test({
  name: "Basic constant inference",
  fn() {
    testTypecheck(
      `const x = 'foo'\nconst y: number = x`,
      true,
    );
  },
});

Deno.test({
  name: "Basic function return",
  fn() {
    testTypecheck(
      `func fn(): string => 'foo'`,
      false,
    );
  },
});

Deno.test({
  name: "Basic function return mismatch",
  fn() {
    testTypecheck(
      `func fn(): number => 'foo'`,
      true,
    );
  },
});

Deno.test({
  name: "Basic function return inference",
  fn() {
    testTypecheck(
      `func fn() => 'foo'\nconst y: string = fn()`,
      false,
    );
  },
});

Deno.test({
  name: "Basic function return inference mismatch",
  fn() {
    testTypecheck(
      `func fn() => 'foo'\nconst y: number = fn()`,
      true,
    );
  },
});

Deno.test({
  name: "Object type",
  fn() {
    testTypecheck(
      `type MyObj = {
            foo: string,
            bar: {
                other: number|nil
            }
        }
        
        const obj: MyObj = {
            foo: 'stuff',
            bar: {
                other: 12
            }
        }`,
      false,
    );
  },
});

Deno.test({
  name: "Object type mismatch",
  fn() {
    testTypecheck(
      `type MyObj = {
            foo: string,
            bar: {
                other: number|nil
            }
        }
        
        const obj: MyObj = {
            foo: 'stuff',
            bar: {
                other: 'foo'
            }
        }`,
      true,
    );
  },
});

// TODO: Invocation arguments
// TODO: Reactions
// TODO: Classes
// TODO: if/else/switch
// TODO: object property access
// TODO: Generics

function testTypecheck(code: string, shouldFail: boolean): void {
  const errors: (BagelSyntaxError | BagelTypeError)[] = [];
  function reportError(err: BagelSyntaxError | BagelTypeError) {
    errors.push(err);
  }

  const parsed = parse(code, reportError);

  const modulesStore = new ModulesStore();
  modulesStore.modules.set("foo", parsed);

  scopescan(reportError, modulesStore, parsed, "foo");
  typeinfer(reportError, modulesStore, parsed);
  typecheck(reportError, modulesStore, parsed);

  if (!shouldFail && errors.length > 0) {
    throw Error(
      `\n${code}\nType check should have succeeded but failed with errors\n` +
        errors.map(prettyError("foo")).join("\n"),
    );
  } else if (shouldFail && errors.length === 0) {
    throw Error("Type check should have failed but succeeded");
  }
}
