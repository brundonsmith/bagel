import { parse } from "./1_parse/index.ts";
import { reshape } from "./2_reshape/index.ts";
import { getParentsMap, scopescan } from "./3_checking/scopescan.ts";
import { typecheck } from "./3_checking/typecheck.ts";
import { compile, INT } from "./4_compile/index.ts";
import { path } from "./deps.ts";
import { BagelError, miscError } from "./errors.ts";
import { computedFn, makeAutoObservable } from "./mobx.ts";
import { given, iterateParseTree, ModuleName, pathIsRemote } from "./utils.ts";
import { AST, Module } from "./_model/ast.ts";
import { ParentsMap, ScopesMap } from "./_model/common.ts";

class _Store {

    constructor() {
        makeAutoObservable(this)
    }

    config: undefined | Readonly<{
        entryFileOrDir: ModuleName,
        singleEntry: boolean,
        bundle: boolean,
        watch: boolean,
        includeTests: boolean,
        emit: boolean
    }> = undefined
    modules = new Set<ModuleName>()
    readonly modulesSource = new Map<ModuleName, string>()

    get modulesOutstanding() {
        return this.modules.size === 0 || this.modules.size > this.modulesSource.size
    }

    readonly parsed = computedFn((source: string): { ast: Module, errors: readonly BagelError[] } => {
        const errors: BagelError[] = []
        const ast = reshape(parse(source, err => errors.push(err)))
        return { ast, errors }
    })

    readonly parentsMap = computedFn(getParentsMap)

    get allParents() {
        const set = new Set<ParentsMap>()

        for (const module of this.modules) {
            const source = this.modulesSource.get(module)
            
            if (source) {
                const { ast } = this.parsed(source)
                set.add(this.parentsMap(ast))
            }
        }

        return set
    }

    readonly scopesMap = computedFn((ast: Module): { scopes: ScopesMap, errors: readonly BagelError[] } => {
        try {
            const errors: BagelError[] = []
            const scopes = scopescan(
                err => errors.push(err),
                this.allParents,
                ast
            )

            return { scopes, errors }
        } catch {
            return { scopes: new Map(), errors: [] }
        }
    })

    get allScopes() {
        const set = new Set<ScopesMap>()

        for (const module of this.modules) {
            const source = this.modulesSource.get(module)
            
            if (source) {
                const { ast } = this.parsed(source)
                const { scopes } = this.scopesMap(ast)

                set.add(scopes)
            }
        }

        return set
    }

    readonly getModuleFor = computedFn((ast: AST): ModuleName|undefined => {
        for (const moduleName of this.modules) {
            const source = this.modulesSource.get(moduleName)

            if (source) {
                const { ast: moduleAst } = this.parsed(source)

                for (const { current } of iterateParseTree(moduleAst)) {
                    if (current.id === ast.id) {
                        return moduleName
                    }
                }
            }
        }
    })

    readonly typeerrors = computedFn((module: ModuleName, ast: Module): BagelError[] => {
        const errors: BagelError[] = []
        try {
            const { errors: scopeErrors } = this.scopesMap(ast)
            errors.push(...scopeErrors)
            typecheck(
                err => errors.push(err),
                imported => 
                    given(this.modulesSource.get(canonicalModuleName(module, imported)), 
                        source => this.parsed(source).ast), 
                this.allParents,
                this.allScopes, 
                ast
            )
            return errors
        } catch (e) {
            return [ ...errors, miscError(ast, e.toString()) ]
        }
    })

    readonly compiled = computedFn((module: ModuleName, ast: Module): string => {
        try {
            return (
                LIB_IMPORTS + 
                (ast.hasMain ? MOBX_CONFIGURE : '') + 
                compile(
                    this.allParents, 
                    this.allScopes, 
                    ast, 
                    module, 
                    this.config?.includeTests
                )
            )
        } catch (e) {
            console.error(e)
            return '';
        }
    })
}
const Store = new _Store()
export default Store

const IMPORTED_ITEMS = [ 'reactionUntil',  'observable', 'computed', 'configure', 'makeObservable', 'h',
'computedFn', 'range', 'entries', 'log', 'fromEntries', 'Iter', 'RawIter', 'Plan', 'INNER_ITER'
].map(s => `${s} as ${INT}${s}`).join(', ')

const LIB_IMPORTS = `
import { ${IMPORTED_ITEMS} } from "../../lib/src/core.ts";
`
const MOBX_CONFIGURE = `
${INT}configure({
    enforceActions: "never",
    computedRequiresReaction: false,
    reactionRequiresObservable: false,
    observableRequiresReaction: false,
});`

export function canonicalModuleName(importerModule: ModuleName, importPath: string): ModuleName {
    if (pathIsRemote(importPath)) {
        return importPath as ModuleName
    } else {
        const moduleDir = path.dirname(importerModule);
        return (path.resolve(moduleDir, importPath) + ".bgl") as ModuleName
    }
}
