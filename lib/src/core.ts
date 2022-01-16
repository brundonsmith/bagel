
// Preact
export {
    h
} from "preact"
import { render as prender } from "preact"
export function render(el: unknown) {
    // @ts-ignore
    prender(el, document.body)
}



// Custom reactivity
export {
    observe,
    invalidate,
    autorun,
    computedFn,
    action
} from './_reactivity.ts'


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

function* map<T, R>(fn: (el: T) => R, iter: RawIter<T>): RawIter<R> {
    for (const el of iter) {
        yield fn(el);
    }
}

function* filter<T>(fn: (el: T) => boolean, iter: RawIter<T>): RawIter<T> {
    for (const el of iter) {
        if (fn(el)) {
            yield el;
        }
    }
}

function every<T>(fn: (el: T) => boolean, iter: RawIter<T>): boolean {
    for (const el of iter) {
        if (!fn(el)) {
            return false
        }
    }

    return true
}

function some<T>(fn: (el: T) => boolean, iter: RawIter<T>): boolean {
    for (const el of iter) {
        if (fn(el)) {
            return true
        }
    }

    return false
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

export const fromEntries = Object.fromEntries;

export const INNER_ITER = Symbol('INNER_ITER')

export type Iter<T> = {
    [INNER_ITER]: RawIter<T>,

    map<R>(fn: (el: T) => R): Iter<R>;
    filter(fn: (el: T) => boolean): Iter<T>;
    slice(start: number, end?: number): Iter<T>;
    sort(fn: (a: T, b: T) => number): Iter<T>;
    every(fn: (a: T) => boolean): boolean;
    some(fn: (a: T) => boolean): boolean;
    count(): number;
    concat(other: RawIter<T>|Iter<T>): Iter<T>;
    zip<R>(other: RawIter<R>|Iter<R>): Iter<[T|undefined, R|undefined]>;

    array(): T[];
    set(): Set<T>;
} & (T extends string ? {
    join(delimiter: string): T extends string ? string : never;
} : {})

const CHAINABLE_PROTOTYPE: Omit<Iter<unknown>, typeof INNER_ITER> = {
    map(fn) {
        return iter(map(fn, (this as Iter<unknown>)[INNER_ITER]))
    },
    
    filter(fn) {
        return iter(filter(fn, (this as Iter<unknown>)[INNER_ITER]))
    },

    slice(start, end) {
        return iter(slice(start)(end)((this as Iter<unknown>)[INNER_ITER]))
    },

    sort(fn) {
        return iter(Array.from((this as Iter<unknown>)[INNER_ITER]).sort(fn))
    },

    every(fn) {
        return every(fn, (this as Iter<unknown>)[INNER_ITER])
    },

    some(fn) {
        return some(fn, (this as Iter<unknown>)[INNER_ITER])
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
    },

    set() {
        return new Set((this as Iter<unknown>)[INNER_ITER])
    },
}

export function iter<T>(inner: RawIter<T>): Iter<T> {
    const res = Object.create(CHAINABLE_PROTOTYPE)
    res[INNER_ITER] = inner
    return res
}


// Plans
type PlanChain<T> = {
    then<N>(transformFn: (p: T) => N): Plan<N>;
}

const PLAN_PROTOTYPE: PlanChain<unknown> = {
    then(transformFn) {
        return plan(async () => {
            const res = await (this as Plan<unknown>).planned()
            return transformFn(res)
        })
    }
}

export type Plan<T> = PlanChain<T> & { planned: () => Promise<T>|T }

export function plan<T>(fn: () => Promise<T>|T): Plan<T> {
    const plan: Plan<T> = Object.create(PLAN_PROTOTYPE);
    plan.planned = fn;
    return plan;
}

export function resolve<T>(plan: Plan<T>): Promise<T>|T {
    return plan.planned()
}

export function concurrent<P extends unknown[], R>(fn: (...params: P) => R, ...params: P): Plan<R> {
    return plan(() => asWorker(fn)(...params))
}

function asWorker<P extends unknown[], R>(fn: (...params: P) => R): (...params: P) => Promise<R> {
    const code = `
        const fn = (${fn.toString()})

        onmessage = function(event) {
            const args = JSON.parse(event.data);
            const result = fn(...args)
            postMessage(JSON.stringify(result))
        }
    `

    const worker = new Worker(`data:text/javascript;base64,${btoa(code)}`, { type: "module" });

    return (...params) => new Promise(res => {
        worker.onmessage = function (event) {
            res(JSON.parse(event.data))
        }

        worker.postMessage(JSON.stringify(params))
    })
}


// misc
export function ___typeof(val: unknown) {
    const to = typeof val;

    switch (to) {
        case "string":
        case "number":
        case "boolean":
            return to
        case "undefined":
            return "nil"
        case "object":
            if (val === null) {
                return "nil"
            } else if (Array.isArray(val)) {
                return "array"
            } else if (val instanceof Set) {
                return "set"
            } else if (Object.getPrototypeOf(val).constructor.name === "object") {
                return "object"
            } else {
                // class instance
                return "class-instance"
            }
    }

    throw Error("Failed to determine a typeof for " + val)
}

export function withConst<T,R>(val: T, fn: (val: T) => R): R {
    return fn(val)
}