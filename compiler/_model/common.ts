import { Statement } from "./statements.ts";

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

export const KEYWORDS = [ "func", "proc", "if", "else", "switch", "case",
"type", "typeof", "class", "let", "const", "for", "while", 
"of", "nil", "public", "visible", "private", "reaction", 
"triggers", "until", "true", "false", "import", "export", "from", "as" ] as const;
