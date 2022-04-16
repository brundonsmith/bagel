
import * as mobx from "https://jspm.dev/npm:mobx@6.3.3"
import * as mobx_utils from "https://jspm.dev/npm:mobx-utils@6.0.4"

export const makeAutoObservable: (obj: object) => void = mobx.makeAutoObservable as any
export const configure: (options: Record<string, unknown>) => void = mobx.configure as any
export const observable: <T>(x: T) => T = mobx.observable as any
export const autorun: (fn: () => void) => void = mobx.autorun as any
export const reaction: <T>(fn: () => T, eff: (val: T) => void) => void = mobx.reaction as any
export const when: (fn: () => boolean) => Promise<void> = mobx.when as any
export const computed: <T>(fn: () => T) => { get(): T } = mobx.computed as any
export const trace: () => void = mobx.trace
export const runInAction: (fn: () => void) => void = mobx.runInAction

export const computedFn: <F extends (...args: any[]) => any>(fn: F) => F = mobx_utils.computedFn as any