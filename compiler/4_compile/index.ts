import { path } from "../deps.ts";
import { cachedModulePath, given, pathIsRemote } from "../utils/misc.ts";
import { Module, AST, Block, PlainIdentifier } from "../_model/ast.ts";
import { GetBinding, getBindingMutability, ModuleName } from "../_model/common.ts";
import { TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, StoreDeclaration, StoreFunction, StoreProperty } from "../_model/declarations.ts";
import { Expression, Proc, Func, Spread } from "../_model/expressions.ts";
import { LetDeclaration } from "../_model/statements.ts";
import { Arg, FuncType, ProcType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export function compile(getBinding: GetBinding, module: Module, modulePath: ModuleName, includeTests?: boolean, excludeTypes = false): string {
    const runtimeCode = module.declarations
        .filter(decl => decl.kind !== 'test-expr-declaration' && decl.kind !== 'test-block-declaration')
        .map(decl => compileOne(getBinding, excludeTypes, modulePath, decl))
        .join("\n\n") + (module.hasMain ? "\nsetTimeout(main, 0);\n" : "");

    if (includeTests) {
        return runtimeCode + `\n export const tests = {
            testExprs: [${
                module.declarations
                    .filter(decl => decl.kind === "test-expr-declaration")
                    // @ts-ignore
                    .map((decl: TestExprDeclaration) => 
                        `{ name: '${decl.name.value}', expr: ${compileOne(getBinding, excludeTypes, modulePath, decl.expr)} }`)
                    .join(',\n')
            }],
            testBlocks: [${
                module.declarations
                    .filter(decl => decl.kind === "test-block-declaration")
                    // @ts-ignore
                    .map((decl: TestBlockDeclaration) => 
                        `{ name: '${decl.name.value}', block: () => ${compileOne(getBinding, excludeTypes, modulePath, decl.block)} }`)
                    .join(',\n')
            }]
        }`
    } else {
        return runtimeCode
    }
}

function compileOne(getBinding: GetBinding, excludeTypes: boolean, module: string, ast: AST): string {
    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            compileOne(getBinding, excludeTypes, module, name) + (alias ? ` as ${compileOne(getBinding, excludeTypes, module, alias)}` : ``)
        ).join(", ")} } from "${pathIsRemote(ast.path.value) ? (path.relative(path.dirname(module), cachedModulePath(ast.path.value as ModuleName)).replaceAll(/\\/g, '/') + '.ts') : (ast.path.value + '.bgl.ts')}";`;
        case "type-declaration":  return (
            excludeTypes
                ? ''
                : (
                    (ast.type.kind === 'nominal-type' ?
                        `const ${INT}${ast.name.name} = Symbol('${ast.name.name}');\n${ast.exported ? `export ` : ``}function ${ast.name.name}(value: ${compileOne(getBinding, excludeTypes, module, ast.type.inner)}): ${ast.name.name} { return { name: ${INT}${ast.name.name}, value } }\n`
                    : '') +
                    `${ast.exported ? `export ` : ``}type ${ast.name.name} = ${ast.type.kind === 'nominal-type'
                        ? `{ name: typeof ${INT}${ast.name.name}, value: ${compileOne(getBinding, excludeTypes, module, ast.type.inner)} }`
                        : compileOne(getBinding, excludeTypes, module, ast.type)};`
                )
        );
        case "proc-declaration":  return (ast.exported ? `export ` : ``) + `const ${ast.name.name} = ` + compileOne(getBinding, excludeTypes, module, ast.value) + ';';
        case "func-declaration":  return compileFuncDeclaration(getBinding, excludeTypes, module, ast)
        case "const-declaration": return (ast.exported ? `export ` : ``) + `const ${compileOne(getBinding, excludeTypes, module, ast.name)}${!excludeTypes && ast.type ? `: ${compileOne(getBinding, excludeTypes, module, ast.type)}` : ''} = ${compileOne(getBinding, excludeTypes, module, ast.value)};`;
        case "store-declaration": return compileStoreDeclaration(getBinding, excludeTypes, module, ast);
        case "store-property": return  compileStoreProperty(getBinding, excludeTypes, module, ast)
        case "store-procedure": return `    ${!excludeTypes ? ast.access : ''} readonly ${ast.name.name} = ${compileOne(getBinding, excludeTypes, module, ast.value)}`
        case "store-function": return  '    ' + compileFuncDeclaration(getBinding, excludeTypes, module, ast);
        case "autorun-declaration": return `${INT}autorun(${compileOne(getBinding, excludeTypes, module, ast.effect)})`;
        case "let-declaration":  return `${LOCALS_OBJ}["${ast.name.name}"] = ${compileOne(getBinding, excludeTypes, module, ast.value)}`;
        case "const-declaration-statement": return `const ${ast.name.name} = ${compileOne(getBinding, excludeTypes, module, ast.value)}`;
        case "assignment": return `${compileOne(getBinding, excludeTypes, module, ast.target)} = ${compileOne(getBinding, excludeTypes, module, ast.value)}`;
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${compileOne(getBinding, excludeTypes, module, condition)}) ${compileOne(getBinding, excludeTypes, module, outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${compileOne(getBinding, excludeTypes, module, ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${compileOne(getBinding, excludeTypes, module, ast.itemIdentifier)} of ${compileOne(getBinding, excludeTypes, module, ast.iterator)}[${INT}INNER_ITER]) ${compileOne(getBinding, excludeTypes, module, ast.body)}`;
        case "while-loop": return `while (${compileOne(getBinding, excludeTypes, module, ast.condition)}) ${compileOne(getBinding, excludeTypes, module, ast.body)}`;
        case "proc": return compileProc(getBinding, excludeTypes, module, ast);
        case "func": return compileFunc(getBinding, excludeTypes, module, ast);
        case "inline-const": return `${INT}withConst(${compileOne(getBinding, excludeTypes, module, ast.value)}, ${ast.name.name} =>
            ${compileOne(getBinding, excludeTypes, module, ast.next)})`
        case "pipe":
        case "invocation": return `${compileOne(getBinding, excludeTypes, module, ast.subject)}${ast.kind === "invocation" && ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(p => compileOne(getBinding, excludeTypes, module, p)).join(',')}>` : ''}(${ast.args.map(arg => compileOne(getBinding, excludeTypes, module, arg)).join(', ')})`;
        case "binary-operator": return `(${compileOne(getBinding, excludeTypes, module, ast.base)} ${ast.ops.map(([op, expr]) => compileOne(getBinding, excludeTypes, module, op) + ' ' + compileOne(getBinding, excludeTypes, module, expr)).join(' ')})`;
        case "negation-operator": return `!(${compileOne(getBinding, excludeTypes, module, ast.base)})`;
        case "operator": return ast.op;
        case "if-else-expression":
        case "switch-expression": return '(' + ast.cases
            .map(({ condition, outcome }) => 
                (ast.kind === "if-else-expression"
                    ? compileOne(getBinding, excludeTypes, module, condition)
                    : compileOne(getBinding, excludeTypes, module, ast.value) + ' === ' + compileOne(getBinding, excludeTypes, module, condition))
                + ` ? ${compileOne(getBinding, excludeTypes, module, outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? compileOne(getBinding, excludeTypes, module, ast.defaultCase) : NIL) + ')'
        case "range": return `${INT}range(${ast.start})(${ast.end})`;
        case "parenthesized-expression": return `(${compileOne(getBinding, excludeTypes, module, ast.inner)})`;
        case "debug": return compileOne(getBinding, excludeTypes, module, ast.inner);
        case "property-accessor": return `${compileOne(getBinding, excludeTypes, module, ast.subject)}.${compileOne(getBinding, excludeTypes, module, ast.property)}`;
        case "plain-identifier": return ast.name;
        case "local-identifier": {
            const binding = getBinding(() => {}, ast.name, ast)

            if (binding && binding.kind !== 'type-binding' && getBindingMutability(binding) === 'assignable') {
                return `${LOCALS_OBJ}["${ast.name}"]`
            } else {
                return ast.name
            }
        }
        case "object-literal":  return `{${objectEntries(getBinding, excludeTypes, module, ast.entries)}}`;
        case "array-literal":   return `[${ast.entries.map(
            e => e.kind === 'spread' 
                ? `...${compileOne(getBinding, excludeTypes, module, e.expr)}`
                : compileOne(getBinding, excludeTypes, module, e)).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment
                                                : '${' + compileOne(getBinding, excludeTypes, module, segment) + '}').join("")}\``;
        case "spread": return `...${compileOne(getBinding, excludeTypes, module, ast.expr)}`;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "indexer": return `${compileOne(getBinding, excludeTypes, module, ast.subject)}[${compileOne(getBinding, excludeTypes, module, ast.indexer)}]`;
        case "block": return `{ ${blockContents(getBinding, excludeTypes, module, ast)}; }`;
        case "element-tag": return `${INT}h('${ast.tagName.name}',{${
            objectEntries(getBinding, excludeTypes, module, (ast.attributes as ([PlainIdentifier, Expression|Expression[]] | Spread)[]))}}, ${ast.children.map(c => compileOne(getBinding, excludeTypes, module, c)).join(', ')})`;
        case "union-type": return ast.members.map(m => compileOne(getBinding, excludeTypes, module, m)).join(" | ");
        case "maybe-type": return compileOne(getBinding, excludeTypes, module, ast.inner) + '|null|undefined'
        case "named-type": return ast.name.name;
        case "generic-type": return "unknown";
        case "bound-generic-type": return `unknown`;
        case "proc-type": return `(${compileArgs(getBinding, excludeTypes, module, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(getBinding, excludeTypes, module, ast.args)}) => ${compileOne(getBinding, excludeTypes, module, ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${
            ast.spreads
            .map(s => '...' + compileOne(getBinding, excludeTypes, module, s))
            .concat(
                ast.entries
                .map(({ name, type }) => `${name.name}: ${compileOne(getBinding, excludeTypes, module, type)}`)
            )
            .join(', ')}}`;
        case "indexer-type": return `{[key: ${compileOne(getBinding, excludeTypes, module, ast.keyType)}]: ${compileOne(getBinding, excludeTypes, module, ast.valueType)}}`;
        case "array-type": return `${compileOne(getBinding, excludeTypes, module, ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(m => compileOne(getBinding, excludeTypes, module, m)).join(", ")}]`;
        case "iterator-type": return `${INT}Iter<${compileOne(getBinding, excludeTypes, module, ast.inner)}>`;
        case "plan-type": return `${INT}Plan<${compileOne(getBinding, excludeTypes, module, ast.inner)}>`;
        case "literal-type": return `${compileOne(getBinding, excludeTypes, module, ast.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `(null | undefined)`;
        case "unknown-type": return `unknown`;
        case "parenthesized-type": return `(${compileOne(getBinding, excludeTypes, module, ast.inner)})`

        default:
            throw Error("Couldn't compile '" + ast.kind + "'");
    }

}

function blockContents(getBinding: GetBinding, excludeTypes: boolean, module: string, block: Block) {
    return block.statements.map(s => compileOne(getBinding, excludeTypes, module, s)).join("; ")
}

function objectEntries(getBinding: GetBinding, excludeTypes: boolean, module: string, entries: readonly (readonly [PlainIdentifier, Expression | readonly Expression[]]|Spread)[]): string {
    return entries
        .map(entry => 
            Array.isArray(entry)
                ? `${compileOne(getBinding, excludeTypes, module, entry[0])}: ${
                    Array.isArray(entry[1]) 
                        ? entry[1].map(c => compileOne(getBinding, excludeTypes, module, c)) 
                        : compileOne(getBinding, excludeTypes, module, entry[1] as Expression)}`
                : compileOne(getBinding, excludeTypes, module, entry as Spread))
        .join(", ")
}

// TODO: Forbid this in user-defined identifers
export const INT = `___`;

const NIL = `undefined`;
const LOCALS_OBJ = INT + "locals";

function compileProc(getBinding: GetBinding, excludeTypes: boolean, module: string, proc: Proc): string {
    const letDeclarations = proc.body.statements.filter(s => s.kind === "let-declaration") as LetDeclaration[]

    const typeParams = !excludeTypes && proc.type.kind === 'generic-type'
        ? `<${proc.type.typeParams.map(p => p.name).join(',')}>`
        : ''
    const procType = proc.type.kind === 'generic-type' ? proc.type.inner as ProcType : proc.type

    return typeParams + `(${compileArgs(getBinding, excludeTypes, module, procType.args)})${!excludeTypes ? ': void' : ''} => {
    ${letDeclarations.length > 0 ? // TODO: Handle ___locals for parent closures
`    const ${LOCALS_OBJ}${!excludeTypes ? `: {${
        letDeclarations
            .map(e => 
                `${e.name.name}?: any`)
            .join(",")
    }}` : ''} = ${INT}observable({});
    
`
    : ``}${proc.body.statements.map(s => compileOne(getBinding, excludeTypes, module, s) + ';').join("\n")}
}`;
}

const compileFuncDeclaration = (getBinding: GetBinding, excludeTypes: boolean, module: string, decl: FuncDeclaration|StoreFunction): string => {
    const signature = compileFuncSignature(getBinding, excludeTypes, module, decl.value)
    const body = compileOne(getBinding, excludeTypes, module, decl.value.body)
    
    const prefix = decl.kind === "func-declaration" 
        ? (decl.exported ? `export ` : ``) + 'const' 
        : (!excludeTypes ? decl.access + ' readonly' : '')

    if (decl.memo) {
        return `${prefix} ${decl.name.name} = ${INT}computedFn(` + signature + ' => ' + body + ');';
    } else {
        return `${prefix} ${decl.name.name} = ` + signature + ' => ' + body + ';';
    }
}

const compileFunc = (getBinding: GetBinding, excludeTypes: boolean, module: string, func: Func): string => {
    const signature = compileFuncSignature(getBinding, excludeTypes, module, func)
    const body = compileOne(getBinding, excludeTypes, module, func.body)

    return signature + ' => ' + body
}

const compileFuncSignature = (getBinding: GetBinding, excludeTypes: boolean, module: string, func: Func): string => {
    const typeParams = !excludeTypes && func.type.kind === 'generic-type'
        ? `<${func.type.typeParams.map(p => p.name).join(',')}>`
        : ''
    const funcType = func.type.kind === 'generic-type' ? func.type.inner as FuncType : func.type
    
    return typeParams + `(${compileArgs(getBinding, excludeTypes, module, funcType.args)})${
        !excludeTypes && funcType.returnType != null ? `: ${compileOne(getBinding, excludeTypes, module, funcType.returnType)}` : ''}`;
}

// TODO: Bring this back as an optimization
// const compileFuncBody = (getBinding: GetBinding, excludeTypes: boolean, module: string, func: Func): string => {
//     const bodyExpr = compileOne(getBinding, excludeTypes, module, func.body);

//     return func.consts.length === 0
//         ? bodyExpr
//         : ' {\n' + 
//             func.consts
//                 .map(c => `    const ${c.name.name}${c.type ? ': ' + compileOne(getBinding, excludeTypes, module, c.type) : ""} = ${compileOne(getBinding, excludeTypes, module, c.value)};\n`)
//                 .join('') +
//             `\n    return ${bodyExpr};\n}`
// }

function compileStoreDeclaration(getBinding: GetBinding, excludeTypes: boolean, module: string, store: StoreDeclaration) {
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
            compileOne(getBinding, excludeTypes, module, m)).join('\n')}
        
    };
    ${store.exported ? 'export ' : ''}const ${store.name.name} = new ${INT}${store.name.name}();`
}

function compileStoreProperty(getBinding: GetBinding, excludeTypes: boolean, module: string, ast: StoreProperty): string {
    const typeDeclaration = !excludeTypes && ast.type ? ': ' + compileOne(getBinding, excludeTypes, module, ast.type) : ''

    if (ast.access === "visible") {
        return `    ${!excludeTypes ? 'private ' : ''}${INT}${ast.name.name}${typeDeclaration} = ${compileOne(getBinding, excludeTypes, module, ast.value)};\n` +
               `    ${!excludeTypes ? 'public ' : ''}get ${ast.name.name}() {\n` +
               `        return this.${INT}${ast.name.name};\n` +
               `    }\n` +
               `    ${!excludeTypes ? 'private ' : ''}set ${ast.name.name}(val${typeDeclaration}) {\n` +
               `        this.${INT}${ast.name.name} = val;\n` +
               `    }\n`
    } else {
        return `    ${!excludeTypes ? ast.access + ' ' : ''}${ast.name.name}${typeDeclaration} = ${compileOne(getBinding, excludeTypes, module, ast.value)};`
    }
}

function compileArgs(getBinding: GetBinding, excludeTypes: boolean, module: string, args: readonly Arg[]): string {
    return args.map(arg => compileOneArg(getBinding, excludeTypes, module, arg)).join(', ')
}

function compileOneArg(getBinding: GetBinding, excludeTypes: boolean, module: string, arg: Arg): string {
    return arg.name.name + (!excludeTypes && arg.type ? `: ${compileOne(getBinding, excludeTypes, module, arg.type)}` : '')
}