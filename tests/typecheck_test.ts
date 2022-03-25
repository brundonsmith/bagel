import { parsed } from "../compiler/1_parse/index.ts";
import { prettyProblem } from "../compiler/errors.ts";
import Store, { allProblems, canonicalModuleName } from "../compiler/store.ts";
import { ModuleName } from "../compiler/_model/common.ts";

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
  name: "Basic constant fail",
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
  name: "Binary operators 5",
  fn() {
    testTypecheck(
      `const x = 'foo' == 12`,
      true
    )
  }
})

Deno.test({
  name: "Function-as-argument inference 1",
  fn() {
    testTypecheck(
      `
      func foo(fn: (val: number) => boolean) => nil
      const x = foo(n => n)`,
      true
    )
  }
})

Deno.test({
  name: "Function-as-argument inference 2",
  fn() {
    testTypecheck(
      `
      func foo(fn: (val: number) => boolean) => nil
      const x = foo(n => n > 0)`,
      false
    )
  }
})

Deno.test({
  name: "Function-as-argument inference 3",
  fn() {
    testTypecheck(
      `
      func foo(fn: (val: number) => boolean) => nil
      const x = foo((n: number) => n > 0)`,
      false
    )
  }
})
Deno.test({
  name: "Function-as-argument inference 4",
  fn() {
    testTypecheck(
      `
      func foo(fn: (val: number) => boolean) => nil
      const x = foo((n: string) => n == 'foo')`,
      true
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
      `func fn(a: string): string => 'foo'`,
      false,
    );
  },
});

Deno.test({
  name: "Basic function return fail",
  fn() {
    testTypecheck(
      `func fn(): number => 'foo'`,
      true,
    );
  },
});

Deno.test({
  name: "Basic function fail 2",
  fn() {
    testTypecheck(
      `func fn(a: string, a: string) => 'foo'`,
      true,
    );
  },
});

Deno.test({
  name: "Basic function return inference",
  fn() {
    testTypecheck(
      `
      func fn(_: string) => 'foo'
      const y: string = fn('z')`,
      false,
    );
  },
});

Deno.test({
  name: "Basic function return inference fail",
  fn() {
    testTypecheck(
      `
      func fn(_: string) => 'foo'
      const y: number = fn('z')`,
      true,
    );
  },
});

Deno.test({
  name: "Object literal with spread pass",
  fn() {
    testTypecheck(
      `
      const a = { foo: 'stuff' }
      const b: { foo: string, bar: string } = { ...a, bar: 'other' }`,
      false
    )
  }
})

Deno.test({
  name: "Object literal with spread fail",
  fn() {
    testTypecheck(
      `
      const a = { foo: 'stuff' }
      const b: { foo: number, bar: string } = { ...a, bar: 'other' }`,
      true
    )
  }
})

Deno.test({
  name: "Array literal with spread pass 1",
  fn() {
    testTypecheck(
      `
      const a = [1, 2, 3]
      const b: number[] = [...a, 4]`,
      false
    )
  }
})

Deno.test({
  name: "Array literal with spread pass 2",
  fn() {
    testTypecheck(
      `
      const a = [1, 2, 3]
      const b: number = [...a, '4'][2]`,
      false
    )
  }
})

Deno.test({
  name: "Function return type inference with generic",
  fn() {
    testTypecheck(
      `
      func getThird<T extends string[]>(arr: T) => arr[2]
      const third: string|nil = getThird(['one', 'two', 'three'])`,
      false
    )
  }
})

Deno.test({
  name: "Array literal with spread fail 1",
  fn() {
    testTypecheck(
      `
      const a = 12
      const b = [...a, 4]`,
      true
    )
  }
})

Deno.test({
  name: "Array literal with spread fail 1",
  fn() {
    testTypecheck(
      `
      const a = ['1', '2', '3']
      const b: number[] = [...a, 4]`,
      true
    )
  }
})

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
  name: "Object type fail",
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
  name: "Basic explicit generic fail argument",
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
  name: "Basic explicit generic with extends",
  fn() {
    testTypecheck(
      `
      func other<T extends { foo: number }>(a: T): number => a.foo
      const c: number = other<{ foo: number, bar: string }>({ foo: 12, bar: 'stuff' })`,
      false,
    );
  },
});

Deno.test({
  name: "Basic explicit generic with outside extends fail",
  fn() {
    testTypecheck(
      `
      func other<T extends { foo: number }>(a: T): number => a.foo
      const c: number = other<{ foo: string, bar: string }>({ foo: 'stuff', bar: 13 })`,
      true,
    );
  },
});

Deno.test({
  name: "Basic explicit generic with inside extends fail",
  fn() {
    testTypecheck(
      `
      func other<T extends { foo: number }>(a: T): number => a
      const c: number = other<{ foo: number, bar: string }>({ foo: 12, bar: 'stuff' })`,
      true,
    );
  },
});

Deno.test({
  name: "Basic explicit generic fail return",
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
  name: "Nested generic calls fail",
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
  name: "Nested generic calls with return inference fail",
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
  name: "Basic generic param inference fail",
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
  name: "Union generic param inference fail",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T|nil): T|nil => a
      const c: number = other(12)`,
      true
    )
  }
})

Deno.test({
  name: "Complex generic",
  fn() {
    testTypecheck(
      `
      func foo<T>(val: { prop: T }) => [val.prop]
      const x: number[] = foo<number>({ prop: 12 })`,
      false
    )
  }
})

Deno.test({
  name: "Complex generic fail",
  fn() {
    testTypecheck(
      `
      func foo<T>(val: { prop: T }) => [val.prop]
      const x: string[] = foo<number>({ prop: 12 })`,
      true
    )
  }
})

// Deno.test({
//   name: "Complex generic param inference",
//   fn() {
//     testTypecheck(
//       `
//       func given<T,R>(val: T|nil, fn: (val: T) => R): R|nil =>
//         if val != nil {
//           fn(val)
//         }
//
//       func double(n: number|nil): number|nil => given<number, number>(n, x => x * 2)`,
//       false
//     )
//   }
// })

Deno.test({
  name: "Union generic param inference fail",
  fn() {
    testTypecheck(
      `
      func other<T>(a: T|nil): T|nil => a
      const c: number = other(12)`,
      true
    )
  }
})

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
  name: "Const declaration referencing self",
  fn() {
    testTypecheck(
      `
      const a: number = a + 2`,
      true,
    );
  },
});

Deno.test({
  name: "Initializing a const from a let",
  fn() {
    testTypecheck(
      `
      let a = 12
      const b = a`,
      true,
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
  name: "Duplicate declaration name 1",
  fn() {
    testTypecheck(
      `
      proc foo() {
      }
      
      const foo = 12`,
      true,
    );
  },
});

Deno.test({
  name: "Duplicate declaration name 2",
  fn() {
    testMultiModuleTypecheck({
        'a.bgl': `export const a = 12`,
        'b.bgl': `
        from 'a.bgl' import { a }
        
        func a() => nil`
      },
      true,
    );
  },
});

Deno.test({
  name: "Basic type refinement",
  fn() {
    testTypecheck(
      `
      const a: number|nil = 12
      const b = if a != nil { a + 12 }`,
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
        if x.bar != nil {
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

// Deno.test({
//   name: "Chained type refinement pass",
//   fn() {
//     testTypecheck(
//       `
//       func foo(x: { bar: number|nil }): number|nil =>
//         x.bar && x.bar + `,
//       true,
//     );
//   },
// });

Deno.test({
  name: "Chained if/else refinement pass",
  fn() {
    testTypecheck(
      `
      func getOutcome(val: number | Error<string>): string =>
        if val instanceof number {
          'nothing wrong!'
        } else {
          val.value
        }`,
      false,
    );
  },
});

Deno.test({
  name: "Chained if/else refinement fail 1",
  fn() {
    testTypecheck(
      `
      func getOutcome(val: number | Error<string>): number =>
        if val instanceof number {
          'nothing wrong!'
        } else {
          val.value
        }`,
      true,
    );
  },
});

Deno.test({
  name: "Chained if/else refinement fail 2",
  fn() {
    testTypecheck(
      `
      func getOutcome(val: number | Error<string>): string =>
        if val instanceof Error<string> {
          'nothing wrong!'
        } else {
          val.value
        }`,
      true,
    );
  },
});

Deno.test({
  name: "Boolean refinement pass",
  fn() {
    testTypecheck(
      `
      func foo(val: boolean|string): true|string =>
        if val {
          val
        } else {
          'stuff'
        }`,
      false,
    );
  },
});

Deno.test({
  name: "Boolean refinement fail",
  fn() {
    testTypecheck(
      `
      func foo(val: boolean|string): true|string =>
        val`,
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
  name: "Property access pass",
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
  name: "Property access fail",
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
  name: "Property access named type pass",
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
  name: "Destructure pass",
  fn() {
    testTypecheck(`
      type Obj = {
        foo: {
          bar: number
        }
      }

      func fn(obj: Obj): number =>
        const { foo } = obj,
        foo.bar
      `,
      false
    )
  }
})

Deno.test({
  name: "Destructure fail",
  fn() {
    testTypecheck(`
      type Obj = {
        foo: {
          bar: number
        }
      }

      func fn(obj: Obj): string =>
        const { foo } = obj,
        foo.bar
      `,
      true
    )
  }
})

Deno.test({
  name: "Optional chain pass",
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
  name: "Optional chain fail",
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
  name: "Optional arguments pass",
  fn() {
    testTypecheck(
      `
      func foo(a: number, b?: string) => a + (b ?? 'foo')
      
      const b = foo(12)
      const c = foo(12, 'stuff')`,
      false,
    );
  },
});

Deno.test({
  name: "Optional arguments fail 1",
  fn() {
    testTypecheck(
      `
      func foo(a: number, b?: string) => a + b`,
      true,
    );
  },
});

Deno.test({
  name: "Optional arguments fail 2",
  fn() {
    testTypecheck(
      `
      func foo(a: number, b?: string) => a + (b ?? 'foo')
      
      const b = foo(12)
      const c = foo(12, 13)`,
      true,
    );
  },
});

Deno.test({
  name: "Optional arguments fail 3",
  fn() {
    testTypecheck(
      `
      func foo(a: number, b?: string) => a + (b ?? 'foo')
      
      const b = foo(12)
      const c = foo(12, 13, 14)`,
      true,
    );
  },
});

Deno.test({
  name: "Optional arguments fail 4",
  fn() {
    testTypecheck(
      `
      func foo(a: number, b?: string, c: boolean) => a + (b ?? 'foo')`,
      true,
    );
  },
});

Deno.test({
  name: "Fail to import module",
  fn() {
    testMultiModuleTypecheck({
      "module-1.bgl": `
      export func foo(b: number) => b * 2`,
      "module-2.bgl": `
      from 'module-3.bgl' import { foo }`
    }, true)
  }
})

Deno.test({
  name: "Import type across modules pass",
  fn() {
    testMultiModuleTypecheck({
      "module-1.bgl": `
      export type Foo = {
        method: () {}
      }`,

      "module-2.bgl": `
      from 'module-1.bgl' import { Foo }
      proc bar(foo: Foo) {
        foo.method();
      }`
    }, false)
  }
})

Deno.test({
  name: "Import type across modules fail",
  fn() {
    testMultiModuleTypecheck({
      "module-1.bgl": `
      export type Foo = {
        method: () {}
      }`,

      "module-2.bgl": `
      from 'module-1.bgl' import { Foo }
      proc bar(foo: Foo) {
        foo.other();
      }`
    }, true)
  }
})

Deno.test({
  name: "Inferred type across modules",
  fn() {
    testMultiModuleTypecheck({
      "module-1.bgl": `
      export func foo(b: number) => b * 2`,

      "module-2.bgl": `
      from 'module-1.bgl' import { foo }
      const stuff: number = foo(12)`
    }, false)
  }
})

Deno.test({
  name: "Inferred type across module with name resolution",
  fn() {
    testMultiModuleTypecheck({
      "module-1.bgl": `
      func foo(a: number) => a * 2
      export func bar(b: number) => foo(b) * 2`,

      "module-2.bgl": `
      from 'module-1.bgl' import { bar }
      const stuff: number = bar(12)`
    }, false)
  }
})

Deno.test({
  name: "Expose access in module",
  fn() {
    testMultiModuleTypecheck({
      "module-1.bgl": `
      expose let foo: number = 12`,

      "module-2.bgl": `
      from 'module-1.bgl' import { foo }
      proc bar() {
        let a: number = 0;

        a = foo;
      }`
    }, false)
  }
})


Deno.test({
  name: "Expose assignment",
  fn() {
    testMultiModuleTypecheck({
      "module-1.bgl": `
      expose let foo: number = 12`,

      "module-2.bgl": `
      from 'module-1.bgl' import { foo }
      proc bar() {
        foo = 13;
      }`
    }, true)
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
  name: "Negation fail",
  fn() {
    testTypecheck(`
    const a: number = 12
    const foo = !a
    `
    , true)
  }
})

Deno.test({
  name: "Literal type",
  fn() {
    testTypecheck(
      `
      const foo: 'bar' = 'bar'`,
      false,
    );
  },
});

Deno.test({
  name: "As-casting pass",
  fn() {
    testTypecheck(`
    func foo(val: number): number|string => val as number|string`,
    false)
  }
})

Deno.test({
  name: "As-casting fail",
  fn() {
    testTypecheck(`
    func foo(val: number|string): number => val as number`,
    true)
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
      let alias = obj as const { foo: string };
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

Deno.test({
  name: "Parentehsized type pass",
  fn() {
    testTypecheck(`
    const foo: (string|number)[] = ['foo', 12, 14, 'bar']`,
    false)
  }
})

Deno.test({
  name: "Parentehsized type fail",
  fn() {
    testTypecheck(`
    const foo: (string|number)[] = ['foo', 12, true, 'bar']`,
    true)
  }
})

Deno.test({
  name: "Nullish-coalescing",
  fn() {
    testTypecheck(`
    func foo(a: number?, b: string?, c: boolean): number|string|boolean => a ?? b ?? c`,
    false)
  }
})

Deno.test({
  name: "Nullish-coalescing fail",
  fn() {
    testTypecheck(`
    func foo(a: string?, b: string?): string => a ?? b ?? 12`,
    true)
  }
})

Deno.test({
  name: "Function method call",
  fn() {
    testTypecheck(`
    func foo(s: string) => s.length
    const a: number = 'foo'.foo()`,
    false)
  }
})

Deno.test({
  name: "Function method call fail",
  fn() {
    testTypecheck(`
    func foo(s: string) => s.length
    const a: string = 'foo'.foo()`,
    true)
  }
})

Deno.test({
  name: "Function method call with property 1",
  fn() {
    testTypecheck(`
    type T = { foo: () => string }
    const t: T = { foo: () => 'stuff' }

    func foo(s: T) => 12
    const a: string = t.foo()`,
    false)
  }
})

Deno.test({
  name: "Function method call with property 2",
  fn() {
    testTypecheck(`
    type T = { foo: () => string }
    const t: T = { foo: () => 'stuff' }

    func bar(s: T) => 12
    const a: string = t.foo()`,
    false)
  }
})

Deno.test({
  name: "Function method call with property 3",
  fn() {
    testTypecheck(`
    type T = { foo: () => string }
    const t: T = { foo: () => 'stuff' }

    func bar(s: T) => 12
    const a: number = t.bar()`,
    false)
  }
})

Deno.test({
  name: "Proc declaration with statements pass",
  fn() {
    testTypecheck(`
    proc log(val: unknown) { }

    proc doStuff(items: Iterator<{ foo: boolean }>) {
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
    false)
  }
})

Deno.test({
  name: "Proc declaration with statements fail 1",
  fn() {
    testTypecheck(`
    proc log(val: unknown) { }

    proc doStuff(items: Iterator<{ foo: boolean }>) {
      let count: string = 0;
    }`,
    true)
  }
})

Deno.test({
  name: "Proc declaration with statements fail 2",
  fn() {
    testTypecheck(`
    proc log(val: unknown) { }

    proc doStuff(items: Iterator<{ foo: boolean }>) {
      const count = 0;

      for item of items {
        count = count + 1;
      }
    }`,
    true)
  }
})

Deno.test({
  name: "Proc declaration with statements fail 3",
  fn() {
    testTypecheck(`
    proc doStuff(items: Iterator<{ foo: boolean }>) {
      const count = count;
    }`,
    true)
  }
})

Deno.test({
  name: "Destructuring statement pass",
  fn() {
    testTypecheck(`
    proc doStuff(stuff: { foo: boolean }) {
      const { foo } = stuff;
    }`,
    false)
  }
})

Deno.test({
  name: "Destructuring statement fail 1",
  fn() {
    testTypecheck(`
    proc doStuff(stuff: { foo: boolean }) {
      const { foo } = foo;
    }`,
    true)
  }
})

Deno.test({
  name: "Destructuring statement fail 2",
  fn() {
    testTypecheck(`
    proc doStuff(stuff: { foo: boolean }) {
      const { bar } = stuff;
    }`,
    true)
  }
})

Deno.test({
  name: "Destructuring statement fail 3",
  fn() {
    testTypecheck(`
    proc doStuff(stuff: { foo: boolean }) {
      const { foo } = stuff;
      foo = true;
    }`,
    true)
  }
})

Deno.test({
  name: "Destructuring array statement pass",
  fn() {
    testTypecheck(`
    proc doStuff(tuple: [number, number], array: number[]) {
      const [a] = tuple;
      const [b, c] = tuple;
      const ap: number = a;
      const bp: number = b;
      const cp: number = c;

      const [a2, b2] = array;
      const a2p: number|nil = a2;
      const b2p: number|nil = b2;
    }`,
    false)
  }
})

Deno.test({
  name: "Destructuring array statement fail 1",
  fn() {
    testTypecheck(`
    proc doStuff(tuple: [number, number]) {
      const [a, b, c] = tuple;
    }`,
    true)
  }
})

Deno.test({
  name: "Destructuring array statement fail 2",
  fn() {
    testTypecheck(`
    proc doStuff(array: number[]) {
      const [a, b] = array;
      const ap: number = a;
    }`,
    true)
  }
})

Deno.test({
  name: "Derive declaration pass",
  fn() {
    testTypecheck(`
    let bar = 12
    derive foo: number () => bar * 2`,
    false)
  }
})

Deno.test({
  name: "Derive declaration fail",
  fn() {
    testTypecheck(`
    let bar = 12
    derive foo: string () => bar * 2`,
    true)
  }
})

Deno.test({
  name: "Pure function",
  fn() {
    testTypecheck(`
    const a = 12
    func foo(b: number) => a * b`,
    false)
  }
})

Deno.test({
  name: "Impure function",
  fn() {
    testTypecheck(`
    let a = 12
    func foo(b: number) => a * b`,
    true)
  }
})

Deno.test({
  name: "Import all pass",
  fn() {
    testMultiModuleTypecheck({
      'a.bgl': `export func foo(a: number) => a + 'stuff'`,
      'b.bgl': `
      import 'a.bgl' as moduleA
      const x = moduleA.foo(12)`
    },
    false)
  }
})

Deno.test({
  name: "Import all fail 1",
  fn() {
    testMultiModuleTypecheck({
      'a.bgl': `export func foo2(a: number) => a + 'stuff'`,
      'b.bgl': `
      import 'a.bgl' as moduleA
      const x = moduleA.foo(12)`
    },
    true)
  }
})

Deno.test({
  name: "Import all fail 2",
  fn() {
    testMultiModuleTypecheck({
      'a.bgl': `export func foo(a: number) => a + 'stuff'`,
      'b.bgl': `
      import 'a.bgl' as moduleA
      const x = foo(12)`
    },
    true)
  }
})

Deno.test({
  name: "Import all fail 3",
  fn() {
    testMultiModuleTypecheck({
      'a.bgl': `export func foo(a: number) => a + 'stuff'`,
      'b.bgl': `
      import 'a.bgl' as moduleA
      const x = moduleA.foo('stuff')`
    },
    true)
  }
})

Deno.test({
  name: "Import all fail 4",
  fn() {
    testMultiModuleTypecheck({
      'a.bgl': `export func foo(a: number) => a + 'stuff'`,
      'b.bgl': `
      import 'c.bgl' as moduleA`
    },
    true)
  }
})

Deno.test({
  name: "Record type pass",
  fn() {
    testTypecheck(`
    type Foo = const {[string]: boolean}
    const a: Foo = { foo: true, bar: false }
    const b: Foo = {}
    
    func f(val: Foo): const {[string]: boolean|string} => val`,
    false)
  }
})

Deno.test({
  name: "Record type fail 1",
  fn() {
    testTypecheck(`
    type Foo = {[string]: boolean}
    const a: Foo = { foo: true, bar: 12 }`,
    true)
  }
})

Deno.test({
  name: "Record type fail 2",
  fn() {
    testTypecheck(`
    type Foo = {[string]: boolean}
    func f(val: Foo): {[string]: boolean|string} => val`,
    true)
  }
})

Deno.test({
  name: "Array type pass",
  fn() {
    testTypecheck(`
    type Foo = const (number|string)[]
    const a: Foo = [1, 'two', 3]
    const b: Foo = [1, 2, 3]
    const c: Foo = []
    
    func f(val: Foo): const (number|string|boolean)[] => val
    `,
    false)
  }
})

Deno.test({
  name: "Array type fail 1",
  fn() {
    testTypecheck(`
    type Foo = (number|string)[]
    func f(val: Foo): (number|string|boolean)[] => val
    `,
    true)
  }
})

Deno.test({
  name: "Array type fail 2",
  fn() {
    testTypecheck(`
    type Foo = (number|string)[]
    func f(val: Foo): number[] => val
    `,
    true)
  }
})

Deno.test({
  name: "Tuple type pass",
  fn() {
    testTypecheck(`
    type Foo = const [string, number, boolean]
    const a: Foo = ['stuff', 12, true]
    
    func f(val: Foo): const [string, number, boolean|number] => val`,
    false)
  }
})

Deno.test({
  name: "Tuple type fail 1",
  fn() {
    testTypecheck(`
    type Foo = [string, number, boolean]
    const a: Foo = [4, 12, true]`,
    true)
  }
})

Deno.test({
  name: "Tuple type fail 2",
  fn() {
    testTypecheck(`
    type Foo = [string, number, boolean]
    const a: Foo = ['stuff', 12, true, 'other']`,
    true)
  }
})

Deno.test({
  name: "Tuple type fail 3",
  fn() {
    testTypecheck(`
    type Foo = [string, number, boolean]
    const a: Foo = ['stuff', 12]`,
    true)
  }
})

Deno.test({
  name: "Tuple type fail 4",
  fn() {
    testTypecheck(`
    type Foo = [string, number, boolean]

    func f(val: Foo): [string, number, boolean|number] => val`,
    true)
  }
})

Deno.test({
  name: "Tuple type fail 5",
  fn() {
    testTypecheck(`
    type Foo = [string, number, boolean]
    const a: Foo = []`,
    true)
  }
})

Deno.test({
  name: "Tuple type fail 6",
  fn() {
    testTypecheck(`
    type Foo = [string, number, boolean]
    func foo(arr: (string|number|boolean)[]): Foo => arr`,
    true)
  }
})

Deno.test({
  name: "Func type pass",
  fn() {
    testTypecheck(`
    type Foo = (a: number, b: string) => number
    const a: Foo = (a: number, b: string) => a
    const b: Foo = (a: number) => a`,
    false)
  }
})

Deno.test({
  name: "Func type fail 1",
  fn() {
    testTypecheck(`
    type Foo = (a: number, b: string) => number
    const a: Foo = (a: number, b: string) => b`,
    true)
  }
})

Deno.test({
  name: "Func type fail 2",
  fn() {
    testTypecheck(`
    type Foo = (a: number, b: string) => number
    const a: Foo = (a: number, b: string, c: boolean) => a`,
    true)
  }
})

Deno.test({
  name: "Proc type pass",
  fn() {
    testTypecheck(`
    type Foo = (a: number, b: string) { }
    const a: Foo = (a: number, b: string) { }
    const b: Foo = (a: number) { }`,
    false)
  }
})

Deno.test({
  name: "Proc type fail 1",
  fn() {
    testTypecheck(`
    type Foo = (a: number, b: string) { }
    const a: Foo = (a: number, b: string, c: boolean) { }`,
    true)
  }
})

Deno.test({
  name: "Tuple length pass",
  fn() {
    testTypecheck(`
    const a = ['a', 'b', 'c']
    const len: 3 = a.length
    const el: 'b' = a[1]`,
    false)
  }
})

Deno.test({
  name: "Tuple length fail",
  fn() {
    testTypecheck(`
    const a = ['a', 'b', 'c']
    const len: 2 = a.length`,
    true)
  }
})

Deno.test({
  name: "Switch expression pass",
  fn() {
    testTypecheck(`
    func foo(n: number): string? =>
      switch n {
        case 0: 'zero',
        case 1: 'one',
        case 2: 'two'
      }

    func bar(n: number): string =>
      switch n {
        case 0: 'zero',
        case 1: 'one',
        case 2: 'two',
        default: 'I dunno!'
      }`,
    false)
  }
})

Deno.test({
  name: "Switch expression fail 1",
  fn() {
    testTypecheck(`
    func foo(n: number): string =>
      switch n {
        case 0: 'zero',
        case 1: 'one',
        case 2: 'two'
      }`,
    true)
  }
})

Deno.test({
  name: "Switch expression fail 2",
  fn() {
    testTypecheck(`
    func foo(n: number): string? =>
      switch n {
        case 0: 'zero',
        case 'a': 'one',
        case 2: 'two'
      }`,
    true)
  }
})

Deno.test({
  name: "Range expression pass",
  fn() {
    testTypecheck(`
    const a: Iterator<number> = 0..10
    
    proc foo() {
      for n of 5..15 {

      }
    }`,
    false)
  }
})

Deno.test({
  name: "Range expression fail",
  fn() {
    testTypecheck(`
    const a: Iterator<string> = 0..10`,
    true)
  }
})

Deno.test({
  name: "String interpolation pass",
  fn() {
    testTypecheck(`
    const a = 12
    const b = 'dlfkhg'
    const c = true
    const s: string = '\${a} - \${b} - \${c}'`,
    false)
  }
})

Deno.test({
  name: "String interpolation fail",
  fn() {
    testTypecheck(`
    const a = { foo: 'bar' }
    const s: string = '\${a}'`,
    true)
  }
})

Deno.test({
  name: "Typeof type pass",
  fn() {
    testTypecheck(`
    const a = { a: 1, b: 2, c: 3 }
    
    func foo(val: typeof a) => nil
    
    const b = foo(a)`,
    false)
  }
})

Deno.test({
  name: "Typeof type fail",
  fn() {
    testTypecheck(`
    const a = { a: 1, b: 2, c: 3 }
    
    func foo(val: typeof a) => nil
    
    const b = foo(12)`,
    true)
  }
})

Deno.test({
  name: "Keyof type pass",
  fn() {
    testTypecheck(`
    const a = { a: 1, b: 2, c: 3 }
    
    func foo(val: keyof typeof a) => nil
    
    const b = foo('a')`,
    false)
  }
})

Deno.test({
  name: "Keyof type fail",
  fn() {
    testTypecheck(`
    const a = { a: 1, b: 2, c: 3 }
    
    func foo(val: keyof typeof a) => nil
    
    const b = foo('other')`,
    true)
  }
})

Deno.test({
  name: "Valueof type pass",
  fn() {
    testTypecheck(`
    const a = { a: 1, b: 2, c: 3 }
    
    func foo(val: valueof typeof a) => nil
    
    const b = foo(1)`,
    false)
  }
})

Deno.test({
  name: "Valueof type fail",
  fn() {
    testTypecheck(`
    const a = { a: 1, b: 2, c: 3 }
    
    func foo(val: valueof typeof a) => nil
    
    const b = foo(12)`,
    true)
  }
})

Deno.test({
  name: "Elementof type pass",
  fn() {
    testTypecheck(`
    const a = [1, 2, 3]
    
    func foo(val: elementof typeof a) => nil
    
    const b = foo(1)`,
    false)
  }
})

Deno.test({
  name: "Elementof type fail",
  fn() {
    testTypecheck(`
    const a = [1, 2, 3]
    
    func foo(val: elementof typeof a) => nil
    
    const b = foo(12)`,
    true)
  }
})

Deno.test({
  name: "Indexer pass",
  fn() {
    testTypecheck(`
    func foo(record: {['foo'|'bar']: number}, obj: { prop1: string, prop2: number }, arr: number[], tuple: [number, number]) =>
      const a: number? = record['foo'],
      
      const b: string = obj['prop1'],

      const c: number? = arr[12],

      const d: number = tuple[1],

      nil`,
    false)
  }
})

Deno.test({
  name: "Indexer fail 1",
  fn() {
    testTypecheck(`
    func foo(record: {['foo'|'bar']: number}) =>
      const a: number = record['foo'],
      nil`,
    true)
  }
})

Deno.test({
  name: "Indexer fail 2",
  fn() {
    testTypecheck(`
    func foo(record: {['foo'|'bar']: number}) =>
      const a = record['stuff'],
      nil`,
    true)
  }
})

Deno.test({
  name: "Indexer fail 3",
  fn() {
    testTypecheck(`
    func foo(obj: { prop1: string, prop2: number }) =>
      const a = obj['stuff'],
      nil`,
    true)
  }
})

Deno.test({
  name: "Indexer fail 4",
  fn() {
    testTypecheck(`
    func foo(arr: number[]) =>
      const a: number = arr[12],
      nil`,
    true)
  }
})

Deno.test({
  name: "Indexer fail 5",
  fn() {
    testTypecheck(`
    func foo(arr: number[]) =>
      const a = arr['stuff'],
      nil`,
    true)
  }
})

Deno.test({
  name: "Indexer fail 6",
  fn() {
    testTypecheck(`
    func foo(tuple: [number, number]) =>
      const a = tuple[2],
      nil`,
    true)
  }
})

Deno.test({
  name: "Indexer fail 7",
  fn() {
    testTypecheck(`
    func foo(tuple: [number, number]) =>
      const a = tuple[-1],
      nil`,
    true)
  }
})

Deno.test({
  name: "Mutability broadening",
  fn() {
    testTypecheck(`
    proc push(arr: number[], el: number) {
    }

    proc foo() {
      let obj = { a: 0, b: '', c: false };
      obj.a = 12;
      obj.b = 'stuff';

      let arr = [1, 2];
      arr[1] = 3;
      arr.push(4);
    }`,
    false)
  }
})

Deno.test({
  name: "Remote pass",
  fn() {
    testTypecheck(`
    proc log(val: unknown) { }

    js func get(n: number): Plan<string> => {# #}

    let incr = 0
    remote foo: string () => get(incr)
    
    proc thing() {
      if (!foo.loading) {
        log(foo.value);
      }

      incr = incr + 1;
    }`,
    false)
  }
})

Deno.test({
  name: "Remote fail 1",
  fn() {
    testTypecheck(`
    proc log(val: unknown) { }

    js func get(n: number): Plan<string> => {# #}

    let incr = 0
    remote foo: number () => get(incr)
    `,
    true)
  }
})

Deno.test({
  name: "Remote fail 2",
  fn() {
    testTypecheck(`
    js func get(n: number): Plan<string> => {# #}

    let incr = 0
    remote foo: string () => get(incr)
    
    proc thing() {
      foo.value = 'stuff';
    }`,
    true)
  }
})

Deno.test({
  name: "Remote fail 3",
  fn() {
    testTypecheck(`
    js func get(n: number): Plan<string> => {# #}

    let incr = 0
    remote foo: string () => incr`,
    true)
  }
})

Deno.test({
  name: "Remote fail 4",
  fn() {
    testTypecheck(`
    js func get(n: number): Plan<string> => {# #}

    let incr = 0
    remote foo: string (x: string) => get(incr)`,
    true)
  }
})

Deno.test({
  name: "Derive pass",
  fn() {
    testTypecheck(`
    proc log(val: unknown) { }

    let incr = 0
    derive doubled: number () => incr * 2
    
    proc thing() {
      log(doubled + incr);
    }`,
    false)
  }
})

Deno.test({
  name: "Derive fail 1",
  fn() {
    testTypecheck(`
    proc log(val: unknown) { }

    let incr = 0
    derive doubled: boolean () => incr * 2`,
    true)
  }
})

Deno.test({
  name: "Derive fail 2",
  fn() {
    testTypecheck(`
    proc log(val: unknown) { }

    let incr = 0
    derive doubled: number (x: string) => incr * 2`,
    true)
  }
})

Deno.test({
  name: "Throw statement pass",
  fn() {
    testTypecheck(`
    proc foo() {
      throw Error('message');
    }`,
    false)
  }
})

Deno.test({
  name: "Throw statement fail",
  fn() {
    testTypecheck(`
    proc foo() {
      throw 12;
    }`,
    true)
  }
})

Deno.test({
  name: "Error bubble pass",
  fn() {
    testTypecheck(`
    proc foo() {
      throw Error('message');
    }
    
    proc main() {
      foo()?;
    }`,
    false)
  }
})

Deno.test({
  name: "Error bubble fail",
  fn() {
    testTypecheck(`
    proc foo() {
      throw Error('message');
    }
    
    proc main() {
      foo();
    }`,
    true)
  }
})

Deno.test({
  name: "Try/catch pass",
  fn() {
    testTypecheck(`
    proc log(s: string) { }

    proc foo() {
      throw Error({ prop1: 'stuff' });
    }
    
    proc main() {
      try {
        foo();
      } catch e {
        log(e.value.prop1);
      }
    }`,
    false)
  }
})

Deno.test({
  name: "Try/catch fail 1",
  fn() {
    testTypecheck(`
    proc log(s: string) { }

    proc foo() {
      throw Error({ prop1: 'stuff' });
    }
    
    proc main() {
      try {
        foo();
      } catch e {
        log(e.value.prop2);
      }
    }`,
    true)
  }
})

Deno.test({
  name: "Try/catch fail 2",
  fn() {
    testTypecheck(`
    proc log(s: string) { }

    proc foo() {
      throw Error({ prop1: 'stuff' });
    }
    
    proc main() {
      try {
        foo()?;
      } catch e {
        log(e.value.prop1);
      }
    }`,
    true)
  }
})

Deno.test({
  name: "Circular type",
  fn() {
    testTypecheck(`
    type JSON =
      | {[string]: JSON}
      | JSON[]
      | string
      | number
      | boolean
      | nil
    
    const foo: JSON = { bar: 'stuff' }`,
    false)
  }
})

// Deno.test({
//   name: "Complex function type inference pass",
//   fn() {
//     testTypecheck(`
//     type Adder = {
//       inc: (n: number) => number
//     }
    
//     const a: Adder = {
//       inc: n => n + 1
//     }`,
//     false)
//   }
// })


function testTypecheck(code: string, shouldFail: boolean): void {
  const moduleName = "<test>.bgl" as ModuleName

  Store.start({
    mode: 'mock',
    modules: {
      [moduleName]: code
    },
    watch: undefined
  })
  
  const parseResult = parsed(Store, moduleName)

  if (parseResult) {
    const errors = allProblems(Store).get(moduleName)?.filter(e => e.kind !== 'lint-problem' || e.severity === 'error')

    if (!errors) throw Error('Bwahhhh!')
  
    if (!shouldFail && errors.length > 0) {
      throw `\n${code}\n\nType check should have succeeded but failed with errors\n` +
        errors.map(err => prettyProblem(moduleName, err)).join("\n")
    } else if (shouldFail && errors.length === 0) {
      throw `\n${code}\n\nType check should have failed but succeeded`
    }
  }
}

function testMultiModuleTypecheck(modules: {[key: string]: string}, shouldFail: boolean): void {
  modules = Object.fromEntries(Object.entries(modules).map(([key, value]) =>
    [
      canonicalModuleName(key as ModuleName, key),
      value
    ]))

  Store.start({
    mode: 'mock',
    modules,
    watch: undefined
  })
  
  const errors = [...allProblems(Store).values()].flat()?.filter(e => e.kind !== 'lint-problem' || e.severity === 'error')

  if (!shouldFail && errors.length > 0) {
    throw `Type check should have succeeded but failed with errors\n\n` +
    errors.map(err => prettyProblem("<test>" as ModuleName, err)).join("\n")
  } else if (shouldFail && errors.length === 0) {
    throw `Type check should have failed but succeeded`
  }
}