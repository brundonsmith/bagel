import { given } from "../1_parse/common.ts";
import { alreadyDeclared, cannotFindExport, cannotFindModule, cannotFindName, miscError } from "../errors.ts";
import Store from "../store.ts";
import { areSame } from "../utils/ast.ts";
import { AST } from "../_model/ast.ts";
import { Binding, ModuleName, ReportError } from "../_model/common.ts";
import { ValueDeclaration,FuncDeclaration,ProcDeclaration,TypeDeclaration } from "../_model/declarations.ts";

/**
 * Given some identifier and some AST context, look upwards until a binding is
 * found for the identifier (or the root is reached)
 */
export function resolve(reportError: ReportError, name: string, from: AST, originator: AST): Binding|undefined {
    const parent = Store.getParent(from)

    // if we've reached the root of the AST, there's no binding
    if (parent == null) {
        reportError(cannotFindName(originator, name))
        return undefined;
    }

    let resolved: Binding|undefined;

    switch (parent.kind) {
        case "module": {
            for (let declarationIndex = 0; declarationIndex < parent.declarations.length; declarationIndex++) {
                const declaration = parent.declarations[declarationIndex]

                switch (declaration.kind) {
                    case "type-declaration": {
                        if (declaration.name.name === name) {
                            if (resolved) {
                                reportError(alreadyDeclared(declaration.name))
                            }
    
                            resolved = {
                                kind: 'type-binding',
                                type: declaration.type,
                            }
                        }
                    } break;
                    case "func-declaration":
                    case "proc-declaration":
                    case "value-declaration":
                    case "js-func-declaration":
                    case "js-proc-declaration": {
                        if (declaration.name.name === name) {
                            if (resolved) {
                                reportError(alreadyDeclared(declaration.name))
                            }
    
                            // detect value being referenced before it's available
                            if (declaration.kind === 'value-declaration') { 
                                const comingFromIndex = parent.declarations.findIndex(other => areSame(other, from))
    
                                if (comingFromIndex < declarationIndex) {
                                    reportError(miscError(originator, `Can't reference "${name}" before initialization`))
                                } else if (comingFromIndex === declarationIndex) {
                                    reportError(miscError(originator, `Can't reference "${name}" in its own initialization`))
                                }
                            }
    
                            resolved = {
                                kind: "basic",
                                ast: declaration
                            }
                        }
                    } break;
                    case "import-all-declaration": {
                        if (declaration.alias.name === name) {
                            if (resolved) {
                                reportError(alreadyDeclared(declaration.alias))
                            }

                            resolved = {
                                kind: "module",
                                imported: declaration
                            }
                        }
                    } break;
                    case "import-declaration": {
                        for (const importItem of declaration.imports) {
                            const nameAst = importItem.alias ?? importItem.name

                            // found the matching import
                            if (nameAst.name === name) {
                                if (resolved) {
                                    reportError(alreadyDeclared(nameAst))
                                }

                                const otherModule = Store.getModuleByName(declaration.module as ModuleName, declaration.path.value)

                                if (otherModule == null) {
                                    // other module doesn't exist
                                    reportError(cannotFindModule(declaration.path))
                                } else {
                                    const imported = otherModule.declarations.find(decl =>
                                        (decl.kind === 'value-declaration' || decl.kind === 'func-declaration' || decl.kind === 'proc-declaration' || decl.kind === 'type-declaration')
                                        && decl.name.name === importItem.name.name
                                        && decl.exported) as ValueDeclaration|FuncDeclaration|ProcDeclaration|TypeDeclaration|undefined

                                    if (imported == null) {
                                        reportError(cannotFindExport(importItem, declaration));
                                    } else {
                                        if (imported.kind === 'type-declaration') {
                                            resolved = {
                                                kind: 'type-binding',
                                                type: imported.type
                                            }
                                        } else {
                                            resolved = {
                                                kind: "basic",
                                                ast: imported
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } break;
                }
            }
        } break;
        case "generic-type": {
            for (const typeParam of parent.typeParams) {
                if (typeParam.name.name === name) {
                    if (resolved) {
                        reportError(alreadyDeclared(typeParam.name))
                    }
                    
                    resolved = {
                        kind: 'type-binding',
                        type: {
                            kind: "generic-param-type",
                            name: typeParam.name,
                            extends: typeParam.extends,
                            module: undefined,
                            code: undefined,
                            startIndex: undefined,
                            endIndex: undefined,
                            mutability: undefined,
                        }
                    }
                }
            }
        } break;
        case "func":
        case "proc": {
            
            // resolve generic type parameters
            if (parent.type.kind === 'generic-type') {
                for (const typeParam of parent.type.typeParams) {
                    if (typeParam.name.name === name) {
                        if (resolved) {
                            reportError(alreadyDeclared(typeParam.name))
                        }

                        resolved = {
                            kind: 'type-binding',
                            type: {
                                kind: "generic-param-type",
                                name: typeParam.name,
                                extends: typeParam.extends,
                                module: undefined,
                                code: undefined,
                                startIndex: undefined,
                                endIndex: undefined,
                                mutability: undefined,
                            }
                        }
                    }
                }
            }

            // resolve func or proc arguments
            const funcOrProcType = parent.type.kind === 'generic-type' ? parent.type.inner : parent.type
            for (let i = 0; i < funcOrProcType.args.length; i++) {
                const arg = funcOrProcType.args[i]

                if (arg.name.name === name) {
                    if (resolved) {
                        reportError(alreadyDeclared(arg.name))
                    }

                    resolved = {
                        kind: "arg",
                        holder: parent,
                        argIndex: i
                    }
                }
            }
        } break;
        case "block":
            for (let statementIndex = 0; statementIndex < parent.statements.length; statementIndex++) {
                const statement = parent.statements[statementIndex]

                if (statement.kind === "value-declaration-statement") {
                    if (statement.name.name === name) {
                        if (resolved) {
                            reportError(alreadyDeclared(statement.name))
                        }
                        
                        // detect variable or const being referenced before it's available
                        const comingFromIndex = parent.statements.findIndex(other => areSame(other, from))
                        if (comingFromIndex < statementIndex) {
                            reportError(miscError(originator, `Can't reference "${name}" before initialization`))
                        } else if (comingFromIndex === statementIndex) {
                            reportError(miscError(originator, `Can't reference "${name}" in its own initialization`))
                        }

                        resolved = {
                            kind: "basic",
                            ast: statement
                        }
                    }
                }
            }
            break;
        case "for-loop": {
            if (parent.itemIdentifier.name === name) {
                resolved = {
                    kind: "iterator",
                    iterator: parent.iterator,
                }
            }
        } break;
        case "inline-const":
            if (parent.name.name === name) {
                resolved = {
                    kind: "basic",
                    ast: parent
                }
            }
            break;
    }

    // if not resolved, recurse upward to the next AST node
    return resolved ?? resolve(reportError, name, parent, originator)
}
