import { AST, Expression, Func, Proc } from "./ast";

export function compile(ast: AST[]): string {
    return ast.map(compileOne).join("\n\n");
}

function compileOne(ast: AST): string {
    switch(ast.kind) {
        case "proc-declaration": return compileProc(ast.proc);
        case "func-declaration": return compileFunc(ast.func);
        case "const-declaration": return `const ${ast.name} = ${compileOne(ast.value)};`;
        case "proc": return compileProc(ast);
        // case "assignment": return "";
        case "func": return compileFunc(ast);
        case "funcall": return `${compileOne(ast.func)}${ast.args.map(arg => `(${compileOne(arg)})`).join("")}`;
        case "pipe": return compilePipe(ast.expressions, ast.expressions.length - 1);
        case "binary-operator": return `${compileOne(ast.left)} ${ast.operator} ${compileOne(ast.right)}`;
        case "if-else-expression": return `(${compileOne(ast.ifCondition)}) ? (${compileOne(ast.ifResult)}) : (${ast.elseResult == null ? NIL : compileOne(ast.elseResult)})`;
        case "range": return `range(${ast.start})(${ast.end})`;
        case "identifier": return ast.name;
        case "object-literal":  return JSON.stringify(ast.entries);
        case "array-literal":   return JSON.stringify(ast.entries);
        case "string-literal":  return JSON.stringify(ast.value);
        case "number-literal":  return JSON.stringify(ast.value);
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
    }

    throw Error("Couldn't compile: " + ast.kind)
}

const NIL = `undefined`;

function compileProc(proc: Proc): string {
    return `function ${proc.name == null ? '' : proc.name}(${proc.args.map(arg => compileOne(arg.name))}) {${proc.body.map(compileOne).join("; ")}}`;
}

function compileFunc(func: Func): string {
    return `function ${func.name == null ? '' : func.name}(${func.args.map(arg => compileOne(arg.name))}) { return ${compileOne(func.body)}; }`;
}

function compilePipe(expressions: readonly Expression[], end: number): string {
    if (end === 0) {
        return compileOne(expressions[end]);
    } else {
        return `${compileOne(expressions[end])}(${compilePipe(expressions, end - 1)})`;
    }
}