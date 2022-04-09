
import { parsed } from "../1_parse/index.ts";
import { computedFn } from "../mobx.ts";
import { _Store } from "../store.ts";
import { AST } from '../_model/ast.ts'
import { ModuleName } from "../_model/common.ts";
import { Spread } from "../_model/expressions.ts";
import { TypeExpression, TypeParam, UNKNOWN_TYPE } from "../_model/type-expressions.ts";

export type FormatOptions = {
    spaces: number
}

export const DEFAULT_OPTIONS: FormatOptions = {
    spaces: 4
}

export const formatted = computedFn((store: _Store, moduleName: ModuleName): string => {
    const ast = parsed(store, moduleName)?.ast

    if (ast?.moduleType === 'bgl') {
        return (
            format(
                ast,
                DEFAULT_OPTIONS
            )
        )
    } else {
        return store.modulesSource.get(moduleName) ?? ''
    }
})

export function format(ast: AST, options: FormatOptions = DEFAULT_OPTIONS): string {
    return formatInner(options, 0, undefined)(ast)
}

const formatInner = (options: FormatOptions, indent: number, parent: AST|undefined) => (ast: AST): string => {
    const f = formatInner(options, indent, ast)
    const fIndent = formatInner(options, indent + 1, ast)
    const currentIndentation = indentation(options, indent)
    const nextIndentation = indentation(options, indent + 1)

    switch (ast.kind) {
        case "module":
            return ast.declarations.map(f).join('\n\n')
        case "import-all-declaration":
            return `import ${f(ast.path)} as ${ast.alias.name}`
        case "import-declaration":
            return `from '${ast.path.value}' import { ${ast.imports.map(f)} }`
        case "import-item":
            return ast.name.name + (ast.alias ? ' as ' + ast.alias.name : '')
        case "func-declaration":
        case "proc-declaration": {
            const front = 
                (ast.value.kind === 'js-func' || ast.value.kind === 'js-proc' ? 'js ' : '') +
                exported(ast.exported) + 
                (ast.kind === 'func-declaration' ? 'func ' : 'proc ') +
                (ast.kind === 'func-declaration' && ast.memo ? 'memo ' : '') +
                (ast.kind === 'proc-declaration' && ast.action ? 'action ' : '') +
                ast.name.name

            const subjectType = ast.value.type.kind === 'generic-type' ? ast.value.type.inner : ast.value.type

            return front + 
                (ast.value.type.kind === 'generic-type' ? maybeTypeParams(options, indent, parent, ast.value.type.typeParams) : '') +
                `(${subjectType.args.map(f).join(', ')})` +
                (subjectType.kind === 'func-type' ? maybeTypeAnnotation(options, indent, parent, subjectType.returnType) : '') +
                (subjectType.kind === 'func-type' ? ' => ' : '') +
                (ast.value.kind === 'js-func' || ast.value.kind === 'js-proc'
                    ? `{#${ast.value.body}#}`
                    : f(ast.value.body))
        }
        case "js-func":
        case "js-proc":
            throw Error(ast.kind + ` should always be handled at the declaration level!`)
        case "arg":
            return ast.name.name + maybeTypeAnnotation(options, indent, parent, ast.type)
        case "block":
            return `{\n${ast.statements.map(s => nextIndentation + fIndent(s)).join('\n')}\n${currentIndentation}}`
        case "value-declaration":
        case "value-declaration-statement":
            return (ast.kind === 'value-declaration' ? exported(ast.exported) : '') + 
                (ast.isConst ? 'const' : 'let') + ` ${ast.name.name}${maybeTypeAnnotation(options, indent, parent, ast.type)} = ${f(ast.value)}` +
                (ast.kind === 'value-declaration-statement' ? ';' : '')
        case "derive-declaration":
        case "remote-declaration": {
            const keyword = ast.kind === 'derive-declaration' ? 'derive' : 'remote'
            return exported(ast.exported) + `${keyword} ${ast.name.name}${maybeTypeAnnotation(options, indent, parent, ast.type)} => ${format(ast.expr)}`
        }
        case "await-statement":
            return (ast.name ? `const ${ast.name.name}${maybeTypeAnnotation(options, indent, parent, ast.type)} = ` : '') + `await ${f(ast.plan)};`
        case "type-declaration":
            if (ast.type.kind === 'nominal-type') {
                return exported(ast.exported) + `nominal type ${ast.name.name}(${f(ast.type.inner)})`
            } else {
                return exported(ast.exported) + `type ${ast.name.name} = ${f(ast.type)}`
            }
        case "parenthesized-expression":
            return `(${f(ast.inner)})`
        case "binary-operator":
            return `${f(ast.left)} ${ast.op.op} ${f(ast.right)}`
        case "negation-operator":
            return `!${f(ast.base)}`
        case "operator":
            return ast.op
        // TODO: Put obj and array literals all on one line vs indented based on size of contents
        case "object-literal":  return `{${
                ast.entries.map(entry =>
                    nextIndentation +
                    (Array.isArray(entry) 
                        ? `${entry[0].name}: ${fIndent(entry[1])}`
                        : f(entry as Spread))
                ).join(',\n')
            }\n${currentIndentation}}`;
        case "array-literal":
            return `[${
                ast.entries.map(f).join(', ')
            }]`
        case "string-literal":
            return `'${ast.segments.map(segment => typeof segment === 'string' ? segment : '${' + f(segment) + '}')}'`
        case "exact-string-literal":
            return `'${ast.value}'`
        case "number-literal":
        case "boolean-literal":
            return JSON.stringify(ast.value)
        case "nil-literal":
            return 'nil'
        case "if-else-expression":
            return `if ${ast.cases.map(f).join(' else if ')}`
                + (ast.defaultCase ? ` else {\n${nextIndentation}` + fIndent(ast.defaultCase) + `\n${currentIndentation}}` : '')
        case "if-else-statement":
            return `if ${ast.cases.map(f).join(' else if ')}`
                + (ast.defaultCase ? ' else ' + fIndent(ast.defaultCase) : '')
        case "plain-identifier":
        case "local-identifier":
            return ast.name
        case "assignment":
            return `${f(ast.target)} = ${f(ast.value)};`
        case "for-loop":
            return `for ${ast.itemIdentifier.name} of ${f(ast.iterator)} ${f(ast.body)}`
        case "while-loop":
            return `while ${f(ast.condition)} ${f(ast.body)}`
        case "invocation":
            return `${f(ast.subject)}${maybeTypeArgs(options, indent, parent, ast.typeArgs)}(${ast.args.map(f).join(', ')})` + (parent?.kind === 'block' ? ';' : '')
        case "property-accessor":
            return `${f(ast.subject)}${ast.optional ? '?' : ''}.${ast.property.name}`
        case "func": {
            const funcType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type
            return `${ast.type.kind === 'generic-type' ? maybeTypeParams(options, indent, parent, ast.type.typeParams) : ''}(${funcType.args.map(f).join(', ')})${maybeTypeAnnotation(options, indent, parent, funcType.returnType)} =>\n${nextIndentation}${fIndent(ast.body)}`
        }
        case "proc": {
            const procType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type
            return `${ast.type.kind === 'generic-type' ? maybeTypeParams(options, indent, parent, ast.type.typeParams) : ''}(${procType.args.map(f).join(', ')}) ${f(ast.body)}`
        }
        case "instance-of":
            return `${f(ast.expr)} instanceof ${f(ast.type)}`
        case "as-cast":
            return `${f(ast.inner)} as ${f(ast.type)}`
        case "error-expression":
            return `Error(${f(ast.inner)})`
        case "range":
            return `${f(ast.start)}..${f(ast.end)}`
        case "spread":
            return `...${f(ast.expr)}`
        case "indexer":
            return `${f(ast.subject)}[${f(ast.indexer)}]`
        case "autorun-declaration":
            return `autorun ${f(ast.effect)}`
        case "case":
            return `${f(ast.condition)} {\n${nextIndentation}${fIndent(ast.outcome)}\n${currentIndentation}}`
        case "case-block":
            return `${f(ast.condition)} ${f(ast.outcome)}`
        case "switch-case":
            return `case ${f(ast.condition)}: ${f(ast.outcome)}`
        case "switch-expression":
            return `switch ${f(ast.value)} {\n${ast.cases.map(c => nextIndentation + fIndent(c)).join('\n')}\n${currentIndentation}}`
        case "test-expr-declaration":
            return `test expr ${f(ast.name)} = ${f(ast.expr)}`
        case "test-block-declaration":
            return `test block ${f(ast.name)} ${f(ast.block)}`
        case "debug":
            return `!debug[${f(ast.inner)}]`
        case "inline-const-group":
            return ast.declarations.map(d => nextIndentation + fIndent(d) + ',\n').join('') + fIndent(ast.inner)
        case "inline-const-declaration":
            return `const ${ast.name.name}${maybeTypeAnnotation(options, indent, parent, ast.type)} = ${ast.awaited ? 'await ' : ''}${f(ast.value)}`
        case "inline-destructuring-declaration":
        case "destructuring-declaration-statement": {
            const propsAndSpread = ast.properties.map(p => p.name).join(', ') + (ast.spread ? `, ...${ast.spread.name}` : '')
            const value = ast.kind === "inline-destructuring-declaration" && ast.awaited ? `await ${f(ast.value)}` : f(ast.value)
            const semicolon = ast.kind === "destructuring-declaration-statement" ? ';' : ''

            if (ast.destructureKind === 'object') {
                return `const { ${propsAndSpread} } = ${value}` + semicolon
            } else {
                return `const [ ${propsAndSpread} ] = ${value}` + semicolon
            }
        }
        case "element-tag":
            return `<${ast.tagName.name}${ast.attributes.length > 0 ? ' ' + ast.attributes.map(([name, value]) => `${name.name}={${f(value)}}`).join(' ') : ''}>${
                ast.children.map(c =>
                    '\n' + nextIndentation + (c.kind === 'element-tag' ? fIndent(c) : `{${fIndent(c)}}`)
                ).join('')
            }${ast.children.length > 0 ? '\n' + currentIndentation : ''}</${ast.tagName.name}>`
        case "javascript-escape":
            return `js#${ast.js}#js`
        case "union-type": return ast.members.map(f).join(" | ");
        case "maybe-type": return f(ast.inner) + '?';
        case "named-type":
        case "generic-param-type": return ast.name.name;
        case "generic-type": return maybeTypeParams(options, indent, parent, ast.typeParams) + f(ast.inner);
        case "bound-generic-type": return f(ast.generic) + maybeTypeArgs(options, indent, parent, ast.typeArgs)
        case "proc-type": return `(${ast.args.map(arg => arg.name.name + (arg.type ? `: ${f(arg.type)}` : '')).join(', ')}) {}`;
        case "func-type": return `(${ast.args.map(arg => arg.name.name + (arg.type ? `: ${f(arg.type)}` : '')).join(', ')}) => ${f(ast.returnType ?? UNKNOWN_TYPE)}`;
        case "object-type":  return (ast.mutability !== 'mutable' && ast.mutability !== 'literal' ? 'const ' : '') + `{${
            ast.spreads.map(s => '\n' + nextIndentation + '...' + fIndent(s)).concat(
            ast.entries.map(e => '\n' + nextIndentation + fIndent(e)))
                .join(',')}\n${currentIndentation}}`;
        case "attribute": return  `${ast.name.name}: ${f(ast.type)}`
        case "record-type":  return (ast.mutability !== 'mutable' && ast.mutability !== 'literal' ? 'const ' : '') + `{ [${f(ast.keyType)}]: ${f(ast.valueType)} }`;
        case "array-type":   return (ast.mutability !== 'mutable' && ast.mutability !== 'literal' ? 'const ' : '') + `${f(ast.element)}[]`;
        case "tuple-type":   return (ast.mutability !== 'mutable' && ast.mutability !== 'literal' ? 'const ' : '') + `[${ast.members.map(f).join(", ")}]`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `nil`;
        case "literal-type": return JSON.stringify(ast.value.value).replaceAll('"', "'");
        case "nominal-type": return ast.name.description ?? '<unnamed nominal>';
        case "iterator-type": return ast.inner.kind === 'any-type' ? `Iterator` : `Iterator<${f(ast.inner)}>`;
        case "plan-type":     return ast.inner.kind === 'any-type' ? `Plan` : `Plan<${f(ast.inner)}>`;
        case "error-type":    return ast.inner.kind === 'any-type' ? `Error` : `Error<${f(ast.inner)}>`;
        case "remote-type":   return ast.inner.kind === 'any-type' ? `Remote` : `Remote<${f(ast.inner)}>`
        case "unknown-type": return "unknown";
        case "any-type": return "<any>";
        case "never-type": return "<never>";
        case "element-type": return `Element`;
        case "parenthesized-type": return `(${f(ast.inner)})`;
        case "typeof-type": return `typeof ${f(ast.expr)}`;
        case "keyof-type": return `keyof ${f(ast.inner)}`;
        case "valueof-type": return `valueof ${f(ast.inner)}`;
        case "elementof-type": return `elementof ${f(ast.inner)}`;
        // case "element-type": return `<${ast.tagName}>`;
        case "property-type": return `${f(ast.subject)}${ast.optional ? '?' : ''}.${ast.property.name}`;
        case "javascript-escape-type": return "<js escape>";
        case "try-catch": return `try ${f(ast.tryBlock)} catch (${f(ast.errIdentifier)}) ${f(ast.catchBlock)};`
        case "throw-statement": return `throw ${f(ast.errorExpression)};`
        default:
            // @ts-expect-error: exhaustiveness
            throw Error(ast.kind)
    }
}

function exported(e: boolean|"export"|"expose"|undefined): string {
    if (typeof e === 'string') {
        return e + ' '
    } else {
        return e ? 'export ' : ''
    }
}

function maybeTypeParams(options: FormatOptions, indent: number, parent: AST|undefined, typeParams: readonly TypeParam[]): string {
    if (typeParams.length === 0) {
        return ''
    } else {
        return `<${typeParams.map(p =>
            p.name.name + (p.extends ? ` extends ${formatInner(options, indent, parent)(p.extends)}` : '')
        ).join(', ')}>`
    }
}

function maybeTypeArgs(options: FormatOptions, indent: number, parent: AST|undefined, typeArgs: readonly TypeExpression[]): string {
    if (typeArgs.length === 0) {
        return ''
    } else {
        return `<${typeArgs.map(formatInner(options, indent, parent)).join(', ')}>`
    }
}

function maybeTypeAnnotation(options: FormatOptions, indent: number, parent: AST|undefined, type: TypeExpression|undefined): string {
    return type ? `: ${formatInner(options, indent, parent)(type)}` : ''
}

function indentation(options: FormatOptions, indent: number) {
    let str = ''

    for (let i = 0; i < indent; i++) {
        for (let j = 0; j < options.spaces; j++) {
            str += ' '
        }
    }

    return str
}
