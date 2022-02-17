
// class NMap {
//     private contents = new Map()

//     set(args: any[], value: any) {
//         let current: WeakMap<any, any> = this.contents

//         for (let i = 0; i < args.length - 1; i++) {
//             if (!current.has(args[i])) {
//                 current.set(args[i], new Map())
//             } else if (!(current.get(args[i]) instanceof Map)) {
//                 throw Error(`Expected WeakMap, found ${current.get(args[i])}`)
//             }

//             current = current.get(args[i])
//         }

//         current.set(args[args.length - 1], value)
//     }

//     get(args: any[]) {
//         let current = this.contents

//         for (let i = 0; i < args.length && current != null; i++) {
//             if (!(current instanceof WeakMap)) {
//                 return undefined
//             } else {
//                 current = current.get(args[i])
//             }
//         }

//         return current
//     }

//     delete(args: any[]) {
//         let current = this.contents

//         for (let i = 0; i < args.length - 1 && current != null; i++) {
//             if (!(current instanceof WeakMap)) {
//                 return
//             } else {
//                 current = current.get(args[i])
//             }
//         }

//         current.delete(args[args.length - 1])
//     }
// }

export const WHOLE_OBJECT = Symbol('WHOLE_OBJECT')
const COMPUTED_RESULT = Symbol('COMPUTED_RESULT')

type Reaction = () => void
type Observable = { obj: WeakRef<object>, prop: string|number|typeof COMPUTED_RESULT|typeof WHOLE_OBJECT }

let reportObservableAccessed: ((obs: Observable) => void) | undefined;
let queuedReactions: Set<Reaction>|undefined // if defined, we're in an action
let observablesToReactions: Array<{
    obj: WeakRef<object>,
    prop: string|number|typeof COMPUTED_RESULT|typeof WHOLE_OBJECT,
    effect: Reaction
}> = []
const memoCache: Array<{
    fn: Function,
    args: unknown[],
    observables: Observable[]
    cached: unknown | typeof EMPTY_CACHE
}> = []
const EMPTY_CACHE = Symbol('EMPTY_CACHE')

// @ts-ignore
export function observe<O extends object, K extends (keyof O & string|number)>(obj: O, prop: K): O[K];
export function observe<O extends object, K extends typeof WHOLE_OBJECT>(obj: O, prop: K): O;
export function observe<O extends object, K extends typeof COMPUTED_RESULT>(obj: O, prop: K): undefined;
export function observe<O extends object, K extends (keyof O & string|number) | typeof COMPUTED_RESULT | typeof WHOLE_OBJECT>(obj: O, prop: K)
        // @ts-ignore
        : O[K] | O | undefined {

    // if something is observing, report this obj/prop to it
    if (reportObservableAccessed) {
        reportObservableAccessed({ obj: new WeakRef(obj), prop })
    }
    
    // return observed value
    if (prop === WHOLE_OBJECT) {
        return obj
    } else if (prop === COMPUTED_RESULT) {
        return undefined
    } else {
        // @ts-ignore
        const val = obj?.[prop]
        
        if (typeof val === 'function') {
            return val.bind(obj) // methods
        } else {
            return val
        }
    }
}

export function invalidate(obj: object, prop: string|number|typeof COMPUTED_RESULT|typeof WHOLE_OBJECT = WHOLE_OBJECT) {
    const topOfAction = queuedReactions == null
    const queue = queuedReactions = queuedReactions ?? new Set()

    // invalidate cached function results that observed this obj/prop
    for (const entry of memoCache) {
        const entryIsInvalidated =
            entry.observables.some(o => 
                o.obj.deref() === obj && (prop === WHOLE_OBJECT || prop === o.prop))

        if (entryIsInvalidated) {
            entry.cached = EMPTY_CACHE
            invalidate(entry.fn, COMPUTED_RESULT)
        }
    }

    // queue up reactions that observed this obj/prop
    for (const entry of observablesToReactions) {
        if (obj === entry.obj.deref() && (prop === WHOLE_OBJECT || prop === entry.prop)) {
            queue.add(entry.effect)
        }
    }
    
    // run queued reactions
    if (topOfAction) {
        for (const effect of queue) {
            effect()
        }
        queuedReactions = undefined
    }
}

export function computedFn<F extends Function>(fn: F): F {
    return ((...args: any[]) => {
        observe(fn, COMPUTED_RESULT)

        // see if we have a cache entry for this function already
        const cacheEntry = memoCache.find(cacheEntry =>
            cacheEntry.fn === fn && args.every((_, index) => args[index] === cacheEntry.args[index]))

        // if we have a valid cache entry, just return it
        if (cacheEntry && cacheEntry.cached !== EMPTY_CACHE) {
            return cacheEntry.cached
        } else {

            // call the function and collect the observables that were accessed
            const previous = reportObservableAccessed
            const observables: Observable[] = []
            reportObservableAccessed = obs => observables.push(obs)
            const result = fn(...args)
            reportObservableAccessed = previous

            // cache the result alongside the observables
            if (!cacheEntry) {
                memoCache.push({
                    fn,
                    args,
                    observables,
                    cached: result
                })
            } else {
                cacheEntry.observables = observables
                cacheEntry.cached = result
            }

            return result
        }
    }) as unknown as F
}

export function autorun(fn: Reaction) {
    function run() {

        // remove this reaction's entries from the mapping
        observablesToReactions = observablesToReactions.filter(r => r.effect !== run)

        // run the reaction and collect all new mappings
        const previous = reportObservableAccessed
        reportObservableAccessed = obs => observablesToReactions.push({ ...obs, effect: run })
        fn()
        reportObservableAccessed = previous
    }

    run()
}

export function action<F extends (...args: any[]) => void>(fn: F): F {
    return ((...args: unknown[]) => {
        const topOfAction = queuedReactions == null
        const queue = queuedReactions = queuedReactions ?? new Set()
    
        fn(...args)
        
        if (topOfAction) {
            for (const effect of queue) {
                effect()
            }
            queuedReactions = undefined
        }
    }) as unknown as  F
}