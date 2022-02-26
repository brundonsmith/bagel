import { parsed } from "../compiler/1_parse/index.ts";
import { compile } from "../compiler/4_compile/index.ts";
import { prettyProblem } from "../compiler/errors.ts";
import Store from "../compiler/store.ts";
import { ModuleName } from "../compiler/_model/common.ts";

Deno.test({
  name: "Simple func declaration",
  fn() {
    testCompile(
      `func uid() => '12345'`,
      `const uid = () => ("12345");`,
    );
  },
});

Deno.test({
  name: "Abbreviated func",
  fn() {
    testCompile(
      `const fn = a => a`,
      `const fn = (a) => (a);`,
    );
  },
});

Deno.test({
  name: "Func declaration with memo",
  fn() {
    testCompile(
      `func memo uid() => '12345'`,
      `const uid = ___computedFn(() => ("12345"));`,
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
      `const uid = (n: number) => ((() => {
        const double = (2 * n);
        const ten = (5 * double);
        return ten;
      })());`,
    );
  },
});

Deno.test({
  name: "Property access",
  fn() {
    testCompile(
      `const x = a.b.c`,
      `const x = ___observe(___observe(a, 'b'), 'c');`,
    );
  },
});

Deno.test({
  name: "Method call",
  fn() {
    testCompile(
      `const x = a.b()`,
      `const x = b(a);`,
    );
  },
});

Deno.test({
  name: "Double method call",
  fn() {
    testCompile(
      `const x = a.b()()`,
      `const x = b(a)();`,
    );
  },
});

Deno.test({
  name: "Deep method call",
  fn() {
    testCompile(
      `const x = a.b.c()`,
      `const x = c(___observe(a, 'b'));`,
    );
  },
});

Deno.test({
  name: "Method chain",
  fn() {
    testCompile(
      `const x = a.b().c()`,
      `const x = c(b(a));`,
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
      `const x = ___observe(___observe(a, 'b'), 'c');`,
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
      `const x = c(b(a));`,
    );
  },
});

Deno.test({
  name: "If expression",
  fn() {
    testCompile(
      `func merge() =>
            if arr1.length <= 0 {
                2
            } else {
                3
            }`,
      `const merge = () => (((___observe(arr1, 'length') <= 0) ? 2 : 3));`,
    );
  },
});

Deno.test({
  name: "Chained if expression",
  fn() {
    testCompile(
      `func merge() =>
            if arr1.length <= 0 {
                2
            } else if arr1.length <= 1 {
                3
            } else {
              4
            }`,
      `const merge = () =>
        (((___observe(arr1, 'length') <= 0) ?
          2
        : (___observe(arr1, 'length') <= 1) ?
          3
        :
          4));`,
    );
  },
});

Deno.test({
  name: "Empty proc",
  fn() {
    testCompile(
      `proc foo() { }`,
      `const foo = (): void => { };`,
    );
  },
});

Deno.test({
  name: "Chained if statements",
  fn() {
    testCompile(
      `proc foo() {
              if true {
                log('true');
              } else if false {
                log('false');
              } else {
                log('other');
              }
            }`,
      `const foo = (): void => {
        if (true) {
          log("true");
        } else if (false) {
          log("false");
        } else {
          log("other");
        };
      };`,
    );
  },
});

Deno.test({
  name: "Object literal with spread",
  fn() {
    testCompile(
      `
      const a = { foo: 'stuff' }
      const b = { ...a, bar: 'other' }`,
      `
      const a = {foo: "stuff"};
      const b = {...a, bar: "other"};`
    )
  }
})

Deno.test({
  name: "Array literal with spread",
  fn() {
    testCompile(
      `
      const a = [1, 2, 3]
      const b = [...a, 4]`,
      `
      const a = [1, 2, 3];
      const b = [...a, 4];`
    )
  }
})

Deno.test({
  name: "Indexer expression",
  fn() {
    testCompile(
      `func uid(arr, i) => arr[i]`,
      `const uid = (arr, i) => (arr[i]);`,
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
      `
      proc doStuff(items: Iterator<number>) {
        let count = 0;
        
        for item of items {
        }

        log(count);
      }`,
      `
      const doStuff = (items: ___Iter<number>): void => {
        let count = 0;

        for (const item of items[___INNER_ITER]) {
        };

        log(count);
      };`,
    );
  },
});

Deno.test({
  name: "Proc declaration with statements",
  fn() {
    testCompile(
      `
      proc doStuff(items: Iterator<number>) {
        let count = 0;

        for item of items {
            if item.foo {
                count = count + 1;
            }

            if count > 12 {
                log(items);
            } else if count != 10 {
                log('not 10!');
            } else {
                log(nil);
            }
        }

        log(count);
      }`,
      `
      const doStuff = (items: ___Iter<number>): void => {
        let count = 0;
    
        for (const item of items[___INNER_ITER]) {
            if ((___observe(item, 'foo') != null && (___observe(item, 'foo') as unknown) !== false && (___observe(item, 'foo') as any).kind !== ___ERROR_SYM)) {
              count = (count + 1);
            };
            
            if ((count > 12)) {
                log(items);
            } else if ((count !== 10)) {
                log("not 10!");
            } else {
                log(undefined);
            };
        };
    
        log(count);
      };`,
    );
  },
});

Deno.test({
  name: "Const declaration with type",
  fn() {
    testCompile(
      `const foo: FooType = 'stuff'`,
      `const foo: FooType = "stuff";`,
    );
  },
});

Deno.test({
  name: "Basic property access",
  fn() {
    testCompile(
      `const foo = bar.prop1.prop2`,
      `const foo = ___observe(___observe(bar, 'prop1'), 'prop2');`,
    );
  },
});

Deno.test({
  name: "Typed func declaration",
  fn() {
    testCompile(
      `func foo(a: string, b: number): number => 0`,
      `const foo = (a: string, b: number): number => (0);`,
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
  name: "Tricky type parse 1",
  fn() {
    testCompile(
      `type Foo = string | number[]`,
      `type Foo = string | number[];`
    )
  }
})

Deno.test({
  name: "Tricky type parse 2",
  fn() {
    testCompile(
      `type Foo = (a: string) => (b: number|boolean) => { foo: nil[] }`,
      `type Foo = (a: string) => (b: number | boolean) => {foo: (null | undefined)[]};`
    )
  }
})

Deno.test({
  name: "Comment test line",
  fn() {
    testCompile(
      `func foo() => 13 // foo bar comment
            const a = 12`,
      `const foo = () => (13);
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
      `const foo = () => (13);
            const a = 12;`,
    );
  },
});

Deno.test({
  name: "Negation precedence",
  fn() {
    testCompile(`
    const a: boolean = true
    const b: boolean = true

    const foo = !a && b
    `,
    `
    const a: boolean = true;

    const b: boolean = true;
    
    const foo = (!(a) && b);`)
  }
})

Deno.test({
  name: "Indexer assignment",
  fn() {
    testCompile(`
    export proc setItem(key: string, value: string) {
      _localStorage[key] = value;
      setLocalStorage(key, value);
    }`,
    `
    export const setItem = (key: string, value: string): void => {
      _localStorage[key] = value; ___invalidate(_localStorage, key);        
      setLocalStorage(key, value);
    };`)
  }
})

Deno.test({
  name: "Method proc call",
  fn() {
    testCompile(`
    proc push<T>(arr: T[], el: T) {
      // stub
    }

    export proc bar() {
      let foo = [1, 2, 3];
      foo.push(4);
    }`,
    `
    const push = <T>(arr: T[], el: T): void => { };

    export const bar = (): void => {
      let foo = [1, 2, 3];
      push(foo, 4);
    };`)
  }
})

Deno.test({
  name: "JS func",
  fn() {
    testCompile(`
    js func foo(a: number, b: string): string => {#
      return a + b;
    #}
    `,
    `
    const foo = (a: number, b: string): string => {
      return a + b;
    };
    `)
  }
})

Deno.test({
  name: "JS proc",
  fn() {
    testCompile(`
    js proc foo(a: { foo: number }, b: number) {#
      a.foo = b;
    #}
    `,
    `
    const foo = (a: {foo: number}, b: number): void => {
      a.foo = b;
    };
    `)
  }
})

Deno.test({
  name: "While loop",
  fn() {
    testCompile(`
    proc foo() {
      while true {
        log('stuff');
      }
    }`,
    `
    const foo = (): void => { 
      while (true) { 
        log("stuff");
      };
    };`)
  }
})

Deno.test({
  name: "Runtime types",
  fn() {
    testCompile(`
    const x = 12

    nominal type FooNominal(string)

    const a = x instanceof string
    const b = x instanceof number
    const c = x instanceof unknown
    const d = x instanceof boolean
    const e = x instanceof nil
    const f = x instanceof 'stuff'
    const g = x instanceof Iterator<number>
    const h = x instanceof Plan<number>
    const i = x instanceof Remote<number>
    const j = x instanceof Error<number>
    const k = x instanceof FooNominal
    const l = x instanceof number[]
    const m = x instanceof {[string]: number}
    const n = x instanceof { a: string, b: number }
    const o = x instanceof { a: string, b?: number }`,
    `
    const x = 12;

    const ___FooNominal = Symbol('FooNominal');
    const FooNominal = ((value: string): FooNominal => ({ kind: ___FooNominal, value })) as (((value: string) => FooNominal) & { sym: typeof ___FooNominal });
    FooNominal.sym = ___FooNominal;
    (FooNominal as any).sym = ___FooNominal;
    type FooNominal = { kind: typeof ___FooNominal, value: string };

    const a = ___instanceOf(x, ___RT_STRING);
    const b = ___instanceOf(x, ___RT_NUMBER);
    const c = ___instanceOf(x, ___RT_UNKNOWN);
    const d = ___instanceOf(x, ___RT_BOOLEAN);
    const e = ___instanceOf(x, ___RT_NIL);
    const f = ___instanceOf(x, { kind: ___RT_LITERAL, value: "stuff" });
    const g = ___instanceOf(x, { kind: ___RT_ITERATOR, inner: ___RT_NUMBER });
    const h = ___instanceOf(x, { kind: ___RT_PLAN, inner: ___RT_NUMBER });
    const i = ___instanceOf(x, { kind: ___RT_REMOTE, inner: ___RT_NUMBER });
    const j = ___instanceOf(x, { kind: ___RT_ERROR, inner: ___RT_NUMBER });
    const k = ___instanceOf(x, { kind: ___RT_NOMINAL, nominal: FooNominal.sym });
    const l = ___instanceOf(x, { kind: ___RT_ARRAY, inner: ___RT_NUMBER });
    const m = ___instanceOf(x, { kind: ___RT_RECORD, key: ___RT_STRING, value: ___RT_NUMBER });
    const n = ___instanceOf(x, { kind: ___RT_OBJECT, entries: [{ key: 'a', value: ___RT_STRING, optional: false },{ key: 'b', value: ___RT_NUMBER, optional: false }] });
    const o = ___instanceOf(x, { kind: ___RT_OBJECT, entries: [{ key: 'a', value: ___RT_STRING, optional: false },{ key: 'b', value: ___RT_NUMBER, optional: true }] });
    `)
  }
})

function testCompile(code: string, exp: string) {
  const moduleName = '<test>' as ModuleName

  Store.start({
    mode: 'mock',
    modules: {
      [moduleName]: code
    },
    watch: undefined
  })
  
  const parseResult = parsed(Store, moduleName)

  if (parseResult) {
    const { ast, errors } = parseResult

    const compiled = compile(ast, moduleName)
  
    if (errors.length > 0) {
      throw `\n${code}\nFailed to parse:\n` +
        errors.map(err => prettyProblem(moduleName, err)).join("\n")
    }
    
    if (normalize(compiled) !== normalize(exp)) {
      throw `Compiler output did not match expected:
  bagel:\n${code}
  expected:\n${exp}
  received:\n${compiled}`;
    }
  }
}

function normalize(ts: string): string {
  return (' ' + ts + ' ').replace(/[\s\n]+/gm, " ");
}