import { AST, PlainIdentifier } from "./_model/ast.ts";
import { ImportDeclaration,ImportItem } from "./_model/declarations.ts";
import { ExactStringLiteral, LocalIdentifier } from "./_model/expressions.ts";
import { TypeExpression } from "./_model/type-expressions.ts";
import { Colors } from "./deps.ts";
import { deepEquals, given, spaces } from "./utils/misc.ts";
import { Context, ModuleName } from "./_model/common.ts";
import { LintProblem } from "./other/lint.ts";

export type BagelError =
    | BagelSyntaxError
    | BagelAssignableToError
    | BagelCannotFindNameError
    | BagelAlreadyDeclaredError
    | BagelMiscTypeError
    | BagelCannotFindModuleError
    | BagelCannotFindExportError

export type BagelSyntaxError = {
    kind: "bagel-syntax-error",
    ast: undefined,
    code: string|undefined,
    index: number|undefined,
    message: string,
    stack: string|undefined,
}
    
export type BagelAssignableToError = {
    kind: "bagel-assignable-to-error",
    ast: AST,
    destination: TypeExpression,
    value: TypeExpression,
    issues: Array<string | string[]>,
    stack?: string|undefined,
}

export type BagelCannotFindNameError = {
    kind: "bagel-cannot-find-name-error",
    name: string,
    ast: AST,
}

export type BagelAlreadyDeclaredError = {
    kind: "bagel-already-declared-error",
    ast: PlainIdentifier,
}

export type BagelMiscTypeError = {
    kind: "bagel-misc-type-error",
    ast: AST|undefined,
    message: string,
}

export type BagelCannotFindModuleError = {
    kind: "bagel-cannot-find-module-error",
    ast: ExactStringLiteral
}

export type BagelCannotFindExportError = {
    kind: "bagel-cannot-find-export-error",
    ast: ImportItem,
    importDeclaration: ImportDeclaration
}

const ALL_ERROR_TYPES: {[key in BagelError["kind"]]: null} = {
    "bagel-syntax-error": null,
    "bagel-assignable-to-error": null,
    "bagel-cannot-find-name-error": null,
    "bagel-already-declared-error": null,
    "bagel-misc-type-error": null,
    "bagel-cannot-find-module-error": null,
    "bagel-cannot-find-export-error": null,
}

export function isError(x: unknown): x is BagelError {
    // @ts-ignore
    return x != null && typeof x === "object" && ALL_ERROR_TYPES[x.kind] === null;
}

export function errorsEquivalent(a: BagelError, b: BagelError): boolean {
    return deepEquals(a, b, ["parent"])
}

export function errorMessage(error: BagelError): string {
    switch (error.kind) {
        case "bagel-syntax-error":
            return error.message
        case "bagel-assignable-to-error":
            return error.issues.map((issue, index) => {
                const indentation = new Array(index).fill(' ').join('')

                return (
                    typeof issue === 'string'
                        ? indentation + issue
                        : issue.map(issue => indentation + issue).join('\n')
                )
            }).join('\n');
        case "bagel-cannot-find-name-error":
            return `Cannot find name "${error.name}"`;
        case "bagel-already-declared-error":
            return `Identifier "${error.ast.name}" declared multiple times in this scope`;
        case "bagel-misc-type-error":
            return error.message;
        case "bagel-cannot-find-module-error":
            return `Failed to resolve module '${error.ast.value}'`
        case "bagel-cannot-find-export-error":
            return `Module "${error.importDeclaration.path.value}" has no export named ${error.ast.name.name}`
    }
}

export function syntaxError(code: string, index: number, message: string): BagelSyntaxError {
    return { kind: "bagel-syntax-error", ast: undefined, code, index, message, stack: undefined }
}

export function assignmentError(ast: AST, destination: TypeExpression, value: TypeExpression, issues: Array<string | string[]>): BagelAssignableToError {
    return { kind: "bagel-assignable-to-error", ast, destination, value, issues, stack: undefined };
}

export function cannotFindName(ast: LocalIdentifier|PlainIdentifier): BagelCannotFindNameError;
export function cannotFindName(ast: AST, name: string): BagelCannotFindNameError;
export function cannotFindName(ast: AST, name: string|void): BagelCannotFindNameError {
    return { kind: "bagel-cannot-find-name-error", ast, name: (ast.kind === 'local-identifier' || ast.kind === 'plain-identifier') ? ast.name : name as string };
}

export function alreadyDeclared(ast: PlainIdentifier): BagelAlreadyDeclaredError {
    return { kind: "bagel-already-declared-error", ast };
}

export function miscError(ast: AST|undefined, message: string): BagelMiscTypeError {
    return { kind: "bagel-misc-type-error", ast, message }
}

export function cannotFindModule(ast: ExactStringLiteral): BagelCannotFindModuleError {
    return { kind: "bagel-cannot-find-module-error", ast }
}

export function cannotFindExport(ast: ImportItem, importDeclaration: ImportDeclaration): BagelCannotFindExportError {
    return { kind: "bagel-cannot-find-export-error", ast, importDeclaration }
}

export function prettyProblem(ctx: Pick<Context, "allModules" | "canonicalModuleName">, modulePath: ModuleName, error: BagelError|LintProblem): string {
    let output = "";

    const code = (
        error.kind === 'bagel-syntax-error' ? error.code : 
        error.ast?.kind !== "module" ? error.ast?.code : 
        error.kind === 'lint-problem' ? error.ast.code : 
        undefined
    )
    const atEndOfLine = error.kind === 'bagel-syntax-error' && error.code?.[error.index ?? -1] === '\n'
    const startIndex = (
        error.kind === 'bagel-syntax-error' ? (
            atEndOfLine
                ? given(error.index, index => index - 1)
                : error.index
         ) : 
        error.ast?.kind !== "module" ? error.ast?.startIndex : 
        error.kind === 'lint-problem' ? error.ast.startIndex : 
        undefined
    )
    const endIndex = (
        error.kind === 'bagel-syntax-error' ? code?.length : 
        error.ast?.kind !== "module" ? error.ast?.endIndex : 
        error.kind === 'lint-problem' ? error.ast.endIndex : 
        undefined
    )
    const message = (
        error.kind === "bagel-syntax-error" ? error.message : 
        error.kind === 'lint-problem' ? error.rule.message(ctx, error.ast) + ` [linter rule '${error.name}']` :
        errorMessage(error)
    )
    const severity = (
        error.kind === 'lint-problem' ? error.severity :
        error.kind === 'bagel-syntax-error' ? 'parse error' :
        'error'
    )
    const color = (
        severity === 'warning' ? Colors.yellow :
        severity === 'info' ? Colors.white :
        Colors.red
    )

    // /Users/me/foo.bgl
    let infoLine = Colors.cyan(modulePath)
    
    const { line: startLine, column: startColumn } = 
        given(code, code => 
        given(startIndex, startIndex => 
            lineAndColumn(code, startIndex))) ?? {}

    // :29:62
    if (startLine != null && startColumn != null) {
        infoLine += Colors.white(":") 
            + Colors.yellow(String(startLine)) 
            + Colors.white(":") 
            + Colors.yellow(String(startColumn))
    }

    // - error Operator '>' cannot be applied to types 'string' and 'number'
    infoLine += Colors.white(" - ")
        + color(severity)
        + Colors.white(" " + message)

    output += infoLine + "\n"

    // print the problematic line of code, with the issue underlined
    if (code != null && startIndex != null && endIndex != null) {
        output += '\n'

        const lines: string[] = []

        const totalLines = [...code].filter(ch => ch === '\n').length + 1
        const maxLineDigits = String(totalLines).length

        let lineNumber = 1
        let firstLine: number|undefined
        let previousLineStart = 0
        let currentLineStart = 0
        for (let i = 0; i <= code.length && currentLineStart < endIndex; i++) {
            if (code[i] === '\n' || i === code.length) {
                if (i > startIndex) {
                    if (firstLine == null) {
                        firstLine = lineNumber - 1
                    }

                    let newLine = ''

                    if (currentLineStart < startIndex && lineNumber > 1) { // first problem-line
                        lines.push(code.substring(previousLineStart, currentLineStart - 1))
                    }

                    // newLine += numberAndPadding(lineNumber, maxLineDigits)
                    
                    if (currentLineStart < startIndex) { // left end is white
                        newLine += code.substring(currentLineStart, startIndex)
                    }

                    // problem segment
                    newLine += color(code.substring(Math.max(currentLineStart, startIndex), Math.min(i, endIndex)))

                    if (endIndex <= i) { // right end is white
                        if (error.kind === 'bagel-syntax-error') newLine += Colors.red('_')

                        newLine += code.substring(endIndex, i)
                    }

                    lines.push(newLine)
                        
                    if (endIndex <= i) {
                        currentLineStart = i + 1
                        i++
                        while (i < code.length && code[i] !== '\n') i++;

                        lines.push(code.substring(currentLineStart, i))
                    }
                }

                lineNumber++
                previousLineStart = currentLineStart
                currentLineStart = i + 1
            }
        }

        const minIndentation = lines
            .map(line => line.length - line.trimStart().length)
            .reduce((min, current) => Math.min(min, current), Number.MAX_SAFE_INTEGER)

        output += lines.map((line, index) => {
            const lineNum = (firstLine ?? 0) + index
            return numberAndPadding(lineNum, maxLineDigits) + line.substring(minIndentation) + '\n'
        }).join('')
    }

    return output
}

function numberAndPadding(line: number, maxWidth: number) {
    const padding = spaces(maxWidth - String(line).length) + '  '
    return Colors.bgWhite(Colors.black(String(line))) + padding    
}

function lineAndColumn(code: string, index: number): { line: number, column: number } {
    let line = 1;
    let column = 0;
    for (let i = 0; i <= index; i++) {
        if (code[i] === "\n") {
            line++;
            column = 0;
        } else {
            column++;
        }
    }

    return { line, column };
}
