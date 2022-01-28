
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
    if (reportObservableAccessed) {
        // console.log('observe(', obj, prop, ')')
        // console.log(`observe()`, { obj, prop })
        reportObservableAccessed({ obj: new WeakRef(obj), prop })
    }
    
    if (prop === WHOLE_OBJECT) {
        return obj
    }
    if (prop === COMPUTED_RESULT) {
        return undefined
    }

    // @ts-ignore
    const val = obj[prop]
    
    return typeof val === 'function' ? val.bind(obj) : val
}

export function invalidate(obj: object, prop: string|number|typeof COMPUTED_RESULT|typeof WHOLE_OBJECT = WHOLE_OBJECT) {
    // console.log('invalidate(', obj, prop, ')')
    const topOfAction = queuedReactions == null
    const queue = queuedReactions = queuedReactions ?? new Set()

    for (const entry of memoCache) {
        const entryIsInvalidated =
            entry.observables.some(o => 
                o.obj.deref() === obj && (prop === WHOLE_OBJECT || prop === o.prop))

        if (entryIsInvalidated) {
            entry.cached = EMPTY_CACHE
            invalidate(entry.fn, COMPUTED_RESULT)
        }
    }

    for (const entry of observablesToReactions) {
        if (obj === entry.obj.deref() && (prop === WHOLE_OBJECT || prop === entry.prop)) {
            queue.add(entry.effect)
        }
    }
    
    if (topOfAction) {
        for (const effect of queue) {
            effect()
        }
        queuedReactions = undefined
    }
}

export function autorun(fn: Reaction) {
    function run() {
        observablesToReactions = observablesToReactions.filter(r => r.effect !== run)

        const previous = reportObservableAccessed
        reportObservableAccessed = obs => observablesToReactions.push({ ...obs, effect: run })
        fn()
        reportObservableAccessed = previous
    }

    run()
}

export function computedFn<F extends Function>(fn: F): F {
    return ((...args: any[]) => {
        observe(fn as any, COMPUTED_RESULT)

        const cacheEntry = memoCache.find(cacheEntry =>
            cacheEntry.fn === fn && args.every((_, index) => args[index] === cacheEntry.args[index]))

        // console.log({ cacheEntry })

        if (cacheEntry && cacheEntry.cached !== EMPTY_CACHE) {
            // console.log('cache hit: ', cacheEntry.cached)
            return cacheEntry.cached
        } else {
            const observables: Observable[] = []

            const previous = reportObservableAccessed
            reportObservableAccessed = (obs) => observables.push(obs)
            const result = fn(...args)
            reportObservableAccessed = previous

            // console.log('caching: ', result)
            if (!cacheEntry) {
                memoCache.push({
                    fn,
                    args,
                    observables,
                    cached: result
                })
            } else {
                cacheEntry.cached = result
            }

            // console.log('cache miss: ', result)
            return result
        }
    }) as unknown as  F
}

export function action<F extends (...args: any[]) => void>(fn: F): F {
    return ((...args: any[]) => {
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