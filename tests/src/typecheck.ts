import { TypeExpression } from "../../src/ast";
import { parse } from "../../src/parse";
import { typecheckFile } from "../../src/typecheck";
import { deepEquals } from "../../src/utils";
import { test } from "./testing-utils";

test(function typeDeclarations() {
    return testTypecheck(`type Foo = string`, [ {
            kind: "primitive-type",
            type: "string",
        } ])
        ?? testTypecheck(`type Bar = string | number`, [ {
            kind: "union-type",
            members: [
                { kind: "primitive-type", type: "string" },
                { kind: "primitive-type", type: "number" },
            ],
        } ])
        ?? testTypecheck(`type Blah = string[]`, [ {
            kind: "array-type",
            element: { kind: "primitive-type", type: "string" },
        } ])
        ?? testTypecheck(`type Stuff = { foo: Bar, foo2: Blah }`, [ {
            kind: "object-type",
            entries: [
                [
                    { kind: "identifier", name: "foo" },
                    { kind: "named-type", name: { kind: "identifier", name: "Bar"} },
                ],
                [
                    { kind: "identifier", name: "foo2" },
                    { kind: "named-type", name: { kind: "identifier", name: "Blah"} },
                ]
            ],
        } ])
})

test(function constDeclarationsInference() {
    return testTypecheck(`const foo = 'stuff'`, [ {
            kind: "primitive-type",
            type: "string",
        } ])
        ?? testTypecheck(`const bar = 12`, [ {
            kind: "primitive-type",
            type: "number",
        } ])
        ?? testTypecheck(`const bar = [ '1', '2', '3' ]`, [ {
            kind: "array-type",
            element: { kind: "primitive-type", type: "string" },
        } ])
        ?? testTypecheck(`const stuff = {
            foo: 12,
            foo2: [ 'other' ]
        }`, [ {
            kind: "object-type",
            entries: [
                [
                    { kind: "identifier", name: "foo" },
                    { kind: "primitive-type", type: "number" },
                ],
                [
                    { kind: "identifier", name: "foo2" },
                    {
                        kind: "array-type",
                        element: { kind: "primitive-type", type: "string" },
                    },
                ]
            ],
        } ])
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

    const expectedToSucceed = [ true, true, true, true, false, true, false, true ];
    const mismatch = type.findIndex((t, index) => (t != null) !== expectedToSucceed[index]);

    if (mismatch >= 0) {
        const expected = expectedToSucceed[mismatch];

        return `Type check should have ${expected ? 'succeeded' : 'failed'} on declaration ${mismatch}, but it ${expected ? 'failed': 'succeeded'}`;
    }
})

function testTypecheck(code: string, expected: (TypeExpression|undefined)[]): string|undefined {
    const parsed = parse(code);
    const type = typecheckFile(parsed);

    if (!deepEquals(type, expected)) {
        return `\nTypechecking: "${code}"\n\nExpected:\n${JSON.stringify(expected, null, 2)}\n\nReceived:\n${JSON.stringify(type, null, 2)}`;
    }
}