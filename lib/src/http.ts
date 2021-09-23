import { Plan, plan } from "./core.ts";

export function get(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return plan(() => fetch(url, { ...options, method: 'GET' }))
}

export function post(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return plan(() => fetch(url, { ...options, method: 'POST' }))
}

export function put(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return plan(() => fetch(url, { ...options, method: 'PUT' }))
}

export function del(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return plan(() => fetch(url, { ...options, method: 'DELETE' }))
}

export function options(url: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]): Plan<Response> {
    return plan(() => fetch(url, { ...options, method: 'OPTIONS' }))
}
