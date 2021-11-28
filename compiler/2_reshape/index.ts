import { Module } from "../_model/ast.ts";
import { Declaration } from "../_model/declarations.ts";
import { INT } from '../4_compile/index.ts';

/**
 * Reshape the parse tree in various ways, including simplification of later 
 * passes and optimization
 */
export function reshape(ast: Module): Module {
    const declarations: Declaration[] = [];

    for (const decl of ast.declarations) {
        if (decl.kind === "store-declaration") {
            declarations.push({
                ...decl,
                kind: "class-declaration",
                typeParams: [],
                exported: false,
                name: {
                    kind: "plain-identifier",
                    name: INT + decl.name.name,
                    id: Symbol(),
                    code: undefined, startIndex: undefined, endIndex: undefined
                }
            })
            declarations.push({
                kind: "const-declaration",
                name: decl.name,
                type: undefined,
                value: {
                    kind: "class-construction",
                    clazz: {
                        kind: "local-identifier",
                        name: INT + decl.name.name,
                        id: Symbol(),
                        code: undefined, startIndex: undefined, endIndex: undefined
                    },
                    id: Symbol(),
                    code: undefined, startIndex: undefined, endIndex: undefined
                },
                exported: decl.exported,
                id: Symbol(),
                code: decl.code, startIndex: decl.startIndex, endIndex: decl.endIndex,
            })
        } else {
            declarations.push(decl)
        }
    }

    return {
        ...ast,
        declarations
    };
}
