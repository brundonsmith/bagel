import { AST } from "./model.ts";

export function parse(code: string): AST {
    const result = expression(code, 0);

    if (result == null) {
        throw Error("Failed to parse");
    }

    return result.ast;
}

function expression(code: string, index: number): { ast: AST, newIndex: number } | undefined {
    index = consumeWhitespace(code, index);
    return stringLiteral(code, index);
}

function stringLiteral(code: string, index: number): { ast: AST, newIndex: number } | undefined {
    if (code[index] === '"') {
        index++;

        const contentsStart = index;

        while (code[index] !== '"') {
            index++;
        }

        return {
            ast: { kind: "string-literal", value: code.substring(contentsStart, index) },
            newIndex: index + 1,
        }
    }
    
    return numberLiteral(code, index);
}

function numberLiteral(code: string, index: number): { ast: AST, newIndex: number } | undefined {
    if (isNumeric(code[index])) {
        const numberStart = index;

        index++;
        while (isNumeric(code[index])) {
            index += 1;
        }

        return {
            ast: { kind: "number-literal", value: Number(code.substring(numberStart, index)) },
            newIndex: index,
        }
    }

    return booleanLiteral(code, index);
}

function booleanLiteral(code: string, index: number): { ast: AST, newIndex: number } | undefined {

    const indexAfterTrue = consume(code, index, "true");
    if (indexAfterTrue != null) {
        return {
            ast: { kind: "boolean-literal", value: true },
            newIndex: indexAfterTrue,
        }
    }
    
    const indexAfterFalse = consume(code, index, "false");
    if (indexAfterFalse != null) {
        return {
            ast: { kind: "boolean-literal", value: false },
            newIndex: indexAfterFalse,
        }
    }

    return funcall(code, index);
}

function funcall(code: string, index: number): { ast: AST, newIndex: number } | undefined {
    if (isAlpha(code[index])) {
        const nameStartIndex = index;
        index = nameStartIndex + 1;
        while (isAlpha(code[index])) {
            index += 1;
        }

        const name = code.substring(nameStartIndex, index);

        index = assertDefined(consume(code, index, "("));
        index = consumeWhitespace(code, index);

        const args: AST[] = [];
        let argResult = expression(code, index);
        while (argResult != null) {
            index = argResult.newIndex;
            args.push(argResult.ast);

            index = consume(code, index, ",") ?? index;
            index = consumeWhitespace(code, index);
            argResult = expression(code, index);
            index = consumeWhitespace(code, index);
        }
        
        index = assertDefined(consume(code, index, ")"));

        return {
            ast: { kind: "funcall", name, args },
            newIndex: index,
        }
    }
    
    return undefined;
}


// Utilities
function assertDefined<T>(val: T|undefined): T {
    if (val == null) {
        throw Error("Expected defined");
    }

    return val;
}

function consume(code: string, index: number, segment: string): number|undefined {
    for (let i = 0; i < segment.length; i++) {
        if (code[index + i] !== segment[i]) {
            return undefined;
        }
    }

    return index + segment.length;
}

function consumeWhitespace(code: string, index: number): number {
    let newIndex = index;
    while (code[newIndex].match(/[\s]/)) {
        newIndex++;
    }

    return newIndex;
}

function isAlpha(char: string): boolean {
    // return char.match(/^[a-zA-Z]$/) != null;
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

function isNumeric(char: string): boolean {
    return char >= '0' && char <= '9';
}
