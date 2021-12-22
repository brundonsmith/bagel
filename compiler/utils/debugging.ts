import { AST } from "../_model/ast.ts";
import { iterateParseTree } from "./ast.ts";

export function log<T>(expr: T, fn?: (expr: T) => unknown): T {
    console.log(fn == null ? expr : fn(expr));
    return expr;
}

export function withoutSourceInfo(ast: AST) {
    const clone = JSON.parse(JSON.stringify(ast))

    for (const { current } of iterateParseTree(clone)) {
        // @ts-ignore
        delete current.module
        // @ts-ignore
        delete current.code
        // @ts-ignore
        delete current.startIndex
        // @ts-ignore
        delete current.endIndex
    }

    return clone
}
