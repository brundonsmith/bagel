// deno-lint-ignore-file no-fallthrough
import { GetParent, GetBinding, ReportError, GetModule, Refinement } from "../_model/common.ts";
import { BinaryOp, Expression, InlineConst, isExpression } from "../_model/expressions.ts";
import { ANY_TYPE, Attribute, BOOLEAN_TYPE, FuncType, ITERATOR_OF_ANY, ITERATOR_OF_NUMBERS_TYPE, JAVASCRIPT_ESCAPE_TYPE, Mutability, NamedType, NIL_TYPE, NUMBER_TYPE, ProcType, STRING_TYPE, TypeExpression, UnionType, UNKNOWN_TYPE } from "../_model/type-expressions.ts";
import { deepEquals, given, memoize5 } from "../utils.ts";
import { displayForm, subsumes, typesEqual } from "./typecheck.ts";
import { StoreMember, Declaration, memberDeclaredType } from "../_model/declarations.ts";
import { assignmentError, cannotFindName, miscError } from "../errors.ts";
import { withoutSourceInfo } from "../debugging.ts";
import { AST } from "../_model/ast.ts";
import { LetDeclaration,ConstDeclarationStatement } from "../_model/statements.ts";

export function inferType(
    reportError: ReportError,
    getModule: GetModule,
    getParent: GetParent,
    getBinding: GetBinding,
    ast: Expression|StoreMember,
): TypeExpression {
    const baseType = inferTypeInner(reportError, getModule, getParent, getBinding, ast)

    let refinedType = baseType
    {
        const refinements = resolveRefinements(getParent, ast)

        for (const refinement of refinements ?? []) {
            switch (refinement.kind) {
                case "subtraction": {
                    refinedType = subtract(getParent, getBinding, refinedType, refinement.type)
                } break;
                case "narrowing": {
                    refinedType = narrow(getParent, getBinding, refinedType, refinement.type)
                } break;
            }
        }
    }

    return simplify(getParent, getBinding, refinedType)
}

const inferTypeInner = memoize5((
    reportError: ReportError,
    getModule: GetModule, 
    getParent: GetParent,
    getBinding: GetBinding,
    ast: Expression|StoreMember,
): TypeExpression => {
    switch(ast.kind) {
        case "proc":
            return ast.type
        case "func": {
            
            // infer callback type based on context
            {
                const parent = getParent(ast)

                if (parent?.kind === "invocation") {
                    const parentSubjectType = inferType(reportError, getModule, getParent, getBinding, parent.subject)
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
                inferType(reportError, getModule, getParent, getBinding, ast.body)

            return {
                ...ast.type,
                returnType,
            }

        }
        case "binary-operator": {
            let leftType = inferType(reportError, getModule, getParent, getBinding, ast.base);

            for (const [op, expr] of ast.ops) {
                const rightType = inferType(reportError, getModule, getParent, getBinding, expr);

                const types = BINARY_OPERATOR_TYPES[op.op].find(({ left, right }) =>
                    subsumes(getParent, getBinding, left, leftType) && subsumes(getParent, getBinding, right, rightType))

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
            // const scope = getScope(ast)

            let subjectType = inferType(reportError, getModule, getParent, getBinding, ast.subject);

            // bind type-args for this invocation
            // if (ast.kind === "invocation") {    
            //     if (subjectType.kind === "func-type" || subjectType.kind === "proc-type") {
            //         if (subjectType.typeParams.length > 0) {
            //             if (ast.typeArgs.length > 0) { // explicit type arguments
            //                 if (subjectType.typeParams.length !== ast.typeArgs.length) {
            //                     reportError(miscError(ast, `Expected ${subjectType.typeParams.length} type arguments, but got ${ast.typeArgs.length}`))
            //                 }

            //                 for (let i = 0; i < subjectType.typeParams.length; i++) {
            //                     const typeParam = subjectType.typeParams[i]
            //                     const typeArg = ast.typeArgs?.[i] ?? UNKNOWN_TYPE

            //                     scopeWithGenerics.types.set(typeParam.name, {
            //                         type: typeArg,
            //                         isGenericParameter: false,
            //                     })
            //                 }
            //             } else { // no type arguments (try to infer)
            //                 const invocationSubjectType: FuncType|ProcType = {
            //                     ...subjectType,
            //                     args: subjectType.args.map((arg, index) => ({
            //                         ...arg,
            //                         type: inferType(reportError, getModule, getParent, getBinding, ast.args[index])
            //                     }))
            //                 }
    
            //                 // attempt to infer params for generic
            //                 const inferredBindings = fitTemplate(reportError, getParent, getBinding, 
            //                     subjectType, 
            //                     invocationSubjectType, 
            //                     subjectType.typeParams.map(param => param.name)
            //                 );
    
            //                 if (inferredBindings.size === subjectType.typeParams.length) {
            //                     for (let i = 0; i < subjectType.typeParams.length; i++) {
            //                         const typeParam = subjectType.typeParams[i]
            //                         const typeArg = inferredBindings.get(typeParam.name) ?? UNKNOWN_TYPE
        
            //                         scopeWithGenerics.types.set(typeParam.name, {
            //                             type: typeArg,
            //                             isGenericParameter: false,
            //                         })
            //                     }
            //                 } else {
            //                     reportError(miscError(ast, `Failed to infer generic type parameters; ${subjectType.typeParams.length} type arguments should be specified explicitly`))
            //                 }
            //             }
            //         }
            //     }
            // }

            if (subjectType.kind === "func-type") {
                return subjectType.returnType ?? UNKNOWN_TYPE;
            } else {
                return UNKNOWN_TYPE;
            }
        }
        case "indexer": {
            const baseType = inferType(reportError, getModule, getParent, getBinding, ast.subject);
            const indexerType = inferType(reportError, getModule, getParent, getBinding, ast.indexer);
            
            if (baseType.kind === "object-type" && indexerType.kind === "literal-type" && indexerType.value.kind === "exact-string-literal") {
                const key = indexerType.value.value;
                const valueType = propertiesOf(reportError, getModule, getParent, getBinding, baseType)?.find(entry => entry.name.name === key)?.type;

                return valueType ?? UNKNOWN_TYPE;
            } else if (baseType.kind === "indexer-type") {
                if (!subsumes(getParent, getBinding, baseType.keyType, indexerType)) {
                    return UNKNOWN_TYPE;
                } else {
                    return {
                        kind: "union-type",
                        members: [ baseType.valueType, NIL_TYPE ],
                        mutability: undefined,
                        module: undefined,
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
            const valueType = ast.kind === "if-else-expression" ? BOOLEAN_TYPE : inferType(reportError, getModule, getParent, getBinding, ast.value)

            const caseTypes = ast.cases.map(({ outcome }) => 
                inferType(reportError, getModule, getParent, getBinding, outcome))

            const unionType: UnionType = {
                kind: "union-type",
                members: caseTypes,
                mutability: undefined,
                module: undefined,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };

            if (!subsumes(getParent, getBinding, unionType, valueType)) {
                return {
                    ...unionType,
                    members: [
                        ...unionType.members,
                        ast.defaultCase 
                            ? inferType(reportError, getModule, getParent, getBinding, ast.defaultCase) 
                            : NIL_TYPE
                    ]
                }
            }
            
            return unionType
        }
        case "range": return ITERATOR_OF_NUMBERS_TYPE;
        case "debug": {
            if (isExpression(ast.inner)) {
                const type = inferType(reportError, getModule, getParent, getBinding, ast.inner)
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
            return inferType(reportError, getModule, getParent, getBinding, ast.inner);
        case "inline-const":
            return inferType(reportError, getModule, getParent, getBinding, ast.next);
        case "property-accessor": {
            const subjectType = inferType(reportError, getModule, getParent, getBinding, ast.subject);
            const nilTolerantSubjectType = ast.optional && subjectType.kind === "union-type" && subjectType.members.some(m => m.kind === "nil-type")
                ? subtract(getParent, getBinding, subjectType, NIL_TYPE)
                : subjectType;
            const propertyType = propertiesOf(reportError, getModule, getParent, getBinding, nilTolerantSubjectType)?.find(entry => entry.name.name === ast.property.name)?.type

            if (ast.optional && propertyType) {
                return {
                    kind: "union-type",
                    members: [propertyType, NIL_TYPE],
                    mutability: undefined,
                    module: undefined,
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

            // deno-lint-ignore no-inner-declarations
            function getDeclType(decl: Declaration|LetDeclaration|ConstDeclarationStatement|InlineConst): TypeExpression {
                switch (decl.kind) {
                    case 'const-declaration':
                    case 'let-declaration':
                    case 'const-declaration-statement': {
                        const baseType = decl.type ?? inferType(reportError, getModule, getParent, getBinding, decl.value)
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
                        const baseType = inferType(reportError, getModule, getParent, getBinding, decl.value)
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
    
            const resolution = getBinding(reportError, ast)

            if (resolution != null) {
                switch (resolution.kind) {
                    case 'basic': return getDeclType(resolution.ast)
                    case 'arg': {
                        return resolution.holder.type.args[resolution.argIndex].type 
                            ?? (inferType(reportError, getModule, getParent, getBinding, resolution.holder) as FuncType|ProcType)
                                .args[resolution.argIndex].type
                            ?? UNKNOWN_TYPE
                    }
                    case 'iterator': {
                        const iteratorType = inferType(reportError, getModule, getParent, getBinding, resolution.iterator)
    
                        if (!subsumes(getParent, getBinding, ITERATOR_OF_ANY, iteratorType)) {
                            reportError(assignmentError(resolution.iterator, ITERATOR_OF_ANY, iteratorType))
                        }
    
                        return iteratorType.kind === 'iterator-type' ? iteratorType.itemType : UNKNOWN_TYPE
                    }
                    case 'this': return {
                        kind: "store-type",
                        store: resolution.store,
                        internal: true,
                        mutability: "mutable",
                        module: undefined,
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined
                    }
                    case 'type-binding': break;
                    default:
                        // @ts-expect-error
                        throw Error('Unreachable!' + resolution.kind)
                }
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
                module: undefined,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "object-literal": {
            const entries: Attribute[] = ast.entries.map(([name, value]) => {
                const type = inferType(reportError, getModule, getParent, getBinding, value);
                return {
                    kind: "attribute",
                    name,
                    type, 
                    mutability: undefined,
                    module: undefined,
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
                module: undefined,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "array-literal": {
            const entries = ast.entries.map(entry => inferType(reportError, getModule, getParent, getBinding, entry));

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
                        module: undefined,
                        code: undefined,
                        startIndex: undefined,
                        endIndex: undefined,
                    },
                mutability: "mutable",
                module: undefined,
                code: undefined,
                startIndex: undefined,
                endIndex: undefined,
            };
        }
        case "store-property":
        case "store-function":
        case "store-procedure": return (ast.kind === "store-property" ? ast.type : undefined) ?? inferType(reportError, getModule, getParent, getBinding, ast.value);
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

export function simplify(getParent: GetParent, getBinding: GetBinding, type: TypeExpression): TypeExpression {
    return handleSingletonUnion(
        distillUnion(getParent, getBinding,
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
            module: type.module,
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
function distillUnion(getParent: GetParent, getBinding: GetBinding, type: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        const indicesToDrop = new Set<number>();

        for (let i = 0; i < type.members.length; i++) {
            for (let j = 0; j < type.members.length; j++) {
                if (i !== j) {
                    const a = type.members[i];
                    const b = type.members[j];

                    if (subsumes(getParent, getBinding, b, a) && !indicesToDrop.has(j)) {
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
            module: type.module,
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

export function subtract(getParent: GetParent, getBinding: GetBinding, type: TypeExpression, without: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        return simplify(getParent, getBinding, {
            ...type,
            members: type.members.filter(member => !subsumes(getParent, getBinding, without, member))
        })
    } else { // TODO: There's probably more we can do here
        return type
    }
}

function narrow(getParent: GetParent, getBinding: GetBinding, type: TypeExpression, fit: TypeExpression): TypeExpression {
    if (type.kind === "union-type") {
        return simplify(getParent, getBinding, {
            ...type,
            members: type.members.filter(member => subsumes(getParent, getBinding, fit, member))
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

function resolveRefinements(getParent: GetParent, epxr: Expression|StoreMember): Refinement[] {
    const refinements: Refinement[] = []

    for (let [current, parent] = [epxr, getParent(epxr)] as [AST, AST|undefined]; parent != null;) {

        switch (current.kind) {
            case 'case': {

                // Type refinement
                if (parent?.kind === "if-else-expression") {
                    if (current.condition.kind === "binary-operator" && current.condition.ops[0][0].op === "!=") {
                        const targetExpression = 
                            current.condition.ops[0][1].kind === 'nil-literal' ? current.condition.base :
                            current.condition.base.kind === "nil-literal" ? current.condition.ops[0][1] :
                            undefined;

                        if (targetExpression != null) {
                            refinements.push({ kind: "subtraction", type: NIL_TYPE, targetExpression })
                        }
                    }

                    if (current.condition.kind === "binary-operator" && current.condition.ops[0][0].op === "==") {
                        const bits = (
                            current.condition.base.kind === "invocation" && current.condition.base.subject.kind === "local-identifier" && current.condition.base.subject.name === "typeof" 
                            && current.condition.ops[0][1].kind === "string-literal" && typeof current.condition.ops[0][1].segments[0] === "string" ? [current.condition.base.args[0], current.condition.ops[0][1].segments[0]] as const :
                            current.condition.base.kind === "string-literal" && typeof current.condition.base.segments[0] === "string"
                            && current.condition.ops[0][1].kind === "invocation" && current.condition.ops[0][1].subject.kind === "local-identifier" && current.condition.ops[0][1].subject.name === "typeof" ? [current.condition.ops[0][1].args[0], current.condition.base.segments[0]] as const :
                            undefined
                        )
                        
                        if (bits) {
                            const [targetExpression, typeofStr] = bits
        
                            const refinedType = typeFromTypeof(typeofStr)
                            
                            if (refinedType) {
                                refinements.push({ kind: "narrowing", type: refinedType, targetExpression })
                            }
                        }
                        
                    }
                } else if (parent?.kind === "switch-expression") {
                    if (parent.value.kind === "invocation" &&
                        parent.value.subject.kind === "local-identifier" &&
                        parent.value.subject.name === "typeof" &&
                        current.condition.kind === "string-literal" &&
                        current.condition.segments.length === 1 &&
                        typeof current.condition.segments[0] === 'string') {
                        
                        const targetExpression = parent.value.args[0]
                        const typeofStr = current.condition.segments[0]

                        const refinedType = typeFromTypeof(typeofStr)

                        if (refinedType) {
                            refinements.push({ kind: "narrowing", type: refinedType, targetExpression })
                        }
                    }
                }
            }
        }

        current = parent
        parent = getParent(parent)
    }

    return refinements
}

function typeFromTypeof(typeofStr: string): TypeExpression|undefined {
    return (
        typeofStr === "string" ? STRING_TYPE :
        typeofStr === "number" ? NUMBER_TYPE :
        typeofStr === "boolean" ? BOOLEAN_TYPE :
        typeofStr === "nil" ? NIL_TYPE :
        typeofStr === "array" ? { kind: "array-type", element: ANY_TYPE, mutability: "readonly", module: undefined, code: undefined, startIndex: undefined, endIndex: undefined } :
        typeofStr === "object" ? { kind: "indexer-type", keyType: ANY_TYPE, valueType: ANY_TYPE, mutability: "readonly", module: undefined, code: undefined, startIndex: undefined, endIndex: undefined } :
        // TODO
        // type.value === "set" ?
        // type.value === "class-instance" ?
        undefined
    )
}

export function propertiesOf(
    reportError: ReportError,
    getModule: GetModule,
    getParent: GetParent,
    getBinding: GetBinding,
    type: TypeExpression
): readonly Attribute[] | undefined {

    switch (type.kind) {
        case "named-type": {
            const binding = getBinding(reportError, type.name)

            if (binding?.kind !== 'type-binding') {
                reportError(miscError(type.name, `Can't find type ${type.name.name}`))
                return undefined
            } else {
                return propertiesOf(reportError, getModule, getParent, getBinding, binding.type)
            }

        }
        case "object-type": {
            const attrs = [...type.entries]

            for (const spread of type.spreads) {
                const resolved = getBinding(reportError, spread.name)
        
                if (resolved != null && resolved.kind === 'type-binding' && resolved.type.kind === 'object-type') {
                    attrs.push(...(propertiesOf(reportError, getModule, getParent, getBinding, resolved.type) ?? []))
                } else {
                    if (resolved != null) {
                        if (resolved.kind !== 'type-binding') {
                            reportError(miscError(spread, `${spread.name.name} is not a type`))
                        } else if (resolved.type.kind !== 'object-type') {
                            reportError(miscError(spread, `${displayForm(resolved.type)} is not an object type; can only spread object types into object types`))
                        }
                    }
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
                        name: { kind: "plain-identifier", name: "el", ...AST_NOISE },
                        type: type.element,
                        ...AST_NOISE
                    }],
                    ...TYPE_AST_NOISE
                }))
            }

            return props;
        }
        case "store-type": {
            
            const memberToAttribute = (member: StoreMember): Attribute => {

                const memberType = memberDeclaredType(member) && memberDeclaredType(member)?.kind !== "func-type"
                    ? memberDeclaredType(member) as TypeExpression
                    : inferType(reportError, getModule, getParent, getBinding, member.value);

                const mutability = (
                    memberType.mutability == null ? undefined :
                    memberType.mutability === "mutable" && member.kind === "store-property" && (type.internal || member.access !== "visible") ? "mutable"
                    : "readonly"
                )

                return {
                    kind: "attribute",
                    name: member.name,
                    type: { ...memberType, mutability } as TypeExpression,
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
                        name: { kind: "plain-identifier", name: "fn", ...AST_NOISE },
                        type: {
                            kind: "func-type",
                            typeParams: [],
                            args: [{
                                kind: "arg",
                                name: { kind: "plain-identifier", name: "el", ...AST_NOISE },
                                type: itemType,
                                ...AST_NOISE
                            }],
                            returnType: BOOLEAN_TYPE,
                            ...TYPE_AST_NOISE
                        },
                        ...AST_NOISE
                    }],
                    returnType: {
                        kind: "iterator-type",
                        itemType,
                        ...TYPE_AST_NOISE
                    },
                    ...TYPE_AST_NOISE
                }),
                attribute("map", {
                    kind: "func-type",
                    typeParams: [
                        { kind: "plain-identifier", name: "R", ...AST_NOISE }
                    ],
                    args: [{
                        kind: "arg",
                        name: { kind: "plain-identifier", name: "fn", ...AST_NOISE },
                        type: {
                            kind: "func-type",
                            args: [{
                                kind: "arg",
                                name: { kind: "plain-identifier", name: "el", ...AST_NOISE },
                                type: itemType,
                                ...AST_NOISE
                            }],
                            returnType: { kind: "named-type", name: { kind: "plain-identifier", name: "R", ...AST_NOISE }, ...TYPE_AST_NOISE },
                            typeParams: [],
                            ...TYPE_AST_NOISE
                        },
                        ...AST_NOISE
                    }],
                    returnType: {
                        kind: "iterator-type",
                        itemType: { kind: "named-type", name: { kind: "plain-identifier", name: "R", ...AST_NOISE }, ...TYPE_AST_NOISE },
                        ...TYPE_AST_NOISE
                    },
                    ...TYPE_AST_NOISE
                }),
                attribute("array", {
                    kind: "func-type",
                    typeParams: [],
                    args: [],
                    returnType: { kind: "array-type", element: itemType, mutability: "mutable", ...AST_NOISE },
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
                        { kind: "plain-identifier", name: "R", ...AST_NOISE }
                    ],
                    args: [{
                        kind: "arg",
                        name: { kind: "plain-identifier", name: "fn", ...AST_NOISE },
                        type: {
                            kind: "func-type",
                            args: [{
                                kind: "arg",
                                name: { kind: "plain-identifier", name: "el", ...AST_NOISE },
                                type: resultType,
                                ...TYPE_AST_NOISE
                            }],
                            returnType: { kind: "named-type", name: { kind: "plain-identifier", name: "R", ...AST_NOISE }, ...TYPE_AST_NOISE },
                            typeParams: [],
                            ...TYPE_AST_NOISE
                        },
                        ...TYPE_AST_NOISE
                    }],
                    returnType: {
                        kind: "plan-type",
                        resultType: { kind: "named-type", name: { kind: "plain-identifier", name: "R", ...AST_NOISE }, ...TYPE_AST_NOISE },
                        ...TYPE_AST_NOISE
                    },
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
        name: { kind: "plain-identifier", name, ...AST_NOISE },
        type,
        ...TYPE_AST_NOISE
    }
}

const AST_NOISE = { module: undefined, code: undefined, startIndex: undefined, endIndex: undefined }
const TYPE_AST_NOISE = { mutability: undefined, ...AST_NOISE }

export function fitTemplate(
    reportError: ReportError, 
    getParent: GetParent,
    getBinding: GetBinding,
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
                fitTemplate(reportError, getParent, getBinding, arg.type ?? UNKNOWN_TYPE, reified.args[index].type ?? UNKNOWN_TYPE, params)),
            // fitTemplate(reportError, getParent, getBinding, parameterized.returnType ?? UNKNOWN_TYPE, reified.returnType ?? UNKNOWN_TYPE, params)
        ]

        const matches = new Map<string, TypeExpression>();

        for (const map of matchGroups) {
            for (const [key, value] of map.entries()) {
                const existing = matches.get(key)
                if (existing) {
                    if (!subsumes(getParent, getBinding, existing, value)) {
                        matches.set(key, simplify(getParent, getBinding, {
                            kind: "union-type",
                            members: [value, existing],
                            mutability: undefined,
                            module: undefined, code: undefined, startIndex: undefined, endIndex: undefined
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
        return fitTemplate(reportError, getParent, getBinding, parameterized.element, reified.element, params);
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

                matches.set(parameterizedMembersRemaining[0].name.name, simplify(getParent, getBinding, {
                    kind: "union-type",
                    members: reifiedMembersRemaining,
                    mutability: undefined,
                    module: undefined, code: undefined, startIndex: undefined, endIndex: undefined
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