import { typecheck } from "../compiler/3_checking/typecheck.ts";
import { BagelError,prettyError } from "../compiler/errors.ts";
import { given, ModuleName } from "../compiler/utils.ts";
import Store, { canonicalModuleName } from "../compiler/store.ts";
import { log, withoutSourceInfo } from "../compiler/debugging.ts";

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
  name: "Binary operators 1",
  fn() {
    testTypecheck(
      `const x: boolean = 2 + 2 == 4`,
      false
    )
  }
})

Deno.test({
  name: "Binary operators 2",
  fn() {
    testTypecheck(
      `const x: string = 2 + 'foo' + 'bar'`,
      false
    )
  }
})

Deno.test({
  name: "Binary operators 3",
  fn() {
    testTypecheck(
      `const x: string = 2 * 3 + 'foo' + 'bar'`,
      false
    )
  }
})

Deno.test({
  name: "Binary operators 4",
  fn() {
    testTypecheck(
      `const x: number = 2 * 3 / 12`,
      false
    )
  }
})

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
      `func fn(_: string): string => 'foo'`,
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
      `func fn(_: string) => 'foo'\nconst y: string = fn('z')`,
      false,
    );
  },
});

Deno.test({
  name: "Basic function return inference mismatch",
  fn() {
    testTypecheck(
      `func fn(_: string) => 'foo'\nconst y: number = fn('z')`,
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

Deno.test({
  name: "Callback argument type inference",
  fn() {
    testTypecheck(
      `
      func foo(fn: (n: number) => number) => fn(12)
      const bar = foo(n => 2 * n)`,
      false
    )
  }
})

Deno.test({
  name: "Basic explicit generic",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T): T => a
      const c: number = other<number>(12)`,
      false,
    );
  },
});

Deno.test({
  name: "Basic explicit generic mismatch argument",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T): T => a
      const c: number = other<number>('foo')`,
      true,
    );
  },
});

Deno.test({
  name: "Basic explicit generic mismatch return",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T): T => a
      const c: string = other<number>(12)`,
      true,
    );
  },
});

Deno.test({
  name: "Basic generic with return inference",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T) => a
      const c: number = other<number>(12)`,
      false,
    );
  },
});

Deno.test({
  name: "Nested generic calls",
  fn() {
    testTypecheck(
      `
      func fnA<R>(a: R) => a
      func fnB<T>(b: T): T => fnA<T>(b)
      const c: number = fnB<number>(12)`,
      false,
    );
  },
});

Deno.test({
  name: "Nested generic calls mismatch",
  fn() {
    testTypecheck(
      `
      func fnA<T>(a: R) => a
      func fnB<T>(b: T): T => fnA<T>(12)
      const c: number = fnB<number>(12)`,
      true,
    );
  },
});

Deno.test({
  name: "Nested generic calls with return inference",
  fn() {
    testTypecheck(
      `
      func fnA<R>(a: R): R => a
      func fnB<T>(b: T) => fnA<T>(b)
      const c: number = fnB<number>(12)`,
      false,
    );
  },
});

Deno.test({
  name: "Nested generic calls with return inference mismatch",
  fn() {
    testTypecheck(
      `
      func fnA<T>(a: R): R => a
      func fnB<T>(b: T) => fnA<T>(b)
      const c: string = fnB<number>(12)`,
      true,
    );
  },
});

Deno.test({
  name: "Nested generic calls with same param names",
  fn() {
    testTypecheck(
      `
      func fnA<T>(a: T): T => a
      func fnB<T>(b: T): T => fnA<T>(b)
      const c: number = fnB<number>(12)`,
      false,
    );
  },
});

Deno.test({
  name: "Basic generic param inference",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T): T => a
      const c: number = other(12)`,
      false
    )
  }
})

Deno.test({
  name: "Basic generic param inference mismatch",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T): T => a
      const c: number = other('foo')`,
      true
    )
  }
})

Deno.test({
  name: "Union generic param inference",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T|nil): T|nil => a
      const c: number|nil = other(12)`,
      false
    )
  }
})

Deno.test({
  name: "Union generic param inference mismatch",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T|nil): T|nil => a
      const c: number = other(12)`,
      true
    )
  }
})

// Deno.test({
//   name: "Complex generic param inference",
//   fn() {
//     testTypecheck(
//       `
//       func given<T,R>(val: T|nil, fn: (val: T) => R): R|nil => if (val != nil) { fn(val) }
//       func double(n: number|nil): number|nil => given(n, x => x * 2)`,
//       false
//     )
//   }
// })

// Deno.test({
//   name: "Union generic param inference mismatch",
//   fn() {
//     testTypecheck(
//       `
//       func other<T>(a: T|nil): T|nil => a
//       const c: number = other(12)`,
//       true
//     )
//   }
// })

// Deno.test({
//   name: "Weird stack overflow!",
//   fn() {
//     testTypecheck(
//       `
//       func foo<T>(items: T[]): T[] => items

//       store AppStore {
          
//           private items = []

//           func allValid() => foo(this.items)
//       }
//       `,
//       false
//     )
//   }
// })

Deno.test({
  name: "Function consts out of order",
  fn() {
    testTypecheck(
      `
      func foo(_: number) =>
        const a = b + 2,
        const b = 12,
        2 * a`,
      true,
    );
  },
});

Deno.test({
  name: "Function consts in order",
  fn() {
    testTypecheck(
      `
      func foo(_: number) =>
        const b = 12,
        const a = b + 2,
        2 * a`,
      false,
    );
  },
});

Deno.test({
  name: "Const declarations out of order",
  fn() {
    testTypecheck(
      `
      const a = b + 2
      const b = 12`,
      true,
    );
  },
});

Deno.test({
  name: "Const declarations in order",
  fn() {
    testTypecheck(
      `
      const b = 12
      const a = b + 2`,
      false,
    );
  },
});

Deno.test({
  name: "Let declarations out of order",
  fn() {
    testTypecheck(
      `
      proc foo() {
        let a = b;
        let b = 12;
      }`,
      true,
    );
  },
});

Deno.test({
  name: "Let declarations in order",
  fn() {
    testTypecheck(
      `
      proc foo() {
        let b = 12;
        let a = b;
      }`,
      false,
    );
  },
});

Deno.test({
  name: "Basic type refinement",
  fn() {
    testTypecheck(
      `
      const a: number|nil = 12
      const b = if (a != nil) { a + 12 }`,
      false,
    );
  },
});

Deno.test({
  name: "Basic type refinement control",
  fn() {
    testTypecheck(
      `
      const a: number|nil = 12
      const b = a + 12`,
      true,
    );
  },
});

Deno.test({
  name: "Deep refinement",
  fn() {
    testTypecheck(
      `
      func foo(x: { bar: number|nil }): number|nil =>
        if (x.bar != nil) {
          x.bar - 12
        }`,
      false,
    );
  },
});

Deno.test({
  name: "Deep refinement control",
  fn() {
    testTypecheck(
      `
      func foo(x: { bar: number|nil }): number|nil =>
        x.bar - 12`,
      true,
    );
  },
});

Deno.test({
  name: "Object type spread 1",
  fn() {
    testTypecheck(
      `
      type Base = {
        foo: number
      }
      
      type Other = {
        ...Base,
        bar: string
      }
      
      const thing: Other = {
        foo: 12,
        bar: 'fgsdg'
      }`,
      false,
    );
  },
});

Deno.test({
  name: "Object type spread 2",
  fn() {
    testTypecheck(
      `
      type Base = {
        foo: number
      }
      
      type Other = {
        ...Base,
        bar: string
      }
      
      const thing: Other = {
        bar: 'fgsdg'
      }`,
      true,
    );
  },
});

Deno.test({
  name: "Property access success",
  fn() {
    testTypecheck(`
      const obj = {
        foo: {
          bar: 12
        }
      }

      const val: number = obj.foo.bar
      `,
      false
    )
  }
})

Deno.test({
  name: "Property access failure",
  fn() {
    testTypecheck(`
      const obj = {
        foo: {
          bar: 12
        }
      }

      const val: number = obj.foo.other
      `,
      true
    )
  }
})

Deno.test({
  name: "Property access named type success",
  fn() {
    testTypecheck(`
      type Obj = {
        foo: {
          bar: number
        }
      }

      func fn(obj: Obj): number =>
        obj.foo.bar
      `,
      false
    )
  }
})

Deno.test({
  name: "Optional chain success",
  fn() {
    testTypecheck(
      `
      type Obj = {
        foo: nil | {
          bar: number
        }
      }
      
      func fn(obj: Obj): number|nil =>
        obj.foo?.bar`,
      false,
    );
  },
});

Deno.test({
  name: "Optional chain failure",
  fn() {
    testTypecheck(
      `
      type Obj = {
        foo: nil | {
          bar: number
        }
      }
      
      func fn(obj: Obj): number|nil =>
        obj.foo.bar`,
      true,
    );
  },
});

Deno.test({
  name: "Inferred type across modules",
  fn() {
    testMultiModuleTypecheck({
      "module-1": `
      export func foo(b: number) => b * 2`,

      "module-2": `
      from 'module-1' import { foo }
      const stuff: number = foo(12)`
    }, false)
  }
})

Deno.test({
  name: "Inferred type across module with name resolution",
  fn() {
    testMultiModuleTypecheck({
      "module-1": `
      func foo(a: number) => a * 2
      export func bar(b: number) => foo(b) * 2`,

      "module-2": `
      from 'module-1' import { bar }
      const stuff: number = bar(12)`
    }, false)
  }
})

Deno.test({
  name: "Store 'this' access",
  fn() {
    testTypecheck(`
    store Foo {

      prop: number = 12

      proc bar() {
        this.prop = 14;
      }
    }
    `, false)
  }
})

Deno.test({
  name: "Store 'this' access mismatch",
  fn() {
    testTypecheck(`
    store Foo {

      prop: number = 12

      proc bar() {
        this.prop23 = 14;
      }
    }
    `, true)
  }
})

Deno.test({
  name: "Store 'this' access in markup",
  fn() {
    testTypecheck(`
        
    store Counter {
      count: number = 0

      public func memo render() =>
          <div>
              <button onClick={this.decrement}>{'-'}</button>
              <span>{this.count}</span>
              <button onClick={this.increment}>{'+'}</button>
          </div>

      proc decrement() {
          this.count = this.count - 1;
      }

      proc increment() {
          this.count = this.count + 1;
      }
    }
    `, false)
  }
})


Deno.test({
  name: "Store 'this' access from outside",
  fn() {
    testTypecheck(`
        
    store Counter {
      count: number = 0
    }

    proc bar(val: unknown) { }

    proc foo() {
      bar(this);
    }
    `, true)
  }
})

Deno.test({
  name: "Negation",
  fn() {
    testTypecheck(`
    const a: boolean = true
    const b: boolean = false
    const foo = !(a && b)
    `
    , false)
  }
})

Deno.test({
  name: "Negation mismatch",
  fn() {
    testTypecheck(`
    const a: number = 12
    const foo = !a
    `
    , true)
  }
})

Deno.test({
  name: "Immutability test 1",
  fn() {
    testTypecheck(`
    const obj = { foo: 'stuff' }

    proc foo() {
      obj.foo = 'other';
    }`,
    true)
  }
})

Deno.test({
  name: "Immutability test 2",
  fn() {
    testTypecheck(`
    proc foo(param: { foo: string }) {
      param = { foo: 'stuff' };
    }`,
    true)
  }
})

Deno.test({
  name: "Immutability test 3",
  fn() {
    testTypecheck(`
    proc foo(param: { foo: string }) {
      param.foo = 'stuff';
    }`,
    false)
  }
})

Deno.test({
  name: "Immutability test 4",
  fn() {
    testTypecheck(`
    proc foo(param: const { foo: string }) {
      param.foo = 'stuff';
    }`,
    true)
  }
})

Deno.test({
  name: "Immutability test 5",
  fn() {
    testTypecheck(`
    proc foo(param: const { foo: { bar: string } }) {
      param.foo.bar = 'stuff';
    }`,
    true)
  }
})

Deno.test({
  name: "Immutability test 6",
  fn() {
    testTypecheck(`
    const obj = { foo: 'bar' }

    proc foo(param: { foo: string }) {
      let alias = obj;
      alias.foo = 'other';
    }`,
    true)
  }
})

Deno.test({
  name: "Immutability test 7",
  fn() {
    testTypecheck(`
    const obj = { foo: 'bar' }

    proc foo(param: { foo: string }) {
      let alias = obj;
      alias = { foo: 'other' };
    }`,
    false)
  }
})

Deno.test({
  name: "Immutability test 8",
  fn() {
    testTypecheck(`
    proc foo(param: { foo: string }) {
      const obj = param;
    }`,
    false)
  }
})

Deno.test({
  name: "Immutability test 9",
  fn() {
    testTypecheck(`
    proc foo(param: { foo: string }) {
      const obj = param;
      obj.foo = 'other';
    }`,
    true)
  }
})

// TODO: Reactions
// TODO: if/else/switch

function testTypecheck(code: string, shouldFail: boolean): void {
  const moduleName = "<test>" as ModuleName
  const errors: BagelError[] = [];
  function reportError(err: BagelError) {
    errors.push(err);
  }

  Store.initializeFromSource({
    [moduleName]: code
  }, {
    entryFileOrDir: moduleName,
    singleEntry: true,
    bundle: false,
    watch: false,
    includeTests: false,
    emit: false
  })
  
  // console.log(JSON.stringify(withoutSourceInfo(Store.parsed(moduleName, code).ast), null, 2))
  const { ast: parsed, errors: parseErrors } = Store.parsed(moduleName, code)

  errors.push(...parseErrors)

  typecheck(
    reportError, 
    () => undefined, 
    Store.getParent, 
    Store.getBinding,
    parsed
  );

  if (!shouldFail && errors.length > 0) {
    throw `\n${code}\n\nType check should have succeeded but failed with errors\n` +
      errors.map(err => prettyError("<test>" as ModuleName, err)).join("\n")
  } else if (shouldFail && errors.length === 0) {
    throw `\n${code}\n\nType check should have failed but succeeded`
  }
}

function testMultiModuleTypecheck(modules: {[key: string]: string}, shouldFail: boolean): void {
  modules = Object.fromEntries(Object.entries(modules).map(([key, value]) => [canonicalModuleName(key as ModuleName, key), value]))

  const errors: BagelError[] = [];

  Store.initializeFromSource(modules, {
    entryFileOrDir: 'foo' as ModuleName,
    singleEntry: true,
    bundle: false,
    watch: false,
    includeTests: false,
    emit: false
  })
  
  for (const module of Object.keys(modules) as ModuleName[]) {
    const { ast: parsed, errors: parseErrors } = Store.parsed(module, modules[module])
    errors.push(...parseErrors)

    const typeErrors = Store.typeerrors(module, parsed)
    errors.push(...typeErrors)
  }

  if (!shouldFail && errors.length > 0) {
    throw `Type check should have succeeded but failed with errors\n\n` +
      errors.map(err => prettyError("<test>" as ModuleName, err)).join("\n")
  } else if (shouldFail && errors.length === 0) {
    throw `Type check should have failed but succeeded`
  }
}