
import { observable, computed } from "mobx"

export const time: { now: BigInt } = observable({ now: BigInt(Date.now()) * 1000000n })

function updateTime() {
    time.now = BigInt(Date.now()) * 1000000n
    setTimeout(updateTime, 1)
}

let updateTimeStarted = false;
export function updateTimeIfNeeded() {
    if (!updateTimeStarted) {
        updateTimeStarted = true;
        updateTime();
    }
}