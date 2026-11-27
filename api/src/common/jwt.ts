import { createHmac, timingSafeEqual } from 'node:crypto';

/** Minimal HS256 JSON Web Tokens with no dependencies. The API is the only issuer and verifier. */
export interface TokenPayload {
  /** The user's id. */
  sub: string;
  iat: number;
  exp: number;
}

const b64 = (input: string | Buffer): string => Buffer.from(input).toString('base64url');
const sign = (data: string, secret: string): string => createHmac('sha256', secret).update(data).digest('base64url');
const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function signToken(sub: string, secret: string, ttlSeconds: number, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const body = b64(JSON.stringify({ sub, iat, exp: iat + ttlSeconds } satisfies TokenPayload));
  return `${HEADER}.${body}.${sign(`${HEADER}.${body}`, secret)}`;
}

/** Returns the payload, or null when the token is malformed, tampered with or expired. */
export function verifyToken(token: string, secret: string, nowMs: number = Date.now()): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  if (header !== HEADER) return null; // only HS256, which also rules out alg=none

  const expected = Buffer.from(sign(`${header}.${body}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<TokenPayload>;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') return null;
    if (payload.exp * 1000 <= nowMs) return null;
    return payload as TokenPayload;
  } catch {
    return null;
  }
}
