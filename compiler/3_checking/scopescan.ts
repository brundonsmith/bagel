import { path } from "../deps.ts";

import { Module } from "../_model/ast.ts";
import { Block } from "../_model/common.ts";
import { Declaration } from "../_model/declarations.ts";
import { Func, Proc, Expression, StringLiteral } from "../_model/expressions.ts";
import { ForLoop } from "../_model/statements.ts";
import { TypeExpression, UNKNOWN_TYPE, NUMBER_TYPE } from "../_model/type-expressions.ts";
import { walkParseTree } from "../utils.ts";
import { ModulesStore, Scope } from "./modules-store.ts";
import { BagelTypeError, cannotFindExport, cannotFindModule } from "./typecheck.ts";


export function scopescan(reportError: (error: BagelTypeError) => void, modulesStore: ModulesStore, ast: Module, module: string) {

    walkParseTree<Scope|undefined>(undefined, ast, (payload, ast) => {
        
        // If ast is of a type that defines its own scope, define that and 
        // mark it as this ast's scope
        switch(ast.kind) {
            case "module":
            case "func":
            case "proc":
            case "block":
            case "for-loop": {
                const scope = scopeFrom(reportError, modulesStore, ast, module, payload);
                modulesStore.scopeFor.set(ast, scope);
                return scope;
            }
        }

        // Otherwise, mark the containing scope as this ast's scope
        modulesStore.scopeFor.set(ast, payload as Scope);
        return payload;
    });
}

export type ScopeOwner = Module|Func|Proc|Block|ForLoop;

export function scopeFrom(reportError: (error: BagelTypeError) => void, modulesStore: ModulesStore, ast: ScopeOwner, module: string, parentScope?: Scope): Scope {
    const scope: Scope = parentScope != null ? extendScope(parentScope) : { types: {}, values: {}, classes: {} };

    // TODO: Err on duplicate identifiers
    
    switch (ast.kind) {
        case "module":
            // add all declarations to scope
            for (const declaration of ast.declarations) {
                if (declaration.kind === "type-declaration") {
                    scope.types[declaration.name.name] = declaration.type;
                } else if (declaration.kind === "func-declaration") {
                    scope.values[declaration.name.name] = {
                        mutability: "none",
                        declaredType: declaration.func.type,
                        initialValue: declaration.func
                    };
                } else if (declaration.kind === "proc-declaration") {
                    scope.values[declaration.name.name] = {
                        mutability: "none",
                        declaredType: declaration.proc.type,
                        initialValue: declaration.proc
                    };
                } else if (declaration.kind === "const-declaration") {
                    scope.values[declaration.name.name] = {
                        mutability: "none",
                        declaredType: declaration.type,
                        initialValue: declaration.value
                    };
                } else if (declaration.kind === "class-declaration") {
                    scope.classes[declaration.name.name] = declaration;
                } else if (declaration.kind === "import-declaration") {
                    const otherModule = modulesStore.modules.get(canonicalModuleName(module, declaration.path));
                    
                    if (otherModule == null) {
                        reportError(cannotFindModule(declaration));

                    for (const i of declaration.imports) {
                            const name = i.alias?.name ?? i.name.name;

                            scope.values[name] = {
                                mutability: "none",
                                declaredType: UNKNOWN_TYPE,
                            };
                        }
                    } else {
                        for (const i of declaration.imports) {
                            const foreignDecl = otherModule.declarations.find(foreignDeclCandidate => 
                                declExported(foreignDeclCandidate) && declName(foreignDeclCandidate) === i.name.name);

                            const name = i.alias?.name ?? i.name.name;

                            if (foreignDecl == null) {
                                reportError(cannotFindExport(i, declaration));

                                scope.values[name] = {
                                    mutability: "none",
                                    declaredType: UNKNOWN_TYPE,
                                };
                            } else {
                                scope.values[name] = {
                                    mutability: "none",
                                    declaredType: declType(foreignDecl) as TypeExpression,
                                    initialValue: declValue(foreignDecl),
                                };
                            }
                        }
                    }
                }
            }
            break;
        case "func":
        case "proc":
            
            // add any generic type parameters to scope
            for (const typeParam of ast.type.typeParams) {
                // TODO: Use `extends` to give these more meaningful types in context
                scope.types[typeParam.name] = UNKNOWN_TYPE
            }

            // add func/proc argument to scope
            if (ast.type.arg) {
                scope.values[ast.type.arg.name.name] = {
                    mutability: ast.kind === "func" ? "none" : "properties-only",
                    declaredType: ast.type.arg.type,
                }
            }
            break;
        case "block":
            // add let-declarations to scope
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
            // add loop element to scope
            scope.values[ast.itemIdentifier.name] = {
                mutability: "properties-only",
                declaredType: NUMBER_TYPE, // TODO: ast.iterator;
            }
            break;
    }

    return scope;
}

function declExported(declaration: Declaration): boolean|undefined {
    if (declaration.kind === "type-declaration" || declaration.kind === "func-declaration" ||
        declaration.kind === "proc-declaration" || declaration.kind === "const-declaration") {
        return declaration.exported;
    }
}

function declName(declaration: Declaration): string|undefined {
    if (declaration.kind === "type-declaration" || declaration.kind === "func-declaration" ||
        declaration.kind === "proc-declaration" || declaration.kind === "const-declaration") {
        return declaration.name.name;
    }
}

function declType(declaration: Declaration): TypeExpression|undefined {
    if (declaration.kind === "func-declaration") {
        return declaration.func.type;
    } else if (declaration.kind === "proc-declaration") {
        return declaration.proc.type;
    } else if (declaration.kind === "const-declaration") {
        return declaration.type;
    }
}

function declValue(declaration: Declaration): Expression|undefined {
    if (declaration.kind === "func-declaration") {
        return declaration.func;
    } else if (declaration.kind === "proc-declaration") {
        return declaration.proc;
    } else if (declaration.kind === "const-declaration") {
        return declaration.value;
    }
}

export function extendScope(scope: Scope): Scope {
    return {
        types: Object.create(scope.types),
        values: Object.create(scope.values),
        classes: scope.classes, // classes can't be created in lower scopes, so we don't need to worry about hierarchy
    }
}

export function canonicalModuleName(importerModule: string, importPath: StringLiteral) {
    const moduleDir = path.dirname(importerModule);
    return path.resolve(moduleDir, importPath.segments.join("")) + ".bgl"
}
