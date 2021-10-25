
import { observable, computed } from "mobx"
import { Temporal } from '@js-temporal/polyfill'

const time: { now: BigInt } = observable({ now: BigInt(Date.now()) * 1000000n })
const now = computed(() =>
    new Temporal.ZonedDateTime(
        time.now, // epoch nanoseconds
        Temporal.TimeZone.from('America/Chicago'), // timezone
        Temporal.Calendar.from('iso8601') // default calendar
    ))

function updateTime() {
    time.now = BigInt(Date.now()) * 1000000n
    setTimeout(updateTime, 1)
}

let updateTimeStarted = false;
function updateTimeIfNeeded() {
    if (!updateTimeStarted) {
        updateTimeStarted = true;
        updateTime();
    }
}

export const millis = () => {
    updateTimeIfNeeded()
    return now.get().millisecond
}
export const seconds = () => {
    updateTimeIfNeeded()
    return now.get().second
}
export const minutes = () => {
    updateTimeIfNeeded()
    return now.get().minute
}
export const hours = () => {
    updateTimeIfNeeded()
    return now.get().hour
}
