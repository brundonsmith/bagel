import { test } from "./testing-utils";
import { deepEquals } from "../../src/utils";

console.log("utils.ts")

test(function deepEqualsWithUndefined() {
    const val1 = {

    };
    const val2 = {
        foo: undefined
    };
    
    if (!deepEquals(val1, val2)) {
        return "Values should be considered equal but were not"
    }
})

test(function deepEqualsBig() {
    const val = {
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
    };

    if (!deepEquals(val, JSON.parse(JSON.stringify(val)))) {
        return "Values should be considered equal but were not"
    }
})

console.log("")