import { AST, Expression, Func, Proc } from "./ast";

export function compile(ast: AST[]): string {
    return ast.map(compileOne).join("\n\n");
}

function compileOne(ast: AST): string {
    switch(ast.kind) {
        case "type-declaration": return ``;
        case "proc-declaration": return compileProc(ast.proc);
        case "func-declaration": return compileFunc(ast.func);
        case "const-declaration": return `const ${ast.name.name} = ${compileOne(ast.value)};`;
        case "proc": return compileProc(ast);
        case "let-declaration": return `let ${compileOne(ast.name)} = ${compileOne(ast.value)};`; // TODO: Make this an observable
        case "assignment": return `${compileOne(ast.target)} = ${compileOne(ast.value)};`; // This needs to change too when observable
        case "proc-call": return `${compileOne(ast.proc)}${ast.args.map(arg => `(${compileOne(arg)})`).join("")}`;
        case "if-else-statement": return `if(${compileOne(ast.ifCondition)}) { ${ast.ifResult.map(compileOne).join(" ")} }` + (ast.elseResult != null ? ` else { ${ast.elseResult.map(compileOne).join(" ")} }` : ``);
        case "for-loop": return `for (const ${compileOne(ast.itemIdentifier)} of ${compileOne(ast.iterator)}) { ${ast.body.map(compileOne).join(" ")} }`;
        case "while-loop": return `while (${compileOne(ast.condition)}) { ${ast.body.map(compileOne).join(" ")} }`;
        case "func": return compileFunc(ast);
        case "funcall": return `${compileOne(ast.func)}${ast.args.map(arg => `(${compileOne(arg)})`).join("")}`;
        case "pipe": return compilePipe(ast.expressions, ast.expressions.length - 1);
        case "binary-operator": return `${compileOne(ast.left)} ${ast.operator} ${compileOne(ast.right)}`;
        case "if-else-expression": return `(${compileOne(ast.ifCondition)}) ? (${compileOne(ast.ifResult)}) : (${ast.elseResult == null ? NIL : compileOne(ast.elseResult)})`;
        case "range": return `range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(ast.inner)})`;
        case "property-accessor": return `${compileOne(ast.base)}.${ast.properties.map(compileOne).join(".")}`;
        case "identifier": return ast.name;
        case "object-literal":  return `{ ${ast.entries.map(([ key, value ]) => `${compileOne(key)}: ${compileOne(value)}`).join(", ")} }`;
        case "array-literal":   return `[${ast.entries.map(compileOne).join(", ")}]`;
        case "string-literal":  return `\`${ast.value}\``;
        case "number-literal":  return JSON.stringify(ast.value);
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
    }

    throw Error("Couldn't compile")//: " + ast.kind)
}

const NIL = `undefined`;

function compileProc(proc: Proc): string {
    return `function ${proc.name == null ? '' : proc.name.name}(${proc.argNames.map(compileOne)}) {${proc.body.map(compileOne).join("; ")}}`;
}

function compileFunc(func: Func): string {
    return `function ${func.name == null ? '' : func.name.name}(${func.argNames.map(compileOne)}) { return ${compileOne(func.body)}; }`;
}

function compilePipe(expressions: readonly Expression[], end: number): string {
    if (end === 0) {
        return compileOne(expressions[end]);
    } else {
        return `${compileOne(expressions[end])}(${compilePipe(expressions, end - 1)})`;
    }
}