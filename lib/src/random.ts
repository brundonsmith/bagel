import { plan } from "./core.ts";

export const random = () => plan(() => Promise.resolve(Math.random()))