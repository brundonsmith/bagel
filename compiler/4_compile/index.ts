import Store, { canonicalModuleName, Mode } from "../store.ts";
import { jsFileLocation } from "../utils/misc.ts";
import { Module, AST, Block, PlainIdentifier } from "../_model/ast.ts";
import { ModuleName } from "../_model/common.ts";
import { TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, ProcDeclaration, JsFuncDeclaration, JsProcDeclaration } from "../_model/declarations.ts";
import { Expression, Proc, Func, Spread } from "../_model/expressions.ts";
import { Arg, FuncType, GenericFuncType, GenericProcType, ProcType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


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
    const c = (ast: AST) => compileOne(excludeTypes, module, ast)

    switch(ast.kind) {
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            c(name) + (alias ? ` as ${c(alias)}` : ``)
        ).join(", ")} } from "${jsFileLocation(canonicalModuleName(module, ast.path.value), Store.mode as Mode).replaceAll(/\\/g, '/')}";`;
        case "type-declaration":  return (
            excludeTypes
                ? ''
                : (
                    (ast.type.kind === 'nominal-type' ?
                        `const ${INT}${ast.name.name} = Symbol('${ast.name.name}');\n${ast.exported ? `export ` : ``}function ${ast.name.name}(value: ${c(ast.type.inner)}): ${ast.name.name} { return { name: ${INT}${ast.name.name}, value } }\n`
                    : '') +
                    `${ast.exported ? `export ` : ``}type ${ast.name.name} = ${ast.type.kind === 'nominal-type'
                        ? `{ name: typeof ${INT}${ast.name.name}, value: ${c(ast.type.inner)} }`
                        : c(ast.type)};`
                )
        );
        case "proc-declaration":  return compileProcDeclaration(excludeTypes, module, ast)
        case "js-proc-declaration": return compileJsProcDeclaration(excludeTypes, module, ast)
        case "func-declaration":  return compileFuncDeclaration(excludeTypes, module, ast)
        case "js-func-declaration": return compileJsFuncDeclaration(excludeTypes, module, ast)
        case "value-declaration": {
            const type = (
                excludeTypes || !ast.type ? '' :
                ast.isConst ? `: ${c(ast.type)}` :
                `: { value: ${c(ast.type)} }`
            )

            const value = ast.isConst
                ? c(ast.value)
                : `{ value: ${c(ast.value)} }`
            
            return (ast.exported ? `export ` : ``) + `const ${ast.name.name}${type} = ${value};`;
        }
        case "autorun-declaration": return `${INT}autorun(${c(ast.effect)})`;
        case "let-declaration-statement":
        case "const-declaration-statement": {
            const keyword = ast.kind === 'let-declaration-statement' ? 'let' : 'const'
            return `${keyword} ${ast.name.name}${!excludeTypes && ast.type != null ? `: ${c(ast.type)}` : ''} = ${c(ast.value)}`;
        }
        case "assignment": {
            const value = c(ast.value)

            if (ast.target.kind === 'local-identifier') {
                const binding = Store.getBinding(() => {}, ast.target.name, ast.target)

                if (binding && binding.kind === 'basic' && binding.ast.kind === 'value-declaration' && !binding.ast.isConst) {
                    return `${ast.target.name}.value = ${value}; ${INT}invalidate(${ast.target.name}, 'value')`
                } else {
                    return `${ast.target.name} = ${value}`
                }
            } else if (ast.target.kind === 'indexer') {
                return `${c(ast.target.subject)}[${c(ast.target.indexer)}] = ${value}; ${INT}invalidate(${c(ast.target.subject)}, ${c(ast.target.indexer)})`
            } else {
                return `${c(ast.target.subject)}.${ast.target.property.name} = ${value}; ${INT}invalidate(${c(ast.target.subject)}, ${c(ast.target.property)})`
            }
        }
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${c(condition)}) ${c(outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${c(ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${c(ast.itemIdentifier)} of ${c(ast.iterator)}[${INT}INNER_ITER]) ${c(ast.body)}`;
        case "while-loop": return `while (${c(ast.condition)}) ${c(ast.body)}`;
        case "proc": return compileProc(excludeTypes, module, ast);
        case "func": return compileFunc(excludeTypes, module, ast);
        case "inline-const": return `${INT}withConst(${c(ast.value)}, ${ast.name.name} =>
            ${c(ast.next)})`
        case "pipe":
        case "invocation": return `${c(ast.subject)}${ast.kind === "invocation" && ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(c).join(',')}>` : ''}(${ast.args.map(c).join(', ')})`;
        case "binary-operator": return `(${c(ast.base)} ${ast.ops.map(([op, expr]) => c(op) + ' ' + c(expr)).join(' ')})`;
        case "negation-operator": return `!(${c(ast.base)})`;
        case "operator": return ast.op;
        case "if-else-expression":
        case "switch-expression": return '(' + ast.cases
            .map(({ condition, outcome }) => 
                (ast.kind === "if-else-expression"
                    ? c(condition)
                    : c(ast.value) + ' === ' + c(condition))
                + ` ? ${c(outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? c(ast.defaultCase) : NIL) + ')'
        case "range": return `${INT}range(${c(ast.start)})(${c(ast.end)})`;
        case "parenthesized-expression": return `(${c(ast.inner)})`;
        case "debug": return c(ast.inner);
        case "property-accessor": return `${INT}observe(${c(ast.subject)}, '${ast.property.name}')`;
        case "plain-identifier": return ast.name;
        case "local-identifier": {
            const binding = Store.getBinding(() => {}, ast.name, ast)

            if (binding && binding.kind === 'basic' && binding.ast.kind === 'value-declaration' && !binding.ast.isConst) {
                return `${INT}observe(${ast.name}, 'value')`
            } else {
                return ast.name
            }
        }
        case "object-literal":  return `{${objectEntries(excludeTypes, module, ast.entries)}}`;
        case "array-literal":   return `[${ast.entries.map(c).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment
                                                : '${' + c(segment) + '}').join("")}\``;
        case "spread": return `...${c(ast.expr)}`;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "indexer": return `${c(ast.subject)}[${c(ast.indexer)}]`;
        case "block": return `{ ${blockContents(excludeTypes, module, ast)}; }`;
        case "element-tag": return `${INT}h('${ast.tagName.name}',{${
            objectEntries(excludeTypes, module, (ast.attributes as ([PlainIdentifier, Expression|Expression[]] | Spread)[]))}}, ${ast.children.map(c).join(', ')})`;
        case "union-type": return ast.members.map(c).join(" | ");
        case "maybe-type": return c(ast.inner) + '|null|undefined'
        case "named-type": return ast.name.name;
        case "generic-type": return "unknown";
        case "bound-generic-type": return `unknown`;
        case "proc-type": return `(${compileArgs(excludeTypes, module, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(excludeTypes, module, ast.args)}) => ${c(ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return `{${
            ast.spreads
            .map(s => '...' + c(s))
            .concat(
                ast.entries.map(({ name, type }) =>
                    `${name.name}: ${c(type)}`)
            )
            .join(', ')}}`;
        case "record-type": return `{[key: ${c(ast.keyType)}]: ${c(ast.valueType)}}`;
        case "array-type": return `${c(ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(c).join(", ")}]`;
        case "iterator-type": return `${INT}Iter<${c(ast.inner)}>`;
        case "plan-type": return `${INT}Plan<${c(ast.inner)}>`;
        case "literal-type": return `${c(ast.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `(null | undefined)`;
        case "unknown-type": return `unknown`;
        case "parenthesized-type": return `(${c(ast.inner)})`

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

const compileProcDeclaration = (excludeTypes: boolean, module: string, decl: ProcDeclaration): string => {
    const baseProc = compileOne(excludeTypes, module, decl.value)
    const proc = decl.action ? `${INT}action(${baseProc})` : baseProc

    return (decl.exported ? `export ` : ``) + `const ${decl.name.name} = ${proc};`;
}

function compileProc(excludeTypes: boolean, module: string, proc: Proc): string {
    const typeParams = !excludeTypes && proc.type.kind === 'generic-type'
        ? `<${proc.type.typeParams.map(p => p.name).join(',')}>`
        : ''
    const procType = proc.type.kind === 'generic-type' ? proc.type.inner as ProcType : proc.type

    return typeParams + `(${compileArgs(excludeTypes, module, procType.args)})${!excludeTypes ? ': void' : ''} => {
    ${proc.body.statements.map(s => compileOne(excludeTypes, module, s) + ';').join("\n")}
}`;
}

const compileJsProcDeclaration = (excludeTypes: boolean, module: string, decl: JsProcDeclaration): string => {
    const signature = compileProcSignature(excludeTypes, module, decl.type)
    const body = `{
        ${decl.js}
    }`
    
    const prefix = (decl.exported ? `export ` : ``) + 'const'

    if (decl.action) {
        return `${prefix} ${decl.name.name} = ${INT}action(` + signature + ' => ' + body + ');';
    } else {
        return `${prefix} ${decl.name.name} = ` + signature + ' => ' + body + ';';
    }

}

const compileFuncDeclaration = (excludeTypes: boolean, module: string, decl: FuncDeclaration): string => {
    const signature = compileFuncSignature(excludeTypes, module, decl.value.type)
    const body = compileOne(excludeTypes, module, decl.value.body)
    
    const prefix = (decl.exported ? `export ` : ``) + 'const'

    if (decl.memo) {
        return `${prefix} ${decl.name.name} = ${INT}computedFn(` + signature + ' => ' + body + ');';
    } else {
        return `${prefix} ${decl.name.name} = ` + signature + ' => ' + body + ';';
    }
}

const compileJsFuncDeclaration = (excludeTypes: boolean, module: string, decl: JsFuncDeclaration): string => {
    const signature = compileFuncSignature(excludeTypes, module, decl.type)
    const body = `{
        ${decl.js}
    }`
    
    const prefix = (decl.exported ? `export ` : ``) + 'const'

    if (decl.memo) {
        return `${prefix} ${decl.name.name} = ${INT}computedFn(` + signature + ' => ' + body + ');';
    } else {
        return `${prefix} ${decl.name.name} = ` + signature + ' => ' + body + ';';
    }
}

const compileFunc = (excludeTypes: boolean, module: string, func: Func): string => {
    const signature = compileFuncSignature(excludeTypes, module, func.type)
    const body = compileOne(excludeTypes, module, func.body)

    return signature + ' => ' + body
}

const compileProcSignature = (excludeTypes: boolean, module: string, proc: ProcType|GenericProcType): string => {
    const typeParams = !excludeTypes && proc.kind === 'generic-type'
        ? `<${proc.typeParams.map(p => p.name.name).join(',')}>`
        : ''
    const procType = proc.kind === 'generic-type' ? proc.inner : proc
    
    return typeParams + `(${compileArgs(excludeTypes, module, procType.args)})`;
}

const compileFuncSignature = (excludeTypes: boolean, module: string, func: FuncType|GenericFuncType): string => {
    const typeParams = !excludeTypes && func.kind === 'generic-type'
        ? `<${func.typeParams.map(p => p.name.name).join(',')}>`
        : ''
    const funcType = func.kind === 'generic-type' ? func.inner : func
    
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

function compileArgs(excludeTypes: boolean, module: string, args: readonly Arg[]): string {
    return args.map(arg => compileOneArg(excludeTypes, module, arg)).join(', ')
}

function compileOneArg(excludeTypes: boolean, module: string, arg: Arg): string {
    return arg.name.name + (!excludeTypes && arg.type ? `: ${compileOne(excludeTypes, module, arg.type)}` : '')
}
