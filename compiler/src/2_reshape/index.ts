import { Module } from "../_model/ast";
import { UNKNOWN_TYPE } from "../_model/type-expressions";
import { walkParseTree } from "../utils";

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
                            name: {
                                ...name,
                                kind: "local-identifier"
                            },
                            code,
                            startIndex,
                            endIndex,
                            value: {
                                kind: "func",
                                argNames: [],
                                code: expression.code,
                                startIndex: expression.startIndex,
                                endIndex: expression.endIndex,
                                body: expression,
                                type: {
                                    kind: "func-type",
                                    argTypes: [],
                                    returnType: UNKNOWN_TYPE,
                                    typeParams: []
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