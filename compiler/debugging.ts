import { displayForm } from "./3_checking/typecheck.ts";
import { given, iterateParseTree } from "./utils.ts";
import { AST } from "./_model/ast.ts";
import { Scope } from "./_model/common.ts";
import { isTypeExpression } from "./_model/type-expressions.ts";

export function log<T>(expr: T, fn?: (expr: T) => unknown): T {
    console.log(fn == null ? expr : fn(expr));
    return expr;
}

export function withoutSourceInfo(ast: AST) {
    const clone = JSON.parse(JSON.stringify(ast))

    for (const { current } of iterateParseTree(clone)) {
        // @ts-ignore
        delete current.code
        // @ts-ignore
        delete current.startIndex
        // @ts-ignore
        delete current.endIndex
    }

    return clone
}

export function displayScope(scope: Scope) {
    return {
        types: Object.fromEntries(scope.types.entries().map(([key, value]) => [key, { ...value, type: display(value.type) }])),
        values: Object.fromEntries(scope.values.entries().map(([key, value]) => [key, { ...value, declaredType: given(value.declaredType, display), initialValue: given(value.initialValue, display) }])),
        classes: Object.fromEntries(scope.classes.entries().map(([key, value]) => [key, display(value)])),
    }
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
