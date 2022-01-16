import Store, { canonicalModuleName, Mode } from "../store.ts";
import { cachedFilePath, jsFileLocation, pathIsRemote } from "../utils/misc.ts";
import { Module, AST, Block, PlainIdentifier } from "../_model/ast.ts";
import { getBindingMutability, ModuleName } from "../_model/common.ts";
import { TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, StoreDeclaration, StoreFunction, StoreProperty, ProcDeclaration, StoreProcedure } from "../_model/declarations.ts";
import { Expression, Proc, Func, Spread } from "../_model/expressions.ts";
import { LetDeclaration } from "../_model/statements.ts";
import { Arg, ProcType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export function compile(module: Module, modulePath: ModuleName, includeTests?: boolean, excludeTypes = false): string {
    const runtimeCode = module.declarations
        .filter(decl => decl.kind !== 'test-expr-declaration' && decl.kind !== 'test-block-declaration')
        .map(decl => compileOne(excludeTypes, modulePath, decl))
        .join("\n\n") + (module.hasMain ? "\nsetTimeout(main, 0);\n" : "");

    if (includeTests) {
        return runtimeCode + `\n export const tests = {
            testExprs: [${
                module.declarations
                    .filter(decl => decl.kind === "test-expr-declaration")
                    // @ts-ignore
                    .map((decl: TestExprDeclaration) => 
                        `{ name: '${decl.name.value}', expr: ${compileOne(excludeTypes, modulePath, decl.expr)} }`)
                    .join(',\n')
            }],
            testBlocks: [${
                module.declarations
                    .filter(decl => decl.kind === "test-block-declaration")
                    // @ts-ignore
                    .map((decl: TestBlockDeclaration) => 
                        `{ name: '${decl.name.value}', block: () => ${compileOne(excludeTypes, modulePath, decl.block)} }`)
                    .join(',\n')
            }]
        }`
    } else {
        return runtimeCode
    }
}

function compileOne(excludeTypes: boolean, module: string, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(excludeTypes, module, name) + (alias ? ` as ${compileOne(excludeTypes, module, alias)}` : ``)
        ).join(", ")} } from "${jsFileLocation(canonicalModuleName(module, ast.path.value), Store.mode as Mode).replaceAll(/\\/g, '/')}";`;
        case "type-declaration":  return (
            excludeTypes
                ? ''
                : (
                    (ast.type.kind === 'nominal-type' ?
                        `const ${INT}${ast.name.name} = Symbol('${ast.name.name}');\n${ast.exported ? `export ` : ``}function ${ast.name.name}(value: ${compileOne(excludeTypes, module, ast.type.inner)}): ${ast.name.name} { return { name: ${INT}${ast.name.name}, value } }\n`
                    : '') +
                    `${ast.exported ? `export ` : ``}type ${ast.name.name} = ${ast.type.kind === 'nominal-type'
                        ? `{ name: typeof ${INT}${ast.name.name}, value: ${compileOne(excludeTypes, module, ast.type.inner)} }`
                        : compileOne(excludeTypes, module, ast.type)};`
                )
        );
        case "proc-declaration":  return compileProcDeclaration(excludeTypes, module, ast)
        case "func-declaration":  return compileFuncDeclaration(excludeTypes, module, ast)
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(excludeTypes, module, ast.name)}${!excludeTypes && ast.type ? `: ${compileOne(excludeTypes, module, ast.type)}` : ''} = ${compileOne(excludeTypes, module, ast.value)};`;
        case "store-declaration": return compileStoreDeclaration(excludeTypes, module, ast);
        case "store-property": return  compileStoreProperty(excludeTypes, module, ast)
        case "store-procedure": return compileProcDeclaration(excludeTypes, module, ast)
        case "store-function": return  '    ' + compileFuncDeclaration(excludeTypes, module, ast);
        case "autorun-declaration": return `${INT}autorun(${compileOne(excludeTypes, module, ast.effect)})`;
        case "let-declaration":  return `${LOCALS_OBJ}["${ast.name.name}"] = ${compileOne(excludeTypes, module, ast.value)}`;
        case "const-declaration-statement": return `const ${ast.name.name} = ${compileOne(excludeTypes, module, ast.value)}`;
        case "assignment": {
            const value = compileOne(excludeTypes, module, ast.value)

            if (ast.target.kind === 'local-identifier') {
                return `${LOCALS_OBJ}['${ast.target.name}'] = ${value}; ${INT}invalidate(${LOCALS_OBJ}, ${ast.target.name})`
            } else {
                return `${compileOne(excludeTypes, module, ast.target.subject)}.${ast.target.property.name} = ${value}; ${INT}invalidate(${compileOne(excludeTypes, module, ast.target.subject)}, '${ast.target.property.name}')`
            }
        }
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${compileOne(excludeTypes, module, condition)}) ${compileOne(excludeTypes, module, outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${compileOne(excludeTypes, module, ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${compileOne(excludeTypes, module, ast.itemIdentifier)} of ${compileOne(excludeTypes, module, ast.iterator)}[${INT}INNER_ITER]) ${compileOne(excludeTypes, module, ast.body)}`;
        case "while-loop": return `while (${compileOne(excludeTypes, module, ast.condition)}) ${compileOne(excludeTypes, module, ast.body)}`;
        case "proc": return compileProc(excludeTypes, module, ast);
        case "func": return compileFunc(excludeTypes, module, ast);
        case "inline-const": return `${INT}withConst(${compileOne(excludeTypes, module, ast.value)}, ${ast.name.name} =>
            ${compileOne(excludeTypes, module, ast.next)})`
        case "pipe":
        case "invocation": return `${compileOne(excludeTypes, module, ast.subject)}${ast.kind === "invocation" && ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(p => compileOne(excludeTypes, module, p)).join(',')}>` : ''}(${ast.args.map(arg => compileOne(excludeTypes, module, arg)).join(', ')})`;
        case "binary-operator": return `(${compileOne(excludeTypes, module, ast.base)} ${ast.ops.map(([op, expr]) => compileOne(excludeTypes, module, op) + ' ' + compileOne(excludeTypes, module, expr)).join(' ')})`;
        case "negation-operator": return `!(${compileOne(excludeTypes, module, ast.base)})`;
        case "operator": return ast.op;
        case "if-else-expression":
        case "switch-expression": return '(' + ast.cases
            .map(({ condition, outcome }) => 
                (ast.kind === "if-else-expression"
                    ? compileOne(excludeTypes, module, condition)
                    : compileOne(excludeTypes, module, ast.value) + ' === ' + compileOne(excludeTypes, module, condition))
                + ` ? ${compileOne(excludeTypes, module, outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? compileOne(excludeTypes, module, ast.defaultCase) : NIL) + ')'
        case "range": return `${INT}range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(excludeTypes, module, ast.inner)})`;
        case "debug": return compileOne(excludeTypes, module, ast.inner);
        case "property-accessor": return `${INT}observe(${compileOne(excludeTypes, module, ast.subject)}, '${ast.property.name}')`;
        case "plain-identifier": return ast.name;
        case "local-identifier": {
            const binding = Store.getBinding(() => {}, ast.name, ast)

            if (binding && binding.kind !== 'type-binding' && getBindingMutability(binding) === 'assignable') {
                return `${INT}observe(${LOCALS_OBJ}, '${ast.name}')`
            } else {
                return ast.name
            }
        }
        case "object-literal":  return `{${objectEntries(excludeTypes, module, ast.entries)}}`;
        case "array-literal":   return `[${ast.entries.map(
            e => e.kind === 'spread' 
                ? `...${compileOne(excludeTypes, module, e.expr)}`
                : compileOne(excludeTypes, module, e)).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment
                                                : '${' + compileOne(excludeTypes, module, segment) + '}').join("")}\``;
        case "spread": return `...${compileOne(excludeTypes, module, ast.expr)}`;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "indexer": return `${compileOne(excludeTypes, module, ast.subject)}[${compileOne(excludeTypes, module, ast.indexer)}]`;
        case "block": return `{ ${blockContents(excludeTypes, module, ast)}; }`;
        case "element-tag": return `${INT}h('${ast.tagName.name}',{${
            objectEntries(excludeTypes, module, (ast.attributes as ([PlainIdentifier, Expression|Expression[]] | Spread)[]))}}, ${ast.children.map(c => compileOne(excludeTypes, module, c)).join(', ')})`;
        case "union-type": return ast.members.map(m => compileOne(excludeTypes, module, m)).join(" | ");
        case "maybe-type": return compileOne(excludeTypes, module, ast.inner) + '|null|undefined'
        case "named-type": return ast.name.name;
        case "generic-type": return "unknown";
        case "bound-generic-type": return `unknown`;
        case "proc-type": return `(${compileArgs(excludeTypes, module, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(excludeTypes, module, ast.args)}) => ${compileOne(excludeTypes, module, ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${
            ast.spreads
            .map(s => '...' + compileOne(excludeTypes, module, s))
            .concat(
                ast.entries
                .map(({ name, type }) => `${name.name}: ${compileOne(excludeTypes, module, type)}`)
            )
            .join(', ')}}`;
        case "indexer-type": return `{[key: ${compileOne(excludeTypes, module, ast.keyType)}]: ${compileOne(excludeTypes, module, ast.valueType)}}`;
        case "array-type": return `${compileOne(excludeTypes, module, ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(m => compileOne(excludeTypes, module, m)).join(", ")}]`;
        case "iterator-type": return `${INT}Iter<${compileOne(excludeTypes, module, ast.inner)}>`;
        case "plan-type": return `${INT}Plan<${compileOne(excludeTypes, module, ast.inner)}>`;
        case "literal-type": return `${compileOne(excludeTypes, module, ast.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `(null | undefined)`;
        case "unknown-type": return `unknown`;
        case "parenthesized-type": return `(${compileOne(excludeTypes, module, ast.inner)})`

        default:
            throw Error("Couldn't compile '" + ast.kind + "'");
    }

}

function blockContents(excludeTypes: boolean, module: string, block: Block) {
    return block.statements.map(s => compileOne(excludeTypes, module, s)).join("; ")
}

function objectEntries(excludeTypes: boolean, module: string, entries: readonly (readonly [PlainIdentifier, Expression | readonly Expression[]]|Spread)[]): string {
    return entries
        .map(entry => 
            Array.isArray(entry)
                ? `${compileOne(excludeTypes, module, entry[0])}: ${
                    Array.isArray(entry[1]) 
                        ? entry[1].map(c => compileOne(excludeTypes, module, c)) 
                        : compileOne(excludeTypes, module, entry[1] as Expression)}`
                : compileOne(excludeTypes, module, entry as Spread))
        .join(", ")
}

// TODO: Forbid this in user-defined identifers
export const INT = `___`;

const NIL = `undefined`;
const LOCALS_OBJ = INT + "locals";

const compileProcDeclaration = (excludeTypes: boolean, module: string, decl: ProcDeclaration|StoreProcedure): string => {
    const baseProc = compileOne(excludeTypes, module, decl.value)
    const proc = decl.action ? `${INT}action(${baseProc})` : baseProc

    if (decl.kind === 'proc-declaration') {
        return (decl.exported ? `export ` : ``) + `const ${decl.name.name} = ${proc}`;
    } else {
        return `    ${!excludeTypes ? (decl.access ?? 'private') : ''} readonly ${decl.name.name} = ${proc}`
    }
}

function compileProc(excludeTypes: boolean, module: string, proc: Proc): string {
    const letDeclarations = proc.body.statements.filter(s => s.kind === "let-declaration") as LetDeclaration[]

    const typeParams = !excludeTypes && proc.type.kind === 'generic-type'
        ? `<${proc.type.typeParams.map(p => p.name).join(',')}>`
        : ''
    const procType = proc.type.kind === 'generic-type' ? proc.type.inner as ProcType : proc.type

    return typeParams + `(${compileArgs(excludeTypes, module, procType.args)})${!excludeTypes ? ': void' : ''} => {
    ${letDeclarations.length > 0 ? // TODO: Handle ___locals for parent closures
`    const ${LOCALS_OBJ}${!excludeTypes ? `: {${
        letDeclarations
            .map(e => 
                `${e.name.name}?: any`)
            .join(",")
    }}` : ''} = {};
    
`
    : ``}${proc.body.statements.map(s => compileOne(excludeTypes, module, s) + ';').join("\n")}
}`;
}

const compileFuncDeclaration = (excludeTypes: boolean, module: string, decl: FuncDeclaration|StoreFunction): string => {
    const signature = compileFuncSignature(excludeTypes, module, decl.value)
    const body = compileOne(excludeTypes, module, decl.value.body)
    
    const prefix = decl.kind === "func-declaration" 
        ? (decl.exported ? `export ` : ``) + 'const' 
        : (!excludeTypes ? (decl.access ?? 'private') + ' readonly' : '')

    if (decl.memo) {
        return `${prefix} ${decl.name.name} = ${INT}computedFn(` + signature + ' => ' + body + ');';
    } else {
        return `${prefix} ${decl.name.name} = ` + signature + ' => ' + body + ';';
    }
}

const compileFunc = (excludeTypes: boolean, module: string, func: Func): string => {
    const signature = compileFuncSignature(excludeTypes, module, func)
    const body = compileOne(excludeTypes, module, func.body)

    return signature + ' => ' + body
}

const compileFuncSignature = (excludeTypes: boolean, module: string, func: Func): string => {
    const typeParams = !excludeTypes && func.type.kind === 'generic-type'
        ? `<${func.type.typeParams.map(p => p.name.name).join(',')}>`
        : ''
    const funcType = func.type.kind === 'generic-type' ? func.type.inner : func.type
    
    return typeParams + `(${compileArgs(excludeTypes, module, funcType.args)})${
        !excludeTypes && funcType.returnType != null ? `: ${compileOne(excludeTypes, module, funcType.returnType)}` : ''}`;
}

// TODO: Bring this back as an optimization
// const compileFuncBody = (excludeTypes: boolean, module: string, func: Func): string => {
//     const bodyExpr = compileOne(excludeTypes, module, func.body);

//     return func.consts.length === 0
//         ? bodyExpr
//         : ' {\n' + 
//             func.consts
//                 .map(c => `    const ${c.name.name}${c.type ? ': ' + compileOne(excludeTypes, module, c.type) : ""} = ${compileOne(excludeTypes, module, c.value)};\n`)
//                 .join('') +
//             `\n    return ${bodyExpr};\n}`
// }

function compileStoreDeclaration(excludeTypes: boolean, module: string, store: StoreDeclaration) {
    return `class ${INT}${store.name.name} {
        
        ${store.members.map(m =>
            compileOne(excludeTypes, module, m)).join('\n')}
        
    };
    ${store.exported ? 'export ' : ''}const ${store.name.name} = new ${INT}${store.name.name}();`
}

function compileStoreProperty(excludeTypes: boolean, module: string, ast: StoreProperty): string {
    const typeDeclaration = !excludeTypes && ast.type ? ': ' + compileOne(excludeTypes, module, ast.type) : ''

    if (ast.access === "visible") {
        return `    ${!excludeTypes ? 'private ' : ''}${INT}${ast.name.name}${typeDeclaration} = ${compileOne(excludeTypes, module, ast.value)};\n` +
               `    ${!excludeTypes ? 'public ' : ''}get ${ast.name.name}() {\n` +
               `        return this.${INT}${ast.name.name};\n` +
               `    }\n` +
               `    ${!excludeTypes ? 'private ' : ''}set ${ast.name.name}(val${typeDeclaration}) {\n` +
               `        this.${INT}${ast.name.name} = val;\n` +
               `    }\n`
    } else {
        return `    ${!excludeTypes ? (ast.access ?? 'private') + ' ' : ''}${ast.name.name}${typeDeclaration} = ${compileOne(excludeTypes, module, ast.value)};`
    }
}

function compileArgs(excludeTypes: boolean, module: string, args: readonly Arg[]): string {
    return args.map(arg => compileOneArg(excludeTypes, module, arg)).join(', ')
}

function compileOneArg(excludeTypes: boolean, module: string, arg: Arg): string {
    return arg.name.name + (!excludeTypes && arg.type ? `: ${compileOne(excludeTypes, module, arg.type)}` : '')
}
