import { displayForm } from "./3_checking/typecheck.ts";
import { walkParseTree } from "./utils.ts";
import { AST } from "./_model/ast.ts";
import { Scope } from "./_model/common.ts";
import { isTypeExpression } from "./_model/type-expressions.ts";

export function log<T>(expr: T, fn?: (expr: T) => string): T {
    console.log(fn == null ? expr : fn(expr));
    return expr;
}

export function withoutSourceInfo(ast: AST) {
    const clone = JSON.parse(JSON.stringify(ast))

    walkParseTree(undefined, clone, (_, ast) => {
        // @ts-ignore
        delete ast.code
        // @ts-ignore
        delete ast.startIndex
        // @ts-ignore
        delete ast.endIndex

        return undefined
    })

    return clone
}

export function collapse(scope: Scope): Scope {
    let all: Scope = {
        types: {},
        values: {},
        classes: {},
        refinements: []
    }

    let types = scope.types
    while(types != null) {
        all = { ...all, types: { ...all.types, ...types } }
        types = Object.getPrototypeOf(types)
    }

    let values = scope.values
    while(values != null) {
        all = { ...all, values: { ...all.values, ...values } }
        values = Object.getPrototypeOf(values)
    }

    let classes = scope.classes
    while(classes != null) {
        all = { ...all, classes: { ...all.classes, ...classes } }
        classes = Object.getPrototypeOf(classes)
    }

    return all
}

export function display(ast: AST): string {
    if (isTypeExpression(ast)) {
        return displayForm(ast)
    }

    const { code, startIndex, endIndex } = ast
    if (code == null || startIndex == null || endIndex == null) {
        return JSON.stringify(ast)
    } else {
        return code.substring(startIndex, endIndex)
    }
}
