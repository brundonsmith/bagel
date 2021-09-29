import { path } from "../deps.ts";

import { AST, Module } from "../_model/ast.ts";
import { Block } from "../_model/common.ts";
import { ClassDeclaration, Declaration } from "../_model/declarations.ts";
import { Func, Proc, Expression, StringLiteral, Invocation } from "../_model/expressions.ts";
import { ForLoop } from "../_model/statements.ts";
import { TypeExpression, UNKNOWN_TYPE, NUMBER_TYPE } from "../_model/type-expressions.ts";
import { walkParseTree } from "../utils.ts";
import { ModulesStore, Scope } from "./modules-store.ts";
import { alreadyDeclared, BagelTypeError, cannotFindExport, cannotFindModule } from "./typecheck.ts";


export function scopescan(reportError: (error: BagelTypeError) => void, modulesStore: ModulesStore, ast: Module, module: string) {

    walkParseTree<Scope|undefined>(undefined, ast, (payload, ast) => {
        
        // If ast is of a type that defines its own scope, define that and 
        // mark it as this ast's scope
        if (isScopeOwner(ast)) {
            const scope = scopeFrom(reportError, modulesStore, ast, module, payload);
            modulesStore.scopeFor.set(ast, scope);
            return scope;
        } else {
            // Otherwise, mark the containing scope as this ast's scope
            modulesStore.scopeFor.set(ast, payload as Scope);
            return payload;
        }
    });
}

export type ScopeOwner = Module|Func|Proc|Block|ForLoop|ClassDeclaration|Invocation;

function isScopeOwner(ast: AST): ast is ScopeOwner {
    return ast.kind === "module" 
        || ast.kind === "func" 
        || ast.kind === "proc" 
        || ast.kind === "block" 
        || ast.kind === "for-loop" 
        || ast.kind === "class-declaration" 
        || ast.kind === "invocation"
}

export function scopeFrom(reportError: (error: BagelTypeError) => void, modulesStore: ModulesStore, ast: ScopeOwner, module: string, parentScope?: Scope): Scope {
    const scope: Scope = parentScope != null ? extendScope(parentScope) : { types: {}, values: {}, classes: {} };

    switch (ast.kind) {
        case "module":
            // add all declarations to scope
            for (const declaration of ast.declarations) {
                if (declaration.kind === "type-declaration") {
                    scope.types[declaration.name.name] = declaration.type;
                } else if (declaration.kind === "func-declaration" || declaration.kind === "proc-declaration" || declaration.kind === "const-declaration") {
                    if (scope.values[declaration.name.name] != null || scope.classes[declaration.name.name] != null) {
                        reportError(alreadyDeclared(declaration.name))
                    }
                    
                    scope.values[declaration.name.name] = {
                        mutability: "none",
                        declaredType: declaration.kind === "const-declaration" ? declaration.type : declaration.value.type,
                        initialValue: declaration.value
                    };
                } else if (declaration.kind === "class-declaration") {
                    if (scope.values[declaration.name.name] != null || scope.classes[declaration.name.name] != null) {
                        reportError(alreadyDeclared(declaration.name))
                    }
                    
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

                            const name = i.alias ?? i.name;

                            if (foreignDecl == null) {
                                reportError(cannotFindExport(i, declaration));

                                if (scope.values[name.name] != null || scope.classes[name.name] != null) {
                                    reportError(alreadyDeclared(name))
                                }

                                scope.values[name.name] = {
                                    mutability: "none",
                                    declaredType: UNKNOWN_TYPE,
                                };
                            } else {
                                if (scope.values[name.name] != null || scope.classes[name.name] != null) {
                                    reportError(alreadyDeclared(name))
                                }

                                scope.values[name.name] = {
                                    mutability: "none",
                                    declaredType: declType(foreignDecl) as TypeExpression,
                                    initialValue: declValue(foreignDecl),
                                };
                            }
                        }
                    }
                }
            }
            
            return scope;
        case "func":
        case "proc":
            
            // add any generic type parameters to scope
            for (const typeParam of ast.type.typeParams) {
                // TODO: Use `extends` to give these more meaningful types in context
                scope.types[typeParam.name] = UNKNOWN_TYPE
            }

            // add func/proc argument to scope
            for (const arg of ast.type.args) {
                if (scope.values[arg.name.name] != null || scope.classes[arg.name.name] != null) {
                    reportError(alreadyDeclared(arg.name))
                }

                scope.values[arg.name.name] = {
                    mutability: ast.kind === "func" ? "none" : "properties-only",
                    declaredType: arg.type,
                }
            }

            if (ast.kind === "func") {
                for (const c of ast.consts) {
                    if (scope.values[c.name.name] != null || scope.classes[c.name.name] != null) {
                        reportError(alreadyDeclared(c.name))
                    }

                    scope.values[c.name.name] = {
                        mutability: "none",
                        declaredType: c.type,
                        initialValue: c.value
                    }
                }
            }
            
            return scope;
        case "block":
            // add let-declarations to scope
            for (const statement of ast.statements) {
                if (statement.kind === "let-declaration") {
                    if (scope.values[statement.name.name] != null || scope.classes[statement.name.name] != null) {
                        reportError(alreadyDeclared(statement.name))
                    }

                    scope.values[statement.name.name] = {
                        mutability: "all",
                        declaredType: statement.type ?? UNKNOWN_TYPE, 
                        initialValue: statement.value
                    };
                }
            }
            
            return scope;
        case "for-loop":
            if (scope.values[ast.itemIdentifier.name] != null || scope.classes[ast.itemIdentifier.name] != null) {
                reportError(alreadyDeclared(ast.itemIdentifier))
            }

            // add loop element to scope
            scope.values[ast.itemIdentifier.name] = {
                mutability: "properties-only",
                declaredType: NUMBER_TYPE, // TODO: ast.iterator;
            }
            
            return scope;
        case "class-declaration":
            scope.values["this"] = {
                mutability: "properties-only",
                declaredType: {
                    kind: "class-type",
                    clazz: ast,
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined
                },
            }
            
            return scope;
        case "invocation": {
            // TODO

            return scope;
        }
    }
}

function declExported(declaration: Declaration): boolean|undefined {
    if (declaration.kind !== "import-declaration" && declaration.kind !== "javascript-escape") {
        return declaration.exported;
    }
}

function declName(declaration: Declaration): string|undefined {
    if (declaration.kind !== "import-declaration" && declaration.kind !== "javascript-escape") {
        return declaration.name.name;
    }
}

function declType(declaration: Declaration): TypeExpression|undefined {
    if (declaration.kind === "func-declaration" || declaration.kind === "proc-declaration") {
        return declaration.value.type;
    } else if (declaration.kind === "const-declaration") {
        return declaration.type;
    } else if (declaration.kind === "class-declaration") {
        return {
            kind: "class-type",
            clazz: declaration,
            code: declaration.code,
            startIndex: declaration.startIndex,
            endIndex: declaration.endIndex
        }
    }
}

function declValue(declaration: Declaration): Expression|undefined {
    if (declaration.kind === "func-declaration" || declaration.kind === "proc-declaration" || declaration.kind === "const-declaration") {
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
