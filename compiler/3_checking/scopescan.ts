import { path } from "../deps.ts";

import { AST, Module } from "../_model/ast.ts";
import { Block, getScopeFor, MutableScope, ParentsMap, Scope, ScopesMap } from "../_model/common.ts";
import { ClassDeclaration, ConstDeclaration, Declaration } from "../_model/declarations.ts";
import { Func, Proc, Expression, Invocation, InlineConst, Case } from "../_model/expressions.ts";
import { ForLoop, LetDeclaration } from "../_model/statements.ts";
import { ANY_TYPE, BOOLEAN_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { walkParseTree } from "../utils.ts";
import { alreadyDeclared, BagelError, cannotFindExport, cannotFindModule, miscError } from "../errors.ts";
import { inferType } from "./typeinfer.ts";


export function scopescan(reportError: (error: BagelError) => void, parents: ParentsMap, getModule: (module: string) => Module|undefined, ast: AST): ScopesMap {
    const scopesMap = new WeakMap<AST, MutableScope>()
    
    walkParseTree<MutableScope|undefined>(undefined, ast, (payload, ast) => {

        // If ast is of a type that defines its own scope, define that and 
        // mark it as this ast's scope
        if (isScopeOwner(ast)) {
            let newScope = scopesMap.get(ast) 
                ?? scopeFrom(reportError, getModule, parents, scopesMap, ast, payload)

            switch (ast.kind) {
                case "module":
                    for (const declaration of ast.declarations) {
                        // each const should establish a new scope to ensure their 
                        // order of evaluation works out
                        if (declaration.kind === "const-declaration") {
                            scopesMap.set(declaration, newScope)
                            newScope = scopeFrom(reportError, getModule, parents, scopesMap, declaration, newScope)
                        }
                    }
                    break;
                case "func":
                    // add inline constants to scope
                    if (ast.kind === "func") {
                        for (const c of ast.consts) {
                            if (newScope.values[c.name.name] != null || newScope.classes[c.name.name] != null) {
                                reportError(alreadyDeclared(c.name))
                            }
                            
                            scopesMap.set(c.value, newScope)
                            newScope = scopeFrom(reportError, getModule, parents, scopesMap, c, newScope)
                        }
                    }
                    break;
                case "block":
                    for (const statement of ast.statements) {
                        if (statement.kind === "let-declaration") {
                            if (newScope.values[statement.name.name] != null || newScope.classes[statement.name.name] != null) {
                                reportError(alreadyDeclared(statement.name))
                            }

                            scopesMap.set(statement, newScope)
                            newScope = scopeFrom(reportError, getModule, parents, scopesMap, statement, newScope)
                        }
                    }
                    break;
            }
            
            scopesMap.set(ast, newScope);
            return newScope;
        } else {
            return scopesMap.get(ast) ?? payload;
        }
    });

    walkParseTree<void>(undefined, ast, (_, ast) => {

        // infer
        const scope = getScopeFor(parents, scopesMap, ast) as MutableScope
        switch(ast.kind) {
            case "for-loop": {

                // add loop element to scope
                const iteratorType = inferType(reportError, parents, scopesMap, ast.iterator)
                scope.values[ast.itemIdentifier.name] = {
                    mutability: "contents-only",
                    declaredType: iteratorType.kind === "iterator-type" ? iteratorType.itemType : undefined,
                }
            } break;
            case "invocation": {
    
                // bind type-args for this invocation
                const subjectType = inferType(reportError, parents, scopesMap, ast.subject);
                if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {
                    if (subjectType.typeParams.length > 0) {
                        if (subjectType.typeParams.length !== ast.typeArgs.length) {
                            reportError(miscError(ast, `Expected ${subjectType.typeParams.length} type arguments, but got ${ast.typeArgs.length}`))
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

    return scopesMap
}

export function getParentsMap(ast: AST): ParentsMap {
    const parents = new WeakMap<AST, AST>()

    walkParseTree<AST|undefined>(undefined, ast, (payload, ast) => {
        if (payload != null) {
            parents.set(ast, payload)
        }
        return ast
    });

    return parents
}

export type ScopeOwner = Module|Func|Proc|Block|ForLoop|ClassDeclaration|Invocation|ConstDeclaration|InlineConst|LetDeclaration|Case;

function isScopeOwner(ast: AST): ast is ScopeOwner {
    return ast.kind === "module" 
        || ast.kind === "func" 
        || ast.kind === "proc" 
        || ast.kind === "block" 
        || ast.kind === "for-loop" 
        || ast.kind === "class-declaration" 
        || ast.kind === "invocation"
        || ast.kind === "const-declaration"
        || ast.kind === "inline-const"
        || ast.kind === "let-declaration"
        || ast.kind === "case"
}

export function scopeFrom(reportError: (error: BagelError) => void, getModule: (module: string) => Module|undefined, parents: ParentsMap, scopes: ScopesMap, ast: ScopeOwner, parentScope?: Scope): MutableScope {
    const newScope = parentScope != null 
        ? extendScope(parentScope) as MutableScope
        : { types: {}, values: {}, classes: {}, refinements: [] };

    switch (ast.kind) {
        case "module":
            // add all declarations to scope
            for (const declaration of ast.declarations) {
                if (declaration.kind === "type-declaration") {
                    newScope.types[declaration.name.name] = {
                        type: declaration.type,
                        isGenericParameter: false,
                    }
                } else if (declaration.kind === "func-declaration" || declaration.kind === "proc-declaration") {
                    if (newScope.values[declaration.name.name] != null || newScope.classes[declaration.name.name] != null) {
                        reportError(alreadyDeclared(declaration.name))
                    }

                    newScope.values[declaration.name.name] = {
                        mutability: "none",
                        declaredType: undefined, // fall back to the function proc's inner type, to allow for return-type inference
                        initialValue: declaration.value
                    };
                } else if (declaration.kind === "class-declaration") {
                    if (newScope.values[declaration.name.name] != null || newScope.classes[declaration.name.name] != null) {
                        reportError(alreadyDeclared(declaration.name))
                    }
                    
                    newScope.classes[declaration.name.name] = declaration;
                } else if (declaration.kind === "import-declaration") {
                    const otherModule = getModule(declaration.path.value);
                    
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
            break;
        case "func":
        case "proc": {
            
            // add any generic type parameters to scope
            for (const typeParam of ast.type.typeParams) {
                // TODO: Use `extends` to give these more meaningful types in context
                newScope.types[typeParam.name] = {
                    type: UNKNOWN_TYPE,
                    isGenericParameter: true
                }
            }

            // infer callback argument types based on context
            const thisArgParentType = (() => {
                const parent = parents.get(ast)
                if (parent?.kind === "invocation") {
                    const parentSubjectType = inferType(reportError, parents, scopes, parent.subject)
                    const thisArgIndex = parent.args.findIndex(a => a === ast)

                    if (parentSubjectType.kind === "func-type" || parentSubjectType.kind === "proc-type") {
                        const thisArgParentType = parentSubjectType.args[thisArgIndex]?.type

                        if (thisArgParentType && thisArgParentType.kind === ast.type.kind) {
                            return thisArgParentType;
                        }
                    }
                }
            })()

            // add func/proc arguments to scope
            for (let i = 0; i < ast.type.args.length; i++) {
                const arg = ast.type.args[i]

                if (newScope.values[arg.name.name] != null || newScope.classes[arg.name.name] != null) {
                    reportError(alreadyDeclared(arg.name))
                }

                newScope.values[arg.name.name] = {
                    mutability: ast.kind === "func" ? "none" : "contents-only",
                    declaredType: arg.type ?? thisArgParentType?.args[i].type,
                }
            }
        } break;
        case "block":
            break;
        case "for-loop": {
            if (newScope.values[ast.itemIdentifier.name] != null || newScope.classes[ast.itemIdentifier.name] != null) {
                reportError(alreadyDeclared(ast.itemIdentifier))
            }
            break;
        }
        case "class-declaration":
            newScope.values["this"] = {
                mutability: "contents-only",
                declaredType: {
                    kind: "class-instance-type",
                    clazz: ast,
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined
                },
            }
            break;
        case "invocation":
            break;
        case "const-declaration":
        case "inline-const":
        case "let-declaration":
            newScope.values[ast.name.name] = {
                mutability: ast.kind === "let-declaration" ? "all" : "none",
                declaredType: ast.type,
                initialValue: ast.value
            };
            break;
        case "case": {

            // Type refinement
            const parent = parents.get(ast)
            if (parent?.kind === "if-else-expression") {
                if (ast.condition.kind === "binary-operator" && ast.condition.ops[0][0].op === "!=") {
                    const targetExpression = 
                        ast.condition.ops[0][1].kind === 'nil-literal' ? ast.condition.base :
                        ast.condition.base.kind === "nil-literal" ? ast.condition.ops[0][1] :
                        undefined;

                    if (targetExpression != null) {
                        newScope.refinements.push({ kind: "subtraction", type: NIL_TYPE, targetExpression })
                    }
                }

                if (ast.condition.kind === "binary-operator" && ast.condition.ops[0][0].op === "==") {
                    const bits = (
                        ast.condition.base.kind === "invocation" && ast.condition.base.subject.kind === "local-identifier" && ast.condition.base.subject.name === "typeof" 
                        && ast.condition.ops[0][1].kind === "string-literal" && typeof ast.condition.ops[0][1].segments[0] === "string" ? [ast.condition.base.args[0], ast.condition.ops[0][1].segments[0]] as const :
                        ast.condition.base.kind === "string-literal" && typeof ast.condition.base.segments[0] === "string"
                        && ast.condition.ops[0][1].kind === "invocation" && ast.condition.ops[0][1].subject.kind === "local-identifier" && ast.condition.ops[0][1].subject.name === "typeof" ? [ast.condition.ops[0][1].args[0], ast.condition.base.segments[0]] as const :
                        undefined
                    )
                    
                    if (bits) {
                        const [targetExpression, typeofStr] = bits
    
                        const refinedType = typeFromTypeof(typeofStr)
                        
                        if (refinedType) {
                            newScope.refinements.push({ kind: "narrowing", type: refinedType, targetExpression })
                        }
                    }
                    
                }
            } else if (parent?.kind === "switch-expression") {
                if (parent.value.kind === "invocation" &&
                    parent.value.subject.kind === "local-identifier" &&
                    parent.value.subject.name === "typeof" &&
                    ast.condition.kind === "string-literal" &&
                    ast.condition.segments.length === 1 &&
                    typeof ast.condition.segments[0] === 'string') {
                    
                    const targetExpression = parent.value.args[0]
                    const typeofStr = ast.condition.segments[0]

                    const refinedType = typeFromTypeof(typeofStr)

                    if (refinedType) {
                        newScope.refinements.push({ kind: "narrowing", type: refinedType, targetExpression })
                    }
                }
            }
        } break;
    }

    return newScope
}

function typeFromTypeof(typeofStr: string): TypeExpression|undefined {
    return (
        typeofStr === "string" ? STRING_TYPE :
        typeofStr === "number" ? NUMBER_TYPE :
        typeofStr === "boolean" ? BOOLEAN_TYPE :
        typeofStr === "nil" ? NIL_TYPE :
        typeofStr === "array" ? { kind: "array-type", element: ANY_TYPE, code: undefined, startIndex: undefined, endIndex: undefined } :
        typeofStr === "object" ? { kind: "indexer-type", keyType: ANY_TYPE, valueType: ANY_TYPE, code: undefined, startIndex: undefined, endIndex: undefined } :
        // TODO
        // type.value === "set" ?
        // type.value === "class-instance" ?
        undefined
    )
}

function declExported(declaration: Declaration): boolean|undefined {
    if (declaration.kind !== "import-declaration" && 
        declaration.kind !== "javascript-escape" && 
        declaration.kind !== "debug" &&
        declaration.kind !== "test-expr-declaration" &&
        declaration.kind !== "test-block-declaration") {
        return declaration.exported;
    }
}

function declName(declaration: Declaration): string|undefined {
    if (declaration.kind !== "import-declaration" && 
        declaration.kind !== "javascript-escape" && 
        declaration.kind !== "debug" &&
        declaration.kind !== "test-expr-declaration" &&
        declaration.kind !== "test-block-declaration") {
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
            kind: "class-instance-type",
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

function extendScope(scope: Scope): Scope {
    return {
        types: Object.create(scope.types),
        values: Object.create(scope.values),
        classes: scope.classes, // classes can't be created in lower scopes, so we don't need to worry about hierarchy
        refinements: [...scope.refinements],
    }
}

export function pathIsRemote(path: string): boolean {
    return path.match(/^https?:\/\//) != null
}