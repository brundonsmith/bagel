import { Statement } from "./statements";

export type SourceInfo = {
    code: string|undefined,
    startIndex: number|undefined,
    endIndex: number|undefined,
}

export type PlainIdentifier = SourceInfo & {
    kind: "plain-identifier",
    name: string,
}

export type Block = SourceInfo & {
    kind: "block",
    statements: Statement[],
}

export const KEYWORDS = [ "func", "proc", "if", "else", 
"type", "typeof", "class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "until", "true", "false", "import", "export", "from", "as" ] as const;
