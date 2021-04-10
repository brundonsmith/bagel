import { NUMBER, STRING } from "./types";

// export type Environment = { [symbol: string]: FuncdefNative | FuncdefDynamic };

// export const DEFAULT_ENVIRONMENT: Environment = {
//     "add": {
//         kind: "funcdef-native",
//         argTypes: [{ kind: NUMBER }, { kind: NUMBER }],
//         returnType: { kind: NUMBER },
//         body: `([a, b]) => a + b`,
//     },
//     "concat": {
//         kind: "funcdef-native",
//         argTypes: [ { kind: "union-type", members: [{ kind: NUMBER }, { kind: STRING }] }, { kind: "union-type", members: [{ kind: NUMBER }, { kind: STRING }] } ],
//         returnType: { kind: STRING },
//         body: `([a, b]) => a + b`,
//     },
// };

// export function extend(base: Environment, extension: Environment): Environment {
//     return Object.setPrototypeOf(extension, base);
// }