import { deepEquals } from "../compiler/utils.ts";
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
