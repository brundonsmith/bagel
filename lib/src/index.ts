// import { IReactionPublic, IReactionOptions, IReactionDisposer, reaction as mreaction, when, autorun } from "mobx";


// MobX
// export {
//     observable,
//     computed,
//     configure
// } from "mobx"

// function reaction<T>(expression: () => T, effect: (arg: T) => void, opts?: IReactionOptions | undefined): IReactionDisposer {
//     effect(expression()) // eagerly evaluate
//     return mreaction(expression, effect, opts)
// }

// export function reactionUntil<T>(expression: () => T, effect: (arg: T) => void, until?: () => boolean, opts?: IReactionOptions | undefined): void {
//     const r = reaction(expression, effect, opts);
//     if (until) {
//         when(until, r);
//     }
// }


// Preact
// export {
//     h,
// } from "preact"
// import {
//     render as prender,
// } from "preact"

// export function render(a: Parameters<typeof prender>[0]) {
//     return function (b: Parameters<typeof prender>[1]): ReturnType<typeof prender> {
//         return prender(a, b)
//     }
// }


// Custom
function _range(start: number) {
    return function*(end: number): RawIter<number> {
        for (let i = start; i < end; i++) {
            yield i;
        }
    }
}

export function range(start: number) {
    return function(end: number): Iter<number> {
        return iter(_range(start)(end))
    }
}

export function slice<T>(start: number|undefined) {
    return function(end: number|undefined) {
        return function*(iter: RawIter<T>): RawIter<T> {
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


export type RawIter<T> = Iterable<T>|Generator<T>

function map<T, R>(fn: (el: T) => R) {
    return function*(iter: RawIter<T>): RawIter<R> {
        for (const el of iter) {
            yield fn(el);
        }
    }
}

function filter<T>(fn: (el: T) => boolean) {
    return function*(iter: RawIter<T>): RawIter<T> {
        for (const el of iter) {
            if (fn(el)) {
                yield el;
            }
        }
    }
}

export function* entries<V>(obj: {[key: string]: V}): RawIter<[string, V]> {
    for (const key in obj) {
        yield [key, obj[key]];
    }
}

function count<T>(iter: RawIter<T>): number {
    let count = 0;

    for (const _ of iter) {
        count++;
    }

    return count;
}

function concat<T>(iter1: RawIter<T>) {
    return function*(iter2: RawIter<T>): RawIter<T> {    
        for (const el of iter1) {
            yield el;
        }
    
        for (const el of iter2) {
            yield el;
        }
    }
}

function zip<T>(iter1: RawIter<T>) {
    return function*<R>(iter2: RawIter<R>): RawIter<[T|undefined, R|undefined]> {
        const a = iter1[Symbol.iterator]();
        const b = iter2[Symbol.iterator]();

        let nextA = a.next();
        let nextB = b.next();
        
        while (!nextA.done || !nextB.done) {
            yield [nextA.value, nextB.value];

            nextA = a.next();
            nextB = b.next();
        }
    }
}

function join<T extends string>(delimiter: string) {
    return function(iter: RawIter<T>) {
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

export function log<T>(expr: T): T {
    console.log(expr);
    return expr;
}

export const floor = Math.floor;
export const arrayFrom = <T>(iter: RawIter<T>): T[] => Array.from(iter);
export const fromEntries = Object.fromEntries;

const INNER_ITER = Symbol('INNER_ITER')

export type Iter<T> = {
    [INNER_ITER]: RawIter<T>,

    map<R>(fn: (el: T) => R): Iter<R>;
    filter(fn: (el: T) => boolean): Iter<T>;
    slice(start: number, end?: number): Iter<T>;
    sort(fn: (a: T, b: T) => number): Iter<T>;
    count(): number;
    concat(other: RawIter<T>|Iter<T>): Iter<T>;
    zip<R>(other: RawIter<R>|Iter<R>): Iter<[T|undefined, R|undefined]>;

    array(): T[];
} & (T extends string ? {
    join(delimiter: string): T extends string ? string : never;
} : {})

const CHAINABLE_PROTOTYPE: Omit<Iter<unknown>, typeof INNER_ITER> = {
    map(fn) {
        return iter(map(fn)((this as Iter<unknown>)[INNER_ITER]))
    },
    
    filter(fn) {
        return iter(filter(fn)((this as Iter<unknown>)[INNER_ITER]))
    },

    slice(start, end) {
        return iter(slice(start)(end)((this as Iter<unknown>)[INNER_ITER]))
    },

    sort(fn) {
        return iter(Array.from((this as Iter<unknown>)[INNER_ITER]).sort(fn))
    },

    count() {
        return count((this as Iter<unknown>)[INNER_ITER])
    },

    concat(other) {
        return iter(concat((this as Iter<unknown>)[INNER_ITER])((other as any)[INNER_ITER] ?? other))
    },

    zip(other) {
        return iter(zip((this as Iter<unknown>)[INNER_ITER])((other as any)[INNER_ITER] ?? other))
    },

    // @ts-ignore
    join(delimiter) {
        return join(delimiter)((this as unknown as Iter<string>)[INNER_ITER])
    },

    array() {
        return Array.from((this as Iter<unknown>)[INNER_ITER])
    }    
}

function iter<T>(iter: RawIter<T>): Iter<T> {
    const res = Object.create(CHAINABLE_PROTOTYPE)
    res[INNER_ITER] = iter
    return res
}

// Object.assign(Array.prototype, {
//     map(fn: any) {
//         return iter(map(fn)(this))
//     },
    
//     filter(fn: any) {
//         return iter(filter(fn)(this))
//     },

//     slice(start: any, end?: any) {
//         return iter(slice(start)(end)(this))
//     },

//     count() {
//         return count(this)
//     },

//     concat(other: any) {
//         return iter(concat(this)((other as any)[INNER_ITER] ?? other))
//     },

//     zip(other: any) {
//         return iter(zip(this)((other as any)[INNER_ITER] ?? other))
//     },

//     array() {
//         return Array.from(this)
//     }
// } as any)

const res = iter([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    .map(el => 'num is ' + el)
    .filter(s => s.length < 9)
    .join(',')

console.log(res)