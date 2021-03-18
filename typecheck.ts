import { AST, ValueType, STRING, NUMBER, BOOLEAN, canBeAssignedTo } from "./model.ts";
import { Environment } from "./environment.ts";

export function typecheck(environment: Environment, ast: AST): ValueType | undefined {
    switch(ast.kind) {
        case "string-literal": return { kind: STRING };
        case "number-literal": return { kind: NUMBER };
        case "boolean-literal": return { kind: BOOLEAN };
        case "funcall": {
            const func = environment[ast.name];
            
            switch (func.kind) {
                case "funcdef-native": {
                    const parameterTypes = ast.args.map(arg => typecheck(environment, arg));

                    if (parameterTypes.every((param, index) => 
                            param != null && canBeAssignedTo(param, func.argTypes[index]))) {
                        return func.returnType;
                    } else {
                        return undefined;
                    }
                }
                case "funcdef-dynamic": return typecheck(environment, func.body);
            }
        }
    }
        
    throw Error("");
}