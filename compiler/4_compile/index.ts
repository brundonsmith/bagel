import { resolve } from "../3_checking/resolve.ts";
import { resolveType, subsumationIssues } from "../3_checking/typecheck.ts";
import { inferType } from "../3_checking/typeinfer.ts";
import { path } from "../deps.ts";
import { format } from "../other/format.ts";
import { elementTagToObject, getName, invocationFromMethodCall } from "../utils/ast.ts";
import { exists, given } from "../utils/misc.ts";
import { Module, AST, Block, PlainIdentifier } from "../_model/ast.ts";
import { Context, ModuleName } from "../_model/common.ts";
import { TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, ProcDeclaration } from "../_model/declarations.ts";
import { Expression, Proc, Func, JsFunc, JsProc } from "../_model/expressions.ts";
import { FuncType, GenericFuncType, GenericProcType, NIL_TYPE, ProcType, TRUTHINESS_SAFE_TYPES, TypeExpression, TypeParam, UNKNOWN_TYPE } from "../_model/type-expressions.ts";

export type CompileContext =  Pick<Context, "allModules"|"canonicalModuleName"> & { moduleName: ModuleName, transpilePath: (module: string) => string, includeTests?: boolean, excludeTypes?: boolean }

export const compile = (ctx: CompileContext, ast: Module, excludeJsPrelude?: boolean): string => {
    return (
        (excludeJsPrelude ? '' : JS_PRELUDE) + 
        compileInner(
            ctx,
            ast
        )
    )
}

export const IMPORTED_ITEMS: readonly string[] = [
    // reactivity
    'observe', 'invalidate', 'memo', 'autorun', 'action', 'WHOLE_OBJECT', 

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


function compileInner(ctx: CompileContext, module: Module): string {
    const { includeTests } = ctx

    const runtimeCode = module.declarations
        .filter(decl => decl.kind !== 'test-expr-declaration' && decl.kind !== 'test-block-declaration')
        .map(decl => compileOne(ctx, decl) + ';')
        .join("\n\n");

    if (includeTests && module.declarations.some(decl => decl.kind === 'test-expr-declaration' || decl.kind === 'test-block-declaration')) {
        return runtimeCode + `\n export const ___tests = {
            testExprs: [${
                module.declarations
                    .filter((decl): decl is TestExprDeclaration => decl.kind === "test-expr-declaration")
                    .map(decl => 
                        `{ name: '${decl.name.value}', expr: ${compileOne(ctx, decl.expr)} }`)
                    .join(',\n')
            }],
            testBlocks: [${
                module.declarations
                    .filter((decl): decl is TestBlockDeclaration => decl.kind === "test-block-declaration")
                    .map(decl => 
                        `{ name: '${decl.name.value}', block: () => ${compileOne(ctx, decl.block)} }`)
                    .join(',\n')
            }]
        }`
    } else {
        return runtimeCode
    }
}

function compileOne(ctx: CompileContext, ast: AST): string {
    const { allModules, moduleName, excludeTypes, transpilePath, canonicalModuleName } = ctx
    const c = (ast: AST) => compileOne(ctx, ast)

    switch(ast.kind) {
        case "import-all-declaration":
        case "import-declaration": {
            const importedModuleName = ast.module && canonicalModuleName(ast.module as ModuleName, ast.path.value)
            const importedModuleType = importedModuleName && allModules.get(importedModuleName)?.ast?.moduleType

            const imported = (
                ast.kind === 'import-declaration' ?
                    '{ ' + ast.imports.map(({ name, alias }) => c(name) + (alias ? ` as ${c(alias)}` : ``)).join(", ") + ' }'
                : importedModuleType === 'json' || importedModuleType === 'text' ?
                    `{ CONTENTS as ${ast.name.name} }`
                :
                    `* as ${ast.name.name}`
            )

            const importedModule = canonicalModuleName(moduleName, ast.path.value)

            // console.log({ module, importedModule, builtModule: buildFilePath(module), builtImportedModule: buildFilePath(importedModule) })
            // console.log('./' + path.relative(path.dirname(buildFilePath(module)), buildFilePath(importedModule)))

            const jsImportPath = (
                './' + path.relative(path.dirname(transpilePath(moduleName)), transpilePath(importedModule))
            ).replaceAll(/\\/g, '/')
            
            return `import ${imported} from "${jsImportPath}"`
        }
        case "type-declaration": {
            const valueTypeDecl = ast.type.kind === 'nominal-type' && ast.type.inner ? `value: ${c(ast.type.inner)}` : ''

            return (
                excludeTypes
                    ? ''
                    : (
                        (ast.type.kind === 'nominal-type' ?
                            `const ${INT}${ast.name.name} = Symbol('${ast.name.name}');\n` +
                            `${exported(ast.exported)}const ${ast.name.name} = ((${valueTypeDecl}): ${ast.name.name} => ({ kind: ${INT}${ast.name.name}, value })) as (((${valueTypeDecl}) => ${ast.name.name}) & { sym: typeof ${INT}${ast.name.name} });\n` +
                            `${ast.name.name}.sym = ${INT}${ast.name.name};\n`
                        : '') +
                        `${exported(ast.exported)}type ${ast.name.name} = ${ast.type.kind === 'nominal-type'
                            ? `{ kind: typeof ${INT}${ast.name.name}${valueTypeDecl ? `, ${valueTypeDecl}` : '' } }`
                            : c(ast.type)}`
                    )
            );
        }
        case "proc-declaration":
            return compileProcDeclaration(ctx, ast)
        case "func-declaration":
            return compileFuncDeclaration(ctx, ast)
        case "value-declaration":
        case "declaration-statement":
        case "inline-declaration": {
            const prefix = ast.kind === 'value-declaration' ? exported(ast.exported) : ''

            const typeAst = (
                ast.kind === 'value-declaration' ? ast.type :
                ast.destination.kind === 'name-and-type' ? ast.destination.type :
                undefined
            )

            const type = (
                given(typeAst, type =>
                    ast.kind === 'inline-declaration' || ast.isConst
                        ? c(type)
                        : `{ value: ${c(type)} }`)
            )

            const destination = (
                ast.kind === 'value-declaration'
                    ? ast.name.name + (!excludeTypes && type != null ? ': ' + type : '')
                    : c(ast.destination)
            )
            
            const value = (
                ast.kind === 'inline-declaration' || ast.isConst
                    ? c(ast.value)
                    : `{ value: ${c(ast.value)} }`
            )

            const semicolon = (
                ast.kind === 'inline-declaration'
                    ? ';'
                    : ''
            )

            return prefix + `const ${destination} = ${ast.kind !== 'value-declaration' && ast.awaited ? awaited(value) : value}${semicolon}`
        }
        case "name-and-type":
            return ast.name.name + maybeTypeAnnotation(ctx, ast.type)
        case "destructure": {
            const [l, r] = ast.destructureKind === 'object' ? ['{', '}'] : ['[', ']']
            const entries = [
                ast.properties.map(p => p.name),
                ast.spread ? '...' + ast.spread.name : undefined
            ].filter(s => s != null)

            return `${l} ${entries.join(', ')} ${r}`
        }
        case "derive-declaration": 
            return exported(ast.exported) + `const ${ast.name.name}${ast.type ? `: () => ${c(ast.type)}` : ``} = ${INT}memo(
                () => ${c(ast.expr)}
            )`
        case "remote-declaration": {
            return exported(ast.exported) + `const ${ast.name.name}${ast.type ? `: ${INT}Remote<${c(ast.type)}>` : ``} = new ${INT}Remote(
                () => ${c(ast.expr)}
            )`
        }
        case "autorun": return `${INT}autorun(() => ${c(ast.effect)}, ${ast.until ? '() => ' + fixTruthinessIfNeeded(ctx, ast.until) : 'undefined'})`;
        case "assignment": {
            const value = c(ast.value)
            const op = ast.operator?.op ?? ''

            if (ast.target.kind === 'local-identifier') {
                const binding = resolve(ctx, ast.target.name, ast.target, true)

                if ((binding?.owner.kind === 'value-declaration' || binding?.owner.kind === 'declaration-statement') && !binding.owner.isConst) {
                    return `${ast.target.name}.value ${op}= ${value}; ${INT}invalidate(${ast.target.name}, 'value')`
                } else {
                    return `${ast.target.name} ${op}= ${value}`
                }
            } else {
                const property = (
                    ast.target.property.kind === 'plain-identifier'
                        ? `.${ast.target.property.name}`
                        : `[${c(ast.target.property)}]`
                )

                const propertyExpr = propertyAsExpression(ctx, ast.target.property)

                return `${c(ast.target.subject)}${property} ${op}= ${value}; ${INT}invalidate(${c(ast.target.subject)}, ${propertyExpr})`
            }
        }
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${fixTruthinessIfNeeded(ctx, condition)}) ${c(outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${c(ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${c(ast.itemIdentifier)} of ${c(ast.iterator)}.inner) ${c(ast.body)}`;
        case "while-loop": return `while (${fixTruthinessIfNeeded(ctx, ast.condition)}) ${c(ast.body)}`;
        case "proc":
        case "js-proc":
            return compileProc(ctx, ast);
        case "func":
        case "js-func":
            return compileFunc(ctx, ast);
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
        case "invocation": {
            
            // method call
            const invocation = invocationFromMethodCall(ctx, ast) ?? ast;

            const subjectType = inferType(ctx, invocation.subject)

            const typeArgs = invocation.kind === "invocation" && invocation.typeArgs.length > 0 ? `<${invocation.typeArgs.map(c).join(',')}>` : ''
            const args = [...invocation.args, invocation.spreadArg].filter(exists).map(c).join(', ')

            const baseInvocation = `${c(invocation.subject)}${typeArgs}(${args})`
            const compiledInvocation = (
                ast.awaitedOrDetached === 'await' ? awaited(baseInvocation) :
                ast.awaitedOrDetached === 'detach' ? detached(baseInvocation) :
                baseInvocation
            )

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
            if ((ast.op.op === '&&' || ast.op.op === '||') && needsTruthinessFix(ctx, ast.left)) {
                return truthify(ctx, ast.left, ast.op.op, ast.right)
            }

            if (ast.op.op === '==' || ast.op.op === '!=') {
                const leftType = inferType(ctx, ast.left)
                const rightType = inferType(ctx, ast.right)

                if (!subsumationIssues(ctx, NIL_TYPE, leftType) || !subsumationIssues(ctx, NIL_TYPE, rightType)) {
                    return `(${c(ast.left)} ${ast.op.op} ${c(ast.right)})`; // special case for nil-comparisons because of null/undefined
                } else {
                    return `(${c(ast.left)} ${ast.op.op}= ${c(ast.right)})`;
                }
            }

            return `(${c(ast.left)} ${ast.op.op} ${c(ast.right)})`;
        }
        case "negation-operator": return `!(${fixTruthinessIfNeeded(ctx, ast.base)})`;
        case "operator": return ast.op;
        case "if-else-expression":
            return '(' + ast.cases.map(c).join('\n') + (ast.defaultCase ? c(ast.defaultCase) : NIL) + ')'
        case "case":
            return fixTruthinessIfNeeded(ctx, ast.condition) + ` ? ${c(ast.outcome)} : `
        case "switch-expression": return '(' + ast.cases
            .map(({ type, outcome }) => 
                `${INT}instanceOf(${c(ast.value)}, ${compileRuntimeType(resolveType(ctx, type))})` +
                ` ? ${c(outcome)} : `)
            .join('\n')
        + (ast.defaultCase ? c(ast.defaultCase) : NIL) + ')'
        case "range": return `${INT}range(${c(ast.start)}, ${c(ast.end)})`;
        case "parenthesized-expression": return `(${c(ast.inner)})`;
        case "debug": return c(ast.inner);
        case "plain-identifier": return ast.name;
        case "local-identifier": {
            const binding = resolve(ctx, ast.name, ast, true)

            if ((binding?.owner.kind === 'value-declaration' || binding?.owner.kind === 'declaration-statement') && !binding.owner.isConst) {
                return `${INT}observe(${ast.name}, 'value')`
            } else if (binding?.owner.kind === 'derive-declaration') {
                return `${ast.name}()`
            } else {
                return ast.name
            }
        }
        case "property-accessor": {

            // HACK: let-declarations accessed from whole-module imports need special treatment!
            // will this break if the module import gets aliased to something else?
            const property = ast.property
            if (ast.subject.kind === 'local-identifier' && property.kind === 'plain-identifier') {
                const binding = resolve(ctx, ast.subject.name, ast)

                if (binding?.owner.kind === 'import-all-declaration') {
                    const moduleName = canonicalModuleName(binding.owner.module as ModuleName, binding.owner.path.value)
                    const module = allModules.get(moduleName)?.ast
                    
                    // TODO: forbid using indexer brackets on whole-module import (do we get this for free already?)
                    if (module?.declarations.some(decl =>
                            decl.kind === 'value-declaration' && !decl.isConst && decl.name.name === property.name)) {
                        return `${INT}observe(${INT}observe(${c(ast.subject)}, '${property.name}'), 'value')`;
                    }
                }
            }

            const propertyExpr = propertyAsExpression(ctx, property)

            return `${INT}observe(${c(ast.subject)}, ${propertyExpr})`;
        }
        case "object-literal":  return `{${ast.entries.map(c).join(', ')}}`;
        case "object-entry": {
            const key = ast.key.kind === 'plain-identifier' || ast.key.kind === 'exact-string-literal'
                ? c(ast.key)
                : `[${c(ast.key)}]`
            
            return `${key}: ${c(ast.value)}`
        }
        case "array-literal":   return `[${ast.entries.map(c).join(", ")}]`;
        case "string-literal":  return `\`${ast.segments.map(segment =>
                                            typeof segment === "string"
                                                ? segment.replaceAll("'", "\\'").replaceAll('$', '\\$').replaceAll('\\', '\\\\')
                                                : '${' + c(segment) + '}').join("")}\``;
        case "spread": return `...${c(ast.expr)}`;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "block": return `{ ${blockContents(ctx, ast)} }`;
        case "element-tag": return c(elementTagToObject(ast));
        case "union-type": return ast.members.map(c).join(" | ");
        case "maybe-type": return c(ast.inner) + '|null|undefined'
        case "named-type": return ast.name.name;
        case "generic-type": return "unknown";
        case "bound-generic-type": return `unknown`;
        case "proc-type": return `(${c(ast.args)}) => void`;
        case "func-type": return `(${c(ast.args)}) => ${c(ast.returnType ?? UNKNOWN_TYPE)}`;
        case "args": return ast.args.map(
            (arg, index) => (arg.name?.name ?? `_arg${index}`) + maybeTypeAnnotation(ctx, arg.type)
        ).join(', ')
        case "spread-args": return `...${ast.name?.name ?? '_args'}` + maybeTypeAnnotation(ctx, ast.type)
        case "object-type": return (
            ast.spreads.map(s => c(s) + ' & ').join('') +
            `{${
                ast.entries
                    .map(c)
                    .join(', ')
            }}`
        );
        case "attribute":
            return `${c(ast.name)}: ${c(ast.type)}`
        case "record-type": return `Record<${c(ast.keyType)}, ${c(ast.valueType)}>`;
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
        case "readonly-type": return `Readonly<${c(ast.inner)}>`;
        case "unknown-type":
        case "poisoned-type":
            return `unknown`;
        case "parenthesized-type": return `(${c(ast.inner)})`
        case "instance-of": return `${INT}instanceOf(${c(ast.expr)}, ${compileRuntimeType(resolveType(ctx, ast.type))})`
        case "as-cast": return `${c(ast.inner)} as ${c(ast.type)}`
        case "error-expression": return `{ kind: ${INT}ERROR_SYM, value: ${c(ast.inner)} }`
        case "throw-statement": return `return ${c(ast.errorExpression)};`
        case "regular-expression": return `/${ast.expr}/${ast.flags.join('')}`
        case "regular-expression-type": return 'RegExp'

        default:
            throw Error("Couldn't compile '" + format(ast) + "'");
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
            `{ key: '${getName(name)}', value: ${compileRuntimeType(type)}, optional: ${optional} }`
        )}] }`;
        case 'nominal-type': return `{ kind: ${INT}RT_NOMINAL, nominal: ${type.name}.sym }`
        case 'error-type': return `{ kind: ${INT}RT_ERROR, inner: ${compileRuntimeType(type.inner)} }`
        case 'iterator-type': return `{ kind: ${INT}RT_ITERATOR, inner: ${compileRuntimeType(type.inner)} }`
        case 'plan-type': return `{ kind: ${INT}RT_PLAN, inner: ${compileRuntimeType(type.inner)} }`
        case 'remote-type': return `{ kind: ${INT}RT_REMOTE, inner: ${compileRuntimeType(type.inner)} }`
        case 'union-type': return `[ ${type.members.map(compileRuntimeType).join(', ')} ]`;
    }

    throw Error(`Couldn't runtime-compile type ${format(type)}`)
}

function propertyAsExpression (ctx: CompileContext, property: PlainIdentifier | Expression) {
    return (
        property.kind === 'plain-identifier'
            ? `'${property.name}'`
            : compileOne(ctx, property)
    )
}

function blockContents(ctx: CompileContext, block: Block) {
    return block.statements.map(s => '\n' + compileOne(ctx, s) + ';').join('') + '\n'
}

export const INT = `___`;
export const INT_FN = INT + 'fn_'

const NIL = `undefined`;


const compileProcDeclaration = (ctx: CompileContext, decl: ProcDeclaration): string => {
    let proc = compileProc(ctx, decl.value, decl.name.name)
    
    for (const dec of decl.decorators) {
        proc = compileOne(ctx, dec.decorator) + `(${proc})`
    }
    
    return exported(decl.exported) + `const ${decl.name.name} = ` + proc;
}
const compileFuncDeclaration = (ctx: CompileContext, decl: FuncDeclaration): string => {
    let func = compileFunc(ctx, decl.value, decl.name.name)

    for (const dec of decl.decorators) {
        func = compileOne(ctx, dec.decorator) + `(${func})`
    }
    
    return exported(decl.exported) + `const ${decl.name.name} = ` + func;
}

function compileProc(ctx: CompileContext, proc: Proc|JsProc, name?: string): string {
    const nameStr = name ? INT_FN + name : ''
    const signature = compileProcOrFunctionSignature(ctx, proc.type)
    return (proc.kind === 'proc' && proc.isAsync ? 'async ' : '') + 'function ' + nameStr + signature + `${proc.kind === 'js-proc' ? `{${proc.body}}` : compileOne(ctx, proc.body)}`;
}
const compileFunc = (ctx: CompileContext, func: Func|JsFunc, name?: string): string => {
    const nameStr = name ? INT_FN + name : ''
    const signature = compileProcOrFunctionSignature(ctx, func.type)
    return 'function ' + nameStr + signature + ' { ' + (func.kind === 'js-func' ? func.body : `return ${compileOne(ctx, func.body)}`) + ' }'
}

const compileProcOrFunctionSignature = (ctx: CompileContext, subject: ProcType|GenericProcType|FuncType|GenericFuncType): string => {
    const { excludeTypes } = ctx

    const typeParams = !excludeTypes && subject.kind === 'generic-type'
        ? maybeTypeParams(ctx, subject.typeParams)
        : ''
    const functionType = subject.kind === 'generic-type' ? subject.inner : subject

    return (
        typeParams + 
        `(${compileOne(ctx, functionType.args)})` +
        (excludeTypes ? '' : 
        functionType.kind === 'proc-type' ? (functionType.isAsync ? ': Promise<void>' : ': void') : 
        functionType.returnType != null ? `: ${compileOne(ctx, functionType.returnType)}` :
        '')
    )
}

function exported(e: boolean|"export"|"expose"|undefined): string {
    return e ? 'export ' : ''
}

function maybeTypeParams(ctx: CompileContext, typeParams: readonly TypeParam[]): string {
    const { excludeTypes } = ctx

    if (excludeTypes || typeParams.length === 0) {
        return ''
    } else {
        return `<${typeParams.map(p =>
            p.name.name + (p.extends ? ` extends ${compileOne(ctx, p.extends)}` : '')
        ).join(', ')}>`
    }
}

function maybeTypeAnnotation(ctx: CompileContext, type: TypeExpression|undefined): string {
    const { excludeTypes } = ctx

    return !excludeTypes && type ? `: ${compileOne(ctx, type)}` : ''
}

const fixTruthinessIfNeeded = (ctx: CompileContext, expr: Expression) =>
    needsTruthinessFix(ctx, expr)
        ? truthinessOf(compileOne(ctx, expr))
        : compileOne(ctx, expr)

const needsTruthinessFix = (ctx: Pick<Context, "allModules"|"canonicalModuleName">, expr: Expression) => {
    const type = inferType(ctx, expr)
    return subsumationIssues(ctx, TRUTHINESS_SAFE_TYPES, type) != null
}

const truthinessOf = (compiledExpr: string) => 
    `(${compiledExpr} != null && (${compiledExpr} as unknown) !== false && (${compiledExpr} as any).kind !== ${INT}ERROR_SYM)`

const truthify = (ctx: CompileContext, leftExpr: Expression, op: "&&"|"||", rest: Expression) => {
    const compiledExpr = compileOne(ctx, leftExpr)
    const negation = op === "&&" ? "" : "!"
    return `(${negation + truthinessOf(compiledExpr)} ? ${compileOne(ctx, rest)} : ${compiledExpr})`
}

const awaited = (plan: string) =>
    `await (${plan})()`

const detached = (plan: string) =>
    plan + '()'

// TODO: const nominal types (generalized const wrapper for any given type?)