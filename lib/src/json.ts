
// TODO: Or error
export const parse = (str: string): unknown => JSON.parse(str)

export const stringify = (val: unknown, indentation: number): string => JSON.stringify(val, null, indentation)