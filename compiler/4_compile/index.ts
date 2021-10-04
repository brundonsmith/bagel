import { ModulesStore } from "../3_checking/modules-store.ts";
import { given } from "../utils.ts";
import { Module, AST } from "../_model/ast.ts";
import { getScopeFor, PlainIdentifier } from "../_model/common.ts";
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
        case "type-declaration": return (ast.exported ? `export ` : ``) + `type ${ast.name.name} = ${compileOne(modulesStore, ast.type)};`;
        case "proc-declaration":
        case "func-declaration": return (ast.exported ? `export ` : ``) + `const ${ast.name.name} = ` + compileOne(modulesStore, ast.value) + ';';
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(modulesStore, ast.name)}${ast.type ? `: ${compileOne(modulesStore, ast.type)}` : ''} = ${compileOne(modulesStore, ast.value)};`;
        case "class-declaration": return (ast.exported ? `export ` : ``) + `class ${compileOne(modulesStore, ast.name)} {\n${ast.members.map(m => compileOne(modulesStore, m)).join('\n')}\n}`;
        case "class-property": return  compileClassProperty(modulesStore, ast)
        case "class-function":
        case "class-procedure": return `    ${ast.access} readonly ${ast.name.name} = ${compileOne(modulesStore, ast.value)}`
        case "let-declaration": return `${LOCALS_OBJ}["${ast.name.name}"] = ${compileOne(modulesStore, ast.value)}`;
        case "assignment": return `${compileOne(modulesStore, ast.target)} = ${compileOne(modulesStore, ast.value)}`;
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${compileOne(modulesStore, condition)}) ${compileOne(modulesStore, outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${compileOne(modulesStore, ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${compileOne(modulesStore, ast.itemIdentifier)} of ${compileOne(modulesStore, ast.iterator)}) ${compileOne(modulesStore, ast.body)}`;
        case "while-loop": return `while (${compileOne(modulesStore, ast.condition)}) ${compileOne(modulesStore, ast.body)}`;
        case "proc": return compileProc(modulesStore, ast);
        case "func": return compileFunc(modulesStore, ast);
        case "pipe":
        case "invocation": return `${compileOne(modulesStore, ast.subject)}${ast.kind === "invocation" && ast.typeArgs && ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(p => compileOne(modulesStore, p)).join(',')}>` : ''}(${ast.args.map(arg => compileOne(modulesStore, arg)).join(', ')})`;
        case "binary-operator": return `${compileOne(modulesStore, ast.args[0])} ${ast.operator} ${compileOne(modulesStore, ast.args[1])}`;
        case "if-else-expression":
        case "switch-expression": return '(' + ast.cases
            .map(({ condition, outcome }) => 
                (ast.kind === "if-else-expression"
                    ? compileOne(modulesStore, condition)
                    : compileOne(modulesStore, ast.value) + ' === ' + compileOne(modulesStore, condition))
                + ` ? ${compileOne(modulesStore, outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? compileOne(modulesStore, ast.defaultCase) : NIL) + ')'
        case "range": return `${HIDDEN_IDENTIFIER_PREFIX}range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(modulesStore, ast.inner)})`;
        case "property-accessor": return `${compileOne(modulesStore, ast.subject)}.${compileOne(modulesStore, ast.property)}`;
        case "plain-identifier": return ast.name;
        case "local-identifier": return getScopeFor(modulesStore, ast).values[ast.name]?.mutability === "all" ? `${LOCALS_OBJ}["${ast.name}"]` : ast.name;
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
${given(ast.until, until => compileOne(modulesStore, until))})`;
        case "computation": return `const ${ast.name.name} = ${HIDDEN_IDENTIFIER_PREFIX}computed(() => ${compileOne(modulesStore, ast.expression)})`;
        case "indexer": return `${compileOne(modulesStore, ast.subject)}[${compileOne(modulesStore, ast.indexer)}]`;
        case "block": return `{ ${ast.statements.map(s => compileOne(modulesStore, s)).join("; ")}; }`;
        case "element-tag": return `${HIDDEN_IDENTIFIER_PREFIX}h('${ast.tagName.name}',{${
            objectEntries(modulesStore, (ast.attributes as [PlainIdentifier, Expression|Expression[]][]))}}, ${ast.children.map(c => compileOne(modulesStore, c)).join(', ')})`;
        case "class-construction": return `new ${ast.clazz.name}()`;
        case "union-type": return ast.members.map(m => compileOne(modulesStore, m)).join(" | ");
        case "named-type": return ast.name.name;
        case "proc-type": return `(${compileArgs(modulesStore, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(modulesStore, ast.args)}) => ${compileOne(modulesStore, ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${ast.entries
            .map(([ key, value ]) => `${key.name}: ${compileOne(modulesStore, value)}`)
            .join(", ")}}`;
        case "indexer-type": return `{[key: ${compileOne(modulesStore, ast.keyType)}]: ${compileOne(modulesStore, ast.valueType)}}`;
        case "array-type": return `${compileOne(modulesStore, ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(m => compileOne(modulesStore, m)).join(", ")}]`;
        case "iterator-type": return `${HIDDEN_IDENTIFIER_PREFIX}Iter<${compileOne(modulesStore, ast.itemType)}>`;
        case "plan-type": return `${HIDDEN_IDENTIFIER_PREFIX}Plan<${compileOne(modulesStore, ast.resultType)}>`;
        // HUGE HACK but should be fine in practice...
        case "literal-type": return `${compileOne(undefined as any, ast.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `null | undefined`;
        case "unknown-type": return `unknown`;

        default:
            throw Error("Couldn't compile '" + ast.kind + "'");
    }

}

function objectEntries(modulesStore: ModulesStore, entries: readonly (readonly [PlainIdentifier, Expression | readonly Expression[]])[]): string {
    return entries
        .map(([ key, value ]) => `${compileOne(modulesStore, key)}: ${Array.isArray(value) ? value.map(c => compileOne(modulesStore, c)) : compileOne(modulesStore, value as Expression)}`)
        .join(", ")
}

// TODO: Forbid this in user-defined identifers
export const HIDDEN_IDENTIFIER_PREFIX = `___`;

const NIL = `undefined`;
const LOCALS_OBJ = HIDDEN_IDENTIFIER_PREFIX + "locals";
// const SENTINEL_OBJ = HIDDEN_IDENTIFIER_PREFIX + "sentinel";

function compileProc(modulesStore: ModulesStore, proc: Proc): string {
    const mutableLocals = Object.entries(getScopeFor(modulesStore, proc.body).values)
        .filter(e => e[1].mutability === "all");

    return (proc.type.typeParams.length > 0 ? `<${proc.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(modulesStore, proc.type.args)}): void => {
    ${mutableLocals.length > 0 ? // TODO: Handle ___locals for parent closures
`    const ${LOCALS_OBJ}: {${mutableLocals.map(e => `${e[0]}?: ${compileOne(modulesStore, e[1].declaredType ?? UNKNOWN_TYPE)}`).join(",")}} = ${HIDDEN_IDENTIFIER_PREFIX}observable({});
    
`
    : ``}${proc.body.statements.map(s => compileOne(modulesStore, s) + ';').join("\n")}
}`;
}
// TODO: dispose of reactions somehow... at some point...

const compileFunc = (modulesStore: ModulesStore, func: Func): string => {
    const signature = (func.type.typeParams.length > 0 ? `<${func.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(modulesStore, func.type.args)})${func.type.returnType != null ? `: ${compileOne(modulesStore, func.type.returnType)}` : ''} => `;
    const body = compileOne(modulesStore, func.body);

    if (func.consts.length > 0) {
        const consts = func.consts.map(c => `    const ${c.name.name}${c.type ? ': ' + compileOne(modulesStore, c.type) : ""} = ${compileOne(modulesStore, c.value)};\n`).join('')

        return `${signature} {\n${consts}\n    return ${body};\n}`
    } else {
        return signature + body
    }
}

function compileClassProperty(modulesStore: ModulesStore, ast: ClassProperty): string {
    const typeDeclaration = ast.type ? ': ' + compileOne(modulesStore, ast.type) : ''

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

function compileArgs(modulesStore: ModulesStore, args: readonly { readonly name: PlainIdentifier, readonly type?: TypeExpression}[]): string {
    return args.map(arg => arg.name.name + (arg.type ? `: ${compileOne(modulesStore, arg.type)}` : '')).join(', ')
}