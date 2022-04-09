import { parsed } from "../1_parse/index.ts";
import { resolve } from "../3_checking/resolve.ts";
import { resolveType, subsumes } from "../3_checking/typecheck.ts";
import { inferType, invocationFromMethodCall } from "../3_checking/typeinfer.ts";
import { computedFn } from "../mobx.ts";
import { format } from "../other/format.ts";
import Store, { canonicalModuleName, getModuleByName, Mode, _Store } from "../store.ts";
import { jsFileLocation } from "../utils/misc.ts";
import { Module, AST, Block, PlainIdentifier } from "../_model/ast.ts";
import { ModuleName } from "../_model/common.ts";
import { TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, ProcDeclaration } from "../_model/declarations.ts";
import { Expression, Proc, Func, Spread, JsFunc, JsProc } from "../_model/expressions.ts";
import { Arg, FuncType, GenericFuncType, GenericProcType, ProcType, TRUTHINESS_SAFE_TYPES, TypeExpression, TypeParam, UNKNOWN_TYPE } from "../_model/type-expressions.ts";


export const compiled = computedFn((store: _Store, moduleName: ModuleName): string => {
    const ast = parsed(store, moduleName)?.ast

    if (!ast) {
        return ''
    }
    
    return (
        JS_PRELUDE + 
        compile(
            ast, 
            moduleName, 
            store.mode?.mode === 'test'
        )
    )
})

export const IMPORTED_ITEMS = [
    // reactivity
    'observe', 'invalidate', 'computedFn', 'autorun', 'action', 'WHOLE_OBJECT', 

    // rendering
    'defaultMarkupFunction',
    
    // used in compiler output
    'range', 'Iter', 'Plan', 'Error', 'ERROR_SYM', 'Remote',
    
    // runtime type-checking 
    'instanceOf', 'RT_UNKNOWN', 
    'RT_NIL', 'RT_BOOLEAN', 'RT_NUMBER', 'RT_STRING', 'RT_LITERAL', 'RT_ITERATOR',
    'RT_PLAN', 'RT_REMOTE', 'RT_ARRAY', 'RT_RECORD', 'RT_OBJECT', 'RT_NOMINAL',
    'RT_ERROR'
]

const JS_PRELUDE = `
import { ${
    IMPORTED_ITEMS.map(s => `${s} as ___${s}`).join(', ')
} } from "https://raw.githubusercontent.com/brundonsmith/bagel/master/lib/ts/core.ts";

`


export function compile(module: Module, modulePath: ModuleName, includeTests?: boolean, excludeTypes = false): string {
    const runtimeCode = module.declarations
        .filter(decl => decl.kind !== 'test-expr-declaration' && decl.kind !== 'test-block-declaration')
        .map(decl => compileOne(excludeTypes, modulePath, decl) + ';')
        .join("\n\n") + (module.hasMain ? "\nsetTimeout(main, 0);\n" : "");

    if (includeTests) {
        return runtimeCode + `\n export const tests = {
            testExprs: [${
                module.declarations
                    .filter((decl): decl is TestExprDeclaration => decl.kind === "test-expr-declaration")
                    .map(decl => 
                        `{ name: '${decl.name.value}', expr: ${compileOne(excludeTypes, modulePath, decl.expr)} }`)
                    .join(',\n')
            }],
            testBlocks: [${
                module.declarations
                    .filter((decl): decl is TestBlockDeclaration => decl.kind === "test-block-declaration")
                    .map(decl => 
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
        case "import-all-declaration": {
            const importedModuleType = ast.module && getModuleByName(Store, ast.module, ast.path.value)?.moduleType
            const imported = importedModuleType === 'json' || importedModuleType === 'text'
                ? `{ CONTENTS as ${ast.alias.name} }`
                : `* as ${ast.alias.name}` 
            return `import ${imported} from "${jsFileLocation(canonicalModuleName(module, ast.path.value), Store.mode as Mode).replaceAll(/\\/g, '/')}"`
        }
        case "import-declaration": return `import { ${ast.imports.map(({ name, alias }) => 
            c(name) + (alias ? ` as ${c(alias)}` : ``)
        ).join(", ")} } from "${jsFileLocation(canonicalModuleName(module, ast.path.value), Store.mode as Mode).replaceAll(/\\/g, '/')}"`;
        case "type-declaration":  return (
            excludeTypes
                ? ''
                : (
                    (ast.type.kind === 'nominal-type' ?
                        `const ${INT}${ast.name.name} = Symbol('${ast.name.name}');\n` +
                        `${exported(ast.exported)}const ${ast.name.name} = ((value: ${c(ast.type.inner)}): ${ast.name.name} => ({ kind: ${INT}${ast.name.name}, value })) as (((value: ${c(ast.type.inner)}) => ${ast.name.name}) & { sym: typeof ${INT}${ast.name.name} });\n` +
                        `${ast.name.name}.sym = ${INT}${ast.name.name};\n` +
                        `(${ast.name.name} as any).sym = ${INT}${ast.name.name};\n`
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
            return exported(ast.exported) + `const ${ast.name.name}${ast.type ? `() => ${c(ast.type)}` : ``} = ${INT}computedFn(
                () => ${c(ast.expr)}
            )`
        case "remote-declaration": {
            return exported(ast.exported) + `const ${ast.name.name}${ast.type ? `${INT}Remote<${c(ast.type)}>` : ``} = new ${INT}Remote(
                () => ${c(ast.expr)}
            )`
        }
        case "autorun-declaration": return `${INT}autorun(() => ${c(ast.effect)})`;
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
                const binding = resolve(ast.target.name, ast.target)

                if (binding?.owner.kind === 'value-declaration' && !binding.owner.isConst) {
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
                `(${fixTruthinessIfNeeded(excludeTypes, module, condition)}) ${c(outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${c(ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${c(ast.itemIdentifier)} of ${c(ast.iterator)}.inner) ${c(ast.body)}`;
        case "while-loop": return `while (${fixTruthinessIfNeeded(excludeTypes, module, ast.condition)}) ${c(ast.body)}`;
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

            const subjectType = inferType(invocation.subject)

            const typeArgs = invocation.kind === "invocation" && invocation.typeArgs.length > 0 ? `<${invocation.typeArgs.map(c).join(',')}>` : ''
            const args = invocation.args.map(c).join(', ')

            const compiledInvocation = `${c(invocation.subject)}${typeArgs}(${args})`

            if (subjectType.kind === 'proc-type' && subjectType.throws) {
                return `{
                    const e = ${compiledInvocation};
                    if (e) return e;
                }`
            } else {
                return compiledInvocation
            }
        }
        case "try-catch": {
            return `
            {
                const ${ast.errIdentifier.name} = (() => ${c(ast.tryBlock)})()
        
                if (${ast.errIdentifier.name} != null) ${c(ast.catchBlock)}
            }`
        }
        case "binary-operator": {
            if ((ast.op.op === '&&' || ast.op.op === '||') && needsTruthinessFix(ast.left)) {
                return truthify(excludeTypes, module, ast.left, ast.op.op, ast.right)
            }

            if (ast.op.op === '==') {
                return `(${c(ast.left)} === ${c(ast.right)})`;
            }

            if (ast.op.op === '!=') {
                return `(${c(ast.left)} !== ${c(ast.right)})`;
            }

            return `(${c(ast.left)} ${ast.op.op} ${c(ast.right)})`;
        }
        case "negation-operator": return `!(${fixTruthinessIfNeeded(excludeTypes, module, ast.base)})`;
        case "operator": return ast.op;
        case "if-else-expression":
        case "switch-expression": return '(' + ast.cases
            .map(({ condition, outcome }) => 
                (ast.kind === "if-else-expression"
                    ? fixTruthinessIfNeeded(excludeTypes, module, condition)
                    : c(ast.value) + ' === ' + c(condition))
                + ` ? ${c(outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? c(ast.defaultCase) : NIL) + ')'
        case "range": return `${INT}range(${c(ast.start)}, ${c(ast.end)})`;
        case "parenthesized-expression": return `(${c(ast.inner)})`;
        case "debug": return c(ast.inner);
        case "plain-identifier": return ast.name;
        case "local-identifier": {
            const binding = resolve(ast.name, ast)

            if (binding?.owner.kind === 'value-declaration' && !binding.owner.isConst) {
                return `${INT}observe(${ast.name}, 'value')`
            } else if (binding?.owner.kind === 'derive-declaration') {
                return `${ast.name}()`
            } else {
                return ast.name
            }
        }
        case "property-accessor": {

            // HACK: let-declarations accessed from whole-module imports need special treatment!
            // will this break if the module import gets aliased so something else?
            if (ast.subject.kind === 'local-identifier') {
                const binding = resolve(ast.subject.name, ast)

                if (binding?.owner.kind === 'import-all-declaration') {
                    const module = getModuleByName(Store, binding.owner.module as ModuleName, binding.owner.path.value)
                    
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
        case "element-tag": return `${INT}defaultMarkupFunction('${ast.tagName.name}',{${
            objectEntries(excludeTypes, module, (ast.attributes as ([PlainIdentifier, Expression|Expression[]] | Spread)[]))}}, [ ${ast.children.map(c).join(', ')} ])`;
        case "union-type": return ast.members.map(c).join(" | ");
        case "maybe-type": return c(ast.inner) + '|null|undefined'
        case "named-type": return ast.name.name;
        case "generic-type": return "unknown";
        case "bound-generic-type": return `unknown`;
        case "proc-type": return `(${compileArgs(excludeTypes, module, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(excludeTypes, module, ast.args)}) => ${c(ast.returnType ?? UNKNOWN_TYPE)}`;
        case "element-type": return `unknown`;
        case "object-type": return (
            ast.spreads.map(s => c(s) + ' & ').join('') +
            `{${
                ast.entries.map(({ name, type }) =>
                    `${name.name}: ${c(type)}`)
                .join(', ')
            }}`
        );
        case "record-type": return `{[key: ${c(ast.keyType)}]: ${c(ast.valueType)}}`;
        case "array-type": return `${c(ast.element)}[]`;
        case "tuple-type": return `[${ast.members.map(c).join(", ")}]`;
        case "iterator-type": return `${INT}Iter<${c(ast.inner)}>`;
        case "plan-type": return `${INT}Plan<${c(ast.inner)}>`;
        case "error-type": return `${INT}Error<${c(ast.inner)}>`;
        case "remote-type": return `${INT}Remote<${c(ast.inner)}>`;
        case "literal-type": return `${c(ast.value)}`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `(null | undefined)`;
        case "unknown-type": return `unknown`;
        case "parenthesized-type": return `(${c(ast.inner)})`
        case "instance-of": return `${INT}instanceOf(${c(ast.expr)}, ${compileRuntimeType(resolveType(ast.type))})`
        case "as-cast": return `${c(ast.inner)} as ${c(ast.type)}`
        case "error-expression": return `{ kind: ${INT}ERROR_SYM, value: ${c(ast.inner)} }`
        case "throw-statement": return `return ${c(ast.errorExpression)};`

        default:
            throw Error("Couldn't compile '" + ast.kind + "'");
    }
}

function compileRuntimeType(type: TypeExpression): string {
    switch (type.kind) {
        case 'unknown-type': return INT + 'RT_UNKNOWN';
        case 'nil-type': return INT + 'RT_NIL';
        case 'boolean-type': return INT + 'RT_BOOLEAN';
        case 'number-type': return INT + 'RT_NUMBER';
        case 'string-type': return INT + 'RT_STRING';
        case 'literal-type': return `{ kind: ${INT}RT_LITERAL, value: ${JSON.stringify(type.value.value)} }`;
        case 'array-type': return `{ kind: ${INT}RT_ARRAY, inner: ${compileRuntimeType(type.element)} }`;
        case 'record-type': return `{ kind: ${INT}RT_RECORD, key: ${compileRuntimeType(type.keyType)}, value: ${compileRuntimeType(type.valueType)} }`;
        case 'object-type': return `{ kind: ${INT}RT_OBJECT, entries: [${type.entries.map(({ name, type, optional }) =>
            `{ key: '${name.name}', value: ${compileRuntimeType(type)}, optional: ${optional} }`
        )}] }`;
        case 'nominal-type': return `{ kind: ${INT}RT_NOMINAL, nominal: ${type.name.description}.sym }`
        case 'error-type': return `{ kind: ${INT}RT_ERROR, inner: ${compileRuntimeType(type.inner)} }`
        case 'iterator-type': return `{ kind: ${INT}RT_ITERATOR, inner: ${compileRuntimeType(type.inner)} }`
        case 'plan-type': return `{ kind: ${INT}RT_PLAN, inner: ${compileRuntimeType(type.inner)} }`
        case 'remote-type': return `{ kind: ${INT}RT_REMOTE, inner: ${compileRuntimeType(type.inner)} }`
        case 'union-type': return `[ ${type.members.map(compileRuntimeType).join(', ')} ]`;
    }

    throw Error(`Couldn't runtime-compile type ${format(type)}`)
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

const fixTruthinessIfNeeded = (excludeTypes: boolean, module: string, expr: Expression) =>
    needsTruthinessFix(expr)
        ? truthinessOf(compileOne(excludeTypes, module, expr))
        : compileOne(excludeTypes, module, expr)

const needsTruthinessFix = (expr: Expression) => {
    const type = inferType(expr)
    return !subsumes(TRUTHINESS_SAFE_TYPES, type)
}

const truthinessOf = (compiledExpr: string) => 
    `(${compiledExpr} != null && (${compiledExpr} as unknown) !== false && (${compiledExpr} as any).kind !== ${INT}ERROR_SYM)`

const truthify = (excludeTypes: boolean, module: string, leftExpr: Expression, op: "&&"|"||", rest: Expression) => {
    const compiledExpr = compileOne(excludeTypes, module, leftExpr)
    const negation = op === "&&" ? "" : "!"
    return `(${negation + truthinessOf(compiledExpr)} ? ${compileOne(excludeTypes, module, rest)} : ${compiledExpr})`
}

// TODO: const nominal types (generalized const wrapper for any given type?)