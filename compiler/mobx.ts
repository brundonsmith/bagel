
import * as mobx from "https://jspm.dev/mobx"
import * as mobx_utils from "https://jspm.dev/mobx-utils"

export const configure: (options: Record<string, unknown>) => void = mobx.configure
export const observable: <T>(x: T) => T = mobx.observable
export const autorun: (fn: () => void) => void = mobx.autorun
export const computed: <T>(fn: () => T) => { get(): T } = mobx.computed

export const createTransformer: <P, R>(fn: (p: P) => R) => (p: P) => R = mobx_utils.createTransformer