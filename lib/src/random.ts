import { plan } from "./core.ts";

export const random = () => plan(() => Math.random())