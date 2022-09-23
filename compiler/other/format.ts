
import { getName } from "../utils/ast.ts";
import { exists, given, spaces } from "../utils/misc.ts";
import { AST, PlainIdentifier } from '../_model/ast.ts'
import { ExactStringLiteral } from "../_model/expressions.ts";
import { FuncType, TypeExpression, TypeParam, UNKNOWN_TYPE } from "../_model/type-expressions.ts";

export type FormatOptions = {
    spaces: number,
    lineBreaks: boolean
}

export const DEFAULT_OPTIONS: FormatOptions = {
    spaces: 4,
    lineBreaks: true
}

export function format(ast: AST, options?: Partial<FormatOptions>): string {
    return formatInner({ ...DEFAULT_OPTIONS, ...options }, 0, undefined)(ast)
}

const formatInner = (options: FormatOptions, indent: number, parent: AST|undefined) => (ast: AST): string => {
    const f = formatInner(options, indent, ast)
    const fIndent = formatInner(options, indent + 1, ast)
    const currentIndentation = indentation(options, indent)
    const nextIndentation = indentation(options, indent + 1)

    const br = options.lineBreaks ? '\n' : ' '

    switch (ast.kind) {
        case "module":
            return ast.declarations.map(f).join(br + br)
        case "import-all-declaration":
            return `import ${f(ast.path)} as ${ast.name.name}`
        case "import-declaration":
            return `from ${f(ast.path)} import { ${ast.imports.map(f)} }`
        case "import-item":
            return ast.name.name + (ast.alias ? ' as ' + ast.alias.name : '')
        case "func-declaration":
        case "proc-declaration": {
            const front = 
                (ast.value.kind === 'js-func' || ast.value.kind === 'js-proc' ? 'js ' : '') +
                exported(ast.exported) + 
                (ast.value.isPure ? 'pure ' : '') +
                (ast.value.isAsync ? 'async ' : '') +
                (ast.kind === 'func-declaration' ? 'func ' : 'proc ') +
                ast.name.name

            const subjectType = ast.value.type.kind === 'generic-type' ? ast.value.type.inner : ast.value.type

            const decorators = ast.decorators.map(d => f(d) + '\n').join('')

            return decorators + front + 
                (ast.value.type.kind === 'generic-type' ? maybeTypeParams(options, indent, parent, ast.value.type.typeParams) : '') +
                `(${f(subjectType.args)})` +
                (subjectType.kind === 'func-type' ? maybeTypeAnnotation(options, indent, parent, subjectType.returnType) : '') +
                (subjectType.kind === 'func-type' ? ' => ' : '') +
                (ast.value.kind === 'js-func' || ast.value.kind === 'js-proc'
                    ? `{#${ast.value.body}#}`
                    : f(ast.value.body))
        }
        case "args":
            return ast.args.map(f).join(', ')
        case "arg":
            return (ast.name?.name ?? '') + (ast.name && ast.type ? ': ' : '') + (given(ast.type, f) ?? '')
        case "spread-args":
            return '...' + (ast.name ? ast.name?.name + ': ' : '') + f(ast.type)
        case "decorator":
            return `@${f(ast.decorator)}`
        case "js-func":
        case "js-proc":
            throw Error(ast.kind + ` should always be handled at the declaration level!`)
        case "block":
            return `{${br}${ast.statements.map(s => nextIndentation + fIndent(s)).join(br)}${br}${currentIndentation}}`
        case "value-declaration":
            return exported(ast.exported) + 
                (ast.isConst ? 'const' : 'let') + ` ${ast.name.name}${maybeTypeAnnotation(options, indent, parent, ast.type)} = ${f(ast.value)}`
        case "declaration-statement":
        case "inline-declaration": {
            const keyword = (
                ast.kind === 'declaration-statement' && !ast.isConst
                    ? 'let'
                    : 'const'
            )
            const value = f(ast.value)
            const endCap = ast.kind === 'declaration-statement' ? ';' : ''

            return `${keyword} ${f(ast.destination)} = ${ast.awaited ? 'await ' : ''}${value}${endCap}`
        }
        case "name-and-type":
            return ast.name.name + maybeTypeAnnotation(options, indent, parent, ast.type)
        case "destructure": {
            const [l, r] = ast.destructureKind === 'object' ? ['{', '}'] : ['[', ']']
            const entries = [
                ast.properties.map(p => p.name),
                ast.spread ? '...' + ast.spread.name : undefined
            ].filter(s => s != null)

            return `${l} ${entries.join(', ')} ${r}`
        }
        case "type-declaration":
            if (ast.type.kind === 'nominal-type') {
                const inner = ast.type.inner ? `(${f(ast.type.inner)})` : ''
                return exported(ast.exported) + `nominal type ${ast.name.name}${inner}`
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
        case "object-literal": return `{${
                ast.entries.map(entry =>
                    nextIndentation + f(entry)
                ).join(',' + br)
            }${br}${currentIndentation}}`;
        case "object-entry":{
            const key = (
                ast.key.kind === 'plain-identifier' || ast.key.kind === 'exact-string-literal' ? f(ast.key) :
                `[${f(ast.key)}]`
            )
            
            return `${key}: ${fIndent(ast.value)}`
        }
        case "array-literal":
            return `[${
                ast.entries.map(f).join(', ')
            }]`
        case "string-literal":
            return (ast.tag ? ast.tag.name : '') + `'${ast.segments.map(segment => typeof segment === 'string' ? segment : '${' + f(segment) + '}').join('')}'`
        case "exact-string-literal":
            return `'${ast.value}'`
        case "number-literal":
        case "boolean-literal":
            return JSON.stringify(ast.value)
        case "nil-literal":
            return 'nil'
        case "if-else-expression":
            return `if ${ast.cases.map(f).join(' else if ')}`
                + (ast.defaultCase ? ` else {${br}${nextIndentation}` + fIndent(ast.defaultCase) + `${br}${currentIndentation}}` : '')
        case "if-else-statement":
            return `if ${ast.cases.map(f).join(' else if ')}`
                + (ast.defaultCase ? ' else ' + fIndent(ast.defaultCase) : '')
        case "plain-identifier":
        case "local-identifier":
            return ast.name
        case "assignment":
            return `${f(ast.target)} ${ast.operator?.op ?? ''}= ${f(ast.value)};`
        case "for-loop":
            return `for ${ast.itemIdentifier.name} of ${f(ast.iterator)} ${f(ast.body)}`
        case "while-loop":
            return `while ${f(ast.condition)} ${f(ast.body)}`
        case "invocation":
            return `${ast.awaitedOrDetached ? ast.awaitedOrDetached + ' ' : ''}${f(ast.subject)}${maybeTypeArgs(options, indent, parent, ast.typeArgs)}(${[...ast.args, ast.spreadArg].filter(exists).map(f).join(', ')})` + (parent?.kind === 'block' ? ';' : '')
        case "property-accessor": {
            const operator = (
                ast.optional ? '?.' :
                ast.property.kind === 'plain-identifier' ? '.' :
                ''
            )

            const property = (
                ast.property.kind === 'plain-identifier'
                    ? ast.property.name
                    : `[${f(ast.property)}]`
            )

            return `${f(ast.subject)}${operator}${property}`
        }
        case "func":
        case "proc": {
            const funcOrProcType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type
            const pure = ast.isPure ? 'pure ' : ''
            const azync = ast.isAsync ? 'async ' : ''
            const typeParams = ast.type.kind === 'generic-type' ? maybeTypeParams(options, indent, parent, ast.type.typeParams) : ''
            const args = (
                funcOrProcType.args.kind === 'args' && 
                funcOrProcType.args.args.length === 1 && 
                funcOrProcType.args.args[0].name != null && 
                funcOrProcType.args.args[0].type == null &&
                (funcOrProcType.kind === 'proc-type' || funcOrProcType.returnType == null)
                    ? funcOrProcType.args.args[0].name.name
                    : `(${f(funcOrProcType.args)})`
            )

            if (ast.kind === 'func') {
                return pure + azync + typeParams + `${args}${maybeTypeAnnotation(options, indent, parent, (funcOrProcType as FuncType).returnType)} =>${br}${nextIndentation}${fIndent(ast.body)}`
            } else {
                return pure + azync + typeParams + `${args} ${f(ast.body)}`
            }
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
        case "autorun":
            return `autorun ${f(ast.effect)}\n${currentIndentation}${ast.until == null ? 'forever' : `until => ${fIndent(ast.until)}`}`
        case "case":
            return `${f(ast.condition)} {${br}${nextIndentation}${fIndent(ast.outcome)}${br}${currentIndentation}}`
        case "case-block":
            return `${f(ast.condition)} ${f(ast.outcome)}`
        case "switch-case":
            return `case ${f(ast.type)}: ${f(ast.outcome)}`
        case "switch-expression":
            return `switch ${f(ast.value)} {${br}${ast.cases.map(c => nextIndentation + fIndent(c)).join(br)}${br}${currentIndentation}}`
        case "test-expr-declaration":
            return `test expr ${f(ast.name)} => ${f(ast.expr)}`
        case "test-block-declaration":
            return `test block ${f(ast.name)} => ${f(ast.block)}`
        case "test-type-declaration":
            return `test type ${f(ast.name)} => ${f(ast.destinationType)}: ${f(ast.valueType)}`
        case "debug":
            return `!debug[${f(ast.inner)}]`
        case "inline-const-group":
            return ast.declarations.map(d => nextIndentation + fIndent(d) + ',' + br).join('') + fIndent(ast.inner)
        case "element-tag": {
            const close = ast.children.length === 0
                ? ' />'
                : `>${
                    ast.children.map(c =>
                        br + nextIndentation + (c.kind === 'element-tag' ? fIndent(c) : `{${fIndent(c)}}`)
                    ).join('')
                }${br}${currentIndentation}</${ast.tagName.name}>`

            return `<${ast.tagName.name} ${
                ast.attributes.map(entry =>
                    entry.kind === 'local-identifier' ? entry.name :
                    entry.kind === 'spread' ? `{...${f(entry.expr)}}` :
                    `${getName(entry.key as PlainIdentifier | ExactStringLiteral)}=${
                        entry.value.kind === 'exact-string-literal'
                            ? f(entry.value)
                            : `{${f(entry.value)}}`}`
                ).join(' ')
            }${close}`
        }
        case "javascript-escape":
            return `js#${ast.js}#js`
        case "union-type": {                    
            if (ast.members.length === 0) {
                return '<never>'
            } else {
                return ast.members.map(f).join(" | ")
            }
        }
        case "maybe-type": return (ast.inner.kind === 'union-type' ? `(${f(ast.inner)})` : f(ast.inner)) + '?';
        case "named-type":
        case "generic-param-type": return ast.name.name;
        case "generic-type": return maybeTypeParams(options, indent, parent, ast.typeParams) + f(ast.inner);
        case "bound-generic-type": return f(ast.generic) + maybeTypeArgs(options, indent, parent, ast.typeArgs)
        case "proc-type":
        case "func-type": {
            const args = `(${f(ast.args)})`

            if (ast.kind === 'proc-type') {
                return (ast.isPure ? 'pure ' : '') + (ast.isAsync ? 'async ' : '') + `${args} {}`;
            } else {
                return (ast.isPure ? 'pure ' : '') + `${args} => ${f(ast.returnType ?? UNKNOWN_TYPE)}`;
            }
        }
        case "object-type":  return (ast.mutability !== 'mutable' && ast.mutability !== 'literal' ? 'readonly ' : '') + `{${
            ast.spreads.map(s => br + nextIndentation + '...' + fIndent(s)).concat(
            ast.entries.map(e => br + nextIndentation + fIndent(e)))
                .join(',')}${br}${currentIndentation}}`;
        case "interface-type": return `interface {${
            ast.entries.map(e => br + nextIndentation + fIndent(e))
        .join(',')}${br}${currentIndentation}}`
        case "property": return  `${f(ast.name)}: ${f(ast.type)}`
        case "record-type":  return (ast.mutability !== 'mutable' && ast.mutability !== 'literal' ? 'readonly ' : '') + `{ [${f(ast.keyType)}]: ${f(ast.valueType)} }`;
        case "array-type":   return (ast.mutability !== 'mutable' && ast.mutability !== 'literal' ? 'readonly ' : '') + `${ast.element.kind === 'union-type' ? `(${f(ast.element)})` : f(ast.element)}[]`; // TODO: Add parens if union type (and also keyof, etc?)
        case "tuple-type":   return (ast.mutability !== 'mutable' && ast.mutability !== 'literal' ? 'readonly ' : '') + `[${ast.members.map(f).join(", ")}]`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `nil`;
        case "literal-type": return JSON.stringify(ast.value.value).replaceAll('"', "'");
        case "nominal-type": return ast.name ?? '<unnamed nominal>';
        case "iterator-type":
        case "plan-type":
        case "error-type":
        case "remote-type": {
            const segment = ast.kind.split('-')[0]
            const typeName = segment[0].toUpperCase() + segment.slice(1)

            return ast.inner.kind === 'any-type' ? typeName : `${typeName}<${f(ast.inner)}>`
        }
        case "unknown-type":
        case "poisoned-type":
            return "unknown";
        case "any-type": return "<any>";
        case "parenthesized-type": return `(${f(ast.inner)})`;
        case "typeof-type": return `typeof ${f(ast.expr)}`;
        case "keyof-type":
        case "valueof-type":
        case "elementof-type":
        case "readonly-type": {
            const keyword = ast.kind.split('-')[0]
            return `${keyword} ${f(ast.inner)}`;
        }
        // case "element-type": return `<${ast.tagName}>`;
        case "property-type": return `${f(ast.subject)}${ast.optional ? '?' : ''}${ast.property.kind === 'plain-identifier' ? `.${ast.property.name}` : `${ast.optional ? '.' : ''}[${f(ast.property)}]`}`;
        case "javascript-escape-type": return "<js escape>";
        case "try-catch": return `try ${f(ast.tryBlock)} catch ${f(ast.errIdentifier)} ${f(ast.catchBlock)};`
        case "throw-statement": return `throw ${f(ast.errorExpression)};`
        case "regular-expression": return `/${ast.expr}/${ast.flags.join('')}`
        case "regular-expression-type": return 'RegExp'
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
    if (!options.lineBreaks) {
        return ''
    }

    return spaces(indent * options.spaces)
}
