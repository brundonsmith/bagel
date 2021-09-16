import { ModulesStore } from "../3_checking/modules-store";
import { given } from "../utils";
import { Module, AST } from "../_model/ast";
import { PlainIdentifier } from "../_model/common";
import { Expression, Proc, Func } from "../_model/expressions";
import { TypeExpression } from "../_model/type-expressions";


export function compile(modulesStore: ModulesStore, module: Module): string {
    const hasMain = module.declarations.some(decl => decl.kind === "proc-declaration" && decl.name.name === "main")
    return module.declarations
        .filter(declaration => declaration.kind !== "type-declaration")
        .map(decl => compileOne(modulesStore, decl))
        .join("\n\n") + (hasMain ? "main();\n" : "");
}

function compileOne(modulesStore: ModulesStore, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(modulesStore, name) + (alias ? ` as ${compileOne(modulesStore, alias)}` : ``)
        ).join(", ")} } from "${ast.path.segments.join("")}.bgl.ts";`;
        case "type-declaration": return (ast.exported ? `export ` : ``) + `type ${ast.name.name} = ${compileTypeExpression(ast.type)}`;
        case "proc-declaration": return (ast.exported ? `export ` : ``) + compileProc(modulesStore, ast.proc, ast.name.name);
        case "func-declaration": return (ast.exported ? `export ` : ``) + compileFunc(modulesStore, ast.func, ast.name.name);
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(modulesStore, ast.name)} = ${compileOne(modulesStore, ast.value)};`;
        case "class-declaration": return (ast.exported ? `export ` : ``) + `class ${compileOne(modulesStore, ast.name)} {\n${ast.members.map(m => compileOne(modulesStore, m)).join('\n')}\n}`;
        case "class-property": return `${ast.access} ${ast.name.name}${ast.type ? ': ' + compileTypeExpression(ast.type) : ''} = ${compileOne(modulesStore, ast.value)}`
        case "class-function": return `${ast.access} ${compileFunc(modulesStore, ast.func, ast.name.name, true)}`
        case "class-procedure": return `${ast.access} ${compileProc(modulesStore, ast.proc, ast.name.name, true)}`
        case "proc": return compileProc(modulesStore, ast);
        case "let-declaration": return `${compileOne(modulesStore, ast.name)} = ${compileOne(modulesStore, ast.value)}`;
        case "assignment": return `${compileOne(modulesStore, ast.target)} = ${compileOne(modulesStore, ast.value)}`;
        case "proc-call": return `${compileOne(modulesStore, ast.proc)}${ast.args.map(arg => `(${compileOne(modulesStore, arg)})`).join("") || "()"}`;
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
        case "local-identifier": return modulesStore.getScopeFor(ast).values[ast.name]?.mutability === "all" ? `${LOCALS_OBJ}["${ast.name}"]` : ast.name;
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
        case "reaction": return `${HIDDEN_IDENTIFIER_PREFIX}reactionUntil(
${compileOne(modulesStore, ast.data)},
${compileOne(modulesStore, ast.effect)},
${given(ast.until, until => compileOne(modulesStore, until))});`;
        case "computation": return `const ${ast.name.name} = ${HIDDEN_IDENTIFIER_PREFIX}computed(() => ${compileOne(modulesStore, ast.expression)});`;
        case "indexer": return `${compileOne(modulesStore, ast.base)}[${compileOne(modulesStore, ast.indexer)}]`;
        case "block": return `{ ${ast.statements.map(s => compileOne(modulesStore, s)).join(" ")} }`;
        case "element-tag": return `${HIDDEN_IDENTIFIER_PREFIX}h('${ast.tagName.name}',{${
            objectEntries(modulesStore, (ast.attributes as [PlainIdentifier, Expression|Expression[]][]))}}, ${ast.children.map(c => compileOne(modulesStore, c)).join(', ')})`;
        case "class-construction": return `new ${ast.clazz.name}()`;
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
const SENTINEL_OBJ = HIDDEN_IDENTIFIER_PREFIX + "sentinel";

function compileProc(modulesStore: ModulesStore, proc: Proc, name?: string, isMethod?: boolean): string {
    const mutableLocals = Object.entries(modulesStore.getScopeFor(proc.body).values)
        .filter(e => e[1].mutability === "all");

    return (!isMethod ? 'function ' : '') + `${name ?? ''}(${proc.argNames[0] != null ? compileOne(modulesStore, proc.argNames[0]) : ''}${proc.argNames[0] != null ? ': ' + compileTypeExpression(proc.type.argTypes[0]) : ''}) {${proc.argNames.length > 1 ? ` return (${proc.argNames.map((arg, index, arr) => index === 0 ? '' : `(${compileOne(modulesStore, arg)}: ${compileTypeExpression(proc.type.argTypes[index])})${index === arr.length - 1 ? ": void" : ""} => `).join("")}{\n` : ''}
    ${mutableLocals.length > 0 ? // TODO: Handle ___locals for parent closures
    `const ${LOCALS_OBJ}: {${mutableLocals.map(e => `${e[0]}?: ${compileTypeExpression(e[1].declaredType)}`).join(",")}} = ${HIDDEN_IDENTIFIER_PREFIX}observable({});
     const ${SENTINEL_OBJ} = {};` : ``}

    ${proc.body.statements.map(s => compileOne(modulesStore, s)).join(";\n")};
    
${proc.argNames.length > 1 ? `});` : ''}}`;
}
// TODO: dispose of reactions somehow... at some point...

function compileFunc(modulesStore: ModulesStore, func: Func, name?: string, isMethod?: boolean): string {
    return (!isMethod ? 'function ' : '') + `${name ?? ''}(${func.argNames[0] != null ? `${compileOne(modulesStore, func.argNames[0])}${func.argNames[0] != null ? ': ' + compileTypeExpression(func.type.argTypes[0]) : ''}` : ''}) { return (${func.argNames.map((arg, index, arr) => index === 0 ? '' : `(${compileOne(modulesStore, arg)}: ${compileTypeExpression(func.type.argTypes[index])})${index === arr.length - 1 ? ": " + compileTypeExpression(func.type.returnType) : ""} => `).join("")}
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

function compileTypeExpression(expr: TypeExpression): string {
    switch (expr.kind) {
        case "union-type": return expr.members.map(compileTypeExpression).join(" | ");
        case "named-type": return expr.name.name;
        case "proc-type": return `(${expr.argTypes.map(compileTypeExpression).join(", ")}) => void`;
        case "func-type": return `(${expr.argTypes.map(compileTypeExpression).join(", ")}) => ${compileTypeExpression(expr.returnType)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${expr.entries
            .map(([ key, value ]) => `${key.name}: ${compileTypeExpression(value)}`)
            .join(", ")}}`;
        case "indexer-type": return `{[key: ${compileTypeExpression(expr.keyType)}]: ${compileTypeExpression(expr.valueType)}}`;
        case "array-type": return `${compileTypeExpression(expr.element)}[]`;
        case "tuple-type": return `[${expr.members.map(compileTypeExpression).join(", ")}]`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `null | undefined`;
        case "unknown-type": return `unknown`;
    }

    throw Error(`Compilation logic for type expression of kind '${expr.kind}' is unspecified`)
}