import { AST } from "../_model/ast.ts";
import { iterateParseTree } from "./ast.ts";

export function log<T>(expr: T, fn?: (expr: T) => unknown): T {
    console.log(fn == null ? expr : fn(expr));
    return expr;
}

export function stripSourceInfo(ast: AST) {
    for (const { current } of iterateParseTree(ast)) {
        // @ts-ignore
        delete current.parent
        // @ts-ignore
        delete current.module
        // @ts-ignore
        delete current.code
        // @ts-ignore
        delete current.startIndex
        // @ts-ignore
        delete current.endIndex
    }
}
