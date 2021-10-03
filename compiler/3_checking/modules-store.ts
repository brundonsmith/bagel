import { AST, Module } from "../_model/ast.ts";

export class ModulesStore {
    readonly modules = new Map<string, Module>();
    readonly parentAst = new WeakMap<AST, AST>();
}
