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

        return payload;
    });
}

export type ScopeOwner = Module|Func|Proc|Block|ForLoop;

export function scopeFrom(ast: ScopeOwner, parentScope?: Scope): Scope {
    const scope: Scope = parentScope != null ? extendScope(parentScope) : { types: {}, values: {} };

    switch (ast.kind) {
        case "module":
            for (const declaration of ast.declarations) {
                if (declaration.kind === "type-declaration") {
                    scope.types[declaration.name.name] = declaration.type;
                } else if (declaration.kind === "func-declaration") {
                    scope.values[declaration.func.name?.name as string] = unknownFallback(declaration.func.type, declaration.func);
                } else if (declaration.kind === "proc-declaration") {
                    scope.values[declaration.proc.name?.name as string] = unknownFallback(declaration.proc.type, declaration.proc);
                } else if (declaration.kind === "const-declaration") {
                    scope.values[declaration.name?.name as string] = unknownFallback(declaration.type, declaration.value);
                } else if (declaration.kind === "import-declaration") {
                    // TODO
                }
            }
            break;
        case "func":
            for (let i = 0; i < ast.argNames.length; i++) {
                scope.values[ast.argNames[i].name] = ast.type.argTypes[i];
            }
            break;
        case "proc":
            for (let i = 0; i < ast.argNames.length; i++) {
                scope.values[ast.argNames[i].name] = ast.type.argTypes[i];
            }
            break;
        case "block":
            for (const statement of ast.statements) {
                if (statement.kind === "let-declaration") {
                    scope.values[statement.name.name] = unknownFallback(statement.type ?? UNKNOWN_TYPE, statement.value);
                }
            }
            break;
        case "for-loop":
            scope.values[ast.itemIdentifier.name] = NUMBER_TYPE; // TODO: ast.iterator;
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

function unknownFallback(type: TypeExpression, fallback: Expression): TypeExpression|Expression {
    if (type.kind === "unknown-type") {
        return fallback;
    } else {
        return type;
    }
}