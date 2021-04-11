import { AST, BinaryOp, BINARY_OPS, KEYWORDS } from "./ast";
import { given } from "./utils";

export function consume(code: string, index: number, segment: string): number|undefined {
    for (let i = 0; i < segment.length; i++) {
        if (code[index + i] !== segment[i]) {
            return undefined;
        }
    }

    return index + segment.length;
}

export function consumeBinaryOp(code: string, index: number): number|undefined {
    for (const op of BINARY_OPS) {
        if (code.substr(index, op.length) === op) {
            return index + op.length;
        }
    }
}

export function consumeWhitespace(code: string, index: number): number {
    return consumeWhile(code, index, ch => ch.match(/[\s]/) != null);
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
    return ch != null && (isAlpha(ch) || (index > 0 && isNumeric(ch)));
}

export function isBinaryOp(str: string): str is BinaryOp {
    return (BINARY_OPS as readonly string[]).includes(str);
}

export type ParseResult<T> = { parsed: T, newIndex: number };

export function parseSeries<T>(code: string, index: number, parseFn: (code: string, index: number) => ParseResult<T>|undefined, delimiter?: string, forbidTrailing = false): { items: T[], newIndex: number } | undefined {
    const items: T[] = [];
    let foundDelimiter = false;
    index = consumeWhitespace(code, index);
    let elementResult = parseFn(code, index);
    while (elementResult != null) {
        index = elementResult.newIndex;
        items.push(elementResult.parsed);

        foundDelimiter = false;
        elementResult = undefined;

        index = consumeWhitespace(code, index);
        if (delimiter != null) {
            given(consume(code, index, delimiter), newIndex => {
                foundDelimiter = true;

                index = consumeWhitespace(code, newIndex);
                elementResult = parseFn(code, index);
                index = consumeWhitespace(code, index);
            });
        }
    }

    if (foundDelimiter && forbidTrailing) {  // found delimiter but element undefined -> trailing delimiter
        return undefined;
    }

    return { items, newIndex: index };
}

export function parseOptional<T>(code: string, index: number, parseFn: (code: string, index: number) => ParseResult<T>|undefined): Partial<ParseResult<T>> {
    const result = parseFn(code, index);

    return {
        parsed: result?.parsed,
        newIndex: result?.newIndex,
    };
}