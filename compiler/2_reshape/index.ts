import { Module } from "../_model/ast.ts";
import { UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { walkParseTree } from "../utils.ts";
import { Statement } from "../_model/statements.ts";

/**
 * Reshape the parse tree in various ways, including simplification of later 
 * passes and optimization
 */
export function reshape(ast: Module): Module {
    // const clone = JSON.parse(JSON.stringify(ast));

    // walkParseTree(undefined, clone, (_, ast) => {
    //     switch (ast.kind) {
    //     }

    //     return undefined
    // })

    // return clone;
    return ast;
}
