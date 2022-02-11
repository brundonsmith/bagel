import { resolveType } from "../3_checking/typecheck.ts";
import { inferType, invocationFromMethodCall } from "../3_checking/typeinfer.ts";
import Store, { canonicalModuleName, Mode } from "../store.ts";
import { jsFileLocation } from "../utils/misc.ts";
import { Module, AST, Block, PlainIdentifier } from "../_model/ast.ts";
import { ModuleName } from "../_model/common.ts";
import { TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, ProcDeclaration } from "../_model/declarations.ts";
import { Expression, Proc, Func, Spread, JsFunc, JsProc } from "../_model/expressions.ts";
import { Arg, FuncType, GenericFuncType, GenericProcType, ProcType, TypeExpression, TypeParam, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export function compile(module: Module, modulePath: ModuleName, includeTests?: boolean, excludeTypes = false): string {
    const runtimeCode = module.declarations
        .filter(decl => decl.kind !== 'test-expr-declaration' && decl.kind !== 'test-block-declaration')
        .map(decl => compileOne(excludeTypes, modulePath, decl) + ';')
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
        case "import-all-declaration": return `import * as ${ast.alias.name} from "${jsFileLocation(canonicalModuleName(module, ast.path.value), Store.mode as Mode).replaceAll(/\\/g, '/')}"`;
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            c(name) + (alias ? ` as ${c(alias)}` : ``)
        ).join(", ")} } from "${jsFileLocation(canonicalModuleName(module, ast.path.value), Store.mode as Mode).replaceAll(/\\/g, '/')}"`;
        case "type-declaration":  return (
            excludeTypes
                ? ''
                : (
                    (ast.type.kind === 'nominal-type' ?
                        `const ${INT}${ast.name.name} = Symbol('${ast.name.name}');\n${exported(ast.exported)}function ${ast.name.name}(value: ${c(ast.type.inner)}): ${ast.name.name} { return { kind: ${INT}${ast.name.name}, value } }\n`
                    : '') +
                    `${exported(ast.exported)}type ${ast.name.name} = ${ast.type.kind === 'nominal-type'
                        ? `{ kind: typeof ${INT}${ast.name.name}, value: ${c(ast.type.inner)} }`
                        : c(ast.type)}`
                )
        );
        case "proc-declaration":
            return compileProcDeclaration(excludeTypes, module, ast)
        case "func-declaration":
            return compileFuncDeclaration(excludeTypes, module, ast)
        case "value-declaration":
        case "value-declaration-statement": {
            const prefix = ast.kind === 'value-declaration' ? exported(ast.exported) : ''

            if (ast.kind === 'value-declaration' && !ast.isConst) {
                const type = !excludeTypes && ast.type ? `: { value: ${c(ast.type)} }` : ''
                const value = `{ value: ${c(ast.value)} }`

                return prefix + `const ${ast.name.name}${type} = ${value}`
            } else {
                const type = !excludeTypes && ast.type ? `: ${c(ast.type)}` : ''
                const value = c(ast.value)
                
                return prefix + (ast.isConst ? 'const' : 'let') + ` ${ast.name.name}${type} = ${value}`;
            }
        }
        case "derive-declaration": 
            return exported(ast.exported) + `const ${ast.name.name}${ast.type ? `() => ${c(ast.type)}` : ``} = ${INT}computedFn(${c(ast.computeFn)})`
        case "remote-declaration": {
            const planGeneratorType = resolveType(() => {}, inferType(() => {}, ast.planGenerator))
            const compiledPlanGenerator = c(ast.planGenerator)

            return exported(ast.exported) + `const ${ast.name.name} = new ${INT}Remote${ast.type ? `<${c(ast.type)}>` : ``}(
                ${planGeneratorType.kind === 'plan-type'
                    ? `() => ${compiledPlanGenerator}`
                    : compiledPlanGenerator}
            )`
        }
        case "autorun-declaration": return `${INT}autorun(${c(ast.effect)})`;
        case "destructuring-declaration-statement":
        case "inline-destructuring-declaration": {
            const propsAndSpread = ast.properties.map(p => p.name).join(', ') + (ast.spread ? `, ...${ast.spread.name}` : '')
            const value = ast.kind === "inline-destructuring-declaration" && ast.awaited ? `await (${c(ast.value)})()` : c(ast.value)

            if (ast.destructureKind === 'object') {
                return `const { ${propsAndSpread} } = ${value}`
            } else {
                return `const [ ${propsAndSpread} ] = ${value}`
            }
        }
        case "assignment": {
            const value = c(ast.value)

            if (ast.target.kind === 'local-identifier') {
                const binding = Store.getBinding(() => {}, ast.target.name, ast.target)

                if (binding && binding.kind === 'value-binding' && binding.owner.kind === 'value-declaration' && !binding.owner.isConst) {
                    return `${ast.target.name}.value = ${value}; ${INT}invalidate(${ast.target.name}, 'value')`
                } else {
                    return `${ast.target.name} = ${value}`
                }
            } else if (ast.target.kind === 'indexer') {
                return `${c(ast.target.subject)}[${c(ast.target.indexer)}] = ${value}; ${INT}invalidate(${c(ast.target.subject)}, ${c(ast.target.indexer)})`
            } else {
                return `${c(ast.target.subject)}.${ast.target.property.name} = ${value}; ${INT}invalidate(${c(ast.target.subject)}, '${c(ast.target.property)}')`
            }
        }
        case "await-statement": {
            return (ast.name ? `const ${ast.name.name}${maybeTypeAnnotation(excludeTypes, module, ast.type)} = ` : '') + `await ${c(ast.plan)}()`
        }
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${c(condition)}) ${c(outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${c(ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${c(ast.itemIdentifier)} of ${c(ast.iterator)}[${INT}INNER_ITER]) ${c(ast.body)}`;
        case "while-loop": return `while (${c(ast.condition)}) ${c(ast.body)}`;
        case "proc":
        case "js-proc":
            return compileProc(excludeTypes, module, ast);
        case "func":
        case "js-func":
            return compileFunc(excludeTypes, module, ast);
        case "inline-const-group": {
            const awaited = ast.declarations.some(d => d.awaited)

            const body = `(${awaited ? 'async ' : ''}() => {
                ${ast.declarations.map(c).join('\n')}
                return ${c(ast.inner)};
            })()`;

            if (awaited) {
                return `() => ${body}`
            } else {
                return body
            }
        }
        case "inline-const-declaration":
            return `const ${ast.name.name}${maybeTypeAnnotation(excludeTypes, module, ast.type)} = ${ast.awaited ? `await (${c(ast.value)})()` : c(ast.value)};`
        case "invocation": {
            
            // method call
            const invocation = invocationFromMethodCall(ast) ?? ast;

            const subjectType = resolveType(() => {}, inferType(() => {}, invocation.subject))
            const procType = (
                subjectType.kind === 'proc-type' ? subjectType :
                subjectType.kind === 'generic-type' && subjectType.inner.kind === 'proc-type' ? subjectType.inner :
                undefined
            )

            let invalidation = ''
            if (procType?.invalidatesParent) {
                // TODO: This won't work if the method has been aliased. Gotta figure that out...
                if (invocation.subject.kind === 'property-accessor') {
                    invalidation = `; ${INT}invalidate(${c(invocation.subject.subject)})`
                }
            }

            return `${c(invocation.subject)}${invocation.kind === "invocation" && invocation.typeArgs.length > 0 ? `<${invocation.typeArgs.map(c).join(',')}>` : ''}(${invocation.args.map(c).join(', ')})` + invalidation;
        }
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
        case "plain-identifier": return ast.name;
        case "local-identifier": {
            const binding = Store.getBinding(() => {}, ast.name, ast)

            if (binding && binding.kind === 'value-binding' && binding.owner.kind === 'value-declaration' && !binding.owner.isConst) {
                return `${INT}observe(${ast.name}, 'value')`
            } else if (binding && binding.kind === 'value-binding' && binding.owner.kind === 'derive-declaration') {
                return `${ast.name}()`
            } else {
                return ast.name
            }
        }
        case "property-accessor": {

            // HACK: let-declarations accessed from whole-module imports need special treatment!
            // will this break if the module import gets aliased so something else?
            if (ast.subject.kind === 'local-identifier') {
                const binding = Store.getBinding(() => {}, ast.subject.name, ast)

                if (binding?.kind === 'value-binding' && binding.owner.kind === 'import-all-declaration') {
                    const module = Store.getModuleByName(binding.owner.module as ModuleName, binding.owner.path.value)
                    
                    if (module?.declarations.find(decl =>
                            decl.kind === 'value-declaration' && !decl.isConst && decl.name.name === ast.property.name)) {
                        return `${INT}observe(${INT}observe(${c(ast.subject)}, '${ast.property.name}'), 'value')`;
                    }
                }
            }

            return `${INT}observe(${c(ast.subject)}, '${ast.property.name}')`;
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
        case "block": return `{ ${blockContents(excludeTypes, module, ast)} }`;
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
    return block.statements.map(s => '\n' + compileOne(excludeTypes, module, s) + ';').join('') + '\n'
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
    
    return exported(decl.exported) + `const ${decl.name.name} = ` + proc;
}
const compileFuncDeclaration = (excludeTypes: boolean, module: string, decl: FuncDeclaration): string => {
    const baseFunc = compileOne(excludeTypes, module, decl.value)
    const func = decl.memo ? `${INT}computedFn(${baseFunc})` : baseFunc
    
    return exported(decl.exported) + `const ${decl.name.name} = ` + func;
}

function compileProc(excludeTypes: boolean, module: string, proc: Proc|JsProc): string {
    const signature = compileProcOrFunctionSignature(excludeTypes, module, proc.type)
    return signature + ` => ${proc.kind === 'js-proc' ? `{${proc.body}}` : compileOne(excludeTypes, module, proc.body)}`;
}
const compileFunc = (excludeTypes: boolean, module: string, func: Func|JsFunc): string => {
    const signature = compileProcOrFunctionSignature(excludeTypes, module, func.type)
    return signature + ' => ' + (func.kind === 'js-func' ? `{${func.body}}` : `(${compileOne(excludeTypes, module, func.body)})`)
}

const compileProcOrFunctionSignature = (excludeTypes: boolean, module: string, subject: ProcType|GenericProcType|FuncType|GenericFuncType): string => {
    const typeParams = !excludeTypes && subject.kind === 'generic-type'
        ? maybeTypeParams(excludeTypes, module, subject.typeParams)
        : ''
    const functionType = subject.kind === 'generic-type' ? subject.inner : subject

    return (functionType.kind === 'proc-type' && functionType.isAsync ? 'async ' : '') +
        typeParams + 
        `(${compileArgs(excludeTypes, module, functionType.args)})` +
        (excludeTypes ? '' : 
        functionType.kind === 'proc-type' ? (functionType.isAsync ? ': Promise<void>' : ': void') : 
        functionType.returnType != null ? `: ${compileOne(excludeTypes, module, functionType.returnType)}` :
        '')
}

function compileArgs(excludeTypes: boolean, module: string, args: readonly Arg[]): string {
    return args.map(arg =>
        arg.name.name + maybeTypeAnnotation(excludeTypes, module, arg.type)).join(', ')
}

function exported(e: boolean|"export"|"expose"|undefined): string {
    return e ? 'export ' : ''
}

function maybeTypeParams(excludeTypes: boolean, module: string, typeParams: readonly TypeParam[]): string {
    if (excludeTypes || typeParams.length === 0) {
        return ''
    } else {
        return `<${typeParams.map(p =>
            p.name.name + (p.extends ? ` extends ${compileOne(excludeTypes, module, p.extends)}` : '')
        ).join(', ')}>`
    }
}

function maybeTypeAnnotation(excludeTypes: boolean, module: string, type: TypeExpression|undefined): string {
    return !excludeTypes && type ? `: ${compileOne(excludeTypes, module, type)}` : ''
}