import path from "path";
import { Module } from "../model/ast";
import { Block } from "../model/common";
import { Declaration } from "../model/declarations";
import { Func, Proc, Expression, StringLiteral } from "../model/expressions";
import { ForLoop } from "../model/statements";
import { TypeExpression, UNKNOWN_TYPE, NUMBER_TYPE } from "../model/type-expressions";
import { walkParseTree } from "../utils";
import { ModulesStore, Scope } from "./modules-store";
import { BagelTypeError, cannotFindExport, cannotFindModule } from "./typecheck";


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
    const scope: Scope = parentScope != null ? extendScope(parentScope) : { types: {}, values: {} };

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
            // add func/proc arguments to scope
            for (let i = 0; i < ast.argNames.length; i++) {
                scope.values[ast.argNames[i].name] = {
                    mutability: ast.kind === "func" ? "none" : "properties-only",
                    declaredType: ast.type.argTypes[i],
                };
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
    }
}

export function canonicalModuleName(importerModule: string, importPath: StringLiteral) {
    const moduleDir = path.dirname(importerModule);
    return path.resolve(moduleDir, importPath.segments.join("")) + ".bgl"
}
