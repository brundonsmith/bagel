import { Module } from "../_model/ast.ts";
import { UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { walkParseTree } from "../utils.ts";

/**
 * Reshape the parse tree in various ways, including simplification of later 
 * passes and optimization
 */
export function reshape(ast: Module): Module {
    const clone = JSON.parse(JSON.stringify(ast));

    walkParseTree(undefined, clone, (_, ast) => {
        switch (ast.kind) {
            case "block": {
                for (let i = 0; i < ast.statements.length; i++) {
                    const stmt = ast.statements[i]
                    if (stmt.kind === "computation") {
                        const { code, startIndex, endIndex, name, expression } = stmt;

                        // TODO: Once constants within procedures are a thing, 
                        // this should be a constant
                        ast.statements[i] = {
                            kind: "let-declaration",
                            name,
                            code,
                            startIndex,
                            endIndex,
                            value: {
                                kind: "func",
                                code: expression.code,
                                startIndex: expression.startIndex,
                                endIndex: expression.endIndex,
                                consts: [],
                                body: expression,
                                type: {
                                    kind: "func-type",
                                    args: [],
                                    returnType: UNKNOWN_TYPE,
                                    typeParams: [],
                                    code: undefined,
                                    startIndex: undefined,
                                    endIndex: undefined,
                                }
                            }
                        }
                    }
                }
            } break;
        }

        return undefined
    })

    return clone;
}
