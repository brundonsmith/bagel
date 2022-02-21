
import { autorun, invalidate, observe, WHOLE_OBJECT } from "./_reactivity.ts";

// Preact
// export {
//     h
// } from "https://ga.jspm.io/npm:preact@10.6.5/dist/preact.js"
// import { render as prender } from "https://ga.jspm.io/npm:preact@10.6.5/dist/preact.js"
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
    return `<${tagName} ${Object.entries(attributes ?? {}).map(([key, value]) => `${key}="${value}"`)}>${children.map(_renderInner)}</${tagName}>`
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


// Errors
export type Error<T> = { kind: typeof ERROR_SYM, value: T }
export const ERROR_SYM = Symbol('ERROR_SYM')

// Iterators
function* _range(start: number, end: number): RawIter<number> {
    for (let i = start; i < end; i++) {
        yield i;
    }
}
export function range(start: number, end: number): Iter<number> {
    return new Iter(_range(start, end))
}

function* _repeat<T>(val: T, count: number): RawIter<T> {
    for (let i = 0; i < count; i++) {
        yield val
    }
}
export function repeat<T>(val: T, count: number): Iter<T> {
    return new Iter(_repeat(val, count))
}

export function* entries<V>(obj: {[key: string]: V}): RawIter<[string, V]> {
    observe(obj, WHOLE_OBJECT)
    for (const key in obj) {
        yield [key, obj[key]];
    }
}


const INNER_ITER = Symbol('INNER_ITER')

type RawIter<T> = Iterable<T>|Generator<T>

export function iter<T>(inner: RawIter<T>): Iter<T> {
    return new Iter(inner)
}

export class Iter<T> {

    [INNER_ITER]: RawIter<T>

    constructor(inner: RawIter<T>) {
        this[INNER_ITER] = inner
    }
    
    map<R>(fn: (el: T) => R): Iter<R> {
        return new Iter(map(fn, this[INNER_ITER]))
    }

    reduce<R>(init: R, fn: (acc: R, el: T) => R): R {
        let acc = init
        for (const el of this[INNER_ITER]) {
            acc = fn(acc, el)
        }
        return acc
    }
    
    filter(fn: (el: T) => boolean): Iter<T> {
        return new Iter(filter(fn, this[INNER_ITER]))
    }

    slice(start: number, end?: number): Iter<T> {
        return new Iter(slice(start, end, this[INNER_ITER]))
    }

    takeWhile(fn: (el: T) => boolean): Iter<T> {
        return new Iter(takeWhile(this[INNER_ITER], fn))
    }

    sorted(fn: (a: T, b: T) => number): Iter<T> {
        return new Iter(Array.from(this[INNER_ITER]).sort(fn))
    }

    every(fn: (a: T) => boolean): boolean {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }
    
        for (const el of this[INNER_ITER]) {
            if (!fn(el)) {
                return false
            }
        }
    
        return true
    }

    some(fn: (a: T) => boolean): boolean {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }
    
        for (const el of this[INNER_ITER]) {
            if (fn(el)) {
                return true
            }
        }
    
        return false
    }

    count(): number {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }
    
        let count = 0;
    
        for (const _ of this[INNER_ITER]) {
            count++;
        }
    
        return count;
    }

    concat(other: Iter<T>): Iter<T> {
        return new Iter(concat(this[INNER_ITER], other[INNER_ITER] ?? other))
    }

    zip<R>(other: Iter<R>): Iter<[T|null|undefined, R|null|undefined]> {
        return new Iter(zip(this[INNER_ITER], other[INNER_ITER] ?? other))
    }

    collectArray(): T[] {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }

        return Array.from(this[INNER_ITER])
    }

    collectObject(): {[key: string]: unknown} {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }
        
        const obj = {} as {[key: string]: unknown}
        for (const entry of this[INNER_ITER]) {
            if (Array.isArray(entry)) {
                const [key, value] = entry

                obj[key] = value
            }
        }

        return obj
    }

    set(): Set<T> {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }
        return new Set(this[INNER_ITER])
    }

    // Bagel will ensure this is an Iter<string>
    join(delimiter: string): string {
        if (this[INNER_ITER][Symbol.iterator]) {
            observe(this[INNER_ITER], WHOLE_OBJECT)
        }

        let str = "";
        let first = true;

        for (const el of this[INNER_ITER]) {
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

function* slice<T>(start: number|undefined, end: number|undefined, iter: RawIter<T>): RawIter<T> {
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

function* takeWhile<T>(iter: RawIter<T>, fn: (el: T) => boolean): RawIter<T> {
    if (iter[Symbol.iterator]) {
        observe(iter, WHOLE_OBJECT)
    }

    for (const el of iter) {
        if (fn(el)) {
            yield el;
        } else {
            return
        }
    }
}

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

function* concat<T>(iter1: RawIter<T>, iter2: RawIter<T>): RawIter<T> {
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

function* zip<T, R>(iter1: RawIter<T>, iter2: RawIter<R>): RawIter<[T|null|undefined, R|null|undefined]> {
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


// Plans
export type Plan<T> = () => Promise<T>

export function concurrent<P extends unknown[], R>(fn: (...params: P) => R, ...params: P): Plan<R> {
    return () => asWorker(fn)(...params)
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

export class Remote<T> {

    constructor (
        fetcher: () => Plan<T>
    ) {
        let latestRequestId: string|undefined;

        autorun(() => {
            const thisRequestId = latestRequestId = String(Math.random())
            
            this.loading = true; invalidate(this, 'loading');
            
            fetcher()()
                .then(res => {
                    if (thisRequestId === latestRequestId) {
                        this.value = res; invalidate(this, 'value');
                        this.loading = false; invalidate(this, 'loading');
                    }
                })
                .catch(() => {
                    if (thisRequestId === latestRequestId) {
                        // TODO
                        this.loading = false; invalidate(this, 'loading');
                    }
                })
        })
    }

    public value: T|undefined;
    public loading = false;
}


// Runtime type checking
export const RT_UNKNOWN = Symbol('RT_UNKNOWN')
export const RT_NIL = Symbol('RT_NIL')
export const RT_BOOLEAN = Symbol('RT_BOOLEAN')
export const RT_NUMBER = Symbol('RT_NUMBER')
export const RT_STRING = Symbol('RT_STRING')
export const RT_LITERAL = Symbol('RT_LITERAL')
export const RT_ITERATOR = Symbol('RT_ITERATOR')
export const RT_PLAN = Symbol('RT_PLAN')
export const RT_REMOTE = Symbol('RT_REMOTE')
export const RT_ARRAY = Symbol('RT_ARRAY')
export const RT_RECORD = Symbol('RT_RECORD')
export const RT_OBJECT = Symbol('RT_OBJECT')
export const RT_NOMINAL = Symbol('RT_NOMINAL')

type RuntimeType =
    | typeof RT_UNKNOWN
    | typeof RT_NIL
    | typeof RT_BOOLEAN
    | typeof RT_NUMBER
    | typeof RT_STRING
    | { kind: typeof RT_LITERAL, value: string|number|boolean }
    | { kind: typeof RT_NOMINAL, nominal: symbol }
    | {
        kind: typeof RT_ITERATOR | typeof RT_PLAN | typeof RT_REMOTE | typeof RT_ARRAY,
        inner: RuntimeType
    }
    | RuntimeType[] // union
    | { kind: typeof RT_RECORD, key: RuntimeType, value: RuntimeType }
    | { kind: typeof RT_OBJECT, entries: { key: string, value: RuntimeType, optional: boolean }[] }


export function instanceOf(val: any, type: RuntimeType): boolean {
    switch (type) {
        case RT_UNKNOWN: return true;
        case RT_NIL: return val == null;
        case RT_BOOLEAN: return typeof val === 'boolean';
        case RT_NUMBER: return typeof val === 'number';
        case RT_STRING: return typeof val === 'string';
        default: {
            if (Array.isArray(type)) {
                return type.some(member => instanceOf(val, member))
            }

            switch (type.kind) {
                case RT_LITERAL: return val === type.value;
                case RT_ARRAY: return Array.isArray(val) && val.every(member => instanceOf(member, type.inner));
                case RT_NOMINAL: return typeof val === 'object' || val != null && val.kind === type.nominal
                case RT_RECORD: {
                    if (typeof val !== 'object' || val == null) {
                        return false
                    } else {
                        for (const key in val) {
                            if (!instanceOf(key, type.key)) {
                                return false
                            }
                            if (!instanceOf(val[key], type.value)) {
                                return false
                            }
                        }

                        return true
                    }
                }
                case RT_OBJECT: {
                    if (typeof val !== 'object' || val == null) {
                        return false
                    } else {
                        for (const entry of type.entries) {
                            let found = false
                            
                            for (const key in val) {
                                if (key === entry.key) {
                                    found = true

                                    if (!instanceOf(val[key], entry.value)) {
                                        // found and doesn't match type
                                        return false
                                    }
                                }
                            }

                            if (!found && !entry.optional) {
                                // not found
                                return false
                            }
                        }

                        return true
                    }
                }

                // TODO:
                // case RT_ITERATOR: return val instanceof Iter;
                // case RT_PLAN: return false
                // case RT_REMOTE: return val instanceof Remote;
            }
        }
    }

    throw Error('Received invalid runtime type')
}

// | MaybeType
// | GenericParamType
// | ProcType
// | FuncType
// | GenericType
// | BoundGenericType
// | ElementType
// | TupleType
// | NominalType
// | AnyType
// | JavascriptEscapeType