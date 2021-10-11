import { given } from "../utils.ts";
import { Module, AST } from "../_model/ast.ts";
import { getScopeFor, ParentsMap, PlainIdentifier, ScopesMap } from "../_model/common.ts";
import { ClassProperty } from "../_model/declarations.ts";
import { Expression, Proc, Func } from "../_model/expressions.ts";
import { TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export function compile(parents: ParentsMap, scopes: ScopesMap, module: Module): string {
    const hasMain = module.declarations.some(decl => decl.kind === "proc-declaration" && decl.name.name === "main")
    return module.declarations
        .map(decl => compileOne(parents, scopes, decl))
        .join("\n\n") + (hasMain ? "\nsetTimeout(main, 0);\n" : "");
}

function compileOne(parents: ParentsMap, scopes: ScopesMap, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(parents, scopes, name) + (alias ? ` as ${compileOne(parents, scopes, alias)}` : ``)
        ).join(", ")} } from "${compileOne(parents, scopes, ast.path)}.bgl.ts";`;
        case "type-declaration":  return (ast.exported ? `export ` : ``) + `type ${ast.name.name} = ${compileOne(parents, scopes, ast.type)};`;
        case "proc-declaration":
        case "func-declaration":  return (ast.exported ? `export ` : ``) + `const ${ast.name.name} = ` + compileOne(parents, scopes, ast.value) + ';';
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(parents, scopes, ast.name)}${ast.type ? `: ${compileOne(parents, scopes, ast.type)}` : ''} = ${compileOne(parents, scopes, ast.value)};`;
        case "class-declaration": return (ast.exported ? `export ` : ``) + `class ${compileOne(parents, scopes, ast.name)} {\n${ast.members.map(m => compileOne(parents, scopes, m)).join('\n')}\n}`;
        case "class-property": return  compileClassProperty(parents, scopes, ast)
        case "class-function":
        case "class-procedure": return `    ${ast.access} readonly ${ast.name.name} = ${compileOne(parents, scopes, ast.value)}`
        case "let-declaration": return `${LOCALS_OBJ}["${ast.name.name}"] = ${compileOne(parents, scopes, ast.value)}`;
        case "assignment": return `${compileOne(parents, scopes, ast.target)} = ${compileOne(parents, scopes, ast.value)}`;
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${compileOne(parents, scopes, condition)}) ${compileOne(parents, scopes, outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${compileOne(parents, scopes, ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${compileOne(parents, scopes, ast.itemIdentifier)} of ${compileOne(parents, scopes, ast.iterator)}) ${compileOne(parents, scopes, ast.body)}`;
        case "while-loop": return `while (${compileOne(parents, scopes, ast.condition)}) ${compileOne(parents, scopes, ast.body)}`;
        case "proc": return compileProc(parents, scopes, ast);
        case "func": return compileFunc(parents, scopes, ast);
        case "pipe":
        case "invocation": return `${compileOne(parents, scopes, ast.subject)}${ast.kind === "invocation" && ast.typeArgs && ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(p => compileOne(parents, scopes, p)).join(',')}>` : ''}(${ast.args.map(arg => compileOne(parents, scopes, arg)).join(', ')})`;
        case "binary-operator": return `${compileOne(parents, scopes, ast.args[0])} ${ast.operator} ${compileOne(parents, scopes, ast.args[1])}`;
        case "if-else-expression":
        case "switch-expression": return '(' + ast.cases
            .map(({ condition, outcome }) => 
                (ast.kind === "if-else-expression"
                    ? compileOne(parents, scopes, condition)
                    : compileOne(parents, scopes, ast.value) + ' === ' + compileOne(parents, scopes, condition))
                + ` ? ${compileOne(parents, scopes, outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? compileOne(parents, scopes, ast.defaultCase) : NIL) + ')'
        case "range": return `${HIDDEN_IDENTIFIER_PREFIX}range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(parents, scopes, ast.inner)})`;
        case "debug": return compileOne(parents, scopes, ast.inner);
        case "property-accessor": return `${compileOne(parents, scopes, ast.subject)}.${compileOne(parents, scopes, ast.property)}`;
        case "plain-identifier": return ast.name;
        case "local-identifier": return getScopeFor(parents, scopes, ast).values[ast.name]?.mutability === "all" ? `${LOCALS_OBJ}["${ast.name}"]` : ast.name;
        case "object-literal":  return `{${objectEntries(parents, scopes, ast.entries)}}`;
        case "array-literal":   return `[${ast.entries.map(e => compileOne(parents, scopes, e)).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment
                                                : '${' + compileOne(parents, scopes, segment) + '}').join("")}\``;
        case "exact-string-literal": return `'${ast.value}'`;
        case "number-literal":  return JSON.stringify(ast.value);
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "reaction": return `${HIDDEN_IDENTIFIER_PREFIX}reactionUntil(
${compileOne(parents, scopes, ast.data)},
${compileOne(parents, scopes, ast.effect)},
${given(ast.until, until => compileOne(parents, scopes, until))})`;
        case "computation": return `const ${ast.name.name} = ${HIDDEN_IDENTIFIER_PREFIX}computed(() => ${compileOne(parents, scopes, ast.expression)})`;
        case "indexer": return `${compileOne(parents, scopes, ast.subject)}[${compileOne(parents, scopes, ast.indexer)}]`;
        case "block": return `{ ${ast.statements.map(s => compileOne(parents, scopes, s)).join("; ")}; }`;
        case "element-tag": return `${HIDDEN_IDENTIFIER_PREFIX}h('${ast.tagName.name}',{${
            objectEntries(parents, scopes, (ast.attributes as [PlainIdentifier, Expression|Expression[]][]))}}, ${ast.children.map(c => compileOne(parents, scopes, c)).join(', ')})`;
        case "class-construction": return `new ${ast.clazz.name}()`;
        case "union-type": return ast.members.map(m => compileOne(parents, scopes, m)).join(" | ");
        case "named-type": return ast.name.name;
        case "proc-type": return `(${compileArgs(parents, scopes, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(parents, scopes, ast.args)}) => ${compileOne(parents, scopes, ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${ast.entries
            .map(({ name, type }) => `${name.name}: ${compileOne(parents, scopes, type)}`)
            .join(", ")}}`;
        case "indexer-type": return `{[key: ${compileOne(parents, scopes, ast.keyType)}]: ${compileOne(parents, scopes, ast.valueType)}}`;
        case "array-type": return `${compileOne(parents, scopes, ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(m => compileOne(parents, scopes, m)).join(", ")}]`;
        case "iterator-type": return `${HIDDEN_IDENTIFIER_PREFIX}Iter<${compileOne(parents, scopes, ast.itemType)}>`;
        case "plan-type": return `${HIDDEN_IDENTIFIER_PREFIX}Plan<${compileOne(parents, scopes, ast.resultType)}>`;
        case "literal-type": return `${compileOne(parents, scopes, ast.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `null | undefined`;
        case "unknown-type": return `unknown`;

        default:
            throw Error("Couldn't compile '" + ast.kind + "'");
    }

}

function objectEntries(parents: ParentsMap, scopes: ScopesMap, entries: readonly (readonly [PlainIdentifier, Expression | readonly Expression[]])[]): string {
    return entries
        .map(([ key, value ]) => `${compileOne(parents, scopes, key)}: ${Array.isArray(value) ? value.map(c => compileOne(parents, scopes, c)) : compileOne(parents, scopes, value as Expression)}`)
        .join(", ")
}

// TODO: Forbid this in user-defined identifers
export const HIDDEN_IDENTIFIER_PREFIX = `___`;

const NIL = `undefined`;
const LOCALS_OBJ = HIDDEN_IDENTIFIER_PREFIX + "locals";
// const SENTINEL_OBJ = HIDDEN_IDENTIFIER_PREFIX + "sentinel";

function compileProc(parents: ParentsMap, scopes: ScopesMap, proc: Proc): string {
    const mutableLocals = Object.entries(getScopeFor(parents, scopes, proc.body).values)
        .filter(e => e[1].mutability === "all");

    return (proc.type.typeParams.length > 0 ? `<${proc.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(parents, scopes, proc.type.args)}): void => {
    ${mutableLocals.length > 0 ? // TODO: Handle ___locals for parent closures
`    const ${LOCALS_OBJ}: {${mutableLocals.map(e => `${e[0]}?: ${compileOne(parents, scopes, e[1].declaredType ?? UNKNOWN_TYPE)}`).join(",")}} = ${HIDDEN_IDENTIFIER_PREFIX}observable({});
    
`
    : ``}${proc.body.statements.map(s => compileOne(parents, scopes, s) + ';').join("\n")}
}`;
}
// TODO: dispose of reactions somehow... at some point...

const compileFunc = (parents: ParentsMap, scopes: ScopesMap, func: Func): string => {
    const signature = (func.type.typeParams.length > 0 ? `<${func.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(parents, scopes, func.type.args)})${func.type.returnType != null ? `: ${compileOne(parents, scopes, func.type.returnType)}` : ''} => `;
    const body = compileOne(parents, scopes, func.body);

    if (func.consts.length > 0) {
        const consts = func.consts.map(c => `    const ${c.name.name}${c.type ? ': ' + compileOne(parents, scopes, c.type) : ""} = ${compileOne(parents, scopes, c.value)};\n`).join('')

        return `${signature} {\n${consts}\n    return ${body};\n}`
    } else {
        return signature + body
    }
}

function compileClassProperty(parents: ParentsMap, scopes: ScopesMap, ast: ClassProperty): string {
    const typeDeclaration = ast.type ? ': ' + compileOne(parents, scopes, ast.type) : ''

    if (ast.access === "visible") {
        return `    private _${ast.name.name}${typeDeclaration} = ${compileOne(parents, scopes, ast.value)};\n` +
               `    public get ${ast.name.name}() {\n` +
               `        return this._${ast.name.name};\n` +
               `    }\n` +
               `    private set ${ast.name.name}(val${typeDeclaration}) {\n` +
               `        this._${ast.name.name} = val;\n` +
               `    }\n`
    } else {
        return `    ${ast.access} ${ast.name.name}${typeDeclaration} = ${compileOne(parents, scopes, ast.value)};`
    }
}

function compileArgs(parents: ParentsMap, scopes: ScopesMap, args: readonly { readonly name: PlainIdentifier, readonly type?: TypeExpression}[]): string {
    return args.map(arg => arg.name.name + (arg.type ? `: ${compileOne(parents, scopes, arg.type)}` : '')).join(', ')
}