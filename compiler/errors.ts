import { AST, PlainIdentifier } from "./_model/ast.ts";
import { ImportDeclaration,ImportItem } from "./_model/declarations.ts";
import { ExactStringLiteral, LocalIdentifier } from "./_model/expressions.ts";
import { TypeExpression } from "./_model/type-expressions.ts";
import { Colors } from "./deps.ts";
import { deepEquals, given } from "./utils/misc.ts";
import { ModuleName } from "./_model/common.ts";
import { LintProblem } from "./other/lint.ts";
import { format } from "./other/format.ts";
import { SOURCE_INFO_PROPERTIES } from "./utils/ast.ts";

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

export function prettyProblem(modulePath: ModuleName, error: BagelError|LintProblem): string {
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
        error.kind === 'bagel-syntax-error' ? undefined : 
        error.ast?.kind !== "module" ? error.ast?.endIndex : 
        error.kind === 'lint-problem' ? error.ast.endIndex : 
        undefined
    )
    const message = (
        error.kind === "bagel-syntax-error" ? error.message : 
        error.kind === 'lint-problem' ? error.rule.message(error.ast) + ` [linter rule '${error.name}']` :
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

    let infoLine = Colors.cyan(modulePath)
    
    const { line, column } = 
        given(code, code => 
        given(startIndex, startIndex => 
            lineAndColumn(code, startIndex))) ?? {}
    if (line != null && column != null) {
        infoLine += Colors.white(":") 
            + Colors.yellow(String(line)) 
            + Colors.white(":") 
            + Colors.yellow(String(column))
    }

    infoLine += Colors.white(" - ")
        + color(severity)
        + Colors.white(" " + message)

    output += infoLine + "\n"

    // print the problematic line of code, with the issue underlined
    if (code != null && startIndex != null && line != null) {
        const lineContent = getLineContents(code, line);

        if (lineContent) {
            const padding = '  '

            output += Colors.bgWhite(Colors.black(String(line))) + padding + lineContent.content + "\n"

            const digitsInLineNum = String(line).length + (atEndOfLine ? 1 : 0)
            const underlineSpacing = padding + new Array(digitsInLineNum + startIndex - lineContent.startIndex).fill(' ').join('')

            if (endIndex != null) {
                const underline = new Array(endIndex - startIndex).fill('~').join('')
                output += color(underlineSpacing + underline) + "\n"
            } else {
                output += color(underlineSpacing + "^") + "\n"
            }
        }
    }

    return output
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

function getLineContents(code: string, line: number) {
    let currentLine = 1;
    let startIndex;
    for (startIndex = 0; startIndex < code.length && currentLine < line; startIndex++) {
        if (code[startIndex] === "\n") {
            currentLine++;
        }
    }

    if (currentLine === line) {
        for (let endIndex = startIndex; endIndex < code.length; endIndex++) {
            if (code[endIndex] === "\n") {
                return { startIndex: startIndex, content: code.substring(startIndex, endIndex) }
            }
        }
        return { startIndex: startIndex, content: code.substring(startIndex, code.length) }
    }

    return undefined
}
