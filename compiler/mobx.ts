
import * as mobx from "https://jspm.dev/npm:mobx@6.3.3"
import * as mobx_utils from "https://jspm.dev/npm:mobx-utils@6.0.4"

export const configure: (options: Record<string, unknown>) => void = mobx.configure as any
export const observable: <T>(x: T) => T = mobx.observable as any
export const autorun: (fn: () => void) => void = mobx.autorun as any
export const computed: <T>(fn: () => T) => { get(): T } = mobx.computed as any

export const createTransformer: <P, R>(fn: (p: P) => R) => (p: P) => R = mobx_utils.createTransformer as any