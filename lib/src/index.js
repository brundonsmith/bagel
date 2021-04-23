
// export * as mobx from "mobx";

export * as crowdx from "./crowdx";

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
            const noStart = start == null;
            const noEnd = end == null || end < 0

            let index = 0;
            for (const el of iter) {
                if ((noStart || index >= start) && (noEnd || index < end)) {
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

export function count(iter) {
    let count = 0;

    for (const key in iter) {
        count++;
    }

    return count;
}

export function join(delimiter) {
    return function(iter) {
        let str = "";
        let first = true;

        for (const el of iter) {
            if (first) {
                first = false;
            } else {
                str += delimiter;
            }

            str += el;
        }

        return str;
    }
}

export function concat(iter1) {
    return function(iter2) {
        const result = [];
    
        for (const el of iter1) {
            result.push(el);
        }
    
        for (const el of iter2) {
            result.push(el);
        }
    
        return result;
    }
}

export function log(expr) {
    console.log(expr);
    return expr;
}

export const floor = Math.floor;
export const arrayFrom = Array.from;
export const fromEntries = Object.fromEntries;
