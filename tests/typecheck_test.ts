import { BagelError, prettyProblem } from "../compiler/errors.ts";
import Store, { canonicalModuleName } from "../compiler/store.ts";
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
      `
      func fn(_: string) => 'foo'
      const y: string = fn('z')`,
      false,
    );
  },
});

Deno.test({
  name: "Basic function return inference mismatch",
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
  name: "Object literal with spread success",
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
  name: "Object literal with spread mismatch",
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
  name: "Array literal with spread success 1",
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
  name: "Array literal with spread success 2",
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
  name: "Array literal with spread mismatch 1",
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
  name: "Array literal with spread mismatch 1",
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
  name: "Basic explicit generic with outside extends mismatch",
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
  name: "Basic explicit generic with inside extends mismatch",
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
  name: "Complex generic mismatch",
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
//       func given<T,R>(val: T|nil, fn: (val: T) => R): R|nil => if val != nil { fn(val) }
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
//   name: "Virtual property type resolution when using named type",
//   fn() {
//     testTypecheck(
//       `
//       type TodoItem = {
//         text: string,
//         done: boolean
//       }
    
//       func renderApp(iter: Iterator<TodoItem>) =>
//         iter.map<string>(item => item.text).array()`,
//       false
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
  name: "Expose access in module",
  fn() {
    testMultiModuleTypecheck({
      "module-1": `
      expose let foo: number = 12`,

      "module-2": `
      from 'module-1' import { foo }
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
      "module-1": `
      expose let foo: number = 12`,

      "module-2": `
      from 'module-1' import { foo }
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
  name: "As-casting success",
  fn() {
    testTypecheck(`
    func foo(val: number): number|string => val as number|string`,
    false)
  }
})

Deno.test({
  name: "As-casting failure",
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
  name: "Parentehsized type success",
  fn() {
    testTypecheck(`
    const foo: (string|number)[] = ['foo', 12, 14, 'bar']`,
    false)
  }
})

Deno.test({
  name: "Parentehsized type failure",
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
  name: "Nullish-coalescing mismatch",
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
  name: "Function method call mismatch",
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

// TODO: Reactions
// TODO: if/else/switch

function testTypecheck(code: string, shouldFail: boolean): void {
  const moduleName = "<test>" as ModuleName

  Store.start({
    mode: 'mock',
    modules: {
      [moduleName]: code
    },
    watch: undefined
  })
  
  const parsed = Store.parsed(moduleName, true)

  if (parsed) {
    const errors = Store.allProblems.get(moduleName)

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
  
  const errors = [...Store.allProblems.values()].flat()

  if (!shouldFail && errors.length > 0) {
    throw `Type check should have succeeded but failed with errors\n\n` +
    errors.map(err => prettyProblem("<test>" as ModuleName, err)).join("\n")
  } else if (shouldFail && errors.length === 0) {
    throw `Type check should have failed but succeeded`
  }
}