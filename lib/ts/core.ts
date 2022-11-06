
// Custom reactivity
export {
    observe,
    invalidate,
    autorun,
    memo,
    action,
    WHOLE_OBJECT
} from './reactivity.ts'

export type {
    Plan,
} from './reactivity.ts'


import { observe, WHOLE_OBJECT, Plan, memo, autorun, invalidate } from "./reactivity.ts";

export const LOADING = Symbol('LOADING')

export function planned<T>(plan: Plan<T>): T | typeof LOADING {
    return observe(getRemote(plan), 'current')
}

const getRemote = memo(<T,>(plan: Plan<T>) => new Remote(plan))

class Remote<T> {
    constructor (
        plan: Plan<T>
    ) {
        autorun(async () => {
            const thisRequestId = this.latestRequestId = String(Math.random())
                
            invalidate(this, 'current', LOADING);
            
            await plan()
                .then(res => {
                    if (thisRequestId === this.latestRequestId) {
                        invalidate(this, 'current', res);
                    }
                })
        }, undefined)
    }

    private latestRequestId: string|undefined;
    public current: T | typeof LOADING = LOADING;
}


// Errors
export type Error<T> = { kind: typeof ERROR_SYM, value: T }
export const ERROR_SYM = Symbol('ERROR_SYM')

// Iterators
function* _range(start: number, end: number): Generator<number> {
    for (let i = start; i < end; i++) {
        yield i;
    }
}
export function range(start: number, end: number): Iter<number> {
    return new Iter(() => _range(start, end))
}

function* _repeat<T>(val: T, count: number): Generator<T> {
    for (let i = 0; i < count; i++) {
        yield val
    }
}
export function repeat<T>(val: T, count: number): Iter<T> {
    return new Iter(_repeat(val, count))
}

function* _entries<V>(obj: {[key: string]: V}): Generator<[string, V]> {
    observe(obj, WHOLE_OBJECT)
    for (const key in obj) {
        yield [key, obj[key]];
    }
}

export function entries<V>(obj: {[key: string]: V}): Iter<[string, V]> {
    return new Iter(() => _entries(obj))
}

function* _keys<V>(obj: {[key: string]: V}): Generator<string> {
    observe(obj, WHOLE_OBJECT)
    for (const key in obj) {
        yield key
    }
}

export function keys<V>(obj: {[key: string]: V}): Iter<string> {
    return new Iter(() => _keys(obj))
}

function* _values<V>(obj: {[key: string]: V}): Generator<V> {
    observe(obj, WHOLE_OBJECT)
    for (const key in obj) {
        yield obj[key]
    }
}

export function values<V>(obj: {[key: string]: V}): Iter<V> {
    return new Iter(() => _values(obj))
}

const INNER_ITER = Symbol('INNER_ITER')

type RawIter<T> = Iterable<T>|(() => Generator<T>)

export function iter<T>(inner: RawIter<T>): Iter<T> {
    return new Iter(inner)
}

export class Iter<T> {

    [INNER_ITER]: RawIter<T>

    constructor(inner: RawIter<T>) {
        this[INNER_ITER] = inner
    }

    get inner() {
        const inner = this[INNER_ITER]
        return typeof inner === 'function' ? inner() : inner
    }
    
    map<R>(fn: (el: T) => R): Iter<R> {
        return new Iter(map(fn, this[INNER_ITER]))
    }

    reduce<R>(init: R, fn: (acc: R, el: T) => R): R {
        let acc = init
        for (const el of this.inner) {
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
        return new Iter(Array.from(this.inner).sort(fn))
    }

    every(fn: (a: T) => boolean): boolean {
        const inner = this.inner

        if (inner[Symbol.iterator]) {
            observe(inner, WHOLE_OBJECT)
        }
    
        for (const el of inner) {
            if (!fn(el)) {
                return false
            }
        }
    
        return true
    }

    some(fn: (a: T) => boolean): boolean {
        const inner = this.inner

        if (inner[Symbol.iterator]) {
            observe(inner, WHOLE_OBJECT)
        }
    
        for (const el of inner) {
            if (fn(el)) {
                return true
            }
        }
    
        return false
    }

    count(): number {
        const inner = this.inner

        if (inner[Symbol.iterator]) {
            observe(inner, WHOLE_OBJECT)
        }
    
        let count = 0;
    
        for (const _ of inner) {
            count++;
        }
    
        return count;
    }

    first(): T | undefined {
        const inner = this.inner

        if (inner[Symbol.iterator]) {
            observe(inner, WHOLE_OBJECT)
        }

        for (const item of inner) {
            return item
        }
    }

    concat(other: Iter<T>): Iter<T> {
        return new Iter(concat(this[INNER_ITER], other[INNER_ITER] ?? other))
    }

    zip<R>(other: Iter<R>): Iter<[T|null|undefined, R|null|undefined]> {
        return new Iter(zip(this[INNER_ITER], other[INNER_ITER] ?? other))
    }

    indexed(): Iter<[T, number]> {
        return new Iter(indexed(this[INNER_ITER]))
    }

    collectArray(): T[] {
        const inner = this.inner

        if (inner[Symbol.iterator]) {
            observe(inner, WHOLE_OBJECT)
        }

        return Array.from(inner)
    }

    collectObject(): {[key: string]: unknown} {
        const inner = this.inner

        if (inner[Symbol.iterator]) {
            observe(inner, WHOLE_OBJECT)
        }
        
        const obj = {} as {[key: string]: unknown}
        for (const entry of inner) {
            if (Array.isArray(entry)) {
                const [key, value] = entry

                obj[key] = value
            }
        }

        return obj
    }

    set(): Set<T> {
        const inner = this.inner
        
        if (inner[Symbol.iterator]) {
            observe(inner, WHOLE_OBJECT)
        }
        return new Set(inner)
    }

    // Bagel will ensure this is an Iter<string>
    join(delimiter: string): string {
        const inner = this.inner
        
        if (inner[Symbol.iterator]) {
            observe(inner, WHOLE_OBJECT)
        }

        let str = "";
        let first = true;

        for (const el of inner) {
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

function* slice<T>(start: number|undefined, end: number|undefined, iter: RawIter<T>): Generator<T> {
    const inner = typeof iter === 'function' ? iter() : iter 
    
    if (inner[Symbol.iterator]) {
        observe(inner, WHOLE_OBJECT)
    }

    let index = 0;
    for (const el of inner) {
        if ((start == null || index >= start) && (end == null || index < end)) {
            yield el;
        }
        index++;
    }
}

function* takeWhile<T>(iter: RawIter<T>, fn: (el: T) => boolean): Generator<T> {
    const inner = typeof iter === 'function' ? iter() : iter 
    
    if (inner[Symbol.iterator]) {
        observe(inner, WHOLE_OBJECT)
    }

    for (const el of inner) {
        if (fn(el)) {
            yield el;
        } else {
            return
        }
    }
}

function* map<T, R>(fn: (el: T) => R, iter: RawIter<T>): Generator<R> {
    const inner = typeof iter === 'function' ? iter() : iter 

    if (inner[Symbol.iterator]) {
        observe(inner, WHOLE_OBJECT)
    }

    for (const el of inner) {
        yield fn(el);
    }
}

function* filter<T>(fn: (el: T) => boolean, iter: RawIter<T>): Generator<T> {
    const inner = typeof iter === 'function' ? iter() : iter 

    if (inner[Symbol.iterator]) {
        observe(inner, WHOLE_OBJECT)
    }

    for (const el of inner) {
        if (fn(el)) {
            yield el;
        }
    }
}

function* concat<T>(iter1: RawIter<T>, iter2: RawIter<T>): Generator<T> {
    const inner1 = typeof iter1 === 'function' ? iter1() : iter1 
    const inner2 = typeof iter2 === 'function' ? iter2() : iter2 

    if (inner1[Symbol.iterator]) {
        observe(inner1, WHOLE_OBJECT)
    }
    if (inner2[Symbol.iterator]) {
        observe(inner2, WHOLE_OBJECT)
    }
        
    for (const el of inner1) {
        yield el;
    }

    for (const el of inner2) {
        yield el;
    }
}

function* zip<T, R>(iter1: RawIter<T>, iter2: RawIter<R>): Generator<[T|null|undefined, R|null|undefined]> {
    const inner1 = typeof iter1 === 'function' ? iter1() : iter1 
    const inner2 = typeof iter2 === 'function' ? iter2() : iter2 

    if (inner1[Symbol.iterator]) {
        observe(inner1, WHOLE_OBJECT)
    }
    if (inner2[Symbol.iterator]) {
        observe(inner2, WHOLE_OBJECT)
    }


    const a = inner1[Symbol.iterator]();
    const b = inner2[Symbol.iterator]();

    let nextA = a.next();
    let nextB = b.next();
    
    while (!nextA.done || !nextB.done) {
        yield [nextA.value, nextB.value];

        nextA = a.next();
        nextB = b.next();
    }
}

function* indexed<T>(iter: RawIter<T>): Generator<[T, number]> {
    const inner = typeof iter === 'function' ? iter() : iter 

    if (inner[Symbol.iterator]) {
        observe(inner, WHOLE_OBJECT)
    }

    let index = 0;
    for (const el of inner) {
        yield [el, index];
        index++
    }
}

// Plans
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
            worker.terminate()
        }

        worker.postMessage(JSON.stringify(params))
    })
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
export const RT_ERROR = Symbol('RT_ERROR')
export const RT_NOMINAL = Symbol('RT_NOMINAL')
export const RT_ARRAY = Symbol('RT_ARRAY')
export const RT_RECORD = Symbol('RT_RECORD')
export const RT_OBJECT = Symbol('RT_OBJECT')

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
    | { kind: typeof RT_ERROR, inner: RuntimeType }


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
                case RT_NOMINAL: return typeof val === 'object' && val != null && val.kind === type.nominal
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
                case RT_ERROR: return typeof val === 'object' && val != null && val.kind === ERROR_SYM && instanceOf(val.value, type.inner)

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

export function* exec(exp: RegExp, s: string) {
    const expr = new RegExp(exp)
    let result

    while (result = expr.exec(s)) {
        const [match, ...groups] = result
        yield { match, groups }

        if (!exp.flags.includes('g')) {
            return
        }
    }
}
