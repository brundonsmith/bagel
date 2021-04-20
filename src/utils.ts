
export function given<T, R>(val: T|undefined, fn: (val: T) => R): R|undefined {
    if (val != null) {
        return fn(val);
    } else {
        return undefined;
    }
}

export type BagelSyntaxError = {
    kind: "bagel-syntax-error",
    code: string,
    index: number,
    expected: string,
    stack: string|undefined,
}

export function errorMessage(error: BagelSyntaxError): string {
    let line = 1;
    let column = 0;
    for (let i = 0; i <= error.index; i++) {
        if (error.code[i] === "\n") {
            line++;
            column = 0;
        } else {
            column++;
        }
    }

    return `${line}:${column} ${error.expected} expected\n${error.stack}`;
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
    return { kind: "bagel-syntax-error", code, index, expected, stack: Error().stack };
}

export function log<T>(expr: T, fn?: (expr: T) => string): T {
    console.log(fn == null ? expr : fn(expr));
    return expr;
}


type BasicData =
    | {[key: string]: BasicData}
    | BasicData[]
    | string
    | number
    | boolean
    | undefined

export function deepEquals(a: BasicData, b: BasicData): boolean {
    if (a === b) {
        return true;
    } else if(a == null && b == null) {
        return true;
    } else if (a != null && b != null && typeof a === "object" && typeof b === "object") {
        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) {
                return false;
            } else {
                for (let i = 0; i < a.length; i++) {
                    if (!deepEquals(a[i], b[i])) {
                        return false;
                    }
                }
                return true;
            }
        } else if(!Array.isArray(a) && !Array.isArray(b)) {
            const keysSet = Array.from(new Set([...Object.keys(a as {}), ...Object.keys(b as {})]));
            
            for (const key of keysSet) {
                if (!deepEquals(a[key], b[key])) {
                    return false;
                }
            }
            return true;
        }
    }

    return false;
}