import { cannotFindExport, cannotFindModule, miscError } from "../errors.ts";
import { computedFn } from "../mobx.ts";
import Store, { getModuleByName } from "../store.ts";
import { AST } from "../_model/ast.ts";
import { Binding, ModuleName, ReportError } from "../_model/common.ts";
import { ValueDeclaration,FuncDeclaration,ProcDeclaration,TypeDeclaration } from "../_model/declarations.ts";

export const resolve = computedFn((reportError: ReportError, name: string, from: AST): Binding|undefined => {
    return resolveInner(reportError, name, from, from)
})

/**
 * Given some identifier and some AST context, look upwards until a binding is
 * found for the identifier (or the root is reached)
 */
const resolveInner = (reportError: ReportError, name: string, from: AST, originator: AST): Binding|undefined => {
    const parent = from.parent

    // if we've reached the root of the AST, there's no binding
    if (parent == null) {
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
                            resolved = {
                                identifier: declaration.name,
                                owner: declaration,
                            }
                        }
                    } break;
                    case "func-declaration":
                    case "proc-declaration":
                    case "value-declaration":
                    case "derive-declaration":
                    case "remote-declaration": {
                        if (declaration.name.name === name) {
                            if (declaration.kind === 'value-declaration') {

                                if (!declaration.isConst) {

                                    // lets can only be referenced by procs, autoruns, derives, remotes
                                    if (from.kind !== 'proc-declaration' 
                                     && from.kind !== 'autorun-declaration' 
                                     && from.kind !== 'derive-declaration' 
                                     && from.kind !== 'remote-declaration') {
                                        // TODO: check against lambdas too. move to typecheck.ts? 
                                        const declName = (
                                            from.kind === 'value-declaration' && from.isConst ? 'constants' :
                                            from.kind === 'value-declaration' && !from.isConst ? 'let declarations' :
                                            from.kind === 'func-declaration' ? 'funcs' :
                                            'this declaration'
                                        )

                                        reportError(miscError(originator, `Can't reference let-declarations from ${declName}`))
                                    }
                                }
                            }
    
                            resolved = {
                                owner: declaration,
                                identifier: declaration.name
                            }
                        }
                    } break;
                    case "import-all-declaration": {
                        if (declaration.alias.name === name) {
                            resolved = {
                                owner: declaration,
                                identifier: declaration.alias
                            }
                        }
                    } break;
                    case "import-declaration": {
                        for (const importItem of declaration.imports) {
                            const nameAst = importItem.alias ?? importItem.name

                            // found the matching import
                            if (nameAst.name === name) {
                                const otherModule = getModuleByName(Store, declaration.module as ModuleName, declaration.path.value)

                                if (otherModule == null) {
                                    // other module doesn't exist
                                    reportError(cannotFindModule(declaration.path))
                                } else {
                                    const imported = otherModule.declarations.find(decl =>
                                        (decl.kind === 'value-declaration' || 
                                         decl.kind === 'func-declaration' || 
                                         decl.kind === 'proc-declaration' || 
                                         decl.kind === 'type-declaration')
                                        && decl.name.name === importItem.name.name
                                        && decl.exported) as ValueDeclaration|FuncDeclaration|ProcDeclaration|TypeDeclaration|undefined

                                    if (imported == null) {
                                        reportError(cannotFindExport(importItem, declaration));
                                    } else {
                                        if (imported.kind === 'type-declaration') {
                                            resolved = {
                                                identifier: nameAst,
                                                owner: imported
                                            }
                                        } else {
                                            resolved = {
                                                identifier: nameAst,
                                                owner: imported,
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
                    resolved = {
                        identifier: typeParam.name,
                        owner: {
                            kind: "generic-param-type",
                            name: typeParam.name,
                            extends: typeParam.extends,
                            parent: typeParam.name.parent,
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
                        resolved = {
                            identifier: typeParam.name,
                            owner: {
                                kind: "generic-param-type",
                                name: typeParam.name,
                                extends: typeParam.extends,
                                parent: typeParam.name.parent,
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
                    resolved = {
                        owner: parent,
                        identifier: arg.name
                    }
                }
            }
        } break;
        case "block":
            for (let statementIndex = 0; statementIndex < parent.statements.length; statementIndex++) {
                const statement = parent.statements[statementIndex]

                if (statement.kind === "value-declaration-statement" || statement.kind === 'destructuring-declaration-statement' || statement.kind === 'await-statement') {
                    if (statement.kind !== 'destructuring-declaration-statement') {
                        if (statement.name?.name === name) {
                            resolved = {
                                owner: statement,
                                identifier: statement.name
                            }
                        }
                    } else {
                        for (const property of statement.properties) {
                            if (property.name === name) {
                                resolved = {
                                    owner: statement,
                                    identifier: property
                                }
                            }
                        }
                    }
                }
            }
            break;
        case "for-loop": {
            if (parent.itemIdentifier.name === name) {
                resolved = {
                    owner: parent,
                    identifier: parent.itemIdentifier
                }
            }
        } break;
        case "inline-const-group":
            for (let declarationIndex = 0; declarationIndex < parent.declarations.length; declarationIndex++) {
                const declaration = parent.declarations[declarationIndex]

                if (declaration.kind === 'inline-const-declaration') {
                    if (declaration.name.name === name) {
                        resolved = {
                            owner: declaration,
                            identifier: declaration.name
                        }
                    }
                } else {
                    for (const property of declaration.properties) {
                        if (property.name === name) {
                            resolved = {
                                owner: declaration,
                                identifier: property
                            }
                        }
                    }
                }
            }
            break;
    }

    // if not resolved, recurse upward to the next AST node
    return resolved ?? resolveInner(reportError, name, parent, originator)
}
