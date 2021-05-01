import { test } from "./testing-utils";
import { deepEquals } from "../../compiler/src/utils";
import { UNKNOWN_TYPE } from "../../compiler/src/ast";

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

test(function deepEqualsArrays() {
    const val1 = [
        {
            "kind": "func-type",
            "argTypes": [
                {
                    "kind": "primitive-type",
                    "type": "number"
                },
                {
                    "kind": "primitive-type",
                    "type": "number"
                }
            ],
            "returnType": {
                "kind": "primitive-type",
                "type": "number"
            }
        }
    ]
    const val2 = [
        {
            "kind": "func-type",
            "argTypes": [
                {
                    "kind": "primitive-type",
                    "type": "number"
                },
                {
                    "kind": "primitive-type",
                    "type": "number"
                }
            ],
            "returnType": {
                "kind": "primitive-type",
                "type": "number"
            }
        },
        {
            "kind": "primitive-type",
            "type": "number"
        }
    ]
    
    if (deepEquals(val1, val2)) {
        return "Values should be considered inequal but were not"
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
            type: UNKNOWN_TYPE,
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
                                type: UNKNOWN_TYPE,
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
                                type: UNKNOWN_TYPE,
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