import { AST, Module } from "../model/ast";
import { Expression } from "../model/expressions";
import { TypeExpression } from "../model/type-expressions";
import { DeepReadonly } from "../utils";


export type Scope = {
    readonly parentScope?: Scope,
    readonly types: {[key: string]: TypeExpression},
    readonly values: {[key: string]: DeclarationDescriptor},
}

export type Mutability = "all"|"properties-only"|"none";

export type DeclarationDescriptor = {
    mutability: Mutability,
    declaredType: TypeExpression,
    initialValue?: Expression,
}

export type ReadonlyScope = {
    readonly types: Readonly<{[key: string]: TypeExpression}>,
    readonly values: Readonly<{[key: string]: TypeExpression}>,
}

export class ModulesStore {
    readonly modules = new Map<string, Module>();
    readonly scopeFor = new WeakMap<AST, Scope>();
    readonly astTypes = new WeakMap<AST, TypeExpression>();

    getScopeFor(ast: AST): DeepReadonly<Scope> {
        const scope = this.scopeFor.get(ast);

        if (scope == null) {
            throw Error("No scope was created for:" + JSON.stringify(ast, null, 2));
        }

        return scope;
    }

    getTypeOf(ast: AST): TypeExpression {
        const type = this.astTypes.get(ast);

        if (type == null) {
            throw Error(`No type found for AST node of kind '${ast.kind}'`);
        }

        return type;
    }
}