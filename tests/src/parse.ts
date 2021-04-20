
import { test } from "./testing-utils";
import { parse } from "../../src/parse";
import { AST, FuncDeclaration } from "../../src/ast";
import { deepEquals } from "../../src/utils";

console.log("parse.ts")

test(function simpleFuncDeclaration() {
    return testParse(
        "func uid() => '12345'",
        {
            kind: "func-declaration",
            func: {
                kind: "func",
                name: {
                    kind: "plain-identifier",
                    name: "uid",
                },
                type: {
                    kind: "func-type",
                    argTypes: [],
                    returnType: { kind: "unknown-type" },
                },
                argNames: [],
                body: {
                    kind: "string-literal",
                    segments: ["12345"],
                }
            }
        },
        (code, index) => parse(code)[0],
    );
})

test(function funcCallCall() {
    return testParse(
        "const foo = fn()()",
        {
            kind: "const-declaration",
            name: {
                kind: "plain-identifier",
                name: "foo"
            },
            type: {
                "kind": "unknown-type"
            },
            value: {
                kind: "funcall",
                args: [],
                func: {
                    kind: "funcall",
                    args: [],
                    func: {
                        kind: "local-identifier",
                        name: "fn",
                    }
                }
            }
        },
        (code, index) => parse(code)[0],
    );
})

test(function simpleProcDeclaration() {
    return testParse(
        `proc doStuff(a) {
            
        }`,
        {
            kind: "proc-declaration",
            proc: {
                kind: "proc",
                name: {
                    kind: "plain-identifier",
                    name: "doStuff",
                },
                type: {
                    kind: "proc-type",
                    argTypes: [{ kind: "unknown-type" }],
                },
                argNames: [
                    {
                        kind: "plain-identifier",
                        name: "a",
                    }
                ],
                body: []
            }
        },
        (code, index) => parse(code)[0],
    );
})

test(function basicProcDeclaration() {
    return testParse(
        `proc doStuff(a) {
            let count = 0;
            
            for (item of items) {
            }

            console.log(count);
        }`,
        {
            kind: "proc-declaration",
            proc: {
                kind: "proc",
                name: {
                    kind: "plain-identifier",
                    name: "doStuff",
                },
                type: {
                    kind: "proc-type",
                    argTypes: [{ kind: "unknown-type" }],
                },
                argNames: [
                    {
                        kind: "plain-identifier",
                        name: "a",
                    }
                ],
                body: [
                    {
                        kind: "let-declaration",
                        name: { kind: "local-identifier", name: "count" },
                        type: { kind: "unknown-type" },
                        value: { kind: "number-literal", value: 0 },
                    },
                    {
                        kind: "for-loop",
                        itemIdentifier: { kind: "plain-identifier", name: "item" },
                        iterator: { kind: "local-identifier", name: "items" },
                        body: []
                    },
                    {
                        kind: "proc-call",
                        proc: {
                            kind: "property-accessor",
                            base: { kind: "local-identifier", name: "console" },
                            properties: [
                                { kind: "plain-identifier", name: "log" },
                            ],
                        },
                        args: [
                            { kind: "local-identifier", name: "count" }
                        ]
                    }
                ]
            }
        },
        (code, index) => parse(code)[0],
    );
})

test(function procDeclarationWithStatements() {
    return testParse(
        `proc doStuff(a) {
            let count = 0;

            for (item of items) {
                if (item.foo) {
                    count = count + 1;
                }

                if (count > 12) {
                    console.log(a);
                } else {
                    console.log(nil);
                }
            }

            console.log(count);
        }`,
        {
            kind: "proc-declaration",
            proc: {
                kind: "proc",
                name: {
                    kind: "plain-identifier",
                    name: "doStuff",
                },
                type: {
                    kind: "proc-type",
                    argTypes: [{ kind: "unknown-type" }],
                },
                argNames: [
                    {
                        kind: "plain-identifier",
                        name: "a",
                    }
                ],
                body: [
                    {
                        kind: "let-declaration",
                        name: { kind: "local-identifier", name: "count" },
                        type: { kind: "unknown-type" },
                        value: { kind: "number-literal", value: 0 },
                    },
                    {
                        kind: "for-loop",
                        itemIdentifier: { kind: "plain-identifier", name: "item" },
                        iterator: { kind: "local-identifier", name: "items" },
                        body: [
                            {
                                kind: "if-else-statement",
                                ifCondition: {
                                    kind: "property-accessor",
                                    base: { kind: "local-identifier", name: "item" },
                                    properties: [
                                        { kind: "plain-identifier", name: "foo" },
                                    ],
                                },
                                ifResult: [
                                    {
                                        kind: "assignment",
                                        target: { kind: "local-identifier", name: "count" },
                                        value: {
                                            kind: "binary-operator",
                                            operator: "+",
                                            left: { kind: "local-identifier", name: "count" },
                                            right: { kind: "number-literal", value: 1 }
                                        }
                                    }
                                ],
                            },
                            {
                                kind: "if-else-statement",
                                ifCondition: {
                                    kind: "binary-operator",
                                    operator: ">",
                                    left: { kind: "local-identifier", name: "count" },
                                    right: { kind: "number-literal", value: 12 },
                                },
                                ifResult: [
                                    {
                                        kind: "proc-call",
                                        proc: {
                                            kind: "property-accessor",
                                            base: { kind: "local-identifier", name: "console" },
                                            properties: [
                                                { kind: "plain-identifier", name: "log" },
                                            ],
                                        },
                                        args: [
                                            { kind: "local-identifier", name: "a" }
                                        ]
                                    }
                                ],
                                elseResult: [
                                    {
                                        kind: "proc-call",
                                        proc: {
                                            kind: "property-accessor",
                                            base: { kind: "local-identifier", name: "console" },
                                            properties: [
                                                { kind: "plain-identifier", name: "log" },
                                            ],
                                        },
                                        args: [
                                            { kind: "nil-literal" }
                                        ]
                                    }
                                ],
                            }
                        ],
                    },
                    {
                        kind: "proc-call",
                        proc: {
                            kind: "property-accessor",
                            base: { kind: "local-identifier", name: "console" },
                            properties: [
                                { kind: "plain-identifier", name: "log" },
                            ],
                        },
                        args: [
                            { kind: "local-identifier", name: "count" }
                        ]
                    }
                ]
            }
        },
        (code, index) => parse(code)[0],
    );
})

test(function simpleConstDeclaration() {
    return testParse(
        "const foo: FooType = 'stuff'",
        {
            kind: "const-declaration",
            name: {
                kind: "plain-identifier",
                name: "foo",
            },
            type: {
                kind: "named-type",
                name: {
                    kind: "plain-identifier",
                    name: "FooType",
                },
            },
            value: {
                kind: "string-literal",
                segments: ["stuff"],
            }
        },
        (code, index) => parse(code)[0],
    );
})


test(function basicPropertyAccess() {
    return testParse(
        "const foo = bar.prop1.prop2",
        {
            kind: "const-declaration",
            name: {
                kind: "plain-identifier",
                name: "foo",
            },
            type: { kind: "unknown-type" },
            value: {
                kind: "property-accessor",
                base: {
                    kind: "local-identifier",
                    name: "bar",
                },
                properties: [
                    {
                        kind: "plain-identifier",
                        name: "prop1",
                    },
                    {
                        kind: "plain-identifier",
                        name: "prop2",
                    }
                ]
            }
        },
        (code, index) => parse(code)[0],
    );
})


test(function funcDeclarationWithPipe() {
    return testParse(
        `func classNames(cn) =>
            cn
                |> entries 
                |> fromEntries`,
        {
            kind: "func-declaration",
            func: {
                kind: "func",
                name: {
                    kind: "plain-identifier",
                    name: "classNames",
                },
                type: {
                    kind: "func-type",
                    argTypes: [ { kind: "unknown-type" } ],
                    returnType: { kind: "unknown-type" },
                },
                argNames: [
                    {
                        kind: "plain-identifier",
                        name: "cn",
                    }
                ],
                body: {
                    kind: "pipe",
                    expressions: [
                        {
                            kind: "local-identifier",
                            name: "cn",
                        },
                        {
                            kind: "local-identifier",
                            name: "entries",
                        },
                        {
                            kind: "local-identifier",
                            name: "fromEntries",
                        }
                    ]
                }
            }
        },
        (code, index) => parse(code)[0],
    );
})


test(function funcDeclarationWithIteration() {
    return testParse(
        `func myFunc(a, b) => 
            0..10 |> map((n) => n * 2) |> filter((n) => n < 10)
        `,
        {
            kind: "func-declaration",
            func: {
                kind: "func",
                name: {
                    kind: "plain-identifier",
                    name: "myFunc",
                },
                type: {
                    kind: "func-type",
                    argTypes: [ { kind: "unknown-type" }, { kind: "unknown-type" } ],
                    returnType: { kind: "unknown-type" },
                },
                argNames: [
                    {
                        kind: "plain-identifier",
                        name: "a",
                    },
                    {
                        kind: "plain-identifier",
                        name: "b",
                    }
                ],
                body: {
                    kind: "pipe",
                    expressions: [
                        {
                            kind: "range",
                            start: 0,
                            end: 10,
                        },
                        {
                            kind: "funcall",
                            func: {
                                kind: "local-identifier",
                                name: "map",
                            },
                            args: [
                                {
                                    kind: "func",
                                    type: {
                                        kind: "func-type",
                                        argTypes: [ { kind: "unknown-type" } ],
                                        returnType: { kind: "unknown-type" },
                                    },
                                    argNames: [
                                        {
                                            kind: "plain-identifier",
                                            name: "n",
                                        }
                                    ],
                                    body: {
                                        kind: "binary-operator",
                                        operator: "*",
                                        left: {
                                            kind: "local-identifier",
                                            name: "n",
                                        },
                                        right: {
                                            kind: "number-literal",
                                            value: 2,
                                        }
                                    }
                                }
                            ]
                        },
                        {
                            kind: "funcall",
                            func: {
                                kind: "local-identifier",
                                name: "filter",
                            },
                            args: [
                                {
                                    kind: "func",
                                    type: {
                                        kind: "func-type",
                                        argTypes: [ { kind: "unknown-type" } ],
                                        returnType: { kind: "unknown-type" },
                                    },
                                    argNames: [
                                        {
                                            kind: "plain-identifier",
                                            name: "n",
                                        }
                                    ],
                                    body: {
                                        kind: "binary-operator",
                                        operator: "<",
                                        left: {
                                            kind: "local-identifier",
                                            name: "n",
                                        },
                                        right: {
                                            kind: "number-literal",
                                            value: 10,
                                        }
                                    }
                                }
                            ]
                        },
                    ]
                }
            }
        },
        (code, index) => parse(code)[0],
    );
})

test(function typedFuncDeclaration() {
    return testParse(`
        func foo(a: string, b: number): number => 0
    `,
        {
            kind: "func-declaration",
            func: {
                kind: "func",
                name: {
                    kind: "plain-identifier",
                    name: "foo",
                },
                type: {
                    kind: "func-type",
                    argTypes: [
                        {
                            kind: "primitive-type",
                            type: "string",
                        },
                        {
                            kind: "primitive-type",
                            type: "number",
                        }
                    ],
                    returnType: {
                        kind: "primitive-type",
                        type: "number",
                    },
                },
                argNames: [
                    { kind: "plain-identifier", name: "a" },
                    { kind: "plain-identifier", name: "b" },
                ],
                body: {
                    kind: "number-literal",
                    value: 0,
                }
            }
        },
        (code, index) => parse(code)[0],
    );
})

test(function typedProcDeclaration() {
    return testParse(`
        proc bar(a: string[], b: { foo: number }) {
                    
        }
    `,
        {
            kind: "proc-declaration",
            proc: {
                kind: "proc",
                name: {
                    kind: "plain-identifier",
                    name: "bar",
                },
                type: {
                    kind: "proc-type",
                    argTypes: [
                        {
                            kind: "array-type",
                            element: {
                                kind: "primitive-type",
                                type: "string",
                            },
                        },
                        {
                            kind: "object-type",
                            entries: [
                                [
                                    { kind: "plain-identifier", name: "foo" },
                                    { kind: "primitive-type", type: "number" },
                                ]
                            ],
                        },
                    ],
                },
                argNames: [
                    { kind: "plain-identifier", name: "a" },
                    { kind: "plain-identifier", name: "b" },
                ],
                body: []
            }
        },
        (code, index) => parse(code)[0],
    );
})



function testParse<T extends AST>(code: string, expected: T, parseFn: (code: string, index: number) => T): string|undefined {
    const parsed = parseFn(code, 0);

    if (!deepEquals(parsed, expected)) {
        return `\nParsing: "${code}"\n\nExpected:\n${JSON.stringify(expected, null, 2)}\n\nReceived:\n${JSON.stringify(parsed, null, 2)}`;
    }
}

console.log("");