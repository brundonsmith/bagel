
export function test(fn: () => string|void) {
    if (!process.argv[2] || process.argv[2] === fn.name) {
        const result = fn();
    
        if (result != null) {
            const description = typeof result === "string" ? `: "${result}"` : ``;
            console.error(`❌ ${fn.name}` + description)
        } else {
            console.log(`✅ ${fn.name}`)
        }
    }
}