import { Colors } from "./deps.ts";
import { diskModulePath } from "./utils/cli.ts";
import { on } from "./utils/misc.ts";
import { ModuleName } from "./_model/common.ts";

const watchers = new Map<string, Deno.FsWatcher>()

export function watch(module: ModuleName, cb: (newContents: string) => void) {
    const modulePath = diskModulePath(module)
    
    if (watchers.get(modulePath) == null) {
        try {
            const watcher = Deno.watchFs(modulePath);
            watchers.set(modulePath, watcher);

            on(watcher, async () => {
                try {
                    const fileContents = await Deno.readTextFile(modulePath);
                    cb(fileContents)
                } catch {
                    // TODO: Retry logic?
                    console.error(Colors.red('Error') + `    couldn't find module ${modulePath}`)
                }
            })
        } catch {
            console.error(Colors.red('Error') + `    couldn't find module ${modulePath}`)
        }
    }
}