import { INT } from "../4_compile/index.ts";
import { BagelError, isError, syntaxError } from "../errors.ts";
import { memoize2, memoize3 } from "../utils/misc.ts";
import { AST, PlainIdentifier } from "../_model/ast.ts";
import { ModuleName } from "../_model/common.ts";

export const consume = memoize3((code: string, index: number, segment: string): number|undefined => {
    for (let i = 0; i < segment.length; i++) {
        if (code[index + i] !== segment[i]) {
            return undefined;
        }
    }

    return index + segment.length;
})

export const consumeWhitespace = memoize2((code: string, index: number): number => {
    let currentIndex = index;
    let inComment: 'no'|'line'|'block' = 'no';

    while (currentIndex < code.length) {
        const char = code[currentIndex]
        const next = code[currentIndex+1]

        if (inComment === 'no') {
            if (char === '/') {
                if (next === '/') {
                    inComment = 'line'
                    currentIndex++
                } else if (next === '*') {
                    inComment = 'block'
                    currentIndex++
                } else {
                    return currentIndex
                }
            } else if (!char.match(/[\s]/)) {
                return currentIndex
            }
        } else if (inComment === 'line' && char === '\n') {
            inComment = 'no'
        } else if (inComment === 'block' && char === '*' && next === '/') {
            inComment = 'no'
            currentIndex++
        }

        currentIndex++
    }

    return currentIndex;
})

export function consumeWhitespaceRequired(code: string, index: number): number|undefined {
    const newIndex = consumeWhitespace(code, index);
    
    if (newIndex > index) {
        return newIndex;
    } else {
        return undefined;
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

export function isSymbolic(ch: string, isFirstCharacter: boolean): boolean {
    return ch != null && (isAlpha(ch) || ch === "_" || (!isFirstCharacter && (isNumeric(ch) || ch === "$")));
}

export type ParseResult<T> = { parsed: T, index: number };

export function parseSeries<T, D extends AST>(module: ModuleName, code: string, index: number, itemParseFn: ParseFunction<T>, delimiter:  ParseFunction<D>,        options?: Partial<SeriesOptions>):      ParseResult<(T|D)[]>|BagelError;
export function parseSeries<T>(module: ModuleName, code: string, index: number, itemParseFn: ParseFunction<T>, delimiter?: string, options?: Partial<SeriesOptions>):      ParseResult<T[]>|BagelError;
export function parseSeries<T, D extends AST>(module: ModuleName, code: string, index: number, itemParseFn: ParseFunction<T>, delimiter?: string|ParseFunction<D>, options:  Partial<SeriesOptions> = {}): ParseResult<(T|D)[]>|BagelError {
    const delimiterFn: ParseFunction<D|undefined>|undefined = (
        typeof delimiter === "function" ? delimiter : 
        typeof delimiter === "string" ? ((_module, code, index) => given(consume(code, index, delimiter), index => ({ parsed: undefined, index })))
        : undefined
    )
    const EMPTY_RESULT: Readonly<ParseResult<T[]>> = { parsed: [], index: index };

    const { leadingDelimiter, trailingDelimiter, whitespace } = { ...DEFAULT_SERIES_OPTIONS, ...options };
    const parsed: (T|D)[] = [];

    if (delimiterFn != null && (leadingDelimiter === "required" || leadingDelimiter === "optional")) {
        const res = delimiterFn(module, code, index);

        if (isError(res)) {
            return res
        }

        if (leadingDelimiter === "required" && res == null) {
            return EMPTY_RESULT;
        } else if (res != null) {
            index = res.index;
            if (res.parsed) {
                parsed.push(res.parsed)
            }
        }
    }

    let foundDelimiter = false;

    if (whitespace === "optional") index = consumeWhitespace(code, index);

    let itemResult = itemParseFn(module, code, index);
    while (itemResult != null) {
        if (isError(itemResult)) {
            return itemResult;
        }

        index = itemResult.index;
        parsed.push(itemResult.parsed);

        foundDelimiter = false;
        itemResult = undefined;

        if (whitespace === "optional") index = consumeWhitespace(code, index);

        if (delimiterFn != null) {
            const res = delimiterFn(module, code, index)

            if (isError(res)) {
                return res
            }

            if (res != null) {
                foundDelimiter = true;
                index = res.index;
                if (res.parsed) {
                    parsed.push(res.parsed)
                }
                if (whitespace === "optional") index = consumeWhitespace(code, index);
                
                itemResult = itemParseFn(module, code, index);
            }
        } else {
            itemResult = itemParseFn(module, code, index);
        }

        if (whitespace === "optional") index = consumeWhitespace(code, index);
    }

    // element undefined but found delimiter means trailing delimiter
    if (foundDelimiter && trailingDelimiter === "forbidden") {
        return EMPTY_RESULT;
    } else if (!foundDelimiter && trailingDelimiter === "required") {
        return EMPTY_RESULT;
    }

    return { parsed, index: index };
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

export function parseOptional<T>(module: ModuleName, code: string, index: number, parseFn: ParseFunction<T>): Partial<ParseResult<T>> | BagelError {
    const result = parseFn(module, code, index);

    if (isError(result)) {
        return result;
    } else {
        return {
            parsed: result?.parsed,
            index: result?.index,
        };
    }
}

export const parseExact = <K extends string>(str: K): ParseFunction<K> => (_module, code, index) => {
    return given(consume(code, index, str), index => ({ parsed: str, index }))
}

export function parseKeyword(code: string, index: number, keyword: string): ParseResult<boolean> {
    const indexAfter = consume(code, index, keyword)
    const newIndex = indexAfter != null ? consumeWhitespaceRequired(code, indexAfter) : undefined

    return {
        parsed: indexAfter != null,
        index: newIndex ?? index
    }
}

export function given<T, R>(val: T|BagelError|undefined, fn: (val: T) => R): R|BagelError|undefined {
    if (val != null && !(isError(val))) {
        return fn(val);
    } else {
        return val as BagelError|undefined;
    }
}

export function expec<T, R>(val: T|BagelError|undefined, err: BagelError, fn: (val: T) => R): R|BagelError {
    if (isError(val)) {
        return val;
    } else if (val != null) {
        return fn(val);
    } else {
        return err;
    }
}

export function err(code: string|undefined, index: number|undefined, expected: string): BagelError {
    return { kind: "bagel-syntax-error", ast: undefined, code, index, message: `${expected} expected`, stack: undefined };
}

export type ParseFunction<T> = (module: ModuleName, code: string, index: number) => ParseResult<T> | BagelError | undefined;

export const plainIdentifier: ParseFunction<PlainIdentifier> = memoize3((module, code, startIndex) => 
    given(identifierSegment(code, startIndex), ({ segment: name, index }) => 
        name.startsWith(INT)
            ? syntaxError(code, index, `Identifiers can't start with '${INT}'`)
            : {
                parsed: {
                    kind: "plain-identifier",
                    name,
                    module,
                    code,
                    startIndex,
                    endIndex: index,
                },
                index,
            }))

export const identifierSegment = memoize2((code: string, index: number): { segment: string, index: number} | undefined => {
    const startIndex = index;

    while (isSymbolic(code[index], index - startIndex === 0)) {
        index++;
    }

    const segment = code.substring(startIndex, index);

    if (index - startIndex > 0) {
        return { segment, index };
    }
})

export type ParseTiers<T> = readonly ParseFunction<T>[][]

export class TieredParser<T> {
    private readonly nextTierFor

    constructor(private readonly tiers: ParseTiers<T>) {
        this.nextTierFor = new Map<ParseFunction<T>, number>();
    
        for (let i = 0; i < tiers.length; i++) {
            for (const fn of tiers[i]) {
                this.nextTierFor.set(fn, i+1);
            }
        }
    }
    
    public readonly parseStartingFromTier = (tier: number): ParseFunction<T> => (module, code, index) => {
        for (let i = tier; i < this.tiers.length; i++) {
            for (const fn of this.tiers[i]) {
                const result = fn(module, code, index)

                if (result != null) {
                    return result;
                }
            }
        }

        return undefined;
    }

    public readonly beneath = (fn: ParseFunction<T>): ParseFunction<T> => ((module: ModuleName, code: string, index: number) =>
        this.parseStartingFromTier(this.nextTierFor.get(fn) as number)(module, code, index))

    public readonly parseBeneath = (module: ModuleName, code: string, index: number, fn: ParseFunction<T>) =>
        this.beneath(fn)(module, code, index)
}