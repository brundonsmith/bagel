import { path, fs, Colors } from "../deps.ts";
import { ModuleName } from "../_model/common.ts";
import { Platform } from "../_model/declarations.ts";
import { exists } from "./misc.ts";

export const POSSIBLE_COMMANDS = ['new', 'init', 'build', 'run', 'transpile', 'check', 
'test', 'format', 'autofix', 'clean'] as const
type Command = typeof POSSIBLE_COMMANDS[number]

export const { command, target, flags } = (() => {
    const args = Deno.args

    const flags = args.filter(arg => arg.startsWith('--'))
    const nonFlags = args.filter(arg => !arg.startsWith('--'))

    const command = nonFlags[0]
    const target = path.resolve(Deno.cwd(), nonFlags[1] || '.')
    const targetExists = fs.existsSync(target)


    if (!(POSSIBLE_COMMANDS as readonly string[]).includes(command)) {
        fail(`Must provide a valid command:\n${POSSIBLE_COMMANDS.join(', ')}`)
    }

    if ((command === 'new' || command === 'init') && targetExists) {
        if (command === 'new') {
            fail(`Cannot create project directory ${target} because it already exists`)
        } else if (command === 'init') {
            fail(`Can't initialize Bagel project here because one already exists`)
        }
    } else if ((command !== 'new' && command !== 'init') && !targetExists) {
        fail(`Couldn't find '${target}'`)
    }

    return {
        command: command as Command,
        target,
        flags: {
            watch: flags.includes('--watch'),
            clean: flags.includes('--clean'),
            node: flags.includes('--node'),
            deno: flags.includes('--deno'),
            bundle: flags.includes('--bundle'),
        } as const
    }
})()

export function fail(msg: string): any {
    console.error(Colors.red(pad('Failed')) + msg)
    Deno.exit(1)
}

export function pad(str: string): string {
    const targetLength = 11;
    let res = str
    while (res.length < targetLength) {
        res += ' '
    }
    return res
}

export const cliPlatforms = [
    flags.deno ? 'deno' : undefined,
    flags.node ? 'node' : undefined,
].filter(exists) as Platform[]

const targetStat = Deno.statSync(target)
export const targetDir = targetStat.isDirectory ? target : path.dirname(target)
export const targetIsScript = targetStat.isFile

export const entry = (() => {
    if (command === 'run' || command === 'build') {
        const entryPath = (
            targetStat.isDirectory
                ? path.resolve(target, 'index.bgl')
                : target
        )

        if (!fs.existsSync(entryPath) || path.extname(entryPath) !== '.bgl') {
            fail(`Couldn't find entry '${target}'`)
        }

        return entryPath as ModuleName
    }
})()

export const allEntries = (
    command === 'build' || command === 'run' ? [entry as ModuleName] :
    Deno.statSync(target).isDirectory ? getAllFiles(target).filter(f => f.match(/.*\.bgl$/)) :
    [ target as ModuleName ]
)

function getAllFiles(dirPath: string, arrayOfFiles: ModuleName[] = []): ModuleName[] {
    for (const file of Deno.readDirSync(dirPath)) {
        const filePath = path.resolve(dirPath, file.name);

        if (Deno.statSync(filePath).isDirectory) {
            getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath as ModuleName);
        }
    }
  
    return arrayOfFiles;
}

type Mode = 'project-dir' | 'script' | 'anonymous'
const mode: Mode = (
    targetIsScript ? 'script' :
    entry == null ? 'anonymous' :
    'project-dir'
)

export const scratchDir = (() => {
    if (mode === 'project-dir') {
        // project-local
        return targetDir
    } else {
        // In user's home directory

        let baseDir;
        switch (Deno.build.os) {
            case "darwin":
                baseDir = Deno.env.get("HOME");
                if (baseDir)
                    baseDir = path.resolve(baseDir, "./Library/Caches")
                break;
            case "windows":
                baseDir = Deno.env.get("LOCALAPPDATA");
                if (!baseDir) {
                    baseDir = Deno.env.get("USERPROFILE");
                    if (baseDir)
                        baseDir = path.resolve(baseDir, "./AppData/Local");
                }
                if (baseDir)
                    baseDir = path.resolve(baseDir, "./Cache");
                break;
            case "linux": {
                const xdg = Deno.env.get("XDG_CACHE_HOME");
                if (xdg && xdg[0] === "/")
                    baseDir = xdg;
            } break;
        }

        if (!baseDir) {
            baseDir = Deno.env.get("HOME");
            if (baseDir)
                baseDir = path.resolve(baseDir, "./.cache")
        }

        if (!baseDir)
            throw new Error("Failed to find cache directory");

        return path.resolve(baseDir, 'bagel')
    }
})()

export const cacheDir = path.resolve(scratchDir, `bagel_modules`)
export const buildDir = path.resolve(scratchDir, 'bagel_out')

fs.ensureDirSync(cacheDir)
fs.ensureDirSync(buildDir)

export const bundlePath = (
    mode === 'project-dir' ? targetDir + '.bundle.js' :
    entry ? path.resolve(buildDir, uniqueFileName(entry) + '.bundle.js') :
    ''
)

export function diskModulePath(module: string): string {
    if (pathIsRemote(module)) {
        return path.resolve(cacheDir, uniqueFileName(module))
    } else {
        return module
    }
}

function uniqueFileName(module: string) {
    const extName = path.extname(module)
    const sanitizedModule = encodeURIComponent(module).replaceAll(/%[a-z0-9]{2}/gi, '_').replaceAll('.', '_')
    return sanitizedModule + '-' + btoa(module) + extName
}

export function transpilePath(module: string): string {
    if (mode === 'anonymous' && pathIsInProject(module)) {
        return module + '.ts'
    } else if (mode === 'script') {
        return path.resolve(buildDir, uniqueFileName(module)) + '.ts'
    } else {
        return path.resolve(buildDir, pathRelativeToProject(diskModulePath(module))) + '.ts'
    }
}

export function pathIsInProject(module: string): boolean {
    return (
        module === target ||
        ((mode === 'project-dir' || mode === 'anonymous') && isWithin(targetDir, module))
    )
}

export function canonicalModuleName(importerModule: ModuleName, importPath: string): ModuleName {
    if (pathIsRemote(importPath)) {
        return importPath as ModuleName
    } else {
        const moduleDir = path.dirname(importerModule);
        return path.resolve(moduleDir, importPath) as ModuleName
    }
}

export function pathIsRemote(path: string): boolean {
    return path.match(/^https?:\/\//) != null
}

export function pathRelativeToProject(module: string): string {
    return path.relative(targetDir, diskModulePath(module))
}

export function isWithin(dir: string, other: string) {
    if (!Deno.statSync(dir).isDirectory) {
        return false
    }

    const relative = path.relative(dir, other)
    return !relative.startsWith('../') && relative !== '..'
}

export const devMode = true

function cleanCache() {
    let numCachedFiles = 0;
    for (const file of Deno.readDirSync(cacheDir)) {
        numCachedFiles++
        Deno.removeSync(path.resolve(cacheDir, file.name))
    }

    let numBuiltFiles = 0;
    for (const file of Deno.readDirSync(buildDir)) {
        numBuiltFiles++
        Deno.removeSync(path.resolve(buildDir, file.name))
    }

    console.log(Colors.yellow(pad('Cleaned')) + 'Bagel cache (' + numCachedFiles + ' cached modules, ' + numBuiltFiles + ' built modules)')
}

if (command === 'clean' || flags.clean) {
    cleanCache()
}