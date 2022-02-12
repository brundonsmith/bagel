import { Plan } from "./core.ts";

export function get(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return () => fetch(url, { ...options, method: 'GET' }).then(res => res.json())
}

export function post(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return () => fetch(url, { ...options, method: 'POST' }).then(res => res.json())
}

export function put(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return () => fetch(url, { ...options, method: 'PUT' }).then(res => res.json())
}

export function del(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return () => fetch(url, { ...options, method: 'DELETE' }).then(res => res.json())
}

export function options(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return () => fetch(url, { ...options, method: 'OPTIONS' }).then(res => res.json())
}
