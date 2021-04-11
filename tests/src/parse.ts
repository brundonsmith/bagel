
import { test } from "./testing-utils";
import { parse } from "../../src/parse";
import { AST, FuncDeclaration } from "../../src/ast";
import { deepEquals } from "../../src/utils";

test(function simpleFuncDeclaration() {
    return testParse(
        "func uid() => '12345'",
        {
            kind: "func-declaration",
            func: {
                kind: "func",
                name: {
                    kind: "identifier",
                    name: "uid",
                },
                type: { kind: "unknown-type" },
                argNames: [],
                body: {
                    kind: "string-literal",
                    value: "12345",
                }
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
                kind: "identifier",
                name: "foo",
            },
            type: {
                kind: "named-type",
                name: {
                    kind: "identifier",
                    name: "FooType",
                },
            },
            value: {
                kind: "string-literal",
                value: "stuff",
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
                    kind: "identifier",
                    name: "classNames",
                },
                type: { kind: "unknown-type" },
                argNames: [
                    {
                        kind: "identifier",
                        name: "cn",
                    }
                ],
                body: {
                    kind: "pipe",
                    expressions: [
                        {
                            kind: "identifier",
                            name: "cn",
                        },
                        {
                            kind: "identifier",
                            name: "entries",
                        },
                        {
                            kind: "identifier",
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
                    kind: "identifier",
                    name: "myFunc",
                },
                type: { kind: "unknown-type" },
                argNames: [
                    {
                        kind: "identifier",
                        name: "a",
                    },
                    {
                        kind: "identifier",
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
                                kind: "identifier",
                                name: "map",
                            },
                            args: [
                                {
                                    kind: "func",
                                    type: { kind: "unknown-type" },
                                    argNames: [
                                        {
                                            kind: "identifier",
                                            name: "n",
                                        }
                                    ],
                                    body: {
                                        kind: "binary-operator",
                                        operator: "*",
                                        left: {
                                            kind: "identifier",
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
                                kind: "identifier",
                                name: "filter",
                            },
                            args: [
                                {
                                    kind: "func",
                                    type: { kind: "unknown-type" },
                                    argNames: [
                                        {
                                            kind: "identifier",
                                            name: "n",
                                        }
                                    ],
                                    body: {
                                        kind: "binary-operator",
                                        operator: "<",
                                        left: {
                                            kind: "identifier",
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


function testParse<T extends AST>(code: string, expected: T, parseFn: (code: string, index: number) => T): string|undefined {
    const parsed = parseFn(code, 0);

    if (!deepEquals(parsed, expected)) {
        return `\nParsing: "${code}"\n\nExpected:\n${JSON.stringify(expected, null, 2)}\n\nReceived:\n${JSON.stringify(parsed, null, 2)}`;
    }
}
