import { assertEquals } from "https://deno.land/std@0.136.0/testing/asserts.ts";

import { observe, invalidate, autorun, when, computedFn, action, runInAction } from '../lib/ts/reactivity.ts'

Deno.test({
    name: 'autorun()',
    fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        autorun(() => {
            outcomes.push(observe(obj, 'count'))
        }, undefined)

        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')

        assertEquals(outcomes, [0, 1, 2, 3])
    }
})

Deno.test({
    name: 'autorun() with until',
    fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        autorun(() => {
            outcomes.push(observe(obj, 'count'))
        }, () => observe(obj, 'count') > 1)

        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')

        assertEquals(outcomes, [0, 1])
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

        assertEquals(obj.count, 4)
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
        }, undefined)

        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')
        obj.count++; invalidate(obj, 'count')

        assertEquals(outcomes, [0, 4, 8, 12])
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
        }, undefined)

        increment()

        assertEquals(outcomes, [0, 3])
    }
})

Deno.test({
    name: "runInAction()",
    fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        autorun(() => {
            outcomes.push(observe(obj, 'count'))
        }, undefined)

        runInAction(() => {
            obj.count++; invalidate(obj, 'count')
            obj.count++; invalidate(obj, 'count')
            obj.count++; invalidate(obj, 'count')
        })


        assertEquals(outcomes, [0, 3])
    }
})