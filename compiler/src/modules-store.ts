import { AST, Block, Expression, Func, Module, Proc, TypeExpression } from "./ast";
import { DeepReadonly } from "./utils";

export type Scope = {
    readonly parentScope?: Scope,
    readonly types: {[key: string]: TypeExpression},
    readonly values: {[key: string]: TypeExpression|Expression},
}

export type ReadonlyScope = {
    readonly types: Readonly<{[key: string]: TypeExpression}>,
    readonly values: Readonly<{[key: string]: TypeExpression}>,
}

export class ModulesStore {
    readonly modules = new Map<string, Module>();
    readonly scopeFor = new Map<Module|Func|Proc|Block, Scope>();
    readonly astTypes = new Map<AST, TypeExpression>();

    getScopeFor(ast: Module|Func|Proc|Block): DeepReadonly<Scope> {
        const scope = this.scopeFor.get(ast);

        if (scope == null) {
            throw Error("No scope was created for:" + JSON.stringify(ast, null, 2));
        }

        return scope;
    }

    getTypeOf(ast: AST): TypeExpression {
        const type = this.astTypes.get(ast);

        if (type == null) {
            throw Error("No type found for AST node:" + JSON.stringify(ast, null, 2));
        }

        return type;
    }
}
