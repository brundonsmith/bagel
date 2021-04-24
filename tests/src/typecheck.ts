import { TypeExpression } from "../../compiler/src/ast";
import { parse } from "../../compiler/src/parse";
import { BagelTypeError, isError, typecheckFile } from "../../compiler/src/typecheck";
import { deepEquals } from "../../compiler/src/utils";
import { test } from "./testing-utils";

console.log("typecheck.ts")

test(function typeDeclarations() {
    return testTypecheck(`type Foo = string`, [{
        kind: "primitive-type",
        type: "string",
    }])
        ?? testTypecheck(`type Bar = string | number`, [{
            kind: "union-type",
            members: [
                { kind: "primitive-type", type: "string" },
                { kind: "primitive-type", type: "number" },
            ],
        }])
        ?? testTypecheck(`type Blah = string[]`, [{
            kind: "array-type",
            element: { kind: "primitive-type", type: "string" },
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
    return testTypecheck(`const foo = 'stuff'`, [{
        kind: "primitive-type",
        type: "string",
    }])
        ?? testTypecheck(`const bar = 12`, [{
            kind: "primitive-type",
            type: "number",
        }])
        ?? testTypecheck(`const bar = [ '1', '2', '3' ]`, [{
            kind: "array-type",
            element: { kind: "primitive-type", type: "string" },
        }])
        ?? testTypecheck(`const stuff = {
            foo: 12,
            foo2: [ 'other' ]
        }`, [{
            kind: "object-type",
            entries: [
                [
                    { kind: "plain-identifier", name: "foo" },
                    { kind: "primitive-type", type: "number" },
                ],
                [
                    { kind: "plain-identifier", name: "foo2" },
                    {
                        kind: "array-type",
                        element: { kind: "primitive-type", type: "string" },
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
    const type = typecheckFile(parsed);

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
    const type = typecheckFile(parsed);

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
                    { kind: "primitive-type", type: "number" },
                    { kind: "primitive-type", type: "number" },
                ],
                returnType: { kind: "primitive-type", type: "number" },
            },
            { kind: "primitive-type", type: "number" },
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
                    { kind: "primitive-type", type: "number" },
                    { kind: "primitive-type", type: "number" },
                ],
                returnType: { kind: "primitive-type", type: "number" },
            },
            {
                kind: "bagel-assignable-to-error",
                ast: {
                    kind: "string-literal",
                    segments: [
                        "stuff"
                    ]
                },
                destination: {
                    kind: "primitive-type",
                    type: "number"
                },
                value: {
                    kind: "primitive-type",
                    type: "string"
                }
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
                    { kind: "primitive-type", type: "number" },
                    { kind: "primitive-type", type: "number" },
                ],
                returnType: { kind: "primitive-type", type: "number" },
            },
            {
                kind: "bagel-assignable-to-error",
                ast: {
                    kind: "const-declaration",
                    name: {
                        kind: "plain-identifier",
                        name: "bar"
                    },
                    type: {
                        kind: "primitive-type",
                        type: "string"
                    },
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
                    }
                },
                destination: {
                    kind: "primitive-type",
                    type: "string"
                },
                value: {
                    kind: "primitive-type",
                    type: "number"
                }
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
                                    { kind: "primitive-type", type: "number" },
                                ]
                            ],
                        }
                    ]
                ],
            },
            { kind: "primitive-type", type: "number" },
        ])
})


function testTypecheck(code: string, expected: (TypeExpression | BagelTypeError)[], debug?: boolean): string | undefined {
    const parsed = parse(code);
    const type = typecheckFile(parsed);

    if (debug) console.log("PARSED: ", JSON.stringify(parsed, null, 4))

    if (!deepEquals(type, expected)) {
        return `\nTypechecking: "${code}"\n\nExpected:\n${JSON.stringify(expected, null, 4)}\n\nReceived:\n${JSON.stringify(type, null, 4)}`;
    }
}