
export function test(fn: () => string|void) {
    if (!Deno.args[0] || Deno.args[0] === fn.name) {
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