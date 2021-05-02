import { AST, Block, Expression, ForLoop, Func, Module, NUMBER_TYPE, Proc, TypeExpression, UNKNOWN_TYPE } from "./ast";
import { ModulesStore, Scope } from "./modules-store";
import { walkParseTree } from "./utils";

export function scopescan(modulesStore: ModulesStore, ast: AST) {
    walkParseTree<Scope|undefined>(undefined, ast, (payload, ast) => {
        switch(ast.kind) {
            case "module":
            case "func":
            case "proc":
            case "block":
            case "for-loop": {
                const scope = scopeFrom(ast, payload);
                modulesStore.scopeFor.set(ast, scope);
                return scope;
            }
        }

        modulesStore.scopeFor.set(ast, payload as Scope);
        return payload;
    });
}

export type ScopeOwner = Module|Func|Proc|Block|ForLoop;

export function scopeFrom(ast: ScopeOwner, parentScope?: Scope): Scope {
    const scope: Scope = parentScope != null ? extendScope(parentScope) : { types: {}, values: {} };

    // TODO: Err on duplicate identifiers
    
    switch (ast.kind) {
        case "module":
            for (const declaration of ast.declarations) {
                if (declaration.kind === "type-declaration") {
                    scope.types[declaration.name.name] = declaration.type;
                } else if (declaration.kind === "func-declaration") {
                    scope.values[declaration.func.name?.name as string] = {
                        mutability: "none",
                        declaredType: declaration.func.type,
                        initialValue: declaration.func
                    };
                } else if (declaration.kind === "proc-declaration") {
                    scope.values[declaration.proc.name?.name as string] = {
                        mutability: "none",
                        declaredType: declaration.proc.type,
                        initialValue: declaration.proc
                    };
                } else if (declaration.kind === "const-declaration") {
                    scope.values[declaration.name?.name as string] = {
                        mutability: "none",
                        declaredType: declaration.type,
                        initialValue: declaration.value
                    };
                } else if (declaration.kind === "import-declaration") {
                    // TODO
                }
            }
            break;
        case "func":
        case "proc":
            for (let i = 0; i < ast.argNames.length; i++) {
                scope.values[ast.argNames[i].name] = {
                    mutability: ast.kind === "func" ? "none" : "properties-only",
                    declaredType: ast.type.argTypes[i],
                };
            }
            break;
        case "block":
            for (const statement of ast.statements) {
                if (statement.kind === "let-declaration") {
                    scope.values[statement.name.name] = {
                        mutability: "all",
                        declaredType: statement.type ?? UNKNOWN_TYPE, 
                        initialValue: statement.value
                    };
                }
            }
            break;
        case "for-loop":
            scope.values[ast.itemIdentifier.name] = {
                mutability: "properties-only",
                declaredType: NUMBER_TYPE, // TODO: ast.iterator;
            }
            break;
    }

    return scope;
}

export function extendScope(scope: Scope): Scope {
    return {
        types: Object.create(scope.types),
        values: Object.create(scope.values),
    }
}
