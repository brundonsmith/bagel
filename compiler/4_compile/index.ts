import { computedFn } from "../../lib/ts/reactivity.ts";
import { parsed } from "../1_parse/index.ts";
import { resolve } from "../3_checking/resolve.ts";
import { resolveType, subsumationIssues } from "../3_checking/typecheck.ts";
import { elementTagToObject, inferType, invocationFromMethodCall } from "../3_checking/typeinfer.ts";
import { format } from "../other/format.ts";
import { canonicalModuleName, getModuleByName } from "../store.ts";
import { getName } from "../utils/ast.ts";
import { jsFileLocation } from "../utils/misc.ts";
import { Module, AST, Block, PlainIdentifier } from "../_model/ast.ts";
import { ModuleName } from "../_model/common.ts";
import { TestExprDeclaration, TestBlockDeclaration, FuncDeclaration, ProcDeclaration } from "../_model/declarations.ts";
import { Expression, Proc, Func, JsFunc, JsProc } from "../_model/expressions.ts";
import { Arg, FuncType, GenericFuncType, GenericProcType, ProcType, TRUTHINESS_SAFE_TYPES, TypeExpression, TypeParam, UNKNOWN_TYPE } from "../_model/type-expressions.ts";

export const compiled = (moduleName: ModuleName, destination: 'cache'|'project', excludeJsPrelude?: boolean, includeTests?: boolean): string => {
    const ast = parsed(moduleName)?.ast

    if (!ast) {
        return ''
    }

    return compile(moduleName, ast, destination, excludeJsPrelude, includeTests)
}

export const compile = computedFn(function compile (moduleName: ModuleName, ast: Module, destination: 'cache'|'project', excludeJsPrelude?: boolean, includeTests?: boolean, excludeTypes?: boolean): string {
    return (
        (excludeJsPrelude ? '' : JS_PRELUDE) + 
        compileInner(
            ast, 
            moduleName,
            destination,
            includeTests,
            excludeTypes
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


function compileInner(module: Module, modulePath: ModuleName, destination: 'cache'|'project', includeTests?: boolean, excludeTypes = false): string {
    const runtimeCode = module.declarations
        .filter(decl => decl.kind !== 'test-expr-declaration' && decl.kind !== 'test-block-declaration')
        .map(decl => compileOne(excludeTypes, modulePath, destination, decl) + ';')
        .join("\n\n") + (module.hasMain ? "\nsetTimeout(main, 0);\n" : "");

    if (includeTests) {
        return runtimeCode + `\n export const tests = {
            testExprs: [${
                module.declarations
                    .filter((decl): decl is TestExprDeclaration => decl.kind === "test-expr-declaration")
                    .map(decl => 
                        `{ name: '${decl.name.value}', expr: ${compileOne(excludeTypes, modulePath, destination, decl.expr)} }`)
                    .join(',\n')
            }],
            testBlocks: [${
                module.declarations
                    .filter((decl): decl is TestBlockDeclaration => decl.kind === "test-block-declaration")
                    .map(decl => 
                        `{ name: '${decl.name.value}', block: () => ${compileOne(excludeTypes, modulePath, destination, decl.block)} }`)
                    .join(',\n')
            }]
        }`
    } else {
        return runtimeCode
    }
}

function compileOne(excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', ast: AST): string {
    const c = (ast: AST) => compileOne(excludeTypes, module, destination, ast)

    switch(ast.kind) {
        case "import-all-declaration":
        case "import-declaration": {
            const importedModuleType = ast.module && getModuleByName(ast.module, ast.path.value)?.moduleType
            const imported = (
                ast.kind === 'import-declaration' ?
                    '{ ' + ast.imports.map(({ name, alias }) => c(name) + (alias ? ` as ${c(alias)}` : ``)).join(", ") + ' }'
                : importedModuleType === 'json' || importedModuleType === 'text' ?
                    `{ CONTENTS as ${ast.name.name} }`
                :
                    `* as ${ast.name.name}`
            )

            const jsImportPath = jsFileLocation(canonicalModuleName(module, ast.path.value), destination).replaceAll(/\\/g, '/')
                
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
            return compileProcDeclaration(excludeTypes, module, destination, ast)
        case "func-declaration":
            return compileFuncDeclaration(excludeTypes, module, destination, ast)
        case "value-declaration": {
            const prefix = exported(ast.exported)

            if (!ast.isConst) {
                const type = !excludeTypes && ast.type ? `: { value: ${c(ast.type)} }` : ''
                return prefix + `const ${ast.name.name}${type} = { value: ${c(ast.value)} }`
            } else {
                const type = maybeTypeAnnotation(excludeTypes, module, destination, ast.type)
                return prefix + `const ${ast.name.name}${type} = ${c(ast.value)}`;
            }
        }
        case "declaration-statement":
        case "inline-declaration": {
            const keyword = (
                ast.kind === 'declaration-statement' && !ast.isConst
                    ? 'let'
                    : 'const'
            )
            const value = c(ast.value)

            return `${keyword} ${c(ast.destination)} = ${ast.awaited ? awaited(value) : value}` + (ast.kind === 'inline-declaration' ? ';' : '')
        }
        case "name-and-type":
            return ast.name.name + maybeTypeAnnotation(excludeTypes, module, destination, ast.type)
        case "destructure": {
            const [l, r] = ast.destructureKind === 'object' ? ['{', '}'] : ['[', ']']
            const entries = [
                ast.properties.map(p => p.name),
                ast.spread ? '...' + ast.spread.name : undefined
            ].filter(s => s != null)

            return `${l} ${entries.join(', ')} ${r}`
        }
        case "derive-declaration": 
            return exported(ast.exported) + `const ${ast.name.name}${ast.type ? `: () => ${c(ast.type)}` : ``} = ${INT}computedFn(
                () => ${c(ast.expr)}
            )`
        case "remote-declaration": {
            return exported(ast.exported) + `const ${ast.name.name}${ast.type ? `: ${INT}Remote<${c(ast.type)}>` : ``} = new ${INT}Remote(
                () => ${c(ast.expr)}
            )`
        }
        case "autorun-declaration": return `${INT}autorun(() => ${c(ast.effect)})`;
        case "assignment": {
            const value = c(ast.value)

            if (ast.target.kind === 'local-identifier') {
                const binding = resolve(ast.target.name, ast.target)

                if (binding?.owner.kind === 'value-declaration' && !binding.owner.isConst) {
                    return `${ast.target.name}.value = ${value}; ${INT}invalidate(${ast.target.name}, 'value')`
                } else {
                    return `${ast.target.name} = ${value}`
                }
            } else {
                const property = (
                    ast.target.property.kind === 'plain-identifier'
                        ? `.${ast.target.property.name}`
                        : `[${c(ast.target.property)}]`
                )

                const propertyExpr = propertyAsExpression(excludeTypes, module, destination, ast.target.property)

                return `${c(ast.target.subject)}${property} = ${value}; ${INT}invalidate(${c(ast.target.subject)}, ${propertyExpr})`
            }
        }
        case "if-else-statement": return 'if ' + ast.cases
            .map(({ condition, outcome }) => 
                `(${fixTruthinessIfNeeded(excludeTypes, module, destination, condition)}) ${c(outcome)}`)
            .join(' else if ')
            + (ast.defaultCase ? ` else ${c(ast.defaultCase)}` : '');
        case "for-loop": return `for (const ${c(ast.itemIdentifier)} of ${c(ast.iterator)}.inner) ${c(ast.body)}`;
        case "while-loop": return `while (${fixTruthinessIfNeeded(excludeTypes, module, destination, ast.condition)}) ${c(ast.body)}`;
        case "proc":
        case "js-proc":
            return compileProc(excludeTypes, module, destination, ast);
        case "func":
        case "js-func":
            return compileFunc(excludeTypes, module, destination, ast);
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
            const invocation = invocationFromMethodCall(ast) ?? ast;

            const subjectType = inferType(invocation.subject)

            const typeArgs = invocation.kind === "invocation" && invocation.typeArgs.length > 0 ? `<${invocation.typeArgs.map(c).join(',')}>` : ''
            const args = invocation.args.map(c).join(', ')

            const baseInvocation = `${c(invocation.subject)}${typeArgs}(${args})`
            const compiledInvocation = (
                ast.awaited
                    ? awaited(baseInvocation)
                    : baseInvocation
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
            if ((ast.op.op === '&&' || ast.op.op === '||') && needsTruthinessFix(ast.left)) {
                return truthify(excludeTypes, module, destination, ast.left, ast.op.op, ast.right)
            }

            if (ast.op.op === '==') {
                return `(${c(ast.left)} === ${c(ast.right)})`;
            }

            if (ast.op.op === '!=') {
                return `(${c(ast.left)} !== ${c(ast.right)})`;
            }

            return `(${c(ast.left)} ${ast.op.op} ${c(ast.right)})`;
        }
        case "negation-operator": return `!(${fixTruthinessIfNeeded(excludeTypes, module, destination, ast.base)})`;
        case "operator": return ast.op;
        case "if-else-expression":
            return '(' + ast.cases.map(c).join('\n') + (ast.defaultCase ? c(ast.defaultCase) : NIL) + ')'
        case "case":
            return fixTruthinessIfNeeded(excludeTypes, module, destination, ast.condition) + ` ? ${c(ast.outcome)} : `
        case "switch-expression": return '(' + ast.cases
            .map(({ type, outcome }) => 
                `${INT}instanceOf(${c(ast.value)}, ${compileRuntimeType(resolveType(type))})` +
                ` ? ${c(outcome)} : `)
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
            // will this break if the module import gets aliased to something else?
            const property = ast.property
            if (ast.subject.kind === 'local-identifier' && property.kind === 'plain-identifier') {
                const binding = resolve(ast.subject.name, ast)

                if (binding?.owner.kind === 'import-all-declaration') {
                    const module = getModuleByName(binding.owner.module as ModuleName, binding.owner.path.value)
                    
                    // TODO: forbid using indexer brackets on whole-module import (do we get this for free already?)
                    if (module?.declarations.some(decl =>
                            decl.kind === 'value-declaration' && !decl.isConst && decl.name.name === property.name)) {
                        return `${INT}observe(${INT}observe(${c(ast.subject)}, '${property.name}'), 'value')`;
                    }
                }
            }

            const propertyExpr = propertyAsExpression(excludeTypes, module, destination, property)

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
                                                ? segment
                                                : '${' + c(segment) + '}').join("")}\``;
        case "spread": return `...${c(ast.expr)}`;
        case "exact-string-literal":
        case "number-literal":
        case "boolean-literal": return JSON.stringify(ast.value);
        case "nil-literal": return NIL;
        case "javascript-escape": return ast.js;
        case "block": return `{ ${blockContents(excludeTypes, module, destination, ast)} }`;
        case "element-tag": return c(elementTagToObject(ast));
        case "union-type": return ast.members.map(c).join(" | ");
        case "maybe-type": return c(ast.inner) + '|null|undefined'
        case "named-type": return ast.name.name;
        case "generic-type": return "unknown";
        case "bound-generic-type": return `unknown`;
        case "proc-type": return `(${compileArgs(excludeTypes, module, destination, ast.args)}) => void`;
        case "func-type": return `(${compileArgs(excludeTypes, module, destination, ast.args)}) => ${c(ast.returnType ?? UNKNOWN_TYPE)}`;
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

function propertyAsExpression (excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', property: PlainIdentifier | Expression) {
    return (
        property.kind === 'plain-identifier'
            ? `'${property.name}'`
            : compileOne(excludeTypes, module, destination, property)
    )
}

function blockContents(excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', block: Block) {
    return block.statements.map(s => '\n' + compileOne(excludeTypes, module, destination, s) + ';').join('') + '\n'
}

export const INT = `___`;

const NIL = `undefined`;


const compileProcDeclaration = (excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', decl: ProcDeclaration): string => {
    const baseProc = compileOne(excludeTypes, module, destination, decl.value)
    const proc = decl.action ? `${INT}action(${baseProc})` : baseProc
    
    return exported(decl.exported) + `const ${decl.name.name} = ` + proc;
}
const compileFuncDeclaration = (excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', decl: FuncDeclaration): string => {
    const baseFunc = compileOne(excludeTypes, module, destination, decl.value)
    const func = decl.memo ? `${INT}computedFn(${baseFunc})` : baseFunc
    
    return exported(decl.exported) + `const ${decl.name.name} = ` + func;
}

function compileProc(excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', proc: Proc|JsProc): string {
    const signature = compileProcOrFunctionSignature(excludeTypes, module, destination, proc.type)
    return signature + ` => ${proc.kind === 'js-proc' ? `{${proc.body}}` : compileOne(excludeTypes, module, destination, proc.body)}`;
}
const compileFunc = (excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', func: Func|JsFunc): string => {
    const signature = compileProcOrFunctionSignature(excludeTypes, module, destination, func.type)
    return signature + ' => ' + (func.kind === 'js-func' ? `{${func.body}}` : `(${compileOne(excludeTypes, module, destination, func.body)})`)
}

const compileProcOrFunctionSignature = (excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', subject: ProcType|GenericProcType|FuncType|GenericFuncType): string => {
    const typeParams = !excludeTypes && subject.kind === 'generic-type'
        ? maybeTypeParams(excludeTypes, module, destination, subject.typeParams)
        : ''
    const functionType = subject.kind === 'generic-type' ? subject.inner : subject

    return (functionType.kind === 'proc-type' && functionType.isAsync ? 'async ' : '') +
        typeParams + 
        `(${compileArgs(excludeTypes, module, destination, functionType.args)})` +
        (excludeTypes ? '' : 
        functionType.kind === 'proc-type' ? (functionType.isAsync ? ': Promise<void>' : ': void') : 
        functionType.returnType != null ? `: ${compileOne(excludeTypes, module, destination, functionType.returnType)}` :
        '')
}

function compileArgs(excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', args: readonly Arg[]): string {
    return args.map(arg =>
        arg.name.name + maybeTypeAnnotation(excludeTypes, module, destination, arg.type)).join(', ')
}

function exported(e: boolean|"export"|"expose"|undefined): string {
    return e ? 'export ' : ''
}

function maybeTypeParams(excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', typeParams: readonly TypeParam[]): string {
    if (excludeTypes || typeParams.length === 0) {
        return ''
    } else {
        return `<${typeParams.map(p =>
            p.name.name + (p.extends ? ` extends ${compileOne(excludeTypes, module, destination, p.extends)}` : '')
        ).join(', ')}>`
    }
}

function maybeTypeAnnotation(excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', type: TypeExpression|undefined): string {
    return !excludeTypes && type ? `: ${compileOne(excludeTypes, module, destination, type)}` : ''
}

const fixTruthinessIfNeeded = (excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', expr: Expression) =>
    needsTruthinessFix(expr)
        ? truthinessOf(compileOne(excludeTypes, module, destination, expr))
        : compileOne(excludeTypes, module, destination, expr)

const needsTruthinessFix = (expr: Expression) => {
    const type = inferType(expr)
    return subsumationIssues(TRUTHINESS_SAFE_TYPES, type) != null
}

const truthinessOf = (compiledExpr: string) => 
    `(${compiledExpr} != null && (${compiledExpr} as unknown) !== false && (${compiledExpr} as any).kind !== ${INT}ERROR_SYM)`

const truthify = (excludeTypes: boolean, module: ModuleName, destination: 'cache'|'project', leftExpr: Expression, op: "&&"|"||", rest: Expression) => {
    const compiledExpr = compileOne(excludeTypes, module, destination, leftExpr)
    const negation = op === "&&" ? "" : "!"
    return `(${negation + truthinessOf(compiledExpr)} ? ${compileOne(excludeTypes, module, destination, rest)} : ${compiledExpr})`
}

const awaited = (plan: string) =>
    `await (${plan})()`

// TODO: const nominal types (generalized const wrapper for any given type?)