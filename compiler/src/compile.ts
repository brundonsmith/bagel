import { AST, Declaration, Expression, Func, LocalIdentifier, Module, Proc } from "./ast";

export function compile(module: Module): string {
    return module.declarations.map(compileOne).join("\n\n");
}

function compileOne(ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(name) + (alias ? ` as ${compileOne(alias)}` : ``)
        ).join(", ")} } from ${compileOne(ast.path)};`;
        case "type-declaration": return ``;
        case "proc-declaration": return (ast.exported ? `export ` : ``) + compileProc(ast.proc);
        case "func-declaration": return (ast.exported ? `export ` : ``) + compileFunc(ast.func);
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(ast.name)} = ${compileOne(ast.value)};`;
        case "proc": return compileProc(ast);
        case "let-declaration": return `${compileOne(ast.name)} = ${compileOne(ast.value)}`;
        case "assignment": return `${compileOne(ast.target)} = ${compileOne(ast.value)}`;
        case "proc-call": return `${compileOne(ast.proc)}${ast.args.map(arg => `(${compileOne(arg)})`).join("")}`;
        case "if-else-statement": return `if(${compileOne(ast.ifCondition)}) ${compileOne(ast.ifResult)}` 
            + (ast.elseResult != null ? ` else ${compileOne(ast.elseResult)}` : ``);
        case "for-loop": return `for (const ${compileOne(ast.itemIdentifier)} of ${compileOne(ast.iterator)}) ${compileOne(ast.body)}`;
        case "while-loop": return `while (${compileOne(ast.condition)}) ${compileOne(ast.body)}`;
        case "func": return compileFunc(ast);
        case "funcall": return `${compileOne(ast.func)}${ast.args.map(arg => `(${compileOne(arg)})`).join("")}`;
        case "pipe": return compilePipe(ast.expressions, ast.expressions.length - 1);
        case "binary-operator": return `${compileOne(ast.left)} ${ast.operator} ${compileOne(ast.right)}`;
        case "if-else-expression": return `(${compileOne(ast.ifCondition)}) ? (${compileOne(ast.ifResult)}) : (${ast.elseResult == null ? NIL : compileOne(ast.elseResult)})`;
        case "range": return `range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(ast.inner)})`;
        case "property-accessor": return `${compileOne(ast.base)}.${ast.properties.map(compileOne).join(".")}`;
        case "local-identifier": return `${ast.name}`;
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
        case "reaction": return `disposers.push(crowdx.reaction(() => ${compileOne(ast.data)}, (data) => ${compileOne(ast.effect)}(data)))`;
        case "indexer": return `${compileOne(ast.base)}[${compileOne(ast.indexer)}]`;
        case "block": return `{ ${ast.statements.map(compileOne).join(" ")} }`;
    }

    throw Error("Couldn't compile '" + (ast as any).kind + "'");
}

const NIL = `undefined`;

export const LOCALS_OBJ = "__locals";

//.map(name => `${name}:{value:${name}}`)
// let ${LOCALS_OBJ} = __locals.crowdx.observable(Object.create(${LOCALS_OBJ}, {${proc.argNames.map(compileOne).map(arg => `${arg}: {value: ${arg}}`).join(", ")}}));
function compileProc(proc: Proc): string {
    return `function ${proc.name == null ? '' : proc.name.name}(${proc.argNames[0] != null ? compileOne(proc.argNames[0]) : ''}) {${proc.argNames.length > 1 ? ` return (${proc.argNames.map((arg, index) => index === 0 ? '' : `(${compileOne(arg)}) => `).join("")}{\n` : ''}
    const disposers = [];

    ${proc.body.statements.map(compileOne).join("; ")}

    // disposers.forEach(crowdx.dispose);
${proc.argNames.length > 1 ? `});` : ''}}`;
}
// TODO: dispose of reactions somehow... at some point...

// TODO: Don't pass __parent_locals to top-level declared functions/procs
function compileFunc(func: Func): string {
    return `function ${func.name == null ? '' : func.name.name}(${func.argNames[0] != null ? compileOne(func.argNames[0]) : ''}) { return (${func.argNames.map((arg, index, arr) => index === 0 ? '' : `(${compileOne(arg)}) => `).join("")}
    ${compileOne(func.body)}
);}`;
}

function compilePipe(expressions: readonly Expression[], end: number): string {
    if (end === 0) {
        return compileOne(expressions[end]);
    } else {
        return `${compileOne(expressions[end])}(${compilePipe(expressions, end - 1)})`;
    }
}