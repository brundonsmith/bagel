import { assert } from "https://deno.land/std@0.136.0/testing/asserts.ts";

import { observe, invalidate, autorun, when, computedFn, action, runInAction } from '../lib/ts/reactivity.ts'

Deno.test({
    name: 'autorun()',
    fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        autorun(() => {
            outcomes.push(observe(obj, 'count'))
        })

        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')

        assert(outcomes[0] === 0)
        assert(outcomes[1] === 1)
        assert(outcomes[2] === 2)
        assert(outcomes[3] === 3)
    }
})

Deno.test({
    name: 'when()',
    async fn() {
        const obj = { count: 0 }

        const interval = setInterval(() => {
            obj.count++; invalidate(obj, 'count')
        }, 0)

        await when(() =>
            observe(obj, 'count') > 3)

        clearInterval(interval)

        assert(obj.count === 4)
    }
})

Deno.test({
    name: 'computedFn()',
    async fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        const doubledCount = computedFn(() => observe(obj, 'count') * 2)
        const doubledDoubledCount = computedFn(() => doubledCount() * 2)

        autorun(() => {
            outcomes.push(doubledDoubledCount())
        })

        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')

        assert(outcomes[0] === 0)
        assert(outcomes[1] === 4)
        assert(outcomes[2] === 8)
        assert(outcomes[3] === 12)
    }
})

Deno.test({
    name: "action()",
    fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        const increment = action(() => {
            obj.count++; invalidate(obj, 'count')
            obj.count++; invalidate(obj, 'count')
            obj.count++; invalidate(obj, 'count')
        })

        autorun(() => {
            outcomes.push(observe(obj, 'count'))
        })

        increment()

        assert(outcomes[0] === 0)
        assert(outcomes[1] === 3)
    }
})

Deno.test({
    name: "runInAction()",
    fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        autorun(() => {
            outcomes.push(observe(obj, 'count'))
        })

        runInAction(() => {
            obj.count++; invalidate(obj, 'count')
            obj.count++; invalidate(obj, 'count')
            obj.count++; invalidate(obj, 'count')
        })

        assert(outcomes[0] === 0)
        assert(outcomes[1] === 3)
    }
})