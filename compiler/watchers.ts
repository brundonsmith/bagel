import { Colors } from "./deps.ts";
import { on } from "./utils/misc.ts";
import { ModuleName } from "./_model/common.ts";

const watchers = new Map<ModuleName, Deno.FsWatcher>()

export function watch(module: ModuleName, cb: (newContents: string) => void) {
    if (watchers.get(module) == null) {
        try {
            const watcher = Deno.watchFs(module);
            watchers.set(module, watcher);

            on(watcher, async () => {
                try {
                    const fileContents = await Deno.readTextFile(module);
                    cb(fileContents)
                } catch {
                    // TODO: Retry logic?
                    console.error(Colors.red('Error') + `    couldn't find module ${module}`)
                }
            })
        } catch {
            console.error(Colors.red('Error') + `    couldn't find module ${module}`)
        }
    }
}