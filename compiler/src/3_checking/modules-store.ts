import { AST, Module } from "../_model/ast";
import { Expression } from "../_model/expressions";
import { TypeExpression } from "../_model/type-expressions";
import { DeepReadonly } from "../utils";
import { ClassDeclaration } from "../_model/declarations";


export type Scope = {
    readonly parentScope?: Scope,
    readonly types: {[key: string]: TypeExpression},
    readonly values: {[key: string]: DeclarationDescriptor},
    readonly classes: {[key: string]: ClassDeclaration},
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
