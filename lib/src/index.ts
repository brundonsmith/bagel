import { IReactionPublic, IReactionOptions, IReactionDisposer, reaction as mreaction, when, autorun } from "mobx";


// MobX
export {
    observable,
    computed,
    configure
} from "mobx"

function reaction<T>(expression: () => T, effect: (arg: T) => void, opts?: IReactionOptions | undefined): IReactionDisposer {
    effect(expression()) // eagerly evaluate
    return mreaction(expression, effect, opts)
}

export function reactionUntil<T>(expression: () => T, effect: (arg: T) => void, until?: () => boolean, opts?: IReactionOptions | undefined): void {
    const r = reaction(expression, effect, opts);
    if (until) {
        when(until, r);
    }
}


// Preact
export {
    h,
} from "preact"
import {
    render as prender,
} from "preact"

export function render(a: Parameters<typeof prender>[0]) {
    return function (b: Parameters<typeof prender>[1]): ReturnType<typeof prender> {
        return prender(a, b)
    }
}


// Custom
export function range(start: number) {
    return function*(end: number) {
        for (let i = start; i < end; i++) {
            yield i;
        }
    }
}

export function slice<T>(start: number|undefined) {
    return function(end: number|undefined) {
        return function*(iter: Iterable<T>) {
            let index = 0;
            for (const el of iter) {
                if ((start == null || index >= start) && (end == null || index < end)) {
                    yield el;
                }
                index++;
            }
        }
    }
}

export function map<T, R>(fn: (el: T) => R) {
    return function*(iter: Iterable<T>) {
        for (const el of iter) {
            yield fn(el);
        }
    }
}

export function filter<T>(fn: (el: T) => boolean) {
    return function*(iter: Iterable<T>) {
        for (const el of iter) {
            if (fn(el)) {
                yield el;
            }
        }
    }
}

export function* entries<V>(obj: {[key: string]: V}): Generator<[string, V], void, unknown> {
    for (const key in obj) {
        yield [key, obj[key]];
    }
}

export function count<T>(iter: Iterable<T>) {
    let count = 0;

    for (const key in iter) {
        count++;
    }

    return count;
}

export function join<T extends string>(delimiter: string) {
    return function(iter: Iterable<T>) {
        let str = "";
        let first = true;

        for (const el of iter) {
            if (first) {
                first = false;
            } else {
                str += delimiter;
            }

            str += el;
        }

        return str;
    }
}

export function concat<T>(iter1: Iterable<T>) {
    return function(iter2: Iterable<T>) {
        const result: T[] = [];
    
        for (const el of iter1) {
            result.push(el);
        }
    
        for (const el of iter2) {
            result.push(el);
        }
    
        return result;
    }
}

export function log<T>(expr: T): T {
    console.log(expr);
    return expr;
}

export const floor = Math.floor;
export const arrayFrom = Array.from;
export const fromEntries = Object.fromEntries;
