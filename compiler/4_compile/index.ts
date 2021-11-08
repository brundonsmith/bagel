import { displayScope, log } from "../debugging.ts";
import { path } from "../deps.ts";
import { cachedModulePath, given, pathIsRemote } from "../utils.ts";
import { Module, AST } from "../_model/ast.ts";
import { AllParents, AllScopes, DeclarationDescriptor, getScopeFor, PlainIdentifier } from "../_model/common.ts";
import { ClassProperty, TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, ClassFunction, ClassDeclaration } from "../_model/declarations.ts";
import { Expression, Proc, Func } from "../_model/expressions.ts";
import { LetDeclaration, Statement } from "../_model/statements.ts";
import { Arg, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export function compile(parents: AllParents, scopes: AllScopes, module: Module, modulePath: string, includeTests?: boolean): string {
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

function compileOne(parents: AllParents, scopes: AllScopes, module: string, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(parents, scopes, module, name) + (alias ? ` as ${compileOne(parents, scopes, module, alias)}` : ``)
        ).join(", ")} } from "${pathIsRemote(ast.path.value) ? (path.relative(path.dirname(module), cachedModulePath(ast.path.value)).replaceAll(/\\/g, '/') + '.ts') : (ast.path.value + '.bgl.ts')}";`;
        case "type-declaration":  return (ast.exported ? `export ` : ``) + `type ${ast.name.name} = ${compileOne(parents, scopes, module, ast.type)};`;
        case "proc-declaration":  return (ast.exported ? `export ` : ``) + `const ${ast.name.name} = ` + compileOne(parents, scopes, module, ast.value) + ';';
        case "func-declaration":  return compileFuncDeclaration(parents, scopes, module, ast)
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(parents, scopes, module, ast.name)}${ast.type ? `: ${compileOne(parents, scopes, module, ast.type)}` : ''} = ${compileOne(parents, scopes, module, ast.value)};`;
        case "class-declaration": return (ast.exported ? `export ` : ``) + `class ${compileOne(parents, scopes, module, ast.name)} {\n\n${compileClassConstructor(ast)}\n\n${ast.members.map(m => compileOne(parents, scopes, module, m)).join('\n')}\n}`;
        case "class-property": return  compileClassProperty(parents, scopes, module, ast)
        case "class-procedure": return `    ${ast.access} readonly ${ast.name.name} = ${compileOne(parents, scopes, module, ast.value)}`
        case "class-function": return  '    ' + compileFuncDeclaration(parents, scopes, module, ast)
        case "let-declaration": return `${LOCALS_OBJ}["${ast.name.name}"] = ${compileOne(parents, scopes, module, ast.value)}`;
        case "const-declaration-statement": return `const ${ast.name.name} = ${compileOne(parents, scopes, module, ast.value)}`;
        case "assignment": return `${compileOne(parents, scopes, module, ast.target)} = ${compileOne(parents, scopes, module, ast.value)}`;
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${compileOne(parents, scopes, module, condition)}) ${compileOne(parents, scopes, module, outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${compileOne(parents, scopes, module, ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${compileOne(parents, scopes, module, ast.itemIdentifier)} of ${compileOne(parents, scopes, module, ast.iterator)}[${INT}INNER_ITER]) ${compileOne(parents, scopes, module, ast.body)}`;
        case "while-loop": return `while (${compileOne(parents, scopes, module, ast.condition)}) ${compileOne(parents, scopes, module, ast.body)}`;
        case "proc": return compileProc(parents, scopes, module, ast);
        case "func": return compileFunc(parents, scopes, module, ast);
        case "pipe":
        case "invocation": return `${compileOne(parents, scopes, module, ast.subject)}${ast.kind === "invocation" && ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(p => compileOne(parents, scopes, module, p)).join(',')}>` : ''}(${ast.args.map(arg => compileOne(parents, scopes, module, arg)).join(', ')})`;
        case "binary-operator": return `(${compileOne(parents, scopes, module, ast.base)} ${ast.ops.map(([op, expr]) => compileOne(parents, scopes, module, op) + ' ' + compileOne(parents, scopes, module, expr)).join(' ')})`;
        case "negation-operator": return `!(${compileOne(parents, scopes, module, ast.base)})`;
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
        case "range": return `${INT}range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(parents, scopes, module, ast.inner)})`;
        case "debug": return compileOne(parents, scopes, module, ast.inner);
        case "property-accessor": return `${compileOne(parents, scopes, module, ast.subject)}.${compileOne(parents, scopes, module, ast.property)}`;
        case "plain-identifier": return ast.name;
        case "local-identifier": return getScopeFor(parents, scopes, ast).values.get(ast.name)?.mutability === "all" ? `${LOCALS_OBJ}["${ast.name}"]` : ast.name;
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
        case "reaction": return `${INT}autorunUntil(
${compileOne(parents, scopes, module, ast.view)},
${given(ast.until, until => compileOne(parents, scopes, module, until))})`;
        case "indexer": return `${compileOne(parents, scopes, module, ast.subject)}[${compileOne(parents, scopes, module, ast.indexer)}]`;
        case "block": return `{ ${ast.statements.map(s => compileOne(parents, scopes, module, s)).join("; ")}; }`;
        case "element-tag": return `${INT}h('${ast.tagName.name}',{${
            objectEntries(parents, scopes, module, (ast.attributes as [PlainIdentifier, Expression|Expression[]][]))}}, ${ast.children.map(c => compileOne(parents, scopes, module, c)).join(', ')})`;
        case "class-construction": return `new ${ast.clazz.name}()`;
        case "union-type": return ast.members.map(m => compileOne(parents, scopes, module, m)).join(" | ");
        case "named-type": return ast.name.name;
        case "proc-type": return `(${compileArgs(parents, scopes, module, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(parents, scopes, module, ast.args)}) => ${compileOne(parents, scopes, module, ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${
            ast.spreads
            .map(s => '...' + compileOne(parents, scopes, module, s))
            .concat(
                ast.entries
                .map(({ name, type }) => `${name.name}: ${compileOne(parents, scopes, module, type)}`)
            )
            .join(', ')}}`;
        case "indexer-type": return `{[key: ${compileOne(parents, scopes, module, ast.keyType)}]: ${compileOne(parents, scopes, module, ast.valueType)}}`;
        case "array-type": return `${compileOne(parents, scopes, module, ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(m => compileOne(parents, scopes, module, m)).join(", ")}]`;
        case "iterator-type": return `${INT}Iter<${compileOne(parents, scopes, module, ast.itemType)}>`;
        case "plan-type": return `${INT}Plan<${compileOne(parents, scopes, module, ast.resultType)}>`;
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

function objectEntries(parents: AllParents, scopes: AllScopes, module: string, entries: readonly (readonly [PlainIdentifier, Expression | readonly Expression[]])[]): string {
    return entries
        .map(([ key, value ]) => `${compileOne(parents, scopes, module, key)}: ${Array.isArray(value) ? value.map(c => compileOne(parents, scopes, module, c)) : compileOne(parents, scopes, module, value as Expression)}`)
        .join(", ")
}

// TODO: Forbid this in user-defined identifers
export const INT = `___`;

const NIL = `undefined`;
const LOCALS_OBJ = INT + "locals";

function compileProc(parents: AllParents, scopes: AllScopes, module: string, proc: Proc): string {
    const names = proc.body.statements.filter(s => s.kind === "let-declaration") as LetDeclaration[]
    const lastStatement: Statement|undefined = proc.body.statements[proc.body.statements.length - 1]
    const mutableLocals = (
        lastStatement
            ? (() => {
                const scope = getScopeFor(parents, scopes, lastStatement)
                return names.map(local => ({
                    name: local.name.name,
                    descriptor: scope.values.get(local.name.name) as DeclarationDescriptor
                }))
            })()
            : []
    )

    return (proc.type.typeParams.length > 0 ? `<${proc.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(parents, scopes, module, proc.type.args)}): void => {
    ${mutableLocals.length > 0 ? // TODO: Handle ___locals for parent closures
`    const ${LOCALS_OBJ}: {${
        mutableLocals
            .map(e => 
                `${e.name}?: ${compileOne(parents, scopes, module, e.descriptor.declaredType ?? UNKNOWN_TYPE)}`)
            .join(",")
    }} = ${INT}observable({});
    
`
    : ``}${proc.body.statements.map(s => compileOne(parents, scopes, module, s) + ';').join("\n")}
}`;
}

const compileFuncDeclaration = (parents: AllParents, scopes: AllScopes, module: string, decl: FuncDeclaration|ClassFunction): string => {
    const signature = compileFuncSignature(parents, scopes, module, decl.value)
    const body = compileFuncBody(parents, scopes, module, decl.value)
    
    const prefix = decl.kind === "func-declaration" 
        ? (decl.exported ? `export ` : ``) + 'const' 
        : (decl.access + ' readonly')

    if (decl.memo) {
        const memoizerPrefix = decl.kind === "func-declaration" 
            ? 'const' 
            : 'private readonly'

        const memoizer = decl.value.type.args.length === 0
            ? `${memoizerPrefix} ${INT}${decl.name.name} = ${INT}computed(() => ${body});\n`
            : `${memoizerPrefix} ${INT}${decl.name.name} = ${decl.value.type.args.map(arg => 
                `${INT}createTransformer((${compileOneArg(parents, scopes, module, arg)}) => `).join('')}\n` +
                `${body}\n` +
                new Array(decl.value.type.args.length).fill(')').join('') + ';\n';

        const invocationArgs = decl.value.type.args.length === 0
            ? `.get()`
            : decl.value.type.args.map(a => `(${a.name.name})`).join('')
                
        return memoizer + `${prefix} ${decl.name.name} = ` + signature + ` => ${decl.kind === "class-function" ? 'this.' : ''}${INT}${decl.name.name}${invocationArgs};`;
    } else {
        return `${prefix} ${decl.name.name} = ` + signature + ' => ' + body + ';';
    }
}

const compileFunc = (parents: AllParents, scopes: AllScopes, module: string, func: Func): string => {
    const signature = compileFuncSignature(parents, scopes, module, func)
    const body = compileFuncBody(parents, scopes, module, func)

    return signature + ' => ' + body
}

const compileFuncSignature = (parents: AllParents, scopes: AllScopes, module: string, func: Func): string => {
    return (func.type.typeParams.length > 0 ? `<${func.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(parents, scopes, module, func.type.args)})${func.type.returnType != null ? `: ${compileOne(parents, scopes, module, func.type.returnType)}` : ''}`;
}

const compileFuncBody = (parents: AllParents, scopes: AllScopes, module: string, func: Func): string => {
    const bodyExpr = compileOne(parents, scopes, module, func.body);

    return func.consts.length === 0
        ? bodyExpr
        : ' {\n' + 
            func.consts
                .map(c => `    const ${c.name.name}${c.type ? ': ' + compileOne(parents, scopes, module, c.type) : ""} = ${compileOne(parents, scopes, module, c.value)};\n`)
                .join('') +
            `\n    return ${bodyExpr};\n}`
}


function compileClassConstructor(clazz: ClassDeclaration): string {
    return `constructor() {
        ${INT}makeObservable(this, {
            ${clazz.members.map(member =>
                member.kind === "class-property" ?
                    `${member.access === "visible" ? INT : ''}${member.name.name}: ${INT}observable`
                : '').filter(s => !!s).join(', ')}
        });
    }`
}

function compileClassProperty(parents: AllParents, scopes: AllScopes, module: string, ast: ClassProperty): string {
    const typeDeclaration = ast.type ? ': ' + compileOne(parents, scopes, module, ast.type) : ''

    if (ast.access === "visible") {
        return `    private ${INT}${ast.name.name}${typeDeclaration} = ${compileOne(parents, scopes, module, ast.value)};\n` +
               `    public get ${ast.name.name}() {\n` +
               `        return this.${INT}${ast.name.name};\n` +
               `    }\n` +
               `    private set ${ast.name.name}(val${typeDeclaration}) {\n` +
               `        this.${INT}${ast.name.name} = val;\n` +
               `    }\n`
    } else {
        return `    ${ast.access} ${ast.name.name}${typeDeclaration} = ${compileOne(parents, scopes, module, ast.value)};`
    }
}

function compileArgs(parents: AllParents, scopes: AllScopes, module: string, args: readonly Arg[]): string {
    return args.map(arg => compileOneArg(parents, scopes, module, arg)).join(', ')
}

function compileOneArg(parents: AllParents, scopes: AllScopes, module: string, arg: Arg): string {
    return arg.name.name + (arg.type ? `: ${compileOne(parents, scopes, module, arg.type)}` : '')
}