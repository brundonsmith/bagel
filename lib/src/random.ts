
export function random(proc: (n: number) => void): void {
    proc(Math.random())
}