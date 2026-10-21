import { randomBytes, createHash, randomUUID } from 'node:crypto';
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export class AppError extends Error { constructor(public status: number, message: string, public code = 'invalid_request') { super(message); } }
export function assert(condition: unknown, message: string, status = 400): asserts condition { if (!condition) throw new AppError(status, message); }
