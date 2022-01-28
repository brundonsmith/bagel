
import { observe, WHOLE_OBJECT } from "./_reactivity.ts";

// Preact
// export {
//     h
// } from "preact"
// import { render as prender } from "preact"
// export function render(el: unknown) {
//     // @ts-ignore
//     prender(el, document.body)
// }

type Element = { tagName: string, attributes: object, children: Element[] }

export function h(tagName: string, attributes: object, ...children: Element[]): Element {
    return { tagName, attributes, children }
}

export function render(el: Element) {
    // @ts-ignore
    document.body.innerHTML = _renderInner(el)
}
function _renderInner({ tagName, attributes, children }: Element): string {
    return `<${tagName} ${Object.entries(attributes ?? {}).map(([key, value]) => `${key}="${value}"`)}>${children.map(render)}</${tagName}>`
}

// Custom reactivity
export {
    observe,
    invalidate,
    autorun,
    computedFn,
    action,
    WHOLE_OBJECT
} from './_reactivity.ts'


// Custom
function* _repeat<T>(val: T, count: number): RawIter<T> {
    for (let i = 0; i < count; i++) {
        yield val
    }
}
export function repeat<T>(val: T, count: number): Iter<T> {
    return new Iter(_repeat(val, count))
}

function _range(start: number) {
    return function*(end: number): RawIter<number> {
        for (let i = start; i < end; i++) {
            yield i;
        }
    }
}

export function range(start: number) {
    return function(end: number): Iter<number> {
        return new Iter(_range(start)(end))
    }
}

export function slice<T>(start: number|undefined) {
    return function(end: number|undefined) {
        return function*(iter: RawIter<T>): RawIter<T> {
            if (iter[Symbol.iterator]) {
                observe(iter, WHOLE_OBJECT)
            }

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
    if (iter[Symbol.iterator]) {
        observe(iter, WHOLE_OBJECT)
    }

    for (const el of iter) {
        yield fn(el);
    }
}

function* filter<T>(fn: (el: T) => boolean, iter: RawIter<T>): RawIter<T> {
    if (iter[Symbol.iterator]) {
        observe(iter, WHOLE_OBJECT)
    }

    for (const el of iter) {
        if (fn(el)) {
            yield el;
        }
    }
}

function every<T>(fn: (el: T) => boolean, iter: RawIter<T>): boolean {
    if (iter[Symbol.iterator]) {
        observe(iter, WHOLE_OBJECT)
    }

    for (const el of iter) {
        if (!fn(el)) {
            return false
        }
    }

    return true
}

function some<T>(fn: (el: T) => boolean, iter: RawIter<T>): boolean {
    if (iter[Symbol.iterator]) {
        observe(iter, WHOLE_OBJECT)
    }

    for (const el of iter) {
        if (fn(el)) {
            return true
        }
    }

    return false
}

export function* entries<V>(obj: {[key: string]: V}): RawIter<[string, V]> {
    observe(obj, WHOLE_OBJECT)
    for (const key in obj) {
        yield [key, obj[key]];
    }
}

function count<T>(iter: RawIter<T>): number {
    if (iter[Symbol.iterator]) {
        observe(iter, WHOLE_OBJECT)
    }

    let count = 0;

    for (const _ of iter) {
        count++;
    }

    return count;
}

function concat<T>(iter1: RawIter<T>) {
    return function*(iter2: RawIter<T>): RawIter<T> {
        if (iter1[Symbol.iterator]) {
            observe(iter1, WHOLE_OBJECT)
        }
        if (iter2[Symbol.iterator]) {
            observe(iter2, WHOLE_OBJECT)
        }
            
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
        if (iter1[Symbol.iterator]) {
            observe(iter1, WHOLE_OBJECT)
        }
        if (iter2[Symbol.iterator]) {
            observe(iter2, WHOLE_OBJECT)
        }


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
        if (iter[Symbol.iterator]) {
            observe(iter, WHOLE_OBJECT)
        }

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

export const INNER_ITER = Symbol('INNER_ITER')

export function iter<T>(inner: RawIter<T>): Iter<T> {
    return new Iter(inner)
}

export class Iter<T> {

    [INNER_ITER]: RawIter<T>

    constructor(inner: RawIter<T>) {
        this[INNER_ITER] = inner
    }
    
    map = <R>(fn: (el: T) => R): Iter<R> => {
        return new Iter(map(fn, (this as Iter<any>)[INNER_ITER]))
    }
    
    filter = (fn: (el: T) => boolean): Iter<T> => {
        return new Iter(filter(fn, (this as Iter<any>)[INNER_ITER]))
    }

    slice = (start: number, end?: number): Iter<T> => {
        return new Iter(slice(start)(end)((this as Iter<any>)[INNER_ITER])) as Iter<T>
    }

    sorted = (fn: (a: T, b: T) => number): Iter<T> => {
        return new Iter(Array.from((this as Iter<any>)[INNER_ITER]).sort(fn))
    }

    every = (fn: (a: T) => boolean): boolean => {
        return every(fn, (this as Iter<any>)[INNER_ITER])
    }

    some = (fn: (a: T) => boolean): boolean => {
        return some(fn, (this as Iter<any>)[INNER_ITER])
    }

    count = (): number => {
        return count((this as Iter<any>)[INNER_ITER])
    }

    concat = (other: RawIter<T>|Iter<T>): Iter<T> => {
        return new Iter(concat((this as Iter<any>)[INNER_ITER])((other as any)[INNER_ITER] ?? other))
    }

    zip = <R>(other: RawIter<R>|Iter<R>): Iter<[T|null|undefined, R|null|undefined]> => {
        return new Iter(zip((this as Iter<any>)[INNER_ITER])((other as any)[INNER_ITER] ?? other))
    }

    array = (): T[] => {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }
        return Array.from((this as Iter<any>)[INNER_ITER])
    }

    set = (): Set<T> => {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }
        return new Set((this as Iter<any>)[INNER_ITER])
    }

    // TODO: These two are only available for certain types of iterators. Need a way to specify that at a type level.
    // object = (): {[left]: right} => {
    //
    // }
    //
    // join = (delimiter: string): string => {
    //     return join(delimiter)((this as unknown as Iter<string>)[INNER_ITER])
    // }
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