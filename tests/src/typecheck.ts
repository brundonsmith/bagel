import { TypeExpression } from "../../compiler/src/ast";
import { parse } from "../../compiler/src/parse";
import { BagelTypeError, isError, typecheckModule } from "../../compiler/src/typecheck";
import { deepEquals } from "../../compiler/src/utils";
import { test } from "./testing-utils";

console.log("typecheck.ts")

test(function typeDeclarations() {
    return testTypecheck(`type Foo = string`, [{ kind: "string-type" }])
        ?? testTypecheck(`type Bar = string | number`, [{
            kind: "union-type",
            members: [
                { kind: "string-type" },
                { kind: "number-type" },
            ],
        }])
        ?? testTypecheck(`type Blah = string[]`, [{
            kind: "array-type",
            element: { kind: "string-type" },
        }])
        ?? testTypecheck(`type Stuff = { foo: Bar, foo2: Blah }`, [{
            kind: "object-type",
            entries: [
                [
                    { kind: "plain-identifier", name: "foo" },
                    { kind: "named-type", name: { kind: "plain-identifier", name: "Bar" } },
                ],
                [
                    { kind: "plain-identifier", name: "foo2" },
                    { kind: "named-type", name: { kind: "plain-identifier", name: "Blah" } },
                ]
            ],
        }])
})

test(function constDeclarationsInference() {
    return testTypecheck(`const foo = 'stuff'`, [{ kind: "string-type" }])
        ?? testTypecheck(`const bar = 12`, [{ kind: "number-type" }])
        ?? testTypecheck(`const bar = [ '1', '2', '3' ]`, [{
            kind: "array-type",
            element: { kind: "string-type" },
        }])
        ?? testTypecheck(`const stuff = {
            foo: 12,
            foo2: [ 'other' ]
        }`, [{
            kind: "object-type",
            entries: [
                [
                    { kind: "plain-identifier", name: "foo" },
                    { kind: "number-type" },
                ],
                [
                    { kind: "plain-identifier", name: "foo2" },
                    {
                        kind: "array-type",
                        element: { kind: "string-type" },
                    },
                ]
            ],
        }])
})

test(function nameResolutions() {
    const code = `
    type Foo = string
    
    type Bar = string | number
    
    type Blah = string[]
    
    type Stuff = { foo: Bar, foo2: Blah }
    
    const foo: Foo = 'stuff'
    
    const bar: Bar = 12
    
    const blah: Blah = [ '1', '2', '3' ]
    
    const stuff: Stuff = {
        foo: 12,
        foo2: [ 'other' ]
    }`

    const parsed = parse(code);
    const type = typecheckModule(parsed);

    const failureIndex = type.findIndex(t => t == null);

    if (failureIndex >= 0) {
        return "Type check should have succeeded but failed on declaration " + failureIndex;
    }
})

test(function failsWhenShould() {
    const code = `
    type Foo = string
    
    type Bar = string | number
    
    type Blah = string[]
    
    type Stuff = { foo: Bar, foo2: Blah }
    
    const foo: Foo = 12
    
    const bar: Bar = 12
    
    const blah: Blah = [ '1', '2', 3 ]
    
    const stuff: Stuff = {
        foo: 12,
        foo2: [ 'other' ]
    }`

    const parsed = parse(code);
    const type = typecheckModule(parsed);

    const expectedToSucceed = [true, true, true, true, false, true, false, true];
    const mismatch = type.findIndex((t, index) => !isError(t) !== expectedToSucceed[index]);

    if (mismatch >= 0) {
        const expected = expectedToSucceed[mismatch];

        return `Type check should have ${expected ? 'succeeded' : 'failed'} on declaration ${mismatch}, but it ${expected ? 'failed' : 'succeeded'}`;
    }
})

test(function passingValidArguments() {
    return testTypecheck(`
        func foo(a: number, b: number): number => a + b
        
        const bar = foo(3, 12)`,
        [
            {
                kind: "func-type",
                argTypes: [
                    { kind: "number-type" },
                    { kind: "number-type" },
                ],
                returnType: { kind: "number-type" },
            },
            { kind: "number-type" },
        ])
})

test(function passingInvalidArguments() {
    return testTypecheck(`
        func foo(a: number, b: number): number => a + b
        
        const bar = foo('stuff', 12)`,
        [
            {
                kind: "func-type",
                argTypes: [
                    { kind: "number-type" },
                    { kind: "number-type" },
                ],
                returnType: { kind: "number-type" },
            },
            {
                kind: "bagel-assignable-to-error",
                ast: {
                    kind: "string-literal",
                    segments: [
                        "stuff"
                    ]
                },
                destination: { kind: "number-type" },
                value: { kind: "string-type" }
            }
        ])
})


test(function usingInvalidReturnType() {
    return testTypecheck(`
        func foo(a: number, b: number): number => a + b
        
        const bar: string = foo(3, 12)`,
        [
            {
                kind: "func-type",
                argTypes: [
                    { kind: "number-type" },
                    { kind: "number-type" },
                ],
                returnType: { kind: "number-type" },
            },
            {
                kind: "bagel-assignable-to-error",
                ast: {
                    kind: "const-declaration",
                    name: {
                        kind: "plain-identifier",
                        name: "bar"
                    },
                    type: { kind: "string-type" },
                    value: {
                        kind: "funcall",
                        func: {
                            kind: "local-identifier",
                            name: "foo"
                        },
                        args: [
                            {
                                kind: "number-literal",
                                value: 3
                            },
                            {
                                kind: "number-literal",
                                value: 12
                            }
                        ]
                    },
                    exported: false
                },
                destination: { kind: "string-type" },
                value: { kind: "number-type" }
            },
        ])
})


test(function propertyAccessorType() {
    return testTypecheck(`
        const obj = {
            foo: {
                bar: 12
            }
        }
        
        const other = obj.foo.bar`,
        [
            {
                kind: "object-type",
                entries: [
                    [
                        { kind: "plain-identifier", name: "foo" },
                        {
                            kind: "object-type",
                            entries: [
                                [
                                    { kind: "plain-identifier", name: "bar" },
                                    { kind: "number-type" },
                                ]
                            ],
                        }
                    ]
                ],
            },
            { kind: "number-type" },
        ])
})


// test(function preventsIteratorMisuse() {
//     return testTypecheck(`
//         func myFunc(map, filter) => 
//             0..10 |> map((n) => n * 2) |> filter((n) => n < 10) |> map((n) => '\${n}')
//         `,
//         [
//             {
//                 kind: "func-type",
//                 argTypes: []
//             }
//         ])
// })


function testTypecheck(code: string, expected: (TypeExpression | BagelTypeError)[], debug?: boolean): string | undefined {
    const parsed = parse(code);
    const type = typecheckModule(parsed);

    if (debug) console.log("PARSED: ", JSON.stringify(parsed, null, 4))

    if (!deepEquals(type, expected)) {
        return `\nTypechecking: "${code}"\n\nExpected:\n${JSON.stringify(expected, null, 4)}\n\nReceived:\n${JSON.stringify(type, null, 4)}`;
    }
}