
export function test(fn: () => string|void) {
    if (!process.argv[2] || process.argv[2] === fn.name) {
        try {
            const result = fn();
    
            if (result != null) {
                const description = typeof result === "string" ? `: "${result}"` : ``;
                console.error(`❌ ${fn.name}` + description)
            } else {
                console.log(`✅ ${fn.name}`)
            }
        } catch(err) {
            console.error(`❌ ${fn.name}\n` + err.message)
        }
    }
}