import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

/** SHA-256 of value + pepper, hex. Used for OTPs and download-link tokens (only the hash is stored). */
export const sha256 = (value: string): string => createHash('sha256').update(value + env.hashPepper).digest('hex');

/** Six digits, uniformly random. */
export const makeOtp = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

/** URL-safe random token. */
export const makeToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
