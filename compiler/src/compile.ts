import { ModulesStore } from "./checking/modules-store";
import { Module, AST } from "./model/ast";
import { PlainIdentifier } from "./model/common";
import { Expression, Proc, Func } from "./model/expressions";


export function compile(modulesStore: ModulesStore, module: Module): string {
    return module.declarations
        .filter(declaration => declaration.kind !== "type-declaration")
        .map(decl => compileOne(modulesStore, decl)).join("\n\n");
}

function compileOne(modulesStore: ModulesStore, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(modulesStore, name) + (alias ? ` as ${compileOne(modulesStore, alias)}` : ``)
        ).join(", ")} } from "${ast.path.segments.join("")}";`;
        case "type-declaration": return ``;
        case "proc-declaration": return (ast.exported ? `export ` : ``) + compileProc(modulesStore, ast.proc);
        case "func-declaration": return (ast.exported ? `export ` : ``) + compileFunc(modulesStore, ast.func);
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(modulesStore, ast.name)} = ${compileOne(modulesStore, ast.value)};`;
        case "proc": return compileProc(modulesStore, ast);
        case "let-declaration": return `${compileOne(modulesStore, ast.name)} = ${compileOne(modulesStore, ast.value)}`;
        case "assignment": return `${compileOne(modulesStore, ast.target)} = ${compileOne(modulesStore, ast.value)}`;
        case "proc-call": return `${compileOne(modulesStore, ast.proc)}${ast.args.map(arg => `(${compileOne(modulesStore, arg)})`).join("") || "()"};`;
        case "if-else-statement": return `if(${compileOne(modulesStore, ast.ifCondition)}) ${compileOne(modulesStore, ast.ifResult)}` 
            + (ast.elseResult != null ? ` else ${compileOne(modulesStore, ast.elseResult)}` : ``);
        case "for-loop": return `for (const ${compileOne(modulesStore, ast.itemIdentifier)} of ${compileOne(modulesStore, ast.iterator)}) ${compileOne(modulesStore, ast.body)}`;
        case "while-loop": return `while (${compileOne(modulesStore, ast.condition)}) ${compileOne(modulesStore, ast.body)}`;
        case "func": return compileFunc(modulesStore, ast);
        case "funcall": return `${compileOne(modulesStore, ast.func)}${ast.args.map(arg => `(${compileOne(modulesStore, arg)})`).join("") || "()"}`;
        case "pipe": return compilePipe(modulesStore, ast.expressions, ast.expressions.length - 1);
        case "binary-operator": return `${compileOne(modulesStore, ast.left)} ${ast.operator} ${compileOne(modulesStore, ast.right)}`;
        case "if-else-expression": return `(${compileOne(modulesStore, ast.ifCondition)}) ? (${compileOne(modulesStore, ast.ifResult)}) : (${ast.elseResult == null ? NIL : compileOne(modulesStore, ast.elseResult)})`;
        case "range": return `${HIDDEN_IDENTIFIER_PREFIX}range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(modulesStore, ast.inner)})`;
        case "property-accessor": return `${compileOne(modulesStore, ast.base)}.${ast.properties.map(p => compileOne(modulesStore, p)).join(".")}`;
        case "local-identifier": return modulesStore.getScopeFor(ast).values[ast.name].mutability === "all" ? `${LOCALS_OBJ}["${ast.name}"]` : ast.name;
        case "plain-identifier": return ast.name;
        case "object-literal":  return `{${objectEntries(modulesStore, ast.entries)}}`;
        case "array-literal":   return `[${ast.entries.map(e => compileOne(modulesStore, e)).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment
                                                : '${' + compileOne(modulesStore, segment) + '}').join("")}\``;
        case "number-literal":  return JSON.stringify(ast.value);
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "reaction": return `disposers.push(crowdx.reaction(() => ${compileOne(modulesStore, ast.data)}, (data) => ${compileOne(modulesStore, ast.effect)}(data)))`;
        case "indexer": return `${compileOne(modulesStore, ast.base)}[${compileOne(modulesStore, ast.indexer)}]`;
        case "block": return `{ ${ast.statements.map(s => compileOne(modulesStore, s)).join(" ")} }`;
        case "element-tag": return `${HIDDEN_IDENTIFIER_PREFIX}elementTag('${ast.tagName.name}',{${
            objectEntries(modulesStore, (ast.attributes as [PlainIdentifier, Expression|Expression[]][])
                .concat([ [{kind: "plain-identifier", name: "children"}, ast.children] as [PlainIdentifier, Expression[]] ]))}})`;
    }

    throw Error("Couldn't compile '" + (ast as any).kind + "'");
}

function objectEntries(modulesStore: ModulesStore, entries: [PlainIdentifier, Expression|Expression[]][]): string {
    return entries
        .map(([ key, value ]) => `${compileOne(modulesStore, key)}: ${Array.isArray(value) ? value.map(c => compileOne(modulesStore, c)) : compileOne(modulesStore, value)}`)
        .join(", ")
}

// TODO: Forbid this in user-defined identifers
export const HIDDEN_IDENTIFIER_PREFIX = `___`;

const NIL = `undefined`;
const LOCALS_OBJ = HIDDEN_IDENTIFIER_PREFIX + "locals";

function compileProc(modulesStore: ModulesStore, proc: Proc): string {
    const mutableLocals = Object.entries(modulesStore.getScopeFor(proc.body).values)
        .filter(e => e[1].mutability === "all");

    return `function ${proc.name == null ? '' : proc.name.name}(${proc.argNames[0] != null ? compileOne(modulesStore, proc.argNames[0]) : ''}) {${proc.argNames.length > 1 ? ` return (${proc.argNames.map((arg, index) => index === 0 ? '' : `(${compileOne(modulesStore, arg)}) => `).join("")}{\n` : ''}
    ${mutableLocals.length > 0 ? // TODO: Handle ___locals for parent closures
    `const ${LOCALS_OBJ} = ${HIDDEN_IDENTIFIER_PREFIX}observable({${
        mutableLocals
            .map(e => `${e[0]}: undefined`)
            .join(",")
    }});` : ``}

    ${proc.body.statements.map(s => compileOne(modulesStore, s)).join(";\n")}

${proc.argNames.length > 1 ? `});` : ''}}`;
}
// TODO: dispose of reactions somehow... at some point...

function compileFunc(modulesStore: ModulesStore, func: Func): string {
    return `function ${func.name == null ? '' : func.name.name}(${func.argNames[0] != null ? compileOne(modulesStore, func.argNames[0]) : ''}) { return (${func.argNames.map((arg, index, arr) => index === 0 ? '' : `(${compileOne(modulesStore, arg)}) => `).join("")}
    ${compileOne(modulesStore, func.body)}
);}`;
}

function compilePipe(modulesStore: ModulesStore, expressions: readonly Expression[], end: number): string {
    if (end === 0) {
        return compileOne(modulesStore, expressions[end]);
    } else {
        return `${compileOne(modulesStore, expressions[end])}(${compilePipe(modulesStore, expressions, end - 1)})`;
    }
}