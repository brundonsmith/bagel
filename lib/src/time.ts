
import { observable, computed } from "mobx"

const time: { now: number } = observable({ now: Date.now() })

const _millis = computed(() => time.now)
export const millis: () => number = () => _millis.get()
const _seconds = computed(() => Math.floor(millis() / 1000))
export const seconds: () => number = () => _seconds.get()
const _minutes = computed(() => Math.floor(seconds() / 60))
export const minutes: () => number = () => _minutes.get()

function updateTime() {
    time.now = Date.now()
    setTimeout(updateTime, 1)
}

updateTime()