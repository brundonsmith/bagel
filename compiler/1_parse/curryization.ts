import { PlainIdentifier,SourceInfo,Block } from "../_model/common.ts";
import { Expression,Func,Proc,Funcall } from "../_model/expressions.ts";
import { ProcCall } from "../_model/statements.ts";
import { TypeExpression,UNKNOWN_TYPE,FuncType,ProcType } from "../_model/type-expressions.ts";


export const funcsFromArgs = (
    typeParams: PlainIdentifier[], 
    args: { name: PlainIdentifier, type?: TypeExpression }[], 
    returnType: TypeExpression, 
    body: Expression, 
    sourceInfo: SourceInfo
): Func => {
    let first: Func|undefined
    let last: Func|undefined

    for (let i = 0; i < args.length; i++) {
        const next: Func = 
            i < args.length - 1
                ? {
                    kind: "func",
                    type: {
                        kind: "func-type",
                        typeParams: i === 0 ? typeParams : [],
                        arg: { name: args[i].name, type: args[i].type ?? UNKNOWN_TYPE },
                        returnType: UNKNOWN_TYPE, // let it be inferred
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined
                    },
                    // Gets filled in below!
                    body: (undefined as any),
                    ...sourceInfo
                }
                : { // final function
                    kind: "func",
                    type: {
                        kind: "func-type",
                        typeParams: i === 0 ? typeParams : [],
                        arg: { name: args[i].name, type: args[i].type ?? UNKNOWN_TYPE },
                        returnType, // use the real one
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined
                    },
                    body, // use the real one
                    ...sourceInfo
                }

        if (first == null) {
            first = last = next
        } else {
            (last as Func).body = next
            last = next
        }
    }

    return first 
        ?? { // there's no first function, meaning there are no arguments at all
            kind: "func",
            type: {
                kind: "func-type",
                typeParams,
                arg: undefined,
                returnType, // use the real one
                code: undefined,
                startIndex: undefined,
                endIndex: undefined
            },
            body, // use the real one
            ...sourceInfo
        }
}

export const procFromArgs = (
    typeParams: PlainIdentifier[], 
    args: { name: PlainIdentifier, type?: TypeExpression }[], 
    body: Block, 
    sourceInfo: SourceInfo
): Func|Proc => {
    let first: Func|Proc|undefined
    let last: Func|Proc|undefined

    for (let i = 0; i < args.length; i++) {
        const next: Func|Proc = 
            i < args.length - 1
                ? {
                    kind: "func",
                    type: {
                        kind: "func-type",
                        typeParams: i === 0 ? typeParams : [],
                        arg: { name: args[i].name, type: args[i].type ?? UNKNOWN_TYPE },
                        returnType: UNKNOWN_TYPE, // let it be inferred
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined
                    },
                    // Gets filled in below!
                    body: (undefined as any),
                    ...sourceInfo
                }
                : { // final
                    kind: "proc",
                    type: {
                        kind: "proc-type",
                        typeParams: i === 0 ? typeParams : [],
                        arg: { name: args[i].name, type: args[i].type ?? UNKNOWN_TYPE },
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined
                    },
                    body, // use the real one
                    ...sourceInfo
                }

        if (first == null) {
            first = last = next
        } else {
            (last as Func).body = next
            last = next
        }
    }

    return first 
        ?? { // there's no first function, meaning there are no arguments at all
            kind: "proc",
            type: {
                kind: "proc-type",
                typeParams,
                arg: undefined,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined
            },
            body, // use the real one
            ...sourceInfo
        }
}

export const funcTypesFromArgs = (
    typeParams: PlainIdentifier[],
    args: { name: PlainIdentifier, type?: TypeExpression }[],
    returnType: TypeExpression,
    sourceInfo: SourceInfo
): FuncType => {
    let first: FuncType|undefined
    let last: FuncType|undefined

    for (let i = 0; i < args.length; i++) {
        const next: FuncType = 
            i < args.length - 1
                ? {
                    kind: "func-type",
                    typeParams: i === 0 ? typeParams : [],
                    arg: { name: args[i].name, type: args[i].type ?? UNKNOWN_TYPE },
                    returnType: (undefined as any),
                    ...sourceInfo
                }
                : {
                    kind: "func-type",
                    typeParams: i === 0 ? typeParams : [],
                    arg: { name: args[i].name, type: args[i].type ?? UNKNOWN_TYPE },
                    returnType, // use the real one
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined
                }

        if (first == null) {
            first = last = next
        } else {
            (last as FuncType).returnType = next
            last = next
        }
    }

    return first 
        ?? { // there's no first function, meaning there are no arguments at all
            kind: "func-type",
            typeParams,
            arg: undefined,
            returnType, // use the real one
            code: undefined,
            startIndex: undefined,
            endIndex: undefined
        }
}

export const procTypeFromArgs = (
    typeParams: PlainIdentifier[],
    args: { name: PlainIdentifier, type?: TypeExpression }[],
    sourceInfo: SourceInfo
): FuncType|ProcType => {
    let first: FuncType|ProcType|undefined
    let last: FuncType|ProcType|undefined

    for (let i = 0; i < args.length; i++) {
        const next: FuncType|ProcType = 
            i < args.length - 1
                ? {
                    kind: "func-type",
                    typeParams: i === 0 ? typeParams : [],
                    arg: { name: args[i].name, type: args[i].type ?? UNKNOWN_TYPE },
                    returnType: (undefined as any),
                    ...sourceInfo
                }
                : {
                    kind: "proc-type",
                    typeParams: i === 0 ? typeParams : [],
                    arg: { name: args[i].name, type: args[i].type ?? UNKNOWN_TYPE },
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined
                }

        if (first == null) {
            first = last = next
        } else {
            (last as FuncType).returnType = next
            last = next
        }
    }

    return first 
        ?? { // there's no first function, meaning there are no arguments at all
            kind: "proc-type",
            typeParams,
            arg: undefined,
            code: undefined,
            startIndex: undefined,
            endIndex: undefined
        }
}

export const funcallFromArgs = (func: Expression, argLists: Expression[][], typeArgs: TypeExpression[], sourceInfo: SourceInfo): Funcall => {
    const allArgs = argLists.flat()

    let first: Funcall|undefined
    let last = func

    for (let i = 0; i < allArgs.length; i++) {
        last = {
            kind: "funcall",
            func: last,
            arg: allArgs[i],
            typeArgs: i === 0 ? typeArgs : [],
            ...sourceInfo
        }

        if (first == null) {
            first = last
        }
    }

    return first 
        ?? { // there's no first function, meaning there are no arguments at all
            kind: "funcall",
            func,
            arg: undefined,
            typeArgs,
            ...sourceInfo
        }
}

export const procCallFromArgs = (proc: Expression, argLists: Expression[][], typeArgs: TypeExpression[], sourceInfo: SourceInfo): Funcall|ProcCall => {
    const allArgs = argLists.flat()

    let first: Funcall|ProcCall|undefined
    let last: Expression|ProcCall = proc

    for (let i = 0; i < allArgs.length; i++) {
        last =
            i < allArgs.length - 1
                ? {
                    kind: "funcall",
                    func: last,
                    arg: allArgs[i],
                    typeArgs: i === 0 ? typeArgs : [],
                    ...sourceInfo
                } as Funcall
                : { 
                    kind: "proc-call",
                    proc: last,
                    arg: allArgs[i],
                    typeArgs: i === 0 ? typeArgs : [],
                    ...sourceInfo
                } as ProcCall

        if (first == null) {
            first = last
        }
    }

    return first 
        ?? { // there's no first function, meaning there are no arguments at all
            kind: "proc-call",
            proc,
            arg: undefined,
            typeArgs,
            ...sourceInfo
        }
}