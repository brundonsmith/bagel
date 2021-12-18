import { path } from "../deps.ts";
import { cachedModulePath, given, ModuleName, pathIsRemote } from "../utils.ts";
import { Module, AST } from "../_model/ast.ts";
import { Block, GetBinding, getBindingMutability, PlainIdentifier } from "../_model/common.ts";
import { TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, StoreDeclaration, StoreFunction, StoreProperty } from "../_model/declarations.ts";
import { Expression, Proc, Func, Spread } from "../_model/expressions.ts";
import { LetDeclaration } from "../_model/statements.ts";
import { Arg, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export function compile(getBinding: GetBinding, module: Module, modulePath: ModuleName, includeTests?: boolean): string {
    const runtimeCode = module.declarations
        .filter(decl => decl.kind !== 'test-expr-declaration' && decl.kind !== 'test-block-declaration')
        .map(decl => compileOne(getBinding, modulePath, decl))
        .join("\n\n") + (module.hasMain ? "\nsetTimeout(main, 0);\n" : "");

    if (includeTests) {
        return runtimeCode + `\n export const tests = {
            testExprs: [${
                module.declarations
                    .filter(decl => decl.kind === "test-expr-declaration")
                    // @ts-ignore
                    .map((decl: TestExprDeclaration) => 
                        `{ name: '${decl.name.value}', expr: ${compileOne(getBinding, modulePath, decl.expr)} }`)
                    .join(',\n')
            }],
            testBlocks: [${
                module.declarations
                    .filter(decl => decl.kind === "test-block-declaration")
                    // @ts-ignore
                    .map((decl: TestBlockDeclaration) => 
                        `{ name: '${decl.name.value}', block: () => ${compileOne(getBinding, modulePath, decl.block)} }`)
                    .join(',\n')
            }]
        }`
    } else {
        return runtimeCode
    }
}

function compileOne(getBinding: GetBinding, module: string, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(getBinding, module, name) + (alias ? ` as ${compileOne(getBinding, module, alias)}` : ``)
        ).join(", ")} } from "${pathIsRemote(ast.path.value) ? (path.relative(path.dirname(module), cachedModulePath(ast.path.value as ModuleName)).replaceAll(/\\/g, '/') + '.ts') : (ast.path.value + '.bgl.ts')}";`;
        case "type-declaration":  return (ast.exported ? `export ` : ``) + `type ${ast.name.name} = ${compileOne(getBinding, module, ast.type)};`;
        case "proc-declaration":  return (ast.exported ? `export ` : ``) + `const ${ast.name.name} = ` + compileOne(getBinding, module, ast.value) + ';';
        case "func-declaration":  return compileFuncDeclaration(getBinding, module, ast)
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(getBinding, module, ast.name)}${ast.type ? `: ${compileOne(getBinding, module, ast.type)}` : ''} = ${compileOne(getBinding, module, ast.value)};`;
        case "store-declaration": return compileStoreDeclaration(getBinding, module, ast);
        case "store-property": return  compileStoreProperty(getBinding, module, ast)
        case "store-procedure": return `    ${ast.access} readonly ${ast.name.name} = ${compileOne(getBinding, module, ast.value)}`
        case "store-function": return  '    ' + compileFuncDeclaration(getBinding, module, ast)
        case "let-declaration":  return `${LOCALS_OBJ}["${ast.name.name}"] = ${compileOne(getBinding, module, ast.value)}`;
        case "const-declaration-statement": return `const ${ast.name.name} = ${compileOne(getBinding, module, ast.value)}`;
        case "assignment": return `${compileOne(getBinding, module, ast.target)} = ${compileOne(getBinding, module, ast.value)}`;
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${compileOne(getBinding, module, condition)}) ${compileOne(getBinding, module, outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${compileOne(getBinding, module, ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${compileOne(getBinding, module, ast.itemIdentifier)} of ${compileOne(getBinding, module, ast.iterator)}[${INT}INNER_ITER]) ${compileOne(getBinding, module, ast.body)}`;
        case "while-loop": return `while (${compileOne(getBinding, module, ast.condition)}) ${compileOne(getBinding, module, ast.body)}`;
        case "proc": return compileProc(getBinding, module, ast);
        case "func": return compileFunc(getBinding, module, ast);
        case "inline-const": return `${INT}withConst(${compileOne(getBinding, module, ast.value)}, ${ast.name.name} =>
            ${compileOne(getBinding, module, ast.next)})`
        case "pipe":
        case "invocation": return `${compileOne(getBinding, module, ast.subject)}${ast.kind === "invocation" && ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(p => compileOne(getBinding, module, p)).join(',')}>` : ''}(${ast.args.map(arg => compileOne(getBinding, module, arg)).join(', ')})`;
        case "binary-operator": return `(${compileOne(getBinding, module, ast.base)} ${ast.ops.map(([op, expr]) => compileOne(getBinding, module, op) + ' ' + compileOne(getBinding, module, expr)).join(' ')})`;
        case "negation-operator": return `!(${compileOne(getBinding, module, ast.base)})`;
        case "operator": return ast.op;
        case "if-else-expression":
        case "switch-expression": return '(' + ast.cases
            .map(({ condition, outcome }) => 
                (ast.kind === "if-else-expression"
                    ? compileOne(getBinding, module, condition)
                    : compileOne(getBinding, module, ast.value) + ' === ' + compileOne(getBinding, module, condition))
                + ` ? ${compileOne(getBinding, module, outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? compileOne(getBinding, module, ast.defaultCase) : NIL) + ')'
        case "range": return `${INT}range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(getBinding, module, ast.inner)})`;
        case "debug": return compileOne(getBinding, module, ast.inner);
        case "property-accessor": return `${compileOne(getBinding, module, ast.subject)}.${compileOne(getBinding, module, ast.property)}`;
        case "plain-identifier": return ast.name;
        case "local-identifier": {
            const binding = getBinding(() => {}, ast)

            if (binding && binding.kind !== 'type-binding' && getBindingMutability(binding) === 'assignable') {
                return `${LOCALS_OBJ}["${ast.name}"]`
            } else {
                return ast.name
            }
        }
        case "object-literal":  return `{${objectEntries(getBinding, module, ast.entries)}}`;
        case "array-literal":   return `[${ast.entries.map(
            e => e.kind === 'spread' 
                ? `...${compileOne(getBinding, module, e.expr)}`
                : compileOne(getBinding, module, e)).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment
                                                : '${' + compileOne(getBinding, module, segment) + '}').join("")}\``;
        case "spread": return `...${compileOne(getBinding, module, ast.expr)}`;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "reaction": return `${INT}reactionUntil(
${compileOne(getBinding, module, ast.data)},
${compileOne(getBinding, module, ast.effect)},
${given(ast.until, until => compileOne(getBinding, module, until))})`;
        case "indexer": return `${compileOne(getBinding, module, ast.subject)}[${compileOne(getBinding, module, ast.indexer)}]`;
        case "block": return `{ ${blockContents(getBinding, module, ast)}; }`;
        case "element-tag": return `${INT}h('${ast.tagName.name}',{${
            objectEntries(getBinding, module, (ast.attributes as ([PlainIdentifier, Expression|Expression[]] | Spread)[]))}}, ${ast.children.map(c => compileOne(getBinding, module, c)).join(', ')})`;
        case "union-type": return ast.members.map(m => compileOne(getBinding, module, m)).join(" | ");
        case "named-type": return ast.name.name;
        case "proc-type": return `(${compileArgs(getBinding, module, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(getBinding, module, ast.args)}) => ${compileOne(getBinding, module, ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${
            ast.spreads
            .map(s => '...' + compileOne(getBinding, module, s))
            .concat(
                ast.entries
                .map(({ name, type }) => `${name.name}: ${compileOne(getBinding, module, type)}`)
            )
            .join(', ')}}`;
        case "indexer-type": return `{[key: ${compileOne(getBinding, module, ast.keyType)}]: ${compileOne(getBinding, module, ast.valueType)}}`;
        case "array-type": return `${compileOne(getBinding, module, ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(m => compileOne(getBinding, module, m)).join(", ")}]`;
        case "iterator-type": return `${INT}Iter<${compileOne(getBinding, module, ast.itemType)}>`;
        case "plan-type": return `${INT}Plan<${compileOne(getBinding, module, ast.resultType)}>`;
        case "literal-type": return `${compileOne(getBinding, module, ast.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `null | undefined`;
        case "unknown-type": return `unknown`;

        default:
            throw Error("Couldn't compile '" + ast.kind + "'");
    }

}

function blockContents(getBinding: GetBinding, module: string, block: Block) {
    return block.statements.map(s => compileOne(getBinding, module, s)).join("; ")
}

function objectEntries(getBinding: GetBinding, module: string, entries: readonly (readonly [PlainIdentifier, Expression | readonly Expression[]]|Spread)[]): string {
    return entries
        .map(entry => 
            Array.isArray(entry)
                ? `${compileOne(getBinding, module, entry[0])}: ${
                    Array.isArray(entry[1]) 
                        ? entry[1].map(c => compileOne(getBinding, module, c)) 
                        : compileOne(getBinding, module, entry[1] as Expression)}`
                : compileOne(getBinding, module, entry as Spread))
        .join(", ")
}

// TODO: Forbid this in user-defined identifers
export const INT = `___`;

const NIL = `undefined`;
const LOCALS_OBJ = INT + "locals";

function compileProc(getBinding: GetBinding, module: string, proc: Proc): string {
    const letDeclarations = proc.body.statements.filter(s => s.kind === "let-declaration") as LetDeclaration[]


    return (proc.type.typeParams.length > 0 ? `<${proc.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(getBinding, module, proc.type.args)}): void => {
    ${letDeclarations.length > 0 ? // TODO: Handle ___locals for parent closures
`    const ${LOCALS_OBJ}: {${
        letDeclarations
            .map(e => 
                `${e.name.name}?: any`)
            .join(",")
    }} = ${INT}observable({});
    
`
    : ``}${proc.body.statements.map(s => compileOne(getBinding, module, s) + ';').join("\n")}
}`;
}

const compileFuncDeclaration = (getBinding: GetBinding, module: string, decl: FuncDeclaration|StoreFunction): string => {
    const signature = compileFuncSignature(getBinding, module, decl.value)
    const body = compileOne(getBinding, module, decl.value.body)
    
    const prefix = decl.kind === "func-declaration" 
        ? (decl.exported ? `export ` : ``) + 'const' 
        : (decl.access + ' readonly')

    if (decl.memo) {
        return `${prefix} ${decl.name.name} = ${INT}computedFn(` + signature + ' => ' + body + ', { requiresReaction: false });';
    } else {
        return `${prefix} ${decl.name.name} = ` + signature + ' => ' + body + ';';
    }
}

const compileFunc = (getBinding: GetBinding, module: string, func: Func): string => {
    const signature = compileFuncSignature(getBinding, module, func)
    const body = compileOne(getBinding, module, func.body)

    return signature + ' => ' + body
}

const compileFuncSignature = (getBinding: GetBinding, module: string, func: Func): string => {
    return (func.type.typeParams.length > 0 ? `<${func.type.typeParams.map(p => p.name).join(',')}>` : '')
        + `(${compileArgs(getBinding, module, func.type.args)})${func.type.returnType != null ? `: ${compileOne(getBinding, module, func.type.returnType)}` : ''}`;
}

// TODO: Bring this back as an optimization
// const compileFuncBody = (getBinding: GetBinding, module: string, func: Func): string => {
//     const bodyExpr = compileOne(getBinding, module, func.body);

//     return func.consts.length === 0
//         ? bodyExpr
//         : ' {\n' + 
//             func.consts
//                 .map(c => `    const ${c.name.name}${c.type ? ': ' + compileOne(getBinding, module, c.type) : ""} = ${compileOne(getBinding, module, c.value)};\n`)
//                 .join('') +
//             `\n    return ${bodyExpr};\n}`
// }

function compileStoreDeclaration(getBinding: GetBinding, module: string, store: StoreDeclaration) {
    return `class ${INT}${store.name.name} {
        
        constructor() {
            ${INT}makeObservable(this, {
                ${store.members.map(member =>
                    member.kind === "store-property" ?
                        `${member.access === "visible" ? INT : ''}${member.name.name}: ${INT}observable`
                    : '').filter(s => !!s).join(', ')}
            });
        }
        
        ${store.members.map(m =>
            compileOne(getBinding, module, m)).join('\n')}
        
    };
    ${store.exported ? 'export ' : ''}const ${store.name.name} = new ${INT}${store.name.name}();`
}

function compileStoreProperty(getBinding: GetBinding, module: string, ast: StoreProperty): string {
    const typeDeclaration = ast.type ? ': ' + compileOne(getBinding, module, ast.type) : ''

    if (ast.access === "visible") {
        return `    private ${INT}${ast.name.name}${typeDeclaration} = ${compileOne(getBinding, module, ast.value)};\n` +
               `    public get ${ast.name.name}() {\n` +
               `        return this.${INT}${ast.name.name};\n` +
               `    }\n` +
               `    private set ${ast.name.name}(val${typeDeclaration}) {\n` +
               `        this.${INT}${ast.name.name} = val;\n` +
               `    }\n`
    } else {
        return `    ${ast.access} ${ast.name.name}${typeDeclaration} = ${compileOne(getBinding, module, ast.value)};`
    }
}

function compileArgs(getBinding: GetBinding, module: string, args: readonly Arg[]): string {
    return args.map(arg => compileOneArg(getBinding, module, arg)).join(', ')
}

function compileOneArg(getBinding: GetBinding, module: string, arg: Arg): string {
    return arg.name.name + (arg.type ? `: ${compileOne(getBinding, module, arg.type)}` : '')
}