import { alreadyDeclared, cannotFindExport, cannotFindModule, cannotFindName } from "../errors.ts";
import { AST } from "../_model/ast.ts";
import { GetParent, PlainIdentifier, ReportError, Binding, GetModule, Refinement, areSame } from "../_model/common.ts";
import { LocalIdentifier } from "../_model/expressions.ts";
import { ANY_TYPE, BOOLEAN_TYPE, NIL_TYPE, NUMBER_TYPE, STRING_TYPE, TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";

export function resolveLazy(reportError: ReportError, getModule: GetModule, getParent: GetParent, identifier: LocalIdentifier|PlainIdentifier, from: AST): Binding|undefined {

    const parent = getParent(from)

    if (parent == null) {
        reportError(cannotFindName(identifier))
        return undefined;
    }

    let resolved: Binding|undefined;

    switch (parent.kind) {
        case "module": {

            // add all declarations except consts to scope
            for (const declaration of parent.declarations) {
                if (declaration.kind === "type-declaration") {
                    if (declaration.name.name === identifier.name) {
                        if (resolved) {
                            reportError(alreadyDeclared(declaration.name))
                        }

                        resolved = {
                            kind: 'type-binding',
                            type: declaration.type,
                            isGenericParameter: false,
                        }
                    }
                } else if (declaration.kind === "func-declaration" || declaration.kind === "proc-declaration" || declaration.kind === "store-declaration") {
                    if (declaration.name.name === identifier.name) {
                        if (resolved) {
                            reportError(alreadyDeclared(declaration.name))
                        }

                        resolved = {
                            kind: "basic",
                            ast: declaration
                        }
                    }
                } else if (declaration.kind === "import-declaration") {
                    for (const importItem of declaration.imports) {
                        const nameAst = importItem.alias ?? importItem.name

                        if (nameAst.name === identifier.name) {
                            if (resolved) {
                                reportError(alreadyDeclared(nameAst))
                            }

                            const otherModule = getModule(declaration.path.value)

                            if (otherModule == null) {
                                reportError(cannotFindModule(declaration.path))
                            } else {
                                resolved = resolveLazy(reportError, getModule, getParent, importItem.name, otherModule.declarations[0]) // HACK

                                if (resolved == null) {
                                    reportError(cannotFindExport(importItem, declaration));
                                }
                            }
                        }
                    }
                }
            }
        } break;
        case "func":
        case "proc": {
            
            // add any generic type parameters to scope
            for (const typeParam of parent.type.typeParams) {
                if (typeParam.name === identifier.name) {
                    if (resolved) {
                        reportError(alreadyDeclared(typeParam))
                    }

                    // TODO: Use `extends` to give these more meaningful types in context
                    resolved = {
                        kind: 'type-binding',
                        type: UNKNOWN_TYPE,
                        isGenericParameter: true
                    }
                }
            }

            // add func/proc arguments to scope
            for (let i = 0; i < parent.type.args.length; i++) {
                const arg = parent.type.args[i]

                if (arg.name.name === identifier.name) {
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
            // TODO?
            break;
        case "for-loop": {
            // add loop element to scope
            if (parent.itemIdentifier.name === identifier.name) {
                resolved = {
                    kind: "iterator",
                    iterator: parent.iterator,
                }
            }
        } break;
        case "store-declaration":
            if ("this" === identifier.name) {
                resolved = {
                    kind: "this",
                    store: parent
                }
            }
            break;
        case "invocation":
            break;
        case "const-declaration":
        case "inline-const":
        case "let-declaration":
        case "const-declaration-statement":
            if (parent.name.name === identifier.name) {
                resolved = {
                    kind: "basic",
                    ast: parent
                }
            }
            break;
    }

    return resolved ?? resolveLazy(reportError, getModule, getParent, identifier, parent)
}
