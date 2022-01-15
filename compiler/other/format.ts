
import { AST, PlainIdentifier } from '../_model/ast.ts'
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

function formatTypeParam(param: { name: PlainIdentifier, extends: TypeExpression | undefined }, options: FormatOptions, indent: number): string {
    const f = formatInner(options, indent)

    return param.name.name + (param.extends ? ' extends ' + f(param.extends) : '')
}

export function format(ast: AST, options: FormatOptions): string {
    return formatInner(options, 0)(ast)
}

const formatInner = (options: FormatOptions, indent: number) => (ast: AST): string => {
    const f = formatInner(options, indent)
    const fIndent = formatInner(options, indent + 1)
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
        case "store-function":
            return (ast.kind === 'func-declaration' && ast.exported ? 'export ' : '') + 
                `func ${ast.memo ? 'memo ' : ''}${ast.name.name}${f(ast.value)}`
        case "proc-declaration":
        case "store-procedure":
            return (ast.kind === 'proc-declaration' && ast.exported ? 'export ' : '') + 
                `proc ${ast.name.name}${f(ast.value)}`
        case "arg":
            return ast.name.name + (ast.type ? ': ' + f(ast.type) : '')
        case "block":
            return `{\n${ast.statements.map(s => nextIndentation + fIndent(s)).join('\n')}\n${currentIndentation}}`
        case "const-declaration":
            return (ast.exported ? 'export ' : '') + `const ${ast.name.name}${ast.type ? ': ' + f(ast.type) : ''} = ${f(ast.value)}`
        case "type-declaration":
            return (ast.exported ? 'export ' : '') + `type ${ast.name.name} = ${f(ast.type)}`
        case "parenthesized-expression":
            return `(${f(ast.inner)})`
        case "binary-operator":
            return `${f(ast.base)} ${ast.ops.map(([op, expr]) => f(op) + ' ' + f(expr)).join(' ')}`
        case "negation-operator":
            return `!${ast.base}`
        case "operator":
            return ast.op
        case "string-literal":
            return `'${ast.segments.map(segment => typeof segment === 'string' ? segment : '${' + f(segment) + '}')}'`
        case "exact-string-literal":
            return `'${ast.value}'`
        case "number-literal":
        case "boolean-literal":
            return JSON.stringify(ast.value)
        case "nil-literal":
            return 'nil'
        case "store-declaration":
            return (ast.exported ? 'export ' : '') + `store ${ast.name.name} {${ast.members.map(m => nextIndentation + fIndent(m)).join('\n')}\n${currentIndentation}}`
        case "store-property":
            return `${ast.access} ${ast.name.name}${ast.type ? ': ' + f(ast.type) : ''} = ${ast.value}`
        case "let-declaration":
            return   `let ${ast.name.name}${ast.type ? ': ' + f(ast.type) : ''} = ${f(ast.value)};`
        case "const-declaration-statement":
            return `const ${ast.name.name}${ast.type ? ': ' + f(ast.type) : ''} = ${f(ast.value)};`
        case "if-else-statement":
        case "if-else-expression":
            return `if ${ast.cases.map(f).join(' else ')}`
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
            return `${f(ast.subject)}(${ast.args.map(f).join(', ')})`
        case "property-accessor":
            return `${f(ast.subject)}${ast.optional ? '?' : ''}.${ast.property.name}`
        case "func": {
            const funcType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type
            return `${ast.type.kind === 'generic-type' ? '<' + ast.type.typeParams.map(p => formatTypeParam(p, options, indent)).join(', ') + '>' : ''}(${funcType.args.map(f).join(', ')})${funcType.returnType ? f(funcType.returnType) : ''} => ${f(ast.body)}`
        }
        case "proc": {
            const procType = ast.type.kind === 'generic-type' ? ast.type.inner : ast.type
            return `${ast.type.kind === 'generic-type' ? '<' + ast.type.typeParams.map(p => formatTypeParam(p, options, indent)).join(', ') + '>' : ''}(${procType.args.map(f).join(', ')}) ${f(ast.body)}`
        }
        case "as-cast":
            return `${f(ast.inner)} as ${f(ast.type)}`
        case "range":
            return `${ast.start}..${ast.end}`
        case "spread":
            return `...${ast.expr}`
        case "indexer":
            return `${f(ast.subject)}[${f(ast.indexer)}]`
        case "autorun-declaration":
            return `autorun ${f(ast.effect)}`
        case "case":
        case "case-block":
            return `${f(ast.condition)} ${f(ast.outcome)}`
        case "switch-case":
            return `case ${f(ast.condition)}: ${f(ast.outcome)}`
        case "switch-expression":
            return `switch ${f(ast.value)} {\n${ast.cases.map(c => nextIndentation + f(c)).join('\n')}\n${currentIndentation}}`
        case "test-expr-declaration":
        case "test-block-declaration":
        case "pipe":
        case "debug":
        case "inline-const":
        case "element-tag":
        case "object-literal":
        case "array-literal":
        case "javascript-escape":
            return ''
        case "union-type": return '(' + ast.members.map(f).join(" | ") + ')';
        case "maybe-type": return f(ast.inner) + '?';
        case "named-type":
        case "generic-param-type": return ast.name.name;
        case "generic-type": return `<${ast.typeParams.map(p => p.name.name + (p.extends ? ` extends ${f(p.extends)}` : '')).join(',')}>${f(ast.inner)}`;
        case "bound-generic-type": return `${f(ast.generic)}<${ast.typeArgs.map(f).join(',')}>`;
        case "proc-type": return `(${ast.args.map(arg => arg.name.name + (arg.type ? `: ${f(arg.type)}` : '')).join(', ')}) {}`;
        case "func-type": return `(${ast.args.map(arg => arg.name.name + (arg.type ? `: ${f(arg.type)}` : '')).join(', ')}) => ${f(ast.returnType ?? UNKNOWN_TYPE)}`;
        case "object-type":  return (ast.mutability !== 'mutable' ? 'const ' : '') + `{${ast.spreads.map(s => '...' + f(s)).concat(ast.entries.map(f)).join(', ')}}`;
        case "attribute": return  `${ast.name.name}: ${f(ast.type)}`
        case "indexer-type": return (ast.mutability !== 'mutable' ? 'const ' : '') + `{ [${f(ast.keyType)}]: ${f(ast.valueType)} }`;
        case "array-type":   return (ast.mutability !== 'mutable' ? 'const ' : '') + `${f(ast.element)}[]`;
        case "tuple-type":   return (ast.mutability !== 'mutable' ? 'const ' : '') + `[${ast.members.map(f).join(", ")}]`;
        case "store-type":   return (ast.mutability !== 'mutable' ? 'const ' : '') + ast.store.name.name;
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