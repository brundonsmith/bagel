import { Statement } from "./statements";

export type SourceInfo = {
    code: string,
    startIndex: number,
    endIndex: number,
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
"triggers", "true", "false", "import", "export", "from", "as" ] as const;
