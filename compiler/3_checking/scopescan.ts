import { path } from "../deps.ts";

import { AST, Module } from "../_model/ast.ts";
import { Block, getScopeFor, Scope } from "../_model/common.ts";
import { ClassDeclaration, Declaration } from "../_model/declarations.ts";
import { Func, Proc, Expression, StringLiteral, Invocation } from "../_model/expressions.ts";
import { ForLoop } from "../_model/statements.ts";
import { TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { walkParseTree } from "../utils.ts";
import { ModulesStore } from "./modules-store.ts";
import { alreadyDeclared, BagelError, cannotFindExport, cannotFindModule, miscError } from "../errors.ts";
import { inferType } from "./typeinfer.ts";


export function scopescan(reportError: (error: BagelError) => void, modulesStore: ModulesStore, ast: Module, module: string) {

    walkParseTree<AST|undefined>(undefined, ast, (payload, ast) => {
        if (payload != null) {
            modulesStore.parentAst.set(ast, payload)
        }
        return ast
    });

    walkParseTree<Scope|undefined>(undefined, ast, (payload, ast) => {
        
        // If ast is of a type that defines its own scope, define that and 
        // mark it as this ast's scope
        if (isScopeOwner(ast)) {
            ast.scope = scopeFrom(reportError, modulesStore.modules, ast, module, payload);
            return ast.scope;
        } else {
            return payload;
        }
    });

    walkParseTree<void>(undefined, ast, (_, ast) => {

        // infer
        const scope = getScopeFor(modulesStore, ast)
        switch(ast.kind) {
            case "for-loop": {

                // add loop element to scope
                const iteratorType = inferType(reportError, modulesStore, ast.iterator)
                scope.values[ast.itemIdentifier.name] = {
                    mutability: "properties-only",
                    declaredType: iteratorType.kind === "iterator-type" ? iteratorType.itemType : undefined,
                }
            } break;
            case "invocation": {
    
                // bind type-args for this invocation
                const subjectType = inferType(reportError, modulesStore, ast.subject);
                if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {
                    if (subjectType.typeParams.length > 0) {
                        if (subjectType.typeParams.length !== ast.typeArgs?.length) {
                            reportError(miscError(ast, `Expected ${subjectType.typeParams.length} type arguments, but got ${ast.typeArgs?.length ?? 0}`))
                        }
    
                        for (let i = 0; i < subjectType.typeParams.length; i++) {
                            const typeParam = subjectType.typeParams[i]
                            const typeArg = ast.typeArgs?.[i] ?? UNKNOWN_TYPE
    
                            scope.types[typeParam.name] = {
                                type: typeArg,
                                isGenericParameter: false,
                            }
                        }
                    }
                }
            } break;
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

export function scopeFrom(reportError: (error: BagelError) => void, modules: Map<string, Module>, ast: ScopeOwner, module: string, parentScope?: Scope): Scope {
    let newScope: Scope = parentScope != null 
        ? extendScope(parentScope) 
        : { types: {}, values: {}, classes: {} };

    switch (ast.kind) {
        case "module":
            // add all declarations to scope
            for (const declaration of ast.declarations) {
                if (declaration.kind === "type-declaration") {
                    newScope.types[declaration.name.name] = {
                        type: declaration.type,
                        isGenericParameter: false,
                    }
                } else if (declaration.kind === "func-declaration" || declaration.kind === "proc-declaration" || declaration.kind === "const-declaration") {
                    if (newScope.values[declaration.name.name] != null || newScope.classes[declaration.name.name] != null) {
                        reportError(alreadyDeclared(declaration.name))
                    }

                    // each const should establish a new scope to ensure their 
                    // order of evaluation works out
                    if (declaration.kind === "const-declaration") {
                        declaration.scope = newScope

                        newScope = extendScope(newScope)
                    }

                    newScope.values[declaration.name.name] = {
                        mutability: "none",
                        declaredType: declaration.kind === "const-declaration" ? declaration.type : undefined,
                        initialValue: declaration.value
                    };
                } else if (declaration.kind === "class-declaration") {
                    if (newScope.values[declaration.name.name] != null || newScope.classes[declaration.name.name] != null) {
                        reportError(alreadyDeclared(declaration.name))
                    }
                    
                    newScope.classes[declaration.name.name] = declaration;
                } else if (declaration.kind === "import-declaration") {
                    const otherModule = modules.get(canonicalModuleName(module, declaration.path));
                    
                    if (otherModule == null) {
                        reportError(cannotFindModule(declaration));

                        for (const i of declaration.imports) {
                            const name = i.alias?.name ?? i.name.name;

                            newScope.values[name] = {
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

                                if (newScope.values[name.name] != null || newScope.classes[name.name] != null) {
                                    reportError(alreadyDeclared(name))
                                }

                                newScope.values[name.name] = {
                                    mutability: "none",
                                    declaredType: UNKNOWN_TYPE,
                                };
                            } else {
                                if (newScope.values[name.name] != null || newScope.classes[name.name] != null) {
                                    reportError(alreadyDeclared(name))
                                }

                                newScope.values[name.name] = {
                                    mutability: "none",
                                    declaredType: declType(foreignDecl) as TypeExpression,
                                    initialValue: declValue(foreignDecl),
                                };
                            }
                        }
                    }
                }
            }
            
            return newScope;
        case "func":
        case "proc":
            
            // add any generic type parameters to scope
            for (const typeParam of ast.type.typeParams) {
                // TODO: Use `extends` to give these more meaningful types in context
                newScope.types[typeParam.name] = {
                    type: UNKNOWN_TYPE,
                    isGenericParameter: true
                }
            }

            // add func/proc argument to scope
            for (const arg of ast.type.args) {
                if (newScope.values[arg.name.name] != null || newScope.classes[arg.name.name] != null) {
                    reportError(alreadyDeclared(arg.name))
                }

                newScope.values[arg.name.name] = {
                    mutability: ast.kind === "func" ? "none" : "properties-only",
                    declaredType: arg.type,
                }
            }

            // add inline constants to scope
            if (ast.kind === "func") {
                // console.log(ast.consts)
                for (const c of ast.consts) {
                    if (newScope.values[c.name.name] != null || newScope.classes[c.name.name] != null) {
                        reportError(alreadyDeclared(c.name))
                    }

                    c.value.scope = newScope

                    newScope = extendScope(newScope)
                    newScope.values[c.name.name] = {
                        mutability: "none",
                        declaredType: c.type,
                        initialValue: c.value
                    }
                }
                // console.log('scope:')
                // console.log(ast.consts[0].value.scope?.values)
                // console.log(Object.getPrototypeOf(ast.consts[0].value.scope?.values))
                
            }

            return newScope;
        case "block":
            for (const statement of ast.statements) {
                if (statement.kind === "let-declaration") {
                    if (newScope.values[statement.name.name] != null || newScope.classes[statement.name.name] != null) {
                        reportError(alreadyDeclared(statement.name))
                    }

                    statement.scope = newScope

                    newScope = extendScope(newScope)
                    newScope.values[statement.name.name] = {
                        mutability: "all",
                        declaredType: statement.type,
                        initialValue: statement.value
                    };
                }
            }
            
            return newScope;
        case "for-loop": {
            if (newScope.values[ast.itemIdentifier.name] != null || newScope.classes[ast.itemIdentifier.name] != null) {
                reportError(alreadyDeclared(ast.itemIdentifier))
            }

            return newScope;
        }
        case "class-declaration":
            newScope.values["this"] = {
                mutability: "properties-only",
                declaredType: {
                    kind: "class-type",
                    clazz: ast,
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined
                },
            }
            
            return newScope;
        case "invocation":
            return newScope;
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
