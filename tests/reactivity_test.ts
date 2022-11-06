import { assertEquals } from "https://deno.land/std@0.136.0/testing/asserts.ts";

import { observe, invalidate, autorun, when, memo, action, runInAction } from '../lib/ts/reactivity.ts'

Deno.test({
    name: 'autorun()',
    fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        autorun(() => {
            outcomes.push(observe(obj, 'count'))
        }, undefined)

        invalidate(obj, 'count', obj.count + 1)
        invalidate(obj, 'count', obj.count + 1)
        invalidate(obj, 'count', obj.count + 1)

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

        invalidate(obj, 'count', obj.count + 1)
        invalidate(obj, 'count', obj.count + 1)
        invalidate(obj, 'count', obj.count + 1)

        assertEquals(outcomes, [0, 1])
    }
})

Deno.test({
    name: 'when()',
    async fn() {
        const obj = { count: 0 }

        const interval = setInterval(() => {
            invalidate(obj, 'count', obj.count + 1)
        }, 0)

        await when(() =>
            observe(obj, 'count') > 3)

        clearInterval(interval)

        assertEquals(obj.count, 4)
    }
})

Deno.test({
    name: 'memo()',
    async fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        const doubledCount = memo(() => observe(obj, 'count') * 2)
        const doubledDoubledCount = memo(() => doubledCount() * 2)

        autorun(() => {
            outcomes.push(doubledDoubledCount())
        }, undefined)

        invalidate(obj, 'count', obj.count + 1)
        invalidate(obj, 'count', obj.count + 1)
        invalidate(obj, 'count', obj.count + 1)

        assertEquals(outcomes, [0, 4, 8, 12])
    }
})

Deno.test({
    name: "action()",
    fn() {
        const outcomes: number[] = []

        const obj = { count: 0 }

        const increment = action(() => {
            invalidate(obj, 'count', obj.count + 1)
            invalidate(obj, 'count', obj.count + 1)
            invalidate(obj, 'count', obj.count + 1)
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
            invalidate(obj, 'count', obj.count + 1)
            invalidate(obj, 'count', obj.count + 1)
            invalidate(obj, 'count', obj.count + 1)
        })


        assertEquals(outcomes, [0, 3])
    }
})