import { computedFn } from "../../lib/ts/reactivity.ts";
import { AST } from "../_model/ast.ts";
import { Binding, Context, ModuleName } from "../_model/common.ts";
import { ImportItem,ValueDeclaration,FuncDeclaration,ProcDeclaration,TypeDeclaration,DeriveDeclaration,RemoteDeclaration,ImportDeclaration } from "../_model/declarations.ts";

export const resolve = computedFn(function resolve (ctx: Pick<Context, 'allModules'|'canonicalModuleName'>, name: string, from: AST, resolveImports?: boolean): Binding|undefined {
    let resolved = resolveInner(name, from, from)

    if (resolveImports) {
        while (resolved?.owner.kind === 'import-item') {
            const imported = resolveImport(ctx, resolved.owner)

            if (!imported) return resolved

            resolved = { identifier: resolved.identifier, owner: imported }
        }
    }

    return resolved
})

/**
 * Given some identifier and some AST context, look upwards until a binding is
 * found for the identifier (or the root is reached)
 */
const resolveInner = (name: string, from: AST, originator: AST): Binding|undefined => {
    const parent = from.parent

    // if we've reached the root of the AST, there's no binding
    if (parent == null) {
        return undefined;
    }

    switch (parent.kind) {
        case "module": {
            for (let declarationIndex = 0; declarationIndex < parent.declarations.length; declarationIndex++) {
                const declaration = parent.declarations[declarationIndex]

                switch (declaration.kind) {
                    case "type-declaration":
                    case "func-declaration":
                    case "proc-declaration":
                    case "value-declaration":
                    case "derive-declaration":
                    case "remote-declaration":
                    case "import-all-declaration": {
                        if (declaration.name.name === name) {
                            return {
                                owner: declaration,
                                identifier: declaration.name
                            }
                        }
                    } break;
                    case "import-declaration": {
                        for (const importItem of declaration.imports) {
                            const nameAst = importItem.alias ?? importItem.name

                            // found the matching import
                            if (nameAst.name === name) {
                                return {
                                    identifier: nameAst,
                                    owner: importItem,
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
                    return {
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
                        return {
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
            if (funcOrProcType.args.kind === 'args') {
                for (const arg of funcOrProcType.args.args) {
                    if (arg.name?.name === name) {
                        return {
                            owner: parent,
                            identifier: arg.name
                        }
                    }
                }
            } else {
                const spreadName = funcOrProcType.args.name

                if (spreadName?.name === name) {
                    return {
                        owner: parent,
                        identifier: spreadName
                    }
                }
            }
        } break;
        case "block": {
            for (let statementIndex = 0; statementIndex < parent.statements.length; statementIndex++) {
                const statement = parent.statements[statementIndex]

                if (statement.kind === "declaration-statement") {
                    if (statement.destination.kind === 'name-and-type') {
                        if (statement.destination.name?.name === name) {
                            return {
                                owner: statement,
                                identifier: statement.destination.name
                            }
                        }
                    } else {
                        for (const property of statement.destination.properties) {
                            if (property.name === name) {
                                return {
                                    owner: statement,
                                    identifier: property
                                }
                            }
                        }
                    }
                }
            }

            const grandparent = parent.parent
            if (grandparent?.kind === 'try-catch' && grandparent.catchBlock === parent && grandparent.errIdentifier.name === name) {
                return {
                    owner: grandparent,
                    identifier: grandparent.errIdentifier
                }
            }
        } break;
        case "for-loop": {
            if (parent.itemIdentifier.name === name) {
                return {
                    owner: parent,
                    identifier: parent.itemIdentifier
                }
            }
        } break;
        case "inline-const-group":
            for (let declarationIndex = 0; declarationIndex < parent.declarations.length; declarationIndex++) {
                const declaration = parent.declarations[declarationIndex]

                if (declaration.destination.kind === 'name-and-type') {
                    if (declaration.destination.name.name === name) {
                        return {
                            owner: declaration,
                            identifier: declaration.destination.name
                        }
                    }
                } else {
                    for (const property of declaration.destination.properties) {
                        if (property.name === name) {
                            return {
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
    return resolveInner(name, parent, originator)
}

export function resolveImport(ctx: Pick<Context, 'allModules'|'canonicalModuleName'>, importItem: ImportItem) {
    const { allModules, canonicalModuleName } = ctx
    const importDeclaration = (importItem.parent as ImportDeclaration)
    const otherModuleName = canonicalModuleName(importItem.module as ModuleName, importDeclaration.path.value)
    const otherModule = allModules.get(otherModuleName)?.ast

    return otherModule?.declarations.find(other =>
        (other.kind === 'value-declaration' ||
        other.kind === 'func-declaration' ||
        other.kind === 'proc-declaration' ||
        other.kind === 'type-declaration' ||
        other.kind === 'derive-declaration' ||
        other.kind === 'remote-declaration')
        && other.name.name === importItem.name.name
    ) as ValueDeclaration|FuncDeclaration|ProcDeclaration|TypeDeclaration|DeriveDeclaration|RemoteDeclaration|undefined
}
