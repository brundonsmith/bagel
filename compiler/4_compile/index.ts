import { ModulesStore } from "../3_checking/modules-store.ts";
import { given } from "../utils.ts";
import { Module, AST } from "../_model/ast.ts";
import { PlainIdentifier } from "../_model/common.ts";
import { ClassProperty } from "../_model/declarations.ts";
import { Expression, Proc, Func } from "../_model/expressions.ts";
import { TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export function compile(modulesStore: ModulesStore, module: Module): string {
    const hasMain = module.declarations.some(decl => decl.kind === "proc-declaration" && decl.name.name === "main")
    return module.declarations
        .map(decl => compileOne(modulesStore, decl))
        .join("\n\n") + (hasMain ? "\nsetTimeout(main, 0);\n" : "");
}

function compileOne(modulesStore: ModulesStore, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(modulesStore, name) + (alias ? ` as ${compileOne(modulesStore, alias)}` : ``)
        ).join(", ")} } from "${ast.path.segments.join("")}.bgl.ts";`;
        case "type-declaration": return (ast.exported ? `export ` : ``) + `type ${ast.name.name} = ${compileTypeExpression(ast.type)}`;
        case "proc-declaration": return (ast.exported ? `export ` : ``) + `const ${ast.name.name} = ` + (ast.proc.kind === 'proc' ? compileProc(modulesStore, ast.proc) : compileFunc(modulesStore, ast.proc));
        case "func-declaration": return (ast.exported ? `export ` : ``) + `const ${ast.name.name} = ` + compileFunc(modulesStore, ast.func);
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(modulesStore, ast.name)}${ast.type ? `: ${compileTypeExpression(ast.type)}` : ''} = ${compileOne(modulesStore, ast.value)};`;
        case "class-declaration": return (ast.exported ? `export ` : ``) + `class ${compileOne(modulesStore, ast.name)} {\n${ast.members.map(m => compileOne(modulesStore, m)).join('\n')}\n}`;
        case "class-property": return  compileClassProperty(modulesStore, ast)
        case "class-function": return  `    ${ast.access} readonly ${ast.name.name} = ${compileFunc(modulesStore, ast.func)}`
        case "class-procedure": return `    ${ast.access} readonly ${ast.name.name} = ${(ast.proc.kind === 'proc' ? compileProc(modulesStore, ast.proc) : compileFunc(modulesStore, ast.proc))}`
        case "proc": return compileProc(modulesStore, ast);
        case "let-declaration": return `${compileOne(modulesStore, ast.name)} = ${compileOne(modulesStore, ast.value)}`;
        case "assignment": return `${compileOne(modulesStore, ast.target)} = ${compileOne(modulesStore, ast.value)}`;
        case "if-else-statement": return `if(${compileOne(modulesStore, ast.ifCondition)}) ${compileOne(modulesStore, ast.ifResult)}` 
            + (ast.elseResult != null ? ` else ${compileOne(modulesStore, ast.elseResult)}` : ``);
        case "for-loop": return `for (const ${compileOne(modulesStore, ast.itemIdentifier)} of ${compileOne(modulesStore, ast.iterator)}) ${compileOne(modulesStore, ast.body)}`;
        case "while-loop": return `while (${compileOne(modulesStore, ast.condition)}) ${compileOne(modulesStore, ast.body)}`;
        case "func": return compileFunc(modulesStore, ast);
        case "invocation": return `${compileOne(modulesStore, ast.subject)}(${ast.args.map(arg => compileOne(modulesStore, arg)).join(', ')})`;
        case "pipe": return compilePipe(modulesStore, ast.expressions, ast.expressions.length - 1);
        case "binary-operator": return `${compileOne(modulesStore, ast.left)} ${ast.operator} ${compileOne(modulesStore, ast.right)}`;
        case "if-else-expression": return `(${compileOne(modulesStore, ast.ifCondition)}) ? (${compileOne(modulesStore, ast.ifResult)}) : (${ast.elseResult == null ? NIL : compileOne(modulesStore, ast.elseResult)})`;
        case "switch-expression": return '(' + ast.cases.map(({ match, outcome }) => `(${compileOne(modulesStore, ast.value)} === ${compileOne(modulesStore, match)}) ? (${compileOne(modulesStore, outcome)}) :`).join('\n')
                                        + (ast.defaultCase ? compileOne(modulesStore, ast.defaultCase) : NIL) + ')'
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

        default:
            throw Error("Couldn't compile '" + ast.kind + "'");
    }

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
// const SENTINEL_OBJ = HIDDEN_IDENTIFIER_PREFIX + "sentinel";

function compileProc(modulesStore: ModulesStore, proc: Proc): string {
    const mutableLocals = Object.entries(modulesStore.getScopeFor(proc.body).values)
        .filter(e => e[1].mutability === "all");

    return `(${proc.type.args.map(arg => `${arg.name.name}: ${compileTypeExpression(arg.type)}`).join(', ')}): void => {
    ${mutableLocals.length > 0 ? // TODO: Handle ___locals for parent closures
`    const ${LOCALS_OBJ}: {${mutableLocals.map(e => `${e[0]}?: ${compileTypeExpression(e[1].declaredType ?? UNKNOWN_TYPE)}`).join(",")}} = ${HIDDEN_IDENTIFIER_PREFIX}observable({});
    
`
    : ``}${proc.body.statements.map(s => compileOne(modulesStore, s) + ';').join("\n")}
}`;
}
// TODO: dispose of reactions somehow... at some point...

const compileFunc = (modulesStore: ModulesStore, func: Func): string => {
    const signature = `(${func.type.args.map(arg => `${arg.name.name}: ${compileTypeExpression(arg.type)}`).join(', ')})${func.type.returnType.kind !== 'unknown-type' ? `: ${compileTypeExpression(func.type.returnType)}` : ''} => `;
    const body = compileOne(modulesStore, func.body);

    if (func.consts.length > 0) {
        const consts = func.consts.map(c => `    const ${c.name.name}${c.type ? ': ' + compileTypeExpression(c.type) : ""} = ${compileOne(modulesStore, c.value)};\n`).join('')

        return `${signature} {\n${consts}\n    return ${body};\n}`
    } else {
        return signature + body
    }
}

function compileClassProperty(modulesStore: ModulesStore, ast: ClassProperty): string {
    const typeDeclaration = ast.type ? ': ' + compileTypeExpression(ast.type) : ''

    if (ast.access === "visible") {
        return `    private _${ast.name.name}${typeDeclaration} = ${compileOne(modulesStore, ast.value)};\n` +
               `    public get ${ast.name.name}() {\n` +
               `        return this._${ast.name.name};\n` +
               `    }\n` +
               `    private set ${ast.name.name}(val${typeDeclaration}) {\n` +
               `        this._${ast.name.name} = val;\n` +
               `    }\n`
    } else {
        return `    ${ast.access} ${ast.name.name}${typeDeclaration} = ${compileOne(modulesStore, ast.value)};`
    }
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
        case "proc-type": return `(${expr.args.map(arg => `${arg.name.name}: ${compileTypeExpression(arg.type)}`).join(', ')}) => void`;
        case "func-type": return `(${expr.args.map(arg => `${arg.name.name}: ${compileTypeExpression(arg.type)}`).join(', ')}) => ${compileTypeExpression(expr.returnType)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${expr.entries
            .map(([ key, value ]) => `${key.name}: ${compileTypeExpression(value)}`)
            .join(", ")}}`;
        case "indexer-type": return `{[key: ${compileTypeExpression(expr.keyType)}]: ${compileTypeExpression(expr.valueType)}}`;
        case "array-type": return `${compileTypeExpression(expr.element)}[]`;
        case "tuple-type": return `[${expr.members.map(compileTypeExpression).join(", ")}]`;
        case "iterator-type": return `${HIDDEN_IDENTIFIER_PREFIX}Iter<${compileTypeExpression(expr.itemType)}>`;
        case "plan-type": return `${HIDDEN_IDENTIFIER_PREFIX}Plan<${compileTypeExpression(expr.resultType)}>`;
        // HUGE HACK but should be fine in practice...
        case "literal-type": return `${compileOne(undefined as any, expr.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `null | undefined`;
        case "unknown-type": return `unknown`;
    }

    throw Error(`Compilation logic for type expression of kind '${expr.kind}' is unspecified`)
}