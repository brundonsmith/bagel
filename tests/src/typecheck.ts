
import { ModulesStore } from "../../compiler/src/3_checking/modules-store";
import { scopescan } from "../../compiler/src/3_checking/scopescan";
import { BagelTypeError, errorMessage, typecheck } from "../../compiler/src/3_checking/typecheck";
import { typescan } from "../../compiler/src/3_checking/typescan";
import { STRING_TYPE, NUMBER_TYPE, UNKNOWN_TYPE, TypeExpression } from "../../compiler/src/_model/type-expressions";
import { parse } from "../../compiler/src/1_parse";
import { deepEquals, given } from "../../compiler/src/utils";
import { test } from "./testing-utils";

console.log("typecheck.ts")

test(function typeDeclarations() {
    return testTypecheck(`type Foo = string`, [STRING_TYPE])
        ?? testTypecheck(`type Bar = string | number`, [{
            kind: "union-type",
            members: [
                STRING_TYPE,
                NUMBER_TYPE,
            ],
        }])
        ?? testTypecheck(`type Blah = string[]`, [{
            kind: "array-type",
            element: STRING_TYPE,
        }])
        ?? given(`type Stuff = { foo: Bar, foo2: Blah }`, code => testTypecheck(code, [{
            kind: "object-type",
            entries: [
                [
                    { kind: "plain-identifier", name: "foo", code, startIndex: 15, endIndex: 18 },
                    { kind: "named-type", name: { kind: "plain-identifier", name: "Bar", code, startIndex: 20, endIndex: 23 } },
                ],
                [
                    { kind: "plain-identifier", name: "foo2", code, startIndex: 25, endIndex: 28 },
                    { kind: "named-type", name: { kind: "plain-identifier", name: "Blah", code, startIndex: 30, endIndex: 34 } },
                ]
            ],
        }]))
})

test(function constDeclarationsInference() {
    return testTypecheck(`const foo = 'stuff'`, [STRING_TYPE])
        ?? testTypecheck(`const bar = 12`, [NUMBER_TYPE])
        ?? testTypecheck(`const bar = [ '1', '2', '3' ]`, [{
            kind: "array-type",
            element: STRING_TYPE,
        }])
        ?? testTypecheck(`const stuff = {
            foo: 12,
            foo2: [ 'other' ]
        }`, [{
            kind: "object-type",
            entries: [
                [
                    { kind: "plain-identifier", name: "foo" },
                    NUMBER_TYPE,
                ],
                [
                    { kind: "plain-identifier", name: "foo2" },
                    {
                        kind: "array-type",
                        element: STRING_TYPE,
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
    
    const modulesStore = new ModulesStore();
    modulesStore.modules.set("foo", parsed);
    scopescan(modulesStore, parsed);
    typescan(modulesStore, parsed);
    let errors: BagelTypeError[] = [];
    typecheck(modulesStore, parsed, err => errors.push(err));

    if (errors.length > 0) {
        return "Type check should have succeeded but failed with errors:\n\n" + errors.map(errorMessage).join("\n\n");
    }
})

// test(function failsWhenShould() {
//     const code = `
//     type Foo = string
    
//     type Bar = string | number
    
//     type Blah = string[]
    
//     type Stuff = { foo: Bar, foo2: Blah }
    
//     const foo: Foo = 12
    
//     const bar: Bar = 12
    
//     const blah: Blah = [ '1', '2', 3 ]
    
//     const stuff: Stuff = {
//         foo: 12,
//         foo2: [ 'other' ]
//     }`

//     const parsed = parse(code);
//     const type = typecheck(parsed);

//     const expectedToSucceed = [true, true, true, true, false, true, false, true];
//     const mismatch = type.findIndex((t, index) => !isError(t) !== expectedToSucceed[index]);

//     if (mismatch >= 0) {
//         const expected = expectedToSucceed[mismatch];

//         return `Type check should have ${expected ? 'succeeded' : 'failed'} on declaration ${mismatch}, but it ${expected ? 'failed' : 'succeeded'}`;
//     }
// })

test(function passingValidArguments() {
    return testTypecheck(`
        func foo(a: number, b: number): number => a + b
        
        const bar = foo(3, 12)`,
        [
            {
                kind: "func-type",
                argTypes: [
                    NUMBER_TYPE,
                    NUMBER_TYPE,
                ],
                returnType: NUMBER_TYPE,
            },
            NUMBER_TYPE,
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
                    NUMBER_TYPE,
                    NUMBER_TYPE,
                ],
                returnType: NUMBER_TYPE,
            },
            UNKNOWN_TYPE,
            // {
            //     kind: "bagel-assignable-to-error",
            //     ast: {
            //         kind: "string-literal",
            //         segments: [
            //             "stuff"
            //         ]
            //     },
            //     destination: NUMBER_TYPE,
            //     value: STRING_TYPE
            // }
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
                    NUMBER_TYPE,
                    NUMBER_TYPE,
                ],
                returnType: NUMBER_TYPE,
            },
            UNKNOWN_TYPE,
            // {
            //     kind: "bagel-assignable-to-error",
            //     ast: {
            //         kind: "const-declaration",
            //         name: {
            //             kind: "plain-identifier",
            //             name: "bar"
            //         },
            //         type: STRING_TYPE,
            //         value: {
            //             kind: "funcall",
            //             func: {
            //                 kind: "local-identifier",
            //                 name: "foo"
            //             },
            //             args: [
            //                 {
            //                     kind: "number-literal",
            //                     value: 3
            //                 },
            //                 {
            //                     kind: "number-literal",
            //                     value: 12
            //                 }
            //             ]
            //         },
            //         exported: false
            //     },
            //     destination: STRING_TYPE,
            //     value: NUMBER_TYPE
            // },
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
                                    NUMBER_TYPE,
                                ]
                            ],
                        }
                    ]
                ],
            },
            NUMBER_TYPE,
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


function testTypecheck(code: string, expected: TypeExpression[], debug?: boolean): string | undefined {
    const parsed = parse(code);
    
    const modulesStore = new ModulesStore();
    modulesStore.modules.set("foo", parsed);
    scopescan(modulesStore, parsed);
    typescan(modulesStore, parsed);
    let errors: BagelTypeError[] = [];
    typecheck(modulesStore, parsed, err => errors.push(err));

    if (errors.length > 0) {
        return "Type check should have succeeded but failed with errors:\n\n" + errors.map(errorMessage).join("\n\n");
    }

    if (debug) console.log("PARSED: ", JSON.stringify(parsed, null, 4))

    const declarationTypes = parsed.declarations
        .filter(decl => decl.kind !== "type-declaration")
        .map(decl => modulesStore.getTypeOf(decl));

    if (!deepEquals(declarationTypes, expected)) {
        return `\nTypechecking: "${code}"\n\nExpected:\n${JSON.stringify(expected, null, 4)}\n\nReceived:\n${JSON.stringify(declarationTypes, null, 4)}`;
    }
}
