import { deepEquals } from "../compiler/utils/misc.ts";
import { UNKNOWN_TYPE } from "../compiler/_model/type-expressions.ts";

Deno.test({
  name: "Deep-equals with undefined",
  fn() {
    const val1 = {

    };
    const val2 = {
        foo: undefined
    };

    if (!deepEquals(val1, val2)) {
        throw "Values should be considered equal but were not"
    }
}})

Deno.test({
  name: "Deep-equals arrays",
  fn() {
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
        throw "Values should be considered inequal but were not"
    }
}})

Deno.test({
    name: "Deep-equals self",
    fn() {
        const obj = {
            "kind": "module",
            "declarations": [
                {
                    "kind": "type-declaration",
                    "name": {
                        "kind": "plain-identifier",
                        "name": "Foo"
                    },
                    "type": {
                        "kind": "nominal-type",
                        "inner": {
                            "kind": "object-type",
                            "spreads": [],
                            "entries": [
                                {
                                    "kind": "attribute",
                                    "name": {
                                        "kind": "plain-identifier",
                                        "name": "prop1"
                                    },
                                    "type": {
                                        "kind": "string-type"
                                    }
                                },
                                {
                                    "kind": "attribute",
                                    "name": {
                                        "kind": "plain-identifier",
                                        "name": "prop2"
                                    },
                                    "type": {
                                        "kind": "number-type"
                                    }
                                }
                            ],
                            "mutability": "mutable"
                        }
                    },
                    "exported": true
                }
            ]
        }

        if (!deepEquals(obj, JSON.parse(JSON.stringify(obj)))) {
            throw "Values should be considered equal but were not"
        }
    }
})

Deno.test({
  name: "Deep-equals big",
  fn() {
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

    if (!deepEquals(val, JSON.parse(JSON.stringify(val)), ["id"])) {
        throw "Values should be considered equal but were not"
    }
}})
