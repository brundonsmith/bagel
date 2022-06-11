
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

type Reaction = () => void | Promise<void>
type Observable = { obj: WeakRef<object>, prop: string|number|typeof COMPUTED_RESULT|typeof WHOLE_OBJECT }

let reportObservableAccessed: ((obs: Observable) => void) | undefined;
let queuedReactions: Set<Reaction>|undefined // if defined, we're in an action
let trigger: { readonly obj: object, readonly prop: string|number|typeof COMPUTED_RESULT|typeof WHOLE_OBJECT }|undefined
let observablesToReactions: Array<
    Observable & { effect: Reaction }
> = []
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
    if (reportObservableAccessed && obj != null) {
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
    queuedReactions = queuedReactions ?? new Set()
    // TODO: Don't invalidate if the new value is the same as the previous value
    if (topOfAction) trigger = { obj, prop }

    // invalidate cached function results that observed this obj/prop
    for (const entry of memoCache) {
        const entryIsInvalidated =
            entry.observables.some(observable => 
                observable.obj.deref() === obj && (prop === WHOLE_OBJECT || observable.prop === WHOLE_OBJECT || prop === observable.prop))

        if (entryIsInvalidated) {
            const alreadyInvalidated = entry.cached === EMPTY_CACHE
            entry.cached = EMPTY_CACHE
            if (!alreadyInvalidated) {
                invalidate(entry.fn, COMPUTED_RESULT)
            }
        }
    }

    // queue up reactions that observed this obj/prop
    for (const entry of observablesToReactions) {
        if (obj === entry.obj.deref() && (prop === WHOLE_OBJECT || entry.prop === WHOLE_OBJECT || prop === entry.prop)) {
            queuedReactions.add(entry.effect)
        }
    }
    
    // run queued reactions
    if (topOfAction) {
        for (const effect of queuedReactions) {
            effect()
        }
        
        if (topOfAction) trigger = undefined

        queuedReactions = undefined
    }
}

type MemoOptions = {
    maxItems?: number
}

export function computedFn<F extends Function>(fn: F, options: MemoOptions = {}): F {
    // TODO: Respond to options
    
    const computed = ((...args: any[]) => {
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
    
    Object.defineProperty(computed, 'name', {value: fn.name, writable: false});

    return computed
}

export function autorun(fn: Reaction, until: (() => boolean) | undefined) {
    function effect() {
        const newObservablesToReactions: typeof observablesToReactions = []

        // run the reaction and collect all new mappings
        const previous = reportObservableAccessed
        reportObservableAccessed = obs => newObservablesToReactions.push({ ...obs, effect })
        fn()
        reportObservableAccessed = previous

        observablesToReactions = [
            // remove this reaction's entries from the mapping    
            ...observablesToReactions.filter(r => r.effect !== effect),
            ...newObservablesToReactions
        ]
    }

    Object.defineProperty(effect, 'name', {value: fn.name, writable: false});

    effect()

    const unsubscribe = () => {
        // unsubscribe
        observablesToReactions = observablesToReactions.filter(r => r.effect !== effect)
    }

    if (until != null) {
        when(until).then(unsubscribe)
    }

    return unsubscribe
}

export function when(fn: () => boolean): Promise<void> {
    // return new Promise(resolve => setTimeout(resolve, 1000))
    return new Promise(resolve => {
        function effect() {
            const conditionMet = fn()

            if (conditionMet) {
                unsubscribe()
                resolve()
            }
        }

        Object.defineProperty(effect, 'name', { value: 'when(' + fn.name + ')', writable: false });

        const unsubscribe = autorun(effect, undefined)
    })
}

export function action<F extends (...args: any[]) => void>(fn: F): F {
    return ((...args: unknown[]) => {
        const topOfAction = queuedReactions == null
        queuedReactions = queuedReactions ?? new Set()
    
        fn(...args)
        
        if (topOfAction) {
            for (const effect of queuedReactions) {
                effect()
            }
            queuedReactions = undefined
        }
    }) as unknown as F
}

export function runInAction(fn: () => void) {
    const actionFn = action(fn)
    actionFn()
}

export function triggeredBy() {
    return trigger
}