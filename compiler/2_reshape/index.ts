import { Module } from "../_model/ast.ts";
import { ConstDeclaration } from "../_model/declarations.ts";

/**
 * Reshape the parse tree in various ways, including simplification of later 
 * passes and optimization
 */
export function reshape(ast: Module): Module {

    let declarations = [...ast.declarations]
    const [rootConstDeclaration, ...otherConstDeclarations] = declarations.filter(decl => decl.kind === "const-declaration") as ConstDeclaration[]
    if (rootConstDeclaration) {
        let current: { next?: ConstDeclaration } = rootConstDeclaration
        for (const other of otherConstDeclarations) {
            current.next = other
            current = other
        }
    
        // Move consts to the bottom so that all other declarations will be available to them
        declarations = declarations
            .filter(decl => decl.kind !== 'const-declaration')
            .concat([ rootConstDeclaration ])
    }

    return {
        ...ast,
        declarations
    }
}
