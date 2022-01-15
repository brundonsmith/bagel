
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

// deep map from computedFn arguments to results cache
// map with which we can respond to any given observable invalidation:
//  - delete relevant cache entries
//  - trigger relevant reactions

type Reaction = () => void

type Observable = { obj: object, prop: string }

export function observe(obj: object, prop: string) {
    if (reportObservableRead) {
        console.log(`observe `, { obj, prop })
        reportObservableRead({ obj, prop })
    }

    // @ts-ignore
    return obj[prop]
}

export function invalidate(obj: object, prop: string) {
    console.log(`invalidate `, { obj, prop })
    const queued = new Set<Reaction>()

    for (const entry of observablesToReactions) {
        if (obj === entry.obj && prop === entry.prop) {
            queued.add(entry.effect)
        }
    }

    invalidateCacheEntries(obj, prop)

    console.log('cache ', memoCache[0])
    // console.log('reactions ', observablesToReactions)

    for (const effect of queued) {
        effect()
    }
}

let reportObservableRead: ((obs: Observable) => void) | undefined;

let observablesToReactions: Array<{
    obj: object,
    prop: string,
    effect: Reaction
}> = []

let memoCache: Array<{
    fn: Function,
    args: unknown[],
    observables: Observable[]
    cached: unknown
}> = []

function invalidateCacheEntries(obj: object, prop: string) {
    function entryIsInvalidated(cacheEntry: typeof memoCache[number]) {
        return cacheEntry.observables.some(o => o.obj === obj && o.prop === prop)
    }

    for (const entry of memoCache) {
        if (entryIsInvalidated(entry)) {
            invalidate(entry.fn, 'result')
        }
    }

    memoCache = memoCache.filter(c => !entryIsInvalidated(c))
}


export function autorun(fn: Reaction) {
    function run() {
        observablesToReactions = observablesToReactions.filter(r => r.effect !== run)

        const observables: Observable[] = []
        
        const previous = reportObservableRead
        reportObservableRead = (obs) => observables.push(obs)
        fn()
        reportObservableRead = previous

        for (const { obj, prop } of observables) {
            observablesToReactions.push({ obj, prop, effect: run })
        }
    }

    run()
}

export function computedFn(fn: Function): Function {
    return (...args: any[]) => {
        observe(fn, 'result')

        const cacheEntry = memoCache.find(cacheEntry =>
            cacheEntry.fn === fn && args.every((_, index) => args[index] === cacheEntry.args[index]))

        if (cacheEntry) {
            return cacheEntry.cached
        } else {
            const observables: Observable[] = []

            const previous = reportObservableRead
            reportObservableRead = (obs) => observables.push(obs)
            const result = fn(...args)
            reportObservableRead = previous

            console.log('caching ', result)
            memoCache.push({
                fn,
                args,
                observables,
                cached: result
            })

            return result
        }
    }
}

export function startAction() {

}

export function endAction() {

}
