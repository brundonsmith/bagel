
export function test(fn: () => string|void) {
    const result = fn();

    if (result != null) {
        const description = typeof result === "string" ? `: "${result}"` : ``;
        console.error(`❌ ${fn.name}` + description)
    } else {
        console.log(`✅ ${fn.name}`)
    }
}