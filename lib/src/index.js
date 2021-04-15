
export * as mobx from "mobx";

export function range(start) {
    return function*(end) {
        for (let i = start; i < end; i++) {
            yield i;
        }
    }
}

export function slice(start) {
    return function(end) {
        return function*(iter) {
            const noEnd = end == null || end < 0
            let index = 0;
            for (const el of iter) {
                if (index >= start && (noEnd || index < end)) {
                    yield el;
                }
                index++;
            }
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
