import { AST, Declaration, declarationName, Expression, Func, LocalIdentifier, Proc } from "./ast";

export function compile(declarations: Declaration[]): string {
    return `
    ${declarations.map(compileOne).join("\n\n")}

    main({...window["bagel-lib"],${declarations.map(declarationName).map(ident => ident.name).join(",")}});`;
}

function compileOne(ast: AST): string {
    switch(ast.kind) {
        case "type-declaration": return ``;
        case "proc-declaration": return compileProc(ast.proc);
        case "func-declaration": return compileFunc(ast.func);
        case "const-declaration": return `const ${ast.name.name} = ${compileOne(ast.value)};`;
        case "proc": return compileProc(ast);
        case "let-declaration": return `${compileOne(ast.name)} = ${compileOne(ast.value)}`;
        case "assignment": return `${compileOne(ast.target)} = ${compileOne(ast.value)}`;
        case "proc-call": return `${compileOne(ast.proc)}${ast.args.map(arg => `(${LOCALS_OBJ}, ${compileOne(arg)})`).join("")}`;
        case "if-else-statement": return `if(${compileOne(ast.ifCondition)}) { ${ast.ifResult.map(compileOne).join(" ")} }` + (ast.elseResult != null ? ` else { ${ast.elseResult.map(compileOne).join(" ")} }` : ``);
        case "for-loop": return `for (const ${compileOne(ast.itemIdentifier)} of ${compileOne(ast.iterator)}) { ${ast.body.map(compileOne).join(" ")} }`;
        case "while-loop": return `while (${compileOne(ast.condition)}) { ${ast.body.map(compileOne).join(" ")} }`;
        case "func": return compileFunc(ast);
        case "funcall": return `${compileOne(ast.func)}${ast.args.map(arg => `(${LOCALS_OBJ}, ${compileOne(arg)})`).join("")}`;
        case "pipe": return compilePipe(ast.expressions, ast.expressions.length - 1);
        case "binary-operator": return `${compileOne(ast.left)} ${ast.operator} ${compileOne(ast.right)}`;
        case "if-else-expression": return `(${compileOne(ast.ifCondition)}) ? (${compileOne(ast.ifResult)}) : (${ast.elseResult == null ? NIL : compileOne(ast.elseResult)})`;
        case "range": return `range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(ast.inner)})`;
        case "property-accessor": return `${compileOne(ast.base)}.${ast.properties.map(compileOne).join(".")}`;
        case "local-identifier": return `${LOCALS_OBJ}.${ast.name}`;
        case "plain-identifier": return ast.name;
        case "object-literal":  return `{ ${ast.entries.map(([ key, value ]) => `${compileOne(key)}: ${compileOne(value)}`).join(", ")} }`;
        case "array-literal":   return `[${ast.entries.map(compileOne).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment
                                                : '${' + compileOne(segment) + '}').join("")}\``;
        case "number-literal":  return JSON.stringify(ast.value);
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "reaction": return `disposers.push(__locals.crowdx.reaction(() => ${compileOne(ast.data)}(${LOCALS_OBJ}), (data) => ${compileOne(ast.effect)}(${LOCALS_OBJ}, data)))`;
    }

    throw Error("Couldn't compile")//: " + ast.kind)
}

const NIL = `undefined`;

export const LOCALS_OBJ = "__locals";

//.map(name => `${name}:{value:${name}}`)
// let ${LOCALS_OBJ} = __locals.crowdx.observable(Object.create(${LOCALS_OBJ}, {${proc.argNames.map(compileOne).map(arg => `${arg}: {value: ${arg}}`).join(", ")}}));
function compileProc(proc: Proc): string {
    return `function ${proc.name == null ? '' : proc.name.name}(__parent_locals, ${proc.argNames.map(compileOne)}) {
    const ${LOCALS_OBJ} = __parent_locals.crowdx.observable({...__parent_locals,${proc.argNames.map(compileOne).join(",")}});
    const disposers = [];

    ${proc.body.map(compileOne).join("; ")}

    // disposers.forEach(__locals.crowdx.dispose);
}`;
}
// TODO: dispose of reactions somehow... at some point...

// TODO: Don't pass __parent_locals to top-level declared functions/procs
function compileFunc(func: Func): string {
    return `function ${func.name == null ? '' : func.name.name}(__parent_locals, ${func.argNames.map(compileOne)}) {
        ${func.argNames.length > 0 ? `const ${LOCALS_OBJ} = {...__parent_locals,${func.argNames.map(compileOne).join(",")}};` : ``}
        return ${compileOne(func.body)};
    }`;
}

function compilePipe(expressions: readonly Expression[], end: number): string {
    if (end === 0) {
        return compileOne(expressions[end]);
    } else {
        return `${compileOne(expressions[end])}(${compilePipe(expressions, end - 1)})`;
    }
}