import { AST, Module } from "../_model/ast.ts";
import { AllParents, anyGet, Block, createEmptyScope, MutableScope, ParentsMap, Scope, ScopesMap, TieredMap } from "../_model/common.ts";
import { StoreDeclaration, ConstDeclaration } from "../_model/declarations.ts";
import { Func, Proc, Invocation, InlineConst, Case } from "../_model/expressions.ts";
import { ConstDeclarationStatement, ForLoop, LetDeclaration } from "../_model/statements.ts";
import { ANY_TYPE, BOOLEAN_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { given, iterateParseTree } from "../utils.ts";
import { alreadyDeclared, BagelError } from "../errors.ts";


export function scopescan(reportError: (error: BagelError) => void, parents: AllParents, ast: AST): ScopesMap {
    const scopesMap = new Map<symbol, MutableScope>()

    for (const { parent, current } of iterateParseTree(ast)) {
        
        // If ast is of a type that defines its own scope, define that and 
        // mark it as this ast's scope
        if (isScopeOwner(current)) {
            let newScope = scopesMap.get(current.id)
                ?? scopeFrom(reportError, parents, current, given(parent, p => scopesMap.get(p.id)))

            switch (current.kind) {
                case "module":
                    for (const declaration of current.declarations) {
                        // each const should establish a new scope to ensure their 
                        // order of evaluation works out
                        if (declaration.kind === "const-declaration") {
                            scopesMap.set(declaration.id, newScope)
                            newScope = scopeFrom(reportError, parents, declaration, newScope)
                        }
                    }
                    break;
                case "func":
                    // add inline constants to scope
                    if (current.kind === "func") {
                        for (const c of current.consts) {
                            if (newScope.values.get(c.name.name) != null) {
                                reportError(alreadyDeclared(c.name))
                            }
                            
                            scopesMap.set(c.value.id, newScope)
                            newScope = scopeFrom(reportError, parents, c, newScope)
                        }
                    }
                    break;
                case "block":
                    for (const statement of current.statements) {
                        if (statement.kind === "let-declaration" || statement.kind === "const-declaration-statement") {
                            if (newScope.values.get(statement.name.name) != null) {
                                reportError(alreadyDeclared(statement.name))
                            }

                            scopesMap.set(statement.id, newScope)
                            newScope = scopeFrom(reportError, parents, statement, newScope)
                        }
                    }
                    break;
            }
            
            scopesMap.set(current.id, newScope);
        } else if (!scopesMap.has(current.id) && parent != null) {
            const parentScope = scopesMap.get(parent.id)

            if (parentScope != null) {
                scopesMap.set(current.id, parentScope);
            }
        }
    }

    return scopesMap
}

export function getParentsMap(ast: AST): ParentsMap {
    const parents = new Map<symbol, AST>()

    for (const { parent, current } of iterateParseTree(ast)) {
        if (parent != null) {
            parents.set(current.id, parent)
        }
    }

    return parents
}

export type ScopeOwner = Module|Func|Proc|Block|ForLoop|StoreDeclaration|Invocation|ConstDeclaration|InlineConst|LetDeclaration|ConstDeclarationStatement|Case;

function isScopeOwner(ast: AST): ast is ScopeOwner {
    return ast.kind === "module" 
        || ast.kind === "func" 
        || ast.kind === "proc" 
        || ast.kind === "block" 
        || ast.kind === "for-loop" 
        || ast.kind === "store-declaration" 
        || ast.kind === "invocation"
        || ast.kind === "const-declaration"
        || ast.kind === "inline-const"
        || ast.kind === "let-declaration"
        || ast.kind === "const-declaration-statement"
        || ast.kind === "case"
}

export function scopeFrom(reportError: (error: BagelError) => void,parents: AllParents, ast: ScopeOwner, parentScope?: Scope): MutableScope {
    const newScope = parentScope != null 
        ? extendScope(parentScope)
        : createEmptyScope()

    switch (ast.kind) {
        case "module":
            // add all declarations to scope
            for (const declaration of ast.declarations) {
                if (declaration.kind === "type-declaration") {
                    newScope.types.set(declaration.name.name, {
                        type: declaration.type,
                        isGenericParameter: false,
                    })
                } else if (declaration.kind === "func-declaration" || declaration.kind === "proc-declaration" || declaration.kind === "store-declaration") {
                    if (newScope.values.get(declaration.name.name) != null) {
                        reportError(alreadyDeclared(declaration.name))
                    }

                    newScope.values.set(declaration.name.name, {
                        kind: "basic",
                        ast: declaration
                    });
                } else if (declaration.kind === "import-declaration") {
                    for (const importItem of declaration.imports) {
                        const name = importItem.alias ?? importItem.name;

                        if (newScope.values.get(name.name) != null) {
                            reportError(alreadyDeclared(name))
                        }
                        
                        newScope.imports.set(name.name, {
                            importItem,
                            importDeclaration: declaration
                        });
                    }
                }
            }
            break;
        case "func":
        case "proc": {
            
            // add any generic type parameters to scope
            for (const typeParam of ast.type.typeParams) {
                // TODO: Use `extends` to give these more meaningful types in context
                newScope.types.set(typeParam.name, {
                    type: UNKNOWN_TYPE,
                    isGenericParameter: true
                })
            }

            // add func/proc arguments to scope
            for (let i = 0; i < ast.type.args.length; i++) {
                const arg = ast.type.args[i]

                if (newScope.values.get(arg.name.name) != null) {
                    reportError(alreadyDeclared(arg.name))
                }

                newScope.values.set(arg.name.name, {
                    kind: "arg",
                    holder: ast,
                    argIndex: i
                })
            }
        } break;
        case "block":
            break;
        case "for-loop": {
            if (newScope.values.get(ast.itemIdentifier.name) != null) {
                reportError(alreadyDeclared(ast.itemIdentifier))
            }

            // add loop element to scope
            newScope.values.set(ast.itemIdentifier.name, {
                kind: "iterator",
                iterator: ast.iterator,
            })
            break;
        }
        case "store-declaration":
            newScope.values.set("this", {
                kind: "this",
                store: ast
            })
            break;
        case "invocation":
            break;
        case "const-declaration":
        case "inline-const":
        case "let-declaration":
        case "const-declaration-statement":
            newScope.values.set(ast.name.name, {
                kind: "basic",
                ast
            });
            break;
        case "case": {

            // Type refinement
            const parent = anyGet(parents, ast.id)
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
        typeofStr === "array" ? { kind: "array-type", element: ANY_TYPE, mutability: "readonly", id: Symbol(), code: undefined, startIndex: undefined, endIndex: undefined } :
        typeofStr === "object" ? { kind: "indexer-type", keyType: ANY_TYPE, valueType: ANY_TYPE, mutability: "readonly", id: Symbol(), code: undefined, startIndex: undefined, endIndex: undefined } :
        // TODO
        // type.value === "set" ?
        // type.value === "class-instance" ?
        undefined
    )
}

export function extendScope(scope: Scope): MutableScope {
    return {
        types: new TieredMap(scope.types),
        values: new TieredMap(scope.values),
        imports: new TieredMap(scope.imports),
        refinements: [...scope.refinements],
    }
}
