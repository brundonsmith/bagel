
function range(start: number) {
    return function*(end: number) {
        for (let i = start; i < end; i++) {
            yield i;
        }
    }
}

function map<T, R>(fn: (el: T) => R) {
    return function*(iter: Iterable<T>) {
        for (const el of iter) {
            yield fn(el);
        }
    }
}

function filter<T>(fn: (el: T) => boolean) {
    return function*(iter: Iterable<T>) {
        for (const el of iter) {
            if (fn(el)) {
                yield el;
            }
        }
    }
}

function* entries(obj: {[key: string]: unknown}): Iterable<[string, unknown]> {
    for (const key in obj) {
        yield [key, obj[key]];
    }
}

const fromEntries = Object.fromEntries;