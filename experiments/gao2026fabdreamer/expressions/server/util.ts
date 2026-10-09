import { randomBytes } from 'node:crypto';
export const newId = (prefix: string) => `${prefix}_${randomBytes(4).toString('hex')}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
