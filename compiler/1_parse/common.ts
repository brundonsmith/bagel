import { KEYWORDS, PlainIdentifier } from "../_model/common.ts";
import { BinaryOp, BINARY_OPS, Expression } from "../_model/expressions.ts";

export function consume(code: string, index: number, segment: string): number|undefined {
    for (let i = 0; i < segment.length; i++) {
        if (code[index + i] !== segment[i]) {
            return undefined;
        }
    }

    return index + segment.length;
}

export function parseBinaryOp(code: string, index: number): ParseResult<BinaryOp>|undefined {
    for (const op of BINARY_OPS) {
        if (code.substr(index, op.length) === op) {
            return {
                parsed: op,
                newIndex: index + op.length,
            };
        }
    }

    return undefined;
}

export function consumeWhitespace(code: string, index: number): number {
    return consumeWhile(code, index, ch => ch.match(/[\s]/) != null);
}

export function consumeWhitespaceRequired(code: string, index: number): number|undefined {
    const newIndex = consumeWhile(code, index, ch => ch.match(/[\s]/) != null);
    
    if (newIndex > index) {
        return newIndex;
    }
}

export function consumeWhile(code: string, index: number, fn: (ch: string, index: number) => boolean): number {
    let newIndex = index;
    while (code[newIndex] != null && fn(code[newIndex], newIndex)) {
        newIndex++;
    }

    return newIndex;
}

export function isAlpha(char: string): boolean {
    // return char.match(/^[a-zA-Z]$/) != null;
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

export function isNumeric(char: string): boolean {
    return char >= '0' && char <= '9';
}

export function isSymbol(str: string): boolean {
    for (let index = 0; index < str.length; index++) {
        if (!isSymbolic(str[index], index)) {
            return false;
        }
    }

    for (const keyword of KEYWORDS) {
        if (str === keyword) {
            return false;
        }
    }

    return true;
}

export function isSymbolic(ch: string, index: number): boolean {
    return ch != null && (isAlpha(ch) || ch === "_" || (index > 0 && (isNumeric(ch) || ch === "$")));
}

export function isBinaryOp(str: string): str is BinaryOp {
    return (BINARY_OPS as readonly string[]).includes(str);
}

export type ParseResult<T> = { parsed: T, newIndex: number };

export function parseSeries<T>(code: string, index: number, itemParseFn: ParseFunction<T>, delimiter?: string, options: Partial<SeriesOptions> = {}): ParseResult<T[]>|BagelSyntaxError {
    const EMPTY_RESULT: Readonly<ParseResult<T[]>> = { parsed: [], newIndex: index };

    const { leadingDelimiter, trailingDelimiter, whitespace } = { ...DEFAULT_SERIES_OPTIONS, ...options };
    const parsed: T[] = [];

    if (delimiter != null && (leadingDelimiter === "required" || leadingDelimiter === "optional")) {
        const indexAfterLeadingDelimiter = consume(code, index, delimiter);

        if (leadingDelimiter === "required" && indexAfterLeadingDelimiter == null) {
            return EMPTY_RESULT;
        } else if (indexAfterLeadingDelimiter != null) {
            index = indexAfterLeadingDelimiter;
        }
    }

    let foundDelimiter = false;

    if (whitespace === "optional") index = consumeWhitespace(code, index);

    let itemResult = itemParseFn(code, index);
    while (itemResult != null) {
        if (isError(itemResult)) {
            return itemResult;
        }

        index = itemResult.newIndex;
        parsed.push(itemResult.parsed);

        foundDelimiter = false;
        itemResult = undefined;

        if (whitespace === "optional") index = consumeWhitespace(code, index);

        if (delimiter != null) {
            given(consume(code, index, delimiter), newIndex => {
                foundDelimiter = true;
                index = newIndex;
                if (whitespace === "optional") index = consumeWhitespace(code, index);
                
                itemResult = itemParseFn(code, index);
            });
        } else {
            itemResult = itemParseFn(code, index);
        }

        if (whitespace === "optional") index = consumeWhitespace(code, index);
    }

    // element undefined but found delimiter means trailing delimiter
    if (foundDelimiter && trailingDelimiter === "forbidden") {
        return EMPTY_RESULT;
    } else if (!foundDelimiter && trailingDelimiter === "required") {
        return EMPTY_RESULT;
    }

    return { parsed, newIndex: index };
}

type SeriesOptions = {
    leadingDelimiter: "required"|"optional"|"forbidden",
    trailingDelimiter: "required"|"optional"|"forbidden",
    whitespace: "optional"|"forbidden",
}

const DEFAULT_SERIES_OPTIONS: SeriesOptions = {
    leadingDelimiter: "forbidden",
    trailingDelimiter: "optional",
    whitespace: "optional",
}

export function parseOptional<T>(code: string, index: number, parseFn: ParseFunction<T>): Partial<ParseResult<T>> | BagelSyntaxError {
    const result = parseFn(code, index);

    if (isError(result)) {
        return result;
    } else {
        return {
            parsed: result?.parsed,
            newIndex: result?.newIndex,
        };
    }
}

export function given<T, R>(val: T|BagelSyntaxError|undefined, fn: (val: T) => R): R|BagelSyntaxError|undefined {
    if (val != null && !(isError(val))) {
        return fn(val);
    } else {
        return val as BagelSyntaxError|undefined;
    }
}

export type BagelSyntaxError = {
    kind: "bagel-syntax-error",
    code: string,
    index: number,
    message: string,
    stack: string|undefined,
}

export function lineAndColumn(code: string, index: number): { line: number, column: number } {
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

export function getLineContents(code: string, line: number) {
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

export function isError(x: unknown): x is BagelSyntaxError {
    return x != null && typeof x === "object" && (x as any).kind === "bagel-syntax-error";
}


export function expec<T, R>(val: T|BagelSyntaxError|undefined, err: BagelSyntaxError, fn: (val: T) => R): R|BagelSyntaxError {
    if (isError(val)) {
        return val;
    } else if (val != null) {
        return fn(val);
    } else {
        return err;
    }
}

export function err(code: string, index: number, expected: string): BagelSyntaxError {
    return { kind: "bagel-syntax-error", code, index, message: `${expected} expected`, stack: undefined };
}

export type ParseFunction<T> = (code: string, index: number) => ParseResult<T> | BagelSyntaxError | undefined;


export class ParseMemo {
    private memo = new Map<string, Map<ParseFunction<Expression>, Map<number, ParseResult<Expression>>>>();

    memoize(fn: ParseFunction<Expression>, code: string, index: number, result: ParseResult<Expression>|BagelSyntaxError|undefined) {
        if (result != null && !isError(result)) {
            if (!this.memo.has(code)) {
                this.memo.set(code, new Map());
            }
            if (!this.memo.get(code)?.has(fn)) {
                this.memo.get(code)?.set(fn, new Map());
            }
            
            this.memo.get(code)?.get(fn)?.set(index, result);
        }
    }

    get(fn: ParseFunction<Expression>, code: string, index: number) {
        return this.memo.get(code)?.get(fn)?.get(index);
    }

    delete(code: string) {
        this.memo.delete(code);
    }

    cachedOrParse<T extends Expression>(fn: ParseFunction<T>): ParseFunction<T> {
        return (code: string, index: number): ParseResult<T>|BagelSyntaxError|undefined => {
            const cached = this.get(fn, code, index);

            if (cached != null) {
                return cached as ParseResult<T>;
            } else {
                const result = fn(code, index);
                this.memoize(fn, code, index, result);
                return result;
            }
        }
    }
}

export const plainIdentifier: ParseFunction<PlainIdentifier> = (code, startIndex) => 
    given(identifierSegment(code, startIndex), ({ segment: name, newIndex: index }) => ({
        parsed: {
            kind: "plain-identifier",
            code,
            startIndex,
            endIndex: index,
            name,
        },
        newIndex: index,
    }))

export function identifierSegment(code: string, index: number): { segment: string, newIndex: number} | undefined {
    const startIndex = index;

    while (isSymbolic(code[index], index - startIndex)) {
        index++;
    }

    const segment = code.substring(startIndex, index);

    for (const keyword of KEYWORDS) {
        if (segment === keyword) {
            return undefined;
        }
    }

    if (index - startIndex > 0) {
        return { segment, newIndex: index };
    }
}
