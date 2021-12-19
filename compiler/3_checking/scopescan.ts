import { alreadyDeclared, cannotFindExport, cannotFindModule, cannotFindName, miscError } from "../errors.ts";
import { AST } from "../_model/ast.ts";
import { PlainIdentifier, Binding, areSame, Passthrough } from "../_model/common.ts";
import { LocalIdentifier } from "../_model/expressions.ts";
import { FuncType, GenericParamType, NamedType, ProcType } from "../_model/type-expressions.ts";

export function resolveLazy(passthough: Pick<Passthrough, 'reportError'|'getParent'|'getModule'>, identifier: LocalIdentifier|PlainIdentifier|NamedType|GenericParamType, from: AST): Binding|undefined {
    const { reportError, getParent, getModule } = passthough
    
    const name = identifier.kind === 'named-type' || identifier.kind === 'generic-param-type' ? identifier.name : identifier

    const parent = getParent(from)

    if (parent == null) {
        reportError(cannotFindName(name))
        return undefined;
    }

    let resolved: Binding|undefined;

    switch (parent.kind) {
        case "module": {
            for (let declarationIndex = 0; declarationIndex < parent.declarations.length; declarationIndex++) {
                const declaration = parent.declarations[declarationIndex]

                switch (declaration.kind) {
                    case "type-declaration": {
                        if (declaration.name.name === name.name) {
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
                    case "store-declaration":
                    case "const-declaration": {
                        if (declaration.name.name === name.name) {
                            if (resolved) {
                                reportError(alreadyDeclared(declaration.name))
                            }
    
                            if (declaration.kind === 'const-declaration') { 
                                const comingFromIndex = parent.declarations.findIndex(other => areSame(other, from))
    
                                if (comingFromIndex < declarationIndex) {
                                    reportError(miscError(identifier, `Can't reference "${identifier.name}" before initialization`))
                                } else if (comingFromIndex === declarationIndex) {
                                    reportError(miscError(identifier, `Can't reference "${identifier.name}" in its own initialization`))
                                }
                            }

                            if (declaration.kind === 'store-declaration' && from.kind === 'const-declaration') {
                                reportError(miscError(identifier, `Stores cannot be referenced when initializing constants`))
                            }
    
                            resolved = {
                                kind: "basic",
                                ast: declaration
                            }
                        }
                    } break;
                    case "import-declaration": {
                        for (const importItem of declaration.imports) {
                            const nameAst = importItem.alias ?? importItem.name

                            if (nameAst.name === name.name) {
                                if (resolved) {
                                    reportError(alreadyDeclared(nameAst))
                                }

                                const otherModule = getModule(declaration.path.value)

                                if (otherModule == null) {
                                    reportError(cannotFindModule(declaration.path))
                                } else {
                                    resolved = resolveLazy(passthough, importItem.name, otherModule.declarations[0]) // HACK

                                    if (resolved == null) {
                                        reportError(cannotFindExport(importItem, declaration));
                                    }
                                }
                            }
                        }
                    } break;
                }
            }
        } break;
        case "func":
        case "proc": {
            
            // add any generic type parameters to scope
            if (parent.type.kind === 'generic-type') {
                for (const typeParam of parent.type.typeParams) {
                    if (typeParam.name.name === name.name) {
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

            // add func/proc arguments to scope
            const funcOrProcType = parent.type.kind === 'generic-type' ? (parent.type.inner as FuncType|ProcType) : parent.type
            for (let i = 0; i < funcOrProcType.args.length; i++) {
                const arg = funcOrProcType.args[i]

                if (arg.name.name === name.name) {
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

                switch (statement.kind) {
                    case "let-declaration":
                    case "const-declaration-statement": {
                        if (statement.name.name === name.name) {
                            if (resolved) {
                                reportError(alreadyDeclared(statement.name))
                            }
                            
                            const comingFromIndex = parent.statements.findIndex(other => areSame(other, from))

                            if (comingFromIndex < statementIndex) {
                                reportError(miscError(identifier, `Can't reference "${identifier.name}" before initialization`))
                            } else if (comingFromIndex === statementIndex) {
                                reportError(miscError(identifier, `Can't reference "${identifier.name}" in its own initialization`))
                            }
    
                            resolved = {
                                kind: "basic",
                                ast: statement
                            }
                        }
                    } break;
                }
            }
            break;
        case "for-loop": {
            if (parent.itemIdentifier.name === name.name) {
                resolved = {
                    kind: "iterator",
                    iterator: parent.iterator,
                }
            }
        } break;
        case "store-declaration":
            if ("this" === name.name) {
                resolved = {
                    kind: "this",
                    store: parent
                }
            }
            break;
        case "inline-const":
            if (parent.name.name === name.name) {
                resolved = {
                    kind: "basic",
                    ast: parent
                }
            }
            break;
    }

    return resolved ?? resolveLazy(passthough, identifier, parent)
}
