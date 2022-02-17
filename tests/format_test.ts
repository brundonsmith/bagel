import { parsed } from "../compiler/1_parse/index.ts";
import { DEFAULT_OPTIONS, format } from "../compiler/other/format.ts";
import Store from "../compiler/store.ts";
import { stripSourceInfo } from "../compiler/utils/debugging.ts";
import { deepEquals } from "../compiler/utils/misc.ts";
import { Module } from "../compiler/_model/ast.ts";
import { ModuleName } from "../compiler/_model/common.ts";

const BAGEL_SNIPPETS = [
    `func uid() => '12345'`,
    `const fn = a => a`,
    `func memo uid() => '12345'`,
    `const x = a < b`,
    `func uid(n: number) => 
        const double = 2 * n,
        const ten = 5 * double,
        ten`,
    `const x = a.b.c`,
    `const x = a.b()`,
    `const x = a.b()()`,
    `const x = a.b.c()`,
    `const x = a.b().c()`,
    `const x = a
        .b
        .c`,
    `const x = a
        .b()
        .c()`,
    `func merge() =>
            if arr1.length <= 0 {
                2
            } else {
                3
            }`,
    `func merge() =>
            if arr1.length <= 0 {
                2
            } else if arr1.length <= 1 {
                3
            } else {
              4
            }`,
    `proc foo() {
            }`,
    `proc foo() {
              if true {
                log('true');
              } else if false {
                log('false');
              } else {
                log('other');
              }
            }`,
    `
      const a = { foo: 'stuff' }
      const b = { ...a, bar: 'other' }`,
    `
      const a = [1, 2, 3]
      const b = [...a, 4]`,
    `func uid(arr, i) => arr[i]`,
    `const x = [ arr1[0] ]`,
    `proc doStuff(a) { }`,
    `proc doStuff(items: Iterator<number>) {
            let count = 0;
            
            for item of items {
            }

            console.log(count);
        }`,
    `proc doStuff(items: Iterator<number>) {
            let count = 0;

            for item of items {
                if item.foo {
                    count = count + 1;
                }

                if count > 12 {
                    console.log(items);
                } else {
                    console.log(nil);
                }
            }

            console.log(count);
        }`,
    `const foo: FooType = 'stuff'`,
    `const foo = bar.prop1.prop2`,
    `func foo(a: string, b: number): number => 0`,
    `proc bar(a: string[], b: { foo: number }) { }`,
    `export type MyFn = (a: number, b: string) => string[]`,
    `type Foo = string | number[]`,
    `type Foo = (a: string) => (b: number|boolean) => { foo: nil[] }`,
    `func foo() => 13 // foo bar comment
            const a = 12`,
    `func foo() => 13 /* foo bar comment
            moar comment*/
            const a = 12`,
    `
    const a: boolean = true
    const b: boolean = true

    const foo = !a && b
    `,
    `const x: string = 'foo'`, `const x: number = 'foo'`, `const x: boolean = 2 + 2 == 4`, `const x: string = 2 + 'foo' + 'bar'`, `const x: string = 2 * 3 + 'foo' + 'bar'`, `const x: number = 2 * 3 / 12`, `
        func foo(fn: (val: number) => boolean) => nil
        const x = foo(n => n)`, `
        func foo(fn: (val: number) => boolean) => nil
        const x = foo(n => n > 0)`, `
        func foo(fn: (val: number) => boolean) => nil
        const x = foo((n: number) => n > 0)`, `
        func foo(fn: (val: number) => boolean) => nil
        const x = foo((n: string) => n == 'foo')`, `const x = 'foo'\nconst y: number = x`, `func fn(_: string): string => 'foo'`, `func fn(): number => 'foo'`, `
        func fn(_: string) => 'foo'
        const y: string = fn('z')`, `
        func fn(_: string) => 'foo'
        const y: number = fn('z')`, `
        const a = { foo: 'stuff' }
        const b: { foo: string, bar: string } = { ...a, bar: 'other' }`, `
        const a = { foo: 'stuff' }
        const b: { foo: number, bar: string } = { ...a, bar: 'other' }`, `
        const a = [1, 2, 3]
        const b: number[] = [...a, 4]`, `
        const a = [1, 2, 3]
        const b: number = [...a, '4'][2]`, `
        func getThird<T extends string[]>(arr: T) => arr[2]
        const third: string|nil = getThird(['one', 'two', 'three'])`, `
        const a = 12
        const b = [...a, 4]`, `
        const a = ['1', '2', '3']
        const b: number[] = [...a, 4]`, `type MyObj = {
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
          }`, `type MyObj = {
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
          }`, `
        func foo(fn: (n: number) => number) => fn(12)
        const bar = foo(n => 2 * n)`, `
        func other<T>(a: T): T => a
        const c: number = other<number>(12)`, `
        func other<T>(a: T): T => a
        const c: number = other<number>('foo')`, `
        func other<T extends { foo: number }>(a: T): number => a.foo
        const c: number = other<{ foo: number, bar: string }>({ foo: 12, bar: 'stuff' })`, `
        func other<T extends { foo: number }>(a: T): number => a.foo
        const c: number = other<{ foo: string, bar: string }>({ foo: 'stuff', bar: 13 })`, `
        func other<T extends { foo: number }>(a: T): number => a
        const c: number = other<{ foo: number, bar: string }>({ foo: 12, bar: 'stuff' })`, `
        func other<T>(a: T): T => a
        const c: string = other<number>(12)`, `
        func other<T>(a: T) => a
        const c: number = other<number>(12)`, `
        func fnA<R>(a: R) => a
        func fnB<T>(b: T): T => fnA<T>(b)
        const c: number = fnB<number>(12)`, `
        func fnA<T>(a: R) => a
        func fnB<T>(b: T): T => fnA<T>(12)
        const c: number = fnB<number>(12)`, `
        func fnA<R>(a: R): R => a
        func fnB<T>(b: T) => fnA<T>(b)
        const c: number = fnB<number>(12)`, `
        func fnA<T>(a: R): R => a
        func fnB<T>(b: T) => fnA<T>(b)
        const c: string = fnB<number>(12)`, `
        func fnA<T>(a: T): T => a
        func fnB<T>(b: T): T => fnA<T>(b)
        const c: number = fnB<number>(12)`, `
        func other<T>(a: T): T => a
        const c: number = other(12)`, `
        func other<T>(a: T): T => a
        const c: number = other('foo')`, `
        func other<T>(a: T|nil): T|nil => a
        const c: number|nil = other(12)`, `
        func other<T>(a: T|nil): T|nil => a
        const c: number = other(12)`, `
        func foo<T>(val: { prop: T }) => [val.prop]
        const x: number[] = foo<number>({ prop: 12 })`, `
        func foo<T>(val: { prop: T }) => [val.prop]
        const x: string[] = foo<number>({ prop: 12 })`,
    `func foo(_: number) =>
          const a = b + 2,
          const b = 12,
          2 * a`, `
        func foo(_: number) =>
          const b = 12,
          const a = b + 2,
          2 * a`, `
        const a = b + 2
        const b = 12`, `
        const b = 12
        const a = b + 2`, `
        proc foo() {
          let a = b;
          let b = 12;
        }`, `
        proc foo() {
          let b = 12;
          let a = b;
        }`, `
        const a: number|nil = 12
        const b = if a != nil { a + 12 }`, `
        const a: number|nil = 12
        const b = a + 12`, `
        func foo(x: { bar: number|nil }): number|nil =>
          if x.bar != nil {
            x.bar - 12
          }`, `
        func foo(x: { bar: number|nil }): number|nil =>
          x.bar - 12`, `
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
        }`, `
        type Base = {
          foo: number
        }
        
        type Other = {
          ...Base,
          bar: string
        }
        
        const thing: Other = {
          bar: 'fgsdg'
        }`, `
        const obj = {
          foo: {
            bar: 12
          }
        }
  
        const val: number = obj.foo.bar
        `, `
        const obj = {
          foo: {
            bar: 12
          }
        }
  
        const val: number = obj.foo.other
        `, `
        type Obj = {
          foo: {
            bar: number
          }
        }
  
        func fn(obj: Obj): number =>
          obj.foo.bar
        `, `
        type Obj = {
          foo: nil | {
            bar: number
          }
        }
        
        func fn(obj: Obj): number|nil =>
          obj.foo?.bar`, `
        type Obj = {
          foo: nil | {
            bar: number
          }
        }
        
        func fn(obj: Obj): number|nil =>
          obj.foo.bar`,
      `
        let count: number = 0
  
        func memo render() =>
            <div>
                <button onClick={decrement}>{'-'}</button>
                <span>{count}</span>
                <button onClick={increment}>{'+'}</button>
            </div>
  
        proc decrement() {
            count = count - 1;
        }
  
        proc increment() {
            count = count + 1;
        }
      `,
    `
      const foo: 'bar' = 'bar'`, `
      func foo(val: number): number|string => val as number|string`, `
      func foo(val: number|string): number => val as number`, `
      const obj = { foo: 'stuff' }
  
      proc foo() {
        obj.foo = 'other';
      }`, `
      proc foo(param: { foo: string }) {
        param = { foo: 'stuff' };
      }`, `
      proc foo(param: { foo: string }) {
        param.foo = 'stuff';
      }`, `
      proc foo(param: const { foo: string }) {
        param.foo = 'stuff';
      }`, `
      proc foo(param: const { foo: { bar: string } }) {
        param.foo.bar = 'stuff';
      }`, `
      const obj = { foo: 'bar' }
  
      proc foo(param: { foo: string }) {
        let alias = obj;
        alias.foo = 'other';
      }`, `
      const obj = { foo: 'bar' }
  
      proc foo(param: { foo: string }) {
        let alias = obj as const { foo: string };
        alias = { foo: 'other' };
      }`, `
      proc foo(param: { foo: string }) {
        const obj = param;
      }`, `
      proc foo(param: { foo: string }) {
        const obj = param;
        obj.foo = 'other';
      }`, `
      const foo: (string|number)[] = ['foo', 12, 14, 'bar']`, `
      const foo: (string|number)[] = ['foo', 12, true, 'bar']`, `
      func foo(a: number?, b: string?, c: boolean): number|string|boolean => a ?? b ?? c`, `
      func foo(a: string?, b: string?): string => a ?? b ?? 12`,
      `export nominal type Foo({ prop1: string, prop2: number })`
]

Store.start({
    mode: "mock",
    modules: Object.fromEntries(BAGEL_SNIPPETS.map((bgl, index) => ['snippet ' + index, bgl])),
    watch: undefined
})

for (let i = 0; i < BAGEL_SNIPPETS.length; i++) {
    Deno.test({
        name: 'snippet ' + i,
        fn() {
            const { ast, errors } = parsed(Store, ('snippet ' + i) as ModuleName, false) ?? {}

            if (ast && errors && errors.length === 0) {
                const formattedModuleName = ('formatted snippet ' + i) as ModuleName
                const formatted = format(ast, DEFAULT_OPTIONS)

                Store.setSource(formattedModuleName, formatted)

                const reParsed = parsed(Store, formattedModuleName, false)?.ast as Module

                stripSourceInfo(ast)
                stripSourceInfo(reParsed)

                if (!deepEquals(ast, reParsed)) {
                    throw `Reformatted AST did not match original:\noriginal:\n${BAGEL_SNIPPETS[i]}\nformatted:\n${formatted}`
                }
            } else {
                throw `Failed to parse:\n${BAGEL_SNIPPETS[i]}`
            }
        }
    })
}