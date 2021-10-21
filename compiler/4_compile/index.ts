import { pathIsRemote } from "../3_checking/scopescan.ts";
import { path } from "../deps.ts";
import { cachedModulePath, given } from "../utils.ts";
import { Module, AST } from "../_model/ast.ts";
import { getScopeFor, ParentsMap, PlainIdentifier, ScopesMap } from "../_model/common.ts";
import { ClassProperty, TestExprDeclaration, TestBlockDeclaration } from "../_model/declarations.ts";
import { Expression, Proc, Func } from "../_model/expressions.ts";
import { TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export function compile(parents: ParentsMap, scopes: ScopesMap, module: Module, modulePath: string, includeTests?: boolean): string {
    const runtimeCode = module.declarations
        .filter(decl => decl.kind !== 'test-expr-declaration' && decl.kind !== 'test-block-declaration')
        .map(decl => compileOne(parents, scopes, modulePath, decl))
        .join("\n\n") + (module.hasMain ? "\nsetTimeout(main, 0);\n" : "");

    if (includeTests) {
        return runtimeCode + `\n export const tests = {
            testExprs: [${
                module.declarations
                    .filter(decl => decl.kind === "test-expr-declaration")
                    // @ts-ignore
                    .map((decl: TestExprDeclaration) => 
                        `{ name: '${decl.name.value}', expr: ${compileOne(parents, scopes, modulePath, decl.expr)} }`)
                    .join(',\n')
            }],
            testBlocks: [${
                module.declarations
                    .filter(decl => decl.kind === "test-block-declaration")
                    // @ts-ignore
                    .map((decl: TestBlockDeclaration) => 
                        `{ name: '${decl.name.value}', block: () => ${compileOne(parents, scopes, modulePath, decl.block)} }`)
                    .join(',\n')
            }]
        }`
    } else {
        return runtimeCode
    }
}

function compileOne(parents: ParentsMap, scopes: ScopesMap, module: string, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(parents, scopes, module, name) + (alias ? ` as ${compileOne(parents, scopes, module, alias)}` : ``)
        ).join(", ")} } from "${pathIsRemote(ast.path.value) ? (path.relative(path.dirname(module), cachedModulePath(ast.path.value)).replaceAll(/\\/g, '/') + '.ts') : (ast.path.value + '.bgl.ts')}";`;
        case "type-declaration":  return (ast.exported ? `export ` : ``) + `type ${ast.name.name} = ${compileOne(parents, scopes, module, ast.type)};`;
        case "proc-declaration":
        case "func-declaration":  return (ast.exported ? `export ` : ``) + `const ${ast.name.name} = ` + compileOne(parents, scopes, module, ast.value) + ';';
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(parents, scopes, module, ast.name)}${ast.type ? `: ${compileOne(parents, scopes, module, ast.type)}` : ''} = ${compileOne(parents, scopes, module, ast.value)};`;
        case "class-declaration": return (ast.exported ? `export ` : ``) + `class ${compileOne(parents, scopes, module, ast.name)} {\n${ast.members.map(m => compileOne(parents, scopes, module, m)).join('\n')}\n}`;
        case "class-property": return  compileClassProperty(parents, scopes, module, ast)
        case "class-function":
        case "class-procedure": return `    ${ast.access} readonly ${ast.name.name} = ${compileOne(parents, scopes, module, ast.value)}`
        case "let-declaration": return `${LOCALS_OBJ}["${ast.name.name}"] = ${compileOne(parents, scopes, module, ast.value)}`;
        case "assignment": return `${compileOne(parents, scopes, module, ast.target)} = ${compileOne(parents, scopes, module, ast.value)}`;
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${compileOne(parents, scopes, module, condition)}) ${compileOne(parents, scopes, module, outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${compileOne(parents, scopes, module, ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${compileOne(parents, scopes, module, ast.itemIdentifier)} of ${compileOne(parents, scopes, module, ast.iterator)}) ${compileOne(parents, scopes, module, ast.body)}`;
        case "while-loop": return `while (${compileOne(parents, scopes, module, ast.condition)}) ${compileOne(parents, scopes, module, ast.body)}`;
        case "proc": return compileProc(parents, scopes, module, ast);
        case "func": return compileFunc(parents, scopes, module, ast);
        case "pipe":
        case "invocation": return `${compileOne(parents, scopes, module, ast.subject)}${ast.kind === "invocation" && ast.typeArgs && ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(p => compileOne(parents, scopes, module, p)).join(',')}>` : ''}(${ast.args.map(arg => compileOne(parents, scopes, module, arg)).join(', ')})`;
        case "binary-operator": return `(${compileOne(parents, scopes, module, ast.base)} ${ast.ops.map(([op, expr]) => compileOne(parents, scopes, module, op) + ' ' + compileOne(parents, scopes, module, expr)).join(' ')})`;
        case "operator": return ast.op;
        case "if-else-expression":
        case "switch-expression": return '(' + ast.cases
            .map(({ condition, outcome }) => 
                (ast.kind === "if-else-expression"
                    ? compileOne(parents, scopes, module, condition)
                    : compileOne(parents, scopes, module, ast.value) + ' === ' + compileOne(parents, scopes, module, condition))
                + ` ? ${compileOne(parents, scopes, module, outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? compileOne(parents, scopes, module, ast.defaultCase) : NIL) + ')'
        case "range": return `${HIDDEN_IDENTIFIER_PREFIX}range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(parents, scopes, module, ast.inner)})`;
        case "debug": return compileOne(parents, scopes, module, ast.inner);
        case "property-accessor": return `${compileOne(parents, scopes, module, ast.subject)}.${compileOne(parents, scopes, module, ast.property)}`;
        case "plain-identifier": return ast.name;
        case "local-identifier": return getScopeFor(parents, scopes, ast).values[ast.name]?.mutability === "all" ? `${LOCALS_OBJ}["${ast.name}"]` : ast.name;
        case "object-literal":  return `{${objectEntries(parents, scopes, module, ast.entries)}}`;
        case "array-literal":   return `[${ast.entries.map(e => compileOne(parents, scopes, module, e)).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment
                                                : '${' + compileOne(parents, scopes, module, segment) + '}').join("")}\``;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "reaction": return `${HIDDEN_IDENTIFIER_PREFIX}reactionUntil(
${compileOne(parents, scopes, module, ast.data)},
${compileOne(parents, scopes, module, ast.effect)},
${given(ast.until, until => compileOne(parents, scopes, module, until))})`;
        case "computation": return `const ${ast.name.name} = ${HIDDEN_IDENTIFIER_PREFIX}computed(() => ${compileOne(parents, scopes, module, ast.expression)})`;
        case "indexer": return `${compileOne(parents, scopes, module, ast.subject)}[${compileOne(parents, scopes, module, ast.indexer)}]`;
        case "block": return `{ ${ast.statements.map(s => compileOne(parents, scopes, module, s)).join("; ")}; }`;
        case "element-tag": return `${HIDDEN_IDENTIFIER_PREFIX}h('${ast.tagName.name}',{${
            objectEntries(parents, scopes, module, (ast.attributes as [PlainIdentifier, Expression|Expression[]][]))}}, ${ast.children.map(c => compileOne(parents, scopes, module, c)).join(', ')})`;
        case "class-construction": return `new ${ast.clazz.name}()`;
        case "union-type": return ast.members.map(m => compileOne(parents, scopes, module, m)).join(" | ");
        case "named-type": return ast.name.name;
        case "proc-type": return `(${compileArgs(parents, scopes, module, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(parents, scopes, module, ast.args)}) => ${compileOne(parents, scopes, module, ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${ast.entries
            .map(({ name, type }) => `${name.name}: ${compileOne(parents, scopes, module, type)}`)
            .join(", ")}}`;
        case "indexer-type": return `{[key: ${compileOne(parents, scopes, module, ast.keyType)}]: ${compileOne(parents, scopes, module, ast.valueType)}}`;
        case "array-type": return `${compileOne(parents, scopes, module, ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(m => compileOne(parents, scopes, module, m)).join(", ")}]`;
        case "iterator-type": return `${HIDDEN_IDENTIFIER_PREFIX}Iter<${compileOne(parents, scopes, module, ast.itemType)}>`;
        case "plan-type": return `${HIDDEN_IDENTIFIER_PREFIX}Plan<${compileOne(parents, scopes, module, ast.resultType)}>`;
        case "literal-type": return `${compileOne(parents, scopes, module, ast.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `null | undefined`;
        case "unknown-type": return `unknown`;

        default:
            throw Error("Couldn't compile '" + ast.kind + "'");
    }

}

function objectEntries(parents: ParentsMap, scopes: ScopesMap, module: string, entries: readonly (readonly [PlainIdentifier, Expression | readonly Expression[]])[]): string {
    return entries
        .map(([ key, value ]) => `${compileOne(parents, scopes, module, key)}: ${Array.isArray(value) ? value.map(c => compileOne(parents, scopes, module, c)) : compileOne(parents, scopes, module, value as Expression)}`)
        .join(", ")
}

// TODO: Forbid this in user-defined identifers
export const HIDDEN_IDENTIFIER_PREFIX = `___`;

const NIL = `undefined`;
const LOCALS_OBJ = HIDDEN_IDENTIFIER_PREFIX + "locals";
// const SENTINEL_OBJ = HIDDEN_IDENTIFIER_PREFIX + "sentinel";

function compileProc(parents: ParentsMap, scopes: ScopesMap, module: string, proc: Proc): string {
    const mutableLocals = Object.entries(getScopeFor(parents, scopes, proc.body).values)
        .filter(e => e[1].mutability === "all");

    return (proc.type.typeParams.length > 0 ? `<${proc.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(parents, scopes, module, proc.type.args)}): void => {
    ${mutableLocals.length > 0 ? // TODO: Handle ___locals for parent closures
`    const ${LOCALS_OBJ}: {${mutableLocals.map(e => `${e[0]}?: ${compileOne(parents, scopes, module, e[1].declaredType ?? UNKNOWN_TYPE)}`).join(",")}} = ${HIDDEN_IDENTIFIER_PREFIX}observable({});
    
`
    : ``}${proc.body.statements.map(s => compileOne(parents, scopes, module, s) + ';').join("\n")}
}`;
}
// TODO: dispose of reactions somehow... at some point...

const compileFunc = (parents: ParentsMap, scopes: ScopesMap, module: string, func: Func): string => {
    const signature = (func.type.typeParams.length > 0 ? `<${func.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(parents, scopes, module, func.type.args)})${func.type.returnType != null ? `: ${compileOne(parents, scopes, module, func.type.returnType)}` : ''} => `;
    const body = compileOne(parents, scopes, module, func.body);

    if (func.consts.length > 0) {
        const consts = func.consts.map(c => `    const ${c.name.name}${c.type ? ': ' + compileOne(parents, scopes, module, c.type) : ""} = ${compileOne(parents, scopes, module, c.value)};\n`).join('')

        return `${signature} {\n${consts}\n    return ${body};\n}`
    } else {
        return signature + body
    }
}

function compileClassProperty(parents: ParentsMap, scopes: ScopesMap, module: string, ast: ClassProperty): string {
    const typeDeclaration = ast.type ? ': ' + compileOne(parents, scopes, module, ast.type) : ''

    if (ast.access === "visible") {
        return `    private _${ast.name.name}${typeDeclaration} = ${compileOne(parents, scopes, module, ast.value)};\n` +
               `    public get ${ast.name.name}() {\n` +
               `        return this._${ast.name.name};\n` +
               `    }\n` +
               `    private set ${ast.name.name}(val${typeDeclaration}) {\n` +
               `        this._${ast.name.name} = val;\n` +
               `    }\n`
    } else {
        return `    ${ast.access} ${ast.name.name}${typeDeclaration} = ${compileOne(parents, scopes, module, ast.value)};`
    }
}

function compileArgs(parents: ParentsMap, scopes: ScopesMap, module: string, args: readonly { readonly name: PlainIdentifier, readonly type?: TypeExpression}[]): string {
    return args.map(arg => arg.name.name + (arg.type ? `: ${compileOne(parents, scopes, module, arg.type)}` : '')).join(', ')
}