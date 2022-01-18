
import { AST, PlainIdentifier } from '../_model/ast.ts'
import { Spread } from "../_model/expressions.ts";
import { TypeExpression, UNKNOWN_TYPE } from "../_model/type-expressions.ts";

export type FormatOptions = {
    spaces: number
}

export const DEFAULT_OPTIONS: FormatOptions = {
    spaces: 4
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

function formatTypeParam(param: { name: PlainIdentifier, extends: TypeExpression | undefined }, options: FormatOptions, indent: number, parent: AST|undefined): string {
    const f = formatInner(options, indent, parent)

    return param.name.name + (param.extends ? ' extends ' + f(param.extends) : '')
}

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
        case "import-declaration":
            return `from '${ast.path.value}' import { ${ast.imports.map(f)} }`
        case "import-item":
            return ast.name.name + (ast.alias ? ' as ' + ast.alias.name : '')
        case "func-declaration":
            return (ast.kind === 'func-declaration' && ast.exported ? 'export ' : '') + 
                `func ${ast.memo ? 'memo ' : ''}${ast.name.name}${f(ast.value)}`
        case "proc-declaration":
            return (ast.kind === 'proc-declaration' && ast.exported ? 'export ' : '') + 
                `proc ${ast.action ? 'action ' : ''}${ast.name.name}${f(ast.value)}`
        case "arg":
            return ast.name.name + (ast.type ? ': ' + f(ast.type) : '')
        case "block":
            return `{\n${ast.statements.map(s => nextIndentation + fIndent(s)).join('\n')}\n${currentIndentation}}`
        case "value-declaration":
            return (ast.exported ? ast.exported + ' ' : '') + (ast.isConst ? 'const' : 'let') + ` ${ast.name.name}${ast.type ? ': ' + f(ast.type) : ''} = ${f(ast.value)}`
        case "type-declaration":
            if (ast.type.kind === 'nominal-type') {
                return (ast.exported ? 'export ' : '') + `nominal type ${ast.name.name}(${f(ast.type.inner)})`
            } else {
            return (ast.exported ? 'export ' : '') + `type ${ast.name.name} = ${f(ast.type)}`
            }
        case "parenthesized-expression":
            return `(${f(ast.inner)})`
        case "binary-operator":
            return `${f(ast.base)} ${ast.ops.map(([op, expr]) => f(op) + ' ' + f(expr)).join(' ')}`
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
        case "let-declaration-statement":
            return   `let ${ast.name.name}${ast.type ? ': ' + f(ast.type) : ''} = ${f(ast.value)};`
        case "const-declaration-statement":
            return `const ${ast.name.name}${ast.type ? ': ' + f(ast.type) : ''} = ${f(ast.value)};`
        case "if-else-expression":
            return `if ${ast.cases.map(f).join(' else if ')}`
                + (ast.defaultCase ? ` else {\n${nextIndentation}` + f(ast.defaultCase) + `\n${currentIndentation}}` : '')
        case "if-else-statement":
            return `if ${ast.cases.map(f).join(' else if ')}`
                + (ast.defaultCase ? ' else ' + f(ast.defaultCase) : '')
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
            return `${f(ast.subject)}${ast.typeArgs.length > 0 ? `<${ast.typeArgs.map(f).join(', ')}>` : ''}(${ast.args.map(f).join(', ')})` + (parent?.kind === 'block' ? ';' : '')
        case "property-accessor":
            return `${f(ast.subject)}${ast.optional ? '?' : ''}.${ast.property.name}`
        case "func": {
            const funcType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type
            return `${ast.type.kind === 'generic-type' ? '<' + ast.type.typeParams.map(p => formatTypeParam(p, options, indent, parent)).join(', ') + '>' : ''}(${funcType.args.map(f).join(', ')})${funcType.returnType ? ': ' + f(funcType.returnType) : ''} =>\n${nextIndentation}${fIndent(ast.body)}`
        }
        case "proc": {
            const procType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type
            return `${ast.type.kind === 'generic-type' ? '<' + ast.type.typeParams.map(p => formatTypeParam(p, options, indent, parent)).join(', ') + '>' : ''}(${procType.args.map(f).join(', ')}) ${f(ast.body)}`
        }
        case "as-cast":
            return `${f(ast.inner)} as ${f(ast.type)}`
        case "range":
            return `${ast.start}..${ast.end}`
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
            return `switch ${f(ast.value)} {\n${ast.cases.map(c => nextIndentation + f(c)).join('\n')}\n${currentIndentation}}`
        case "test-expr-declaration":
            return `test expr ${f(ast.name)} = ${f(ast.expr)}`
        case "test-block-declaration":
            return `test block ${f(ast.name)} ${f(ast.block)}`
        case "debug":
            return `!debug[${f(ast.inner)}]`
        case "inline-const":
            return `const ${ast.name.name}${ast.type ? ': ' + f(ast.type) : ''} = ${f(ast.value)},\n${currentIndentation}${f(ast.next)}`
        case "element-tag":
            return `<${ast.tagName.name}${ast.attributes.length > 0 ? ' ' + ast.attributes.map(([name, value]) => `${name.name}={${f(value)}}`).join(' ') : ''}>${
                ast.children.map(c =>
                    '\n' + nextIndentation + (c.kind === 'element-tag' ? fIndent(c) : `{${fIndent(c)}}`)
                ).join('')
            }${ast.children.length > 0 ? '\n' + currentIndentation : ''}</${ast.tagName.name}>`
        case "pipe":
            return `${f(ast.args[0])} |> ${f(ast.subject)}`
        case "javascript-escape":
            return `js#${ast.js}#js`
        case "union-type": return ast.members.map(f).join(" | ");
        case "maybe-type": return f(ast.inner) + '?';
        case "named-type":
        case "generic-param-type": return ast.name.name;
        case "generic-type": return `<${ast.typeParams.map(p => p.name.name + (p.extends ? ` extends ${f(p.extends)}` : '')).join(',')}>${f(ast.inner)}`;
        case "bound-generic-type": return `${f(ast.generic)}<${ast.typeArgs.map(f).join(',')}>`;
        case "proc-type": return `(${ast.args.map(arg => arg.name.name + (arg.type ? `: ${f(arg.type)}` : '')).join(', ')}) {}`;
        case "func-type": return `(${ast.args.map(arg => arg.name.name + (arg.type ? `: ${f(arg.type)}` : '')).join(', ')}) => ${f(ast.returnType ?? UNKNOWN_TYPE)}`;
        case "object-type":  return (ast.mutability !== 'mutable' ? 'const ' : '') + `{${ast.spreads.map(s => nextIndentation + '...' + fIndent(s)).concat(ast.entries.map(e => nextIndentation + fIndent(e))).join(', ')}}`;
        case "attribute": return  `${ast.name.name}: ${f(ast.type)}`
        case "indexer-type": return (ast.mutability !== 'mutable' ? 'const ' : '') + `{ [${f(ast.keyType)}]: ${f(ast.valueType)} }`;
        case "array-type":   return (ast.mutability !== 'mutable' ? 'const ' : '') + `${f(ast.element)}[]`;
        case "tuple-type":   return (ast.mutability !== 'mutable' ? 'const ' : '') + `[${ast.members.map(f).join(", ")}]`;
        case "string-type": return `string`;
        case "number-type": return `number`;
        case "boolean-type": return `boolean`;
        case "nil-type": return `nil`;
        case "literal-type": return JSON.stringify(ast.value.value).replaceAll('"', "'");
        case "nominal-type": return ast.name.description ?? '<unnamed nominal>';
        case "iterator-type": return `Iterator<${f(ast.inner)}>`;
        case "plan-type": return `Plan<${f(ast.inner)}>`;
        case "unknown-type": return "unknown";
        case "any-type": return "any";
        case "element-type": return `Element`;
        case "parenthesized-type": return `(${f(ast.inner)})`;
        // case "element-type": return `<${ast.tagName}>`;
        case "javascript-escape-type": return "<js escape>";
        default:
            // @ts-expect-error
            throw Error(ast.kind)
    }
}