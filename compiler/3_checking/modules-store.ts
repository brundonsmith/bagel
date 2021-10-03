import { AST, Module } from "../_model/ast.ts";
import { Expression } from "../_model/expressions.ts";
import { TypeExpression } from "../_model/type-expressions.ts";
import { ClassDeclaration } from "../_model/declarations.ts";

export type Scope = {
    readonly types: {[key: string]: TypeDeclarationDescriptor},
    readonly values: {[key: string]: DeclarationDescriptor},
    readonly classes: {[key: string]: ClassDeclaration},
}

export type TypeDeclarationDescriptor = {
    readonly isGenericParameter: boolean,
    readonly type: TypeExpression,
}

export type DeclarationDescriptor = {
    readonly mutability: "all"|"properties-only"|"none",
    readonly declaredType?: TypeExpression,
    readonly initialValue?: Expression,
}

export class ModulesStore {
    readonly modules = new Map<string, Module>();
    readonly scopeFor = new WeakMap<AST, Scope>();
    readonly parentAst = new WeakMap<AST, AST>();

    getScopeFor(ast: AST): Scope {
        const scope = this.scopeFor.get(ast);

        if (scope == null) {
            throw Error("No scope was created for:" + JSON.stringify(ast, null, 2));
        }

        return scope;
    }
}
