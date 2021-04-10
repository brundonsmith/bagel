
export * as mobx from "../node_modules/mobx/dist/index.js";

export function range(start) {
    return function*(end) {
        for (let i = start; i < end; i++) {
            yield i;
        }
    }
}

export function map(fn) {
    return function*(iter) {
        for (const el of iter) {
            yield fn(el);
        }
    }
}

export function filter(fn) {
    return function*(iter) {
        for (const el of iter) {
            if (fn(el)) {
                yield el;
            }
        }
    }
}

export function* entries(obj) {
    for (const key in obj) {
        yield [key, obj[key]];
    }
}

export const fromEntries = Object.fromEntries;
