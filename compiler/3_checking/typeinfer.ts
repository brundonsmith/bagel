// deno-lint-ignore-file no-fallthrough
import { AllParents, AllScopes, anyGet, getScopeFor, Scope } from "../_model/common.ts";
import { BinaryOp, Expression, InlineConst, isExpression } from "../_model/expressions.ts";
import { Attribute, BOOLEAN_TYPE, FuncType, ITERATOR_OF_ANY, ITERATOR_OF_NUMBERS_TYPE, JAVASCRIPT_ESCAPE_TYPE, Mutability, NamedType, NIL_TYPE, NUMBER_TYPE, ProcType, STRING_TYPE, TypeExpression, UnionType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, given, memoize5 } from "../utils.ts";
import { displayForm, subsumes, typesEqual } from "./typecheck.ts";
import { StoreMember, Declaration, memberDeclaredType } from "../_model/declarations.ts";
import { assignmentError, BagelError, cannotFindExport, cannotFindModule, cannotFindName, miscError } from "../errors.ts";
import { display, withoutSourceInfo } from "../debugging.ts";
import { extendScope } from "./scopescan.ts";
import { Module } from "../_model/ast.ts";
import { LetDeclaration,ConstDeclarationStatement } from "../_model/statements.ts";

export function inferType(
    reportError: (error: BagelError) => void,
    getModule: (module: string) => Module|undefined,
    parents: AllParents,
    scopes: AllScopes,
    ast: Expression|StoreMember,
    resolveGenerics?: boolean,
): TypeExpression {
    const baseType = inferTypeInner(reportError, getModule, parents, scopes, ast)

    let refinedType = baseType
    {
        const scope = getScopeFor(reportError, parents, scopes, ast)
        for (const refinement of scope.refinements ?? []) {
            switch (refinement.kind) {
                case "subtraction": {
                    refinedType = subtract(parents, scopes, refinedType, refinement.type)
                } break;
                case "narrowing": {
                    refinedType = narrow(parents, scopes, refinedType, refinement.type)
                } break;
            }
        }
    }

    return resolve(reportError, getModule, [parents, scopes],
        simplify(parents, scopes, refinedType), resolveGenerics);
}

const inferTypeInner = memoize5((
    reportError: (error: BagelError) => void,
    getModule: (module: string) => Module|undefined, 
    parents: AllParents,
    scopes: AllScopes,
    ast: Expression|StoreMember,
): TypeExpression => {
    switch(ast.kind) {
        case "proc":
            return ast.type
        case "func": {
            
            // infer callback type based on context
            {
                const parent = anyGet(parents, ast.id)

                if (parent?.kind === "invocation") {
                    const parentSubjectType = inferType(reportError, getModule, parents, scopes, parent.subject)
                    const thisArgIndex = parent.args.findIndex(a => a === ast)

                    if (parentSubjectType.kind === "func-type" || parentSubjectType.kind === "proc-type") {
                        const thisArgParentType = parentSubjectType.args[thisArgIndex]?.type

                        if (thisArgParentType && thisArgParentType.kind === ast.type.kind) {
                            return thisArgParentType;
                        }
                    }
                }
            }

            // if no return-type is declared, try inferring the type from the inner expression
            const returnType = ast.type.returnType ??
                inferType(reportError, getModule, parents, scopes, ast.body)

            return {
                ...ast.type,
                returnType,
            }

        }
        case "binary-operator": {
            let leftType = inferType(reportError, getModule, parents, scopes, ast.base);

            for (const [op, expr] of ast.ops) {
                const rightType = inferType(reportError, getModule, parents, scopes, expr);

                const types = BINARY_OPERATOR_TYPES[op.op].find(({ left, right }) =>
                    subsumes(parents, scopes, left, leftType) && subsumes(parents, scopes, right, rightType))

                if (types == null) {
                    reportError(miscError(op, `Operator '${op.op}' cannot be applied to types '${displayForm(leftType)}' and '${displayForm(rightType)}'`));

                    if (BINARY_OPERATOR_TYPES[op.op].length === 1) {
                        return BINARY_OPERATOR_TYPES[op.op][0].output
                    } else {
                        return UNKNOWN_TYPE
                    }
                }

                leftType = types.output;
            }

            return leftType;
        }
        case "negation-operator": return BOOLEAN_TYPE;
        case "pipe":
        case "invocation": {
            const scope = getScopeFor(reportError, parents, scopes, ast)

            let subjectType = inferType(reportError, getModule, parents, scopes, ast.subject);
            if (ast.kind === "invocation") {
                const scopeWithGenerics = extendScope(scope)
                
                // bind type-args for this invocation
                if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {
                    if (subjectType.typeParams.length > 0) {
                        if (ast.typeArgs.length > 0) {
                            if (subjectType.typeParams.length !== ast.typeArgs.length) {
                                reportError(miscError(ast, `Expected ${subjectType.typeParams.length} type arguments, but got ${ast.typeArgs.length}`))
                            }

                            for (let i = 0; i < subjectType.typeParams.length; i++) {
                                const typeParam = subjectType.typeParams[i]
                                const typeArg = ast.typeArgs?.[i] ?? UNKNOWN_TYPE

                                scopeWithGenerics.types.set(typeParam.name, {
                                    type: typeArg,
                                    isGenericParameter: false,
                                })
                            }
                        } else {
                            const invocationSubjectType: FuncType|ProcType = {
                                ...subjectType,
                                args: subjectType.args.map((arg, index) => ({
                                    ...arg,
                                    type: inferType(reportError, getModule, parents, scopes, ast.args[index])
                                }))
                            }
    
                            // attempt to infer params for generic
                            const inferredBindings = fitTemplate(reportError, parents, scopes, 
                                subjectType, 
                                invocationSubjectType, 
                                subjectType.typeParams.map(param => param.name)
                            );
    
                            if (inferredBindings.size === subjectType.typeParams.length) {
                                for (let i = 0; i < subjectType.typeParams.length; i++) {
                                    const typeParam = subjectType.typeParams[i]
                                    const typeArg = inferredBindings.get(typeParam.name) ?? UNKNOWN_TYPE
        
                                    scopeWithGenerics.types.set(typeParam.name, {
                                        type: typeArg,
                                        isGenericParameter: false,
                                    })
                                }
                            } else {
                                reportError(miscError(ast, `Failed to infer generic type parameters; ${subjectType.typeParams.length} type arguments should be specified explicitly`))
                            }
                        }
                    }
                }

                subjectType = resolve(reportError, getModule, scopeWithGenerics, subjectType);
            }

            if (subjectType.kind === "func-type") {
                return subjectType.returnType ?? UNKNOWN_TYPE;
            } else {
                return UNKNOWN_TYPE;
            }
        }
        case "indexer": {
            const baseType = inferType(reportError, getModule, parents, scopes, ast.subject);
            const indexerType = inferType(reportError, getModule, parents, scopes, ast.indexer);
            
            if (baseType.kind === "object-type" && indexerType.kind === "literal-type" && indexerType.value.kind === "exact-string-literal") {
                const key = indexerType.value.value;
                const valueType = propertiesOf(reportError, getModule, parents, scopes, baseType)?.find(entry => entry.name.name === key)?.type;

                return valueType ?? UNKNOWN_TYPE;
            } else if (baseType.kind === "indexer-type") {
                if (!subsumes(parents, scopes, baseType.keyType, indexerType)) {
                    return UNKNOWN_TYPE;
                } else {
                    return {
                        kind: "union-type",
                        members: [ baseType.valueType, NIL_TYPE ],
                        mutability: undefined,
                        id: Symbol(),
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined,
                    };
                }
            } else if (baseType.kind === "array-type" && indexerType.kind === "number-type") {
                return baseType.element;
            }

            return UNKNOWN_TYPE;
        }
        case "if-else-expression":
        case "switch-expression": {
            const valueType = ast.kind === "if-else-expression" ? BOOLEAN_TYPE : inferType(reportError, getModule, parents, scopes, ast.value)

            const caseTypes = ast.cases.map(({ outcome }) => 
                inferType(reportError, getModule, parents, scopes, outcome))

            const unionType: UnionType = {
                kind: "union-type",
                members: caseTypes,
                mutability: undefined,
                id: Symbol(),
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };

            if (!subsumes(parents, scopes, unionType, valueType)) {
                return {
                    ...unionType,
                    members: [
                        ...unionType.members,
                        ast.defaultCase 
                            ? inferType(reportError, getModule, parents, scopes, ast.defaultCase) 
                            : NIL_TYPE
                    ]
                }
            }
            
            return unionType
        }
        case "range": return ITERATOR_OF_NUMBERS_TYPE;
        case "debug": {
            if (isExpression(ast.inner)) {
                const type = inferType(reportError, getModule, parents, scopes, ast.inner)
                console.log(JSON.stringify({
                    bgl: given(ast.inner.code, code =>
                        given(ast.inner.startIndex, startIndex =>
                        given(ast.inner.endIndex, endIndex =>
                            code.substring(startIndex, endIndex)))),
                    type: withoutSourceInfo(type)
                }, null, 2));
                return type;
            } else {
                return UNKNOWN_TYPE
            }
        }
        case "parenthesized-expression":
            return inferType(reportError, getModule, parents, scopes, ast.inner);
        case "property-accessor": {
            const subjectType = inferType(reportError, getModule, parents, scopes, ast.subject);
            const nilTolerantSubjectType = ast.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(parents, scopes, subjectType, NIL_TYPE)
                : subjectType;
            const propertyType = propertiesOf(reportError, getModule, parents, scopes, nilTolerantSubjectType)?.find(entry => entry.name.name === ast.property.name)?.type

            if (ast.optional && propertyType) {
                return {
                    kind: "union-type",
                    members: [propertyType, NIL_TYPE],
                    mutability: undefined,
                    id: Symbol(),
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined
                }
            } else {
                const mutability = (
                    propertyType?.mutability == null ? undefined :
                    propertyType.mutability === "mutable" && subjectType.mutability === "mutable" ? "mutable" :
                    subjectType.mutability === "immutable" ? "immutable" :
                    "readonly"
                )
    
                return (
                    given(propertyType, t => ({ ...t, mutability }) as TypeExpression) 
                        ?? UNKNOWN_TYPE
                )
            }
        }
        case "local-identifier": {
            const scope = getScopeFor(reportError, parents, scopes, ast)


            // deno-lint-ignore no-inner-declarations
            function getDeclType(decl: Declaration|LetDeclaration|ConstDeclarationStatement|InlineConst): TypeExpression {
                switch (decl.kind) {
                    case 'const-declaration':
                    case 'let-declaration':
                    case 'const-declaration-statement': {
                        const baseType = decl.type ?? inferType(reportError, getModule, parents, scopes, decl.value)
                        const mutability: Mutability['mutability']|undefined = given(baseType.mutability, mutability =>
                            decl.kind === 'const-declaration' || decl.kind === 'const-declaration-statement'
                                ? 'immutable'
                                : mutability)

                        return {
                            ...baseType,
                            mutability
                        } as TypeExpression
                    }
                    case 'func-declaration':
                    case 'proc-declaration':
                    case 'inline-const': {
                        const baseType = inferType(reportError, getModule, parents, scopes, decl.value)
                        const mutability: Mutability['mutability']|undefined = given(baseType.mutability, () =>
                            decl.kind === 'func-declaration' || decl.kind === 'proc-declaration'
                                ? 'immutable'
                                : 'readonly')

                        return {
                            ...baseType,
                            mutability
                        } as TypeExpression
                    }
                    // case 'store-declaration':
                    //     return ast.
                    default:
                        // @ts-expect-error
                        throw Error('Unreachable!' + binding.ast.kind)
                }
            }
    

            const binding = scope.values.get(ast.name)

            if (binding != null) {
                switch (binding?.kind) {
                    case 'basic': return getDeclType(binding.ast)
                    case 'arg': {
                        return binding.holder.type.args[binding.argIndex].type 
                            ?? (inferType(reportError, getModule, parents, scopes, binding.holder) as FuncType|ProcType)
                                .args[binding.argIndex].type
                            ?? UNKNOWN_TYPE
                    }
                    case 'iterator': {
                        const iteratorType = inferType(reportError, getModule, parents, scopes, binding.iterator)
    
                        if (!subsumes(parents, scopes, ITERATOR_OF_ANY, iteratorType)) {
                            reportError(assignmentError(binding.iterator, ITERATOR_OF_ANY, iteratorType))
                        }
    
                        return iteratorType.kind === 'iterator-type' ? iteratorType.itemType : UNKNOWN_TYPE
                    }
                    case 'this': return {
                        kind: "store-type",
                        store: binding.store,
                        internal: true,
                        mutability: "mutable",
                        id: Symbol(),
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined
                    }
                    default:
                        // @ts-expect-error
                        throw Error('Unreachable!' + binding.kind)
                }
            }


            const imported = scope.imports.get(ast.name)

            if (imported != null) {
                const otherModule = getModule(imported.importDeclaration.path.value)

                if (otherModule == null) {
                    reportError(cannotFindModule(imported.importDeclaration));
                    return UNKNOWN_TYPE
                }

                const foreignDecl = otherModule.declarations.find(foreignDeclCandidate => 
                    declExported(foreignDeclCandidate) && declName(foreignDeclCandidate) === imported.importItem.name.name);
                
                if (foreignDecl == null) {
                    reportError(cannotFindExport(imported.importItem, imported.importDeclaration));
                    return UNKNOWN_TYPE
                }

                return getDeclType(foreignDecl)
            }

            reportError(cannotFindName(ast))
            return UNKNOWN_TYPE
        }
        case "element-tag": {
            return {
                kind: "element-type",
                // tagName: ast.tagName,
                // attributes: ast.attributes
                mutability: undefined,
                id: Symbol(),
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "object-literal": {
            const entries: Attribute[] = ast.entries.map(([name, value]) => {
                const type = inferType(reportError, getModule, parents, scopes, value);
                return {
                    kind: "attribute",
                    name,
                    type, 
                    mutability: undefined,
                    id: Symbol(),
                    code: undefined,
                    startIndex: undefined,
                    endIndex: undefined,
                }
            });

            return {
                kind: "object-type",
                spreads: [],
                entries,
                mutability: "mutable",
                id: Symbol(),
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "array-literal": {
            const entries = ast.entries.map(entry => inferType(reportError, getModule, parents, scopes, entry));

            // NOTE: This could be slightly better where different element types overlap each other
            const uniqueEntryTypes = entries.filter((el, index, arr) => 
                arr.findIndex(other => deepEquals(el, other)) === index);

            return {
                kind: "array-type",
                element: uniqueEntryTypes.length === 1
                    ? uniqueEntryTypes[0]
                    : {
                        kind: "union-type",
                        members: uniqueEntryTypes,
                        mutability: undefined,
                        id: Symbol(),
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined,
                    },
                mutability: "mutable",
                id: Symbol(),
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "store-property":
        case "store-function":
        case "store-procedure": return (ast.kind === "store-property" ? ast.type : undefined) ?? inferType(reportError, getModule, parents, scopes, ast.value);
        case "string-literal": return STRING_TYPE;
        case "exact-string-literal": return STRING_TYPE;
        case "number-literal": return NUMBER_TYPE;
        case "boolean-literal": return BOOLEAN_TYPE;
        case "nil-literal": return NIL_TYPE;
        case "javascript-escape": return JAVASCRIPT_ESCAPE_TYPE;
        default:
            // @ts-expect-error
            throw Error(ast.kind)
    }
})

export function resolve(
    reportError: (error: BagelError) => void,
    getModule: (module: string) => Module|undefined, 
    contextOrScope: [AllParents, AllScopes]|Scope, 
    type: TypeExpression, 
    resolveGenerics?: boolean
): TypeExpression {
    if (type.kind === "named-type") {
        const resolutionScope = Array.isArray(contextOrScope)
            ? getScopeFor(undefined, contextOrScope[0], contextOrScope[1], type)
            : contextOrScope


        const resolvedType = resolutionScope.types.get(type.name.name)

        if (resolvedType != null) {
            if (resolvedType.type.kind === "named-type" && resolvedType.type.name.name === type.name.name) {
                // cycle??
                return UNKNOWN_TYPE
            } else if (!resolvedType.isGenericParameter || resolveGenerics) {
                return resolve(reportError, getModule, contextOrScope, resolvedType.type, resolveGenerics)
            } else {
                return type
            }
        }

        
        const resolvedImport = resolutionScope.imports.get(type.name.name)

        if (resolvedImport != null) {
            const otherModule = getModule(resolvedImport.importDeclaration.path.value)

            if (otherModule == null) {
                reportError(cannotFindModule(resolvedImport.importDeclaration));
                return UNKNOWN_TYPE
            }

            const foreignDecl = otherModule.declarations.find(foreignDeclCandidate => 
                declExported(foreignDeclCandidate) && declName(foreignDeclCandidate) === resolvedImport.importItem.name.name);
            
            if (foreignDecl == null) {
                reportError(cannotFindExport(resolvedImport.importItem, resolvedImport.importDeclaration));
                return UNKNOWN_TYPE
            }

            if (foreignDecl.kind !== 'type-declaration') {
                reportError(miscError(type.name, `Imported declaration "${type.name.name}" is not a type`))
                return UNKNOWN_TYPE
            }

            return foreignDecl.type
        }

        reportError(cannotFindName(type.name))
        return UNKNOWN_TYPE
    } else if(type.kind === "union-type") {
        const memberTypes = type.members.map(member =>
            resolve(reportError, getModule, contextOrScope, member, resolveGenerics));
        if (memberTypes.some(member => member == null)) {
            return UNKNOWN_TYPE;
        } else {
            return {
                kind: "union-type",
                members: memberTypes as TypeExpression[],
                mutability: undefined,
                id: Symbol(),
                code: type.code,
                startIndex: type.startIndex,
                endIndex: type.endIndex,
            };
        }
    } else if(type.kind === "object-type") {
        const entries = type.entries.map(({ type, ...rest }) => 
            ({ ...rest, type: resolve(reportError, getModule, contextOrScope, type, resolveGenerics) }))

        return {
            ...type,
            entries,
        }
    } else if(type.kind === "array-type") {
        const element = resolve(reportError, getModule, contextOrScope, type.element, resolveGenerics)

        return {
            ...type,
            element,
        };
    } else if(type.kind === "func-type") {
        return {
            kind: "func-type",
            typeParams: type.typeParams,
            args: type.args.map(({ type, ...other }) => ({ ...other, type: given(type, t => resolve(reportError, getModule, contextOrScope, t, resolveGenerics)) })),
            returnType: given(type.returnType, returnType => resolve(reportError, getModule, contextOrScope, returnType, resolveGenerics)),
            mutability: undefined,
            id: Symbol(),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    } else if(type.kind === "proc-type") {
        return {
            kind: "proc-type",
            typeParams: type.typeParams,
            args: type.args.map(({ type, ...other }) => ({ ...other, type: given(type, t => resolve(reportError, getModule, contextOrScope, t, resolveGenerics)) })),
            mutability: undefined,
            id: Symbol(),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    } else if(type.kind === "iterator-type") {
        return {
            kind: "iterator-type",
            itemType: resolve(reportError, getModule, contextOrScope, type.itemType, resolveGenerics),
            mutability: undefined,
            id: Symbol(),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    } else if(type.kind === "plan-type") {
        return {
            kind: "plan-type",
            resultType: resolve(reportError, getModule, contextOrScope, type.resultType, resolveGenerics),
            mutability: undefined,
            id: Symbol(),
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        };
    }

    // TODO: Recurse onIndexerType, TupleType, etc
    return type;
}

export function simplify(parents: AllParents, scopes: AllScopes, type: TypeExpression): TypeExpression {
    return handleSingletonUnion(
        distillUnion(parents, scopes,
            flattenUnions(type)));
}

/**
 * Nested unions can be flattened
 */
function flattenUnions(type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        const members: TypeExpression[] = [];

        for (const member of type.members) {
            if (member.kind === "union-type") {
                members.push(...member.members.map(flattenUnions));
            } else {
                members.push(member);
            }
        }

        return {
            kind: "union-type",
            members,
            mutability: undefined,
            id: type.id,
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        }
    } else {
        return type;
    }
}

/**
 * Remove redundant members in union type (members subsumed by other members)
 */
function distillUnion(parents: AllParents, scopes: AllScopes, type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        const indicesToDrop = new Set<number>();

        for (let i = 0; i < type.members.length; i++) {
            for (let j = 0; j < type.members.length; j++) {
                if (i !== j) {
                    const a = type.members[i];
                    const b = type.members[j];

                    if (subsumes(parents, scopes, b, a) && !indicesToDrop.has(j)) {
                        indicesToDrop.add(i);
                    }
                }
            }
        }

        const members = type.members.filter((_, index) => !indicesToDrop.has(index))

        return {
            kind: "union-type",
            members,
            mutability: undefined,
            id: type.id,
            code: type.code,
            startIndex: type.startIndex,
            endIndex: type.endIndex,
        }
    } else {
        return type;
    }
}

/**
 * If union only has one member, putting it in a union-type is redundant
 */
 function handleSingletonUnion(type: TypeExpression): TypeExpression {
    if (type.kind === "union-type" && type.members.length === 1) {
        return type.members[0];
    } else {
        return type;
    }
}

export function subtract(parents: AllParents, scopes: AllScopes, type: TypeExpression, without: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        return simplify(parents, scopes, {
            ...type,
            members: type.members.filter(member => !subsumes(parents, scopes, without, member))
        })
    } else { // TODO: There's probably more we can do here
        return type
    }
}

function narrow(parents: AllParents, scopes: AllScopes, type: TypeExpression, fit: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        return simplify(parents, scopes, {
            ...type,
            members: type.members.filter(member => subsumes(parents, scopes, fit, member))
        })
    } else { // TODO: There's probably more we can do here
        return type
    }
}

const BINARY_OPERATOR_TYPES: { [key in BinaryOp]: { left: TypeExpression, right: TypeExpression, output: TypeExpression }[] } = {
    "+": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: NUMBER_TYPE },
        { left: STRING_TYPE, right: STRING_TYPE, output: STRING_TYPE },
        { left: NUMBER_TYPE, right: STRING_TYPE, output: STRING_TYPE },
        { left: STRING_TYPE, right: NUMBER_TYPE, output: STRING_TYPE },
    ],
    "-": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: NUMBER_TYPE }
    ],
    "*": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: NUMBER_TYPE }
    ],
    "/": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: NUMBER_TYPE }
    ],
    "<": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: BOOLEAN_TYPE }
    ],
    ">": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: BOOLEAN_TYPE }
    ],
    "<=": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: BOOLEAN_TYPE }
    ],
    ">=": [
        { left: NUMBER_TYPE, right: NUMBER_TYPE, output: BOOLEAN_TYPE }
    ],
    "&&": [
        { left: BOOLEAN_TYPE, right: BOOLEAN_TYPE, output: BOOLEAN_TYPE }
    ],
    "||": [
        { left: BOOLEAN_TYPE, right: BOOLEAN_TYPE, output: BOOLEAN_TYPE }
    ],
    "==": [ // TODO: Should require left and right to be the same type, even though that type can be anything!
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: BOOLEAN_TYPE }
    ],
    "!=": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: BOOLEAN_TYPE }
    ],
    "??": [
        { left: UNKNOWN_TYPE, right: UNKNOWN_TYPE, output: UNKNOWN_TYPE }
    ],
    // "??": {
    //     inputs: { kind: "union-type", members: [ { kind: "primitive-type", type: "nil" }, ] },
    //     output: BOOLEAN_TYPE
    // },
}

export function propertiesOf(
    reportError: (error: BagelError) => void,
    getModule: (module: string) => Module|undefined,
    parents: AllParents,
    scopes: AllScopes,
    type: TypeExpression
): readonly Attribute[] | undefined {

    switch (type.kind) {
        case "object-type": {
            const attrs = [...type.entries]

            for (const spread of type.spreads) {
                const resolved = resolve(reportError, getModule, [parents, scopes], spread)
        
                if (resolved.kind !== "object-type") {
                    reportError(miscError(spread, `${displayForm(resolved)} is not an object type; can only spread object types into object types`))
                } else {
                    attrs.push(...(propertiesOf(reportError, getModule, parents, scopes, resolved) ?? []))
                }
            }

            return attrs
        }
        case "string-type": {
            return [
                attribute("length", NUMBER_TYPE),
            ]
        }
        case "array-type": {
        // case "tuple-type":
            const props: Attribute[] = [
                attribute("length", NUMBER_TYPE),
            ];

            if (type.mutability === "mutable") {
                props.push(attribute("push", {
                    kind: "proc-type",
                    typeParams: [],
                    args: [{
                        kind: "arg",
                        name: { kind: "plain-identifier", name: "el", id: Symbol(), ...AST_NOISE },
                        type: type.element,
                        id: Symbol(),
                        ...AST_NOISE
                    }],
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                }))
            }

            return props;
        }
        case "store-type": {
            
            const memberToAttribute = (member: StoreMember): Attribute => {

                const memberType = memberDeclaredType(member) && memberDeclaredType(member)?.kind !== "func-type"
                    ? memberDeclaredType(member) as TypeExpression
                    : inferType(reportError, getModule, parents, scopes, member.value);

                const mutability = (
                    memberType.mutability == null ? undefined :
                    memberType.mutability === "mutable" && member.kind === "store-property" && (type.internal || member.access !== "visible") ? "mutable"
                    : "readonly"
                )

                return {
                    kind: "attribute",
                    name: member.name,
                    type: { ...memberType, mutability } as TypeExpression,
                    id: member.id,
                    ...TYPE_AST_NOISE
                }
            }

            if (type.internal) {
                return type.store.members
                    .map(memberToAttribute)
            } else {
                return type.store.members
                    .filter(member => member.access !== "private")
                    .map(memberToAttribute)
            }
        }
        case "iterator-type": {
            const { code: _, startIndex: _1, endIndex: _2, ...item } = type.itemType
            const itemType = { ...item, ...AST_NOISE }

            const iteratorProps: readonly Attribute[] = [
                attribute("filter", {
                    kind: "func-type",
                    typeParams: [],
                    args: [{
                        kind: "arg",
                        name: { kind: "plain-identifier", name: "fn", id: Symbol(), ...AST_NOISE },
                        type: {
                            kind: "func-type",
                            typeParams: [],
                            args: [{
                                kind: "arg",
                                name: { kind: "plain-identifier", name: "el", id: Symbol(), ...AST_NOISE },
                                type: itemType,
                                id: Symbol(),
                                ...AST_NOISE
                            }],
                            returnType: BOOLEAN_TYPE,
                            id: Symbol(),
                            ...TYPE_AST_NOISE
                        },
                        id: Symbol(),
                        ...AST_NOISE
                    }],
                    returnType: {
                        kind: "iterator-type",
                        itemType,
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    },
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                }),
                attribute("map", {
                    kind: "func-type",
                    typeParams: [
                        { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }
                    ],
                    args: [{
                        kind: "arg",
                        name: { kind: "plain-identifier", name: "fn", id: Symbol(), ...AST_NOISE },
                        type: {
                            kind: "func-type",
                            args: [{
                                kind: "arg",
                                name: { kind: "plain-identifier", name: "el", id: Symbol(), ...AST_NOISE },
                                type: itemType,
                                id: Symbol(),
                                ...AST_NOISE
                            }],
                            returnType: { kind: "named-type", id: Symbol(), name: { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }, ...TYPE_AST_NOISE },
                            typeParams: [],
                            id: Symbol(),
                            ...TYPE_AST_NOISE
                        },
                        id: Symbol(),
                        ...AST_NOISE
                    }],
                    returnType: {
                        kind: "iterator-type",
                        itemType: { kind: "named-type", id: Symbol(), name: { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }, ...TYPE_AST_NOISE },
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    },
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                }),
                attribute("array", {
                    kind: "func-type",
                    typeParams: [],
                    args: [],
                    returnType: { kind: "array-type", element: itemType, mutability: "mutable", id: Symbol(), ...AST_NOISE },
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                }),
            ]

            return iteratorProps
        }
        case "plan-type": {
            const { code: _, startIndex: _1, endIndex: _2, ...result } = type.resultType
            const resultType = { ...result, ...AST_NOISE }

            const planProps: readonly Attribute[] = [
                attribute("then", {
                    kind: "func-type",
                    typeParams: [
                        { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }
                    ],
                    args: [{
                        kind: "arg",
                        name: { kind: "plain-identifier", name: "fn", id: Symbol(), ...AST_NOISE },
                        type: {
                            kind: "func-type",
                            args: [{
                                kind: "arg",
                                name: { kind: "plain-identifier", name: "el", id: Symbol(), ...AST_NOISE },
                                type: resultType,
                                id: Symbol(),
                                ...TYPE_AST_NOISE
                            }],
                            returnType: { kind: "named-type", id: Symbol(), name: { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }, ...TYPE_AST_NOISE },
                            typeParams: [],
                            id: Symbol(),
                            ...TYPE_AST_NOISE
                        },
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    }],
                    returnType: {
                        kind: "plan-type",
                        resultType: { kind: "named-type", id: Symbol(), name: { kind: "plain-identifier", name: "R", id: Symbol(), ...AST_NOISE }, ...TYPE_AST_NOISE },
                        id: Symbol(),
                        ...TYPE_AST_NOISE
                    },
                    id: Symbol(),
                    ...TYPE_AST_NOISE
                }),
            ]

            return planProps
        }
    }
}

function attribute(name: string, type: TypeExpression): Attribute {
    return {
        kind: "attribute",
        name: { kind: "plain-identifier", name, id: Symbol(), ...AST_NOISE },
        type,
        id: Symbol(),
        ...TYPE_AST_NOISE
    }
}

const AST_NOISE = { code: undefined, startIndex: undefined, endIndex: undefined }
const TYPE_AST_NOISE = { mutability: undefined, ...AST_NOISE }

export function fitTemplate(
    reportError: (error: BagelError) => void, 
    parents: AllParents,
    scopes: AllScopes,
    parameterized: TypeExpression, 
    reified: TypeExpression, 
    params: readonly string[]
): ReadonlyMap<string, TypeExpression> {
    function isGenericParam(type: TypeExpression): type is NamedType {
        return type.kind === "named-type" && params.includes(type.name.name)
    }

    if (isGenericParam(parameterized)) {
        const matches = new Map<string, TypeExpression>();
        matches.set(parameterized.name.name, reified);
        return matches;
    }

    if (parameterized.kind === "func-type" && reified.kind === "func-type") {
        const matchGroups = [
            ...parameterized.args.map((arg, index) =>
                fitTemplate(reportError, parents, scopes, arg.type ?? UNKNOWN_TYPE, reified.args[index].type ?? UNKNOWN_TYPE, params)),
            // fitTemplate(reportError, parents, scopes, parameterized.returnType ?? UNKNOWN_TYPE, reified.returnType ?? UNKNOWN_TYPE, params)
        ]

        const matches = new Map<string, TypeExpression>();

        for (const map of matchGroups) {
            for (const [key, value] of map.entries()) {
                const existing = matches.get(key)
                if (existing) {
                    if (!subsumes(parents, scopes, existing, value)) {
                        matches.set(key, simplify(parents, scopes, {
                            kind: "union-type",
                            members: [value, existing],
                            id: Symbol(),
                            mutability: undefined,
                            code: undefined, startIndex: undefined, endIndex: undefined
                        }))
                    }
                } else {
                    matches.set(key, value);
                }
            }
        }
        
        return matches;
    }

    if (parameterized.kind === "array-type" && reified.kind === "array-type") {
        return fitTemplate(reportError, parents, scopes, parameterized.element, reified.element, params);
    }

    if (parameterized.kind === "union-type") {
        if (reified.kind === "union-type") {
            const parameterizedMembers = [...parameterized.members];
            const reifiedMembers = [...reified.members];

            const remove = new Set<TypeExpression>();

            for (const p of parameterizedMembers) {
                for (const r of reifiedMembers) {
                    if (typesEqual(p, r)) {
                        remove.add(p);
                        remove.add(r);
                    }
                }
            }

            const parameterizedMembersRemaining = parameterizedMembers.filter(m => !remove.has(m))
            const reifiedMembersRemaining = reifiedMembers.filter(m => !remove.has(m))

            if (parameterizedMembersRemaining.length === 1 && isGenericParam(parameterizedMembersRemaining[0])) {
                const matches = new Map<string, TypeExpression>();

                matches.set(parameterizedMembersRemaining[0].name.name, simplify(parents, scopes, {
                    kind: "union-type",
                    members: reifiedMembersRemaining,
                    id: Symbol(),
                    mutability: undefined,
                    code: undefined, startIndex: undefined, endIndex: undefined
                }))
                
                return matches;
            }
        } else if(parameterized.members.some(isGenericParam)) {
            const param = parameterized.members.find(isGenericParam) as NamedType;

            const matches = new Map<string, TypeExpression>();

            matches.set(param.name.name, reified);

            return matches;
        }
    }

    return EMPTY_MAP;
}

function declExported(declaration: Declaration): boolean|undefined {
    if (declaration.kind !== "import-declaration" && 
        declaration.kind !== "javascript-escape" && 
        declaration.kind !== "debug" &&
        declaration.kind !== "test-expr-declaration" &&
        declaration.kind !== "test-block-declaration") {
        return declaration.exported;
    }
}

function declName(declaration: Declaration): string|undefined {
    if (declaration.kind !== "import-declaration" && 
        declaration.kind !== "javascript-escape" && 
        declaration.kind !== "debug" &&
        declaration.kind !== "test-expr-declaration" &&
        declaration.kind !== "test-block-declaration") {
        return declaration.name.name;
    }
}

const EMPTY_MAP: ReadonlyMap<string, TypeExpression> = new Map()