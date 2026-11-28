import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 with node:crypto only, for Cloudflare R2's S3-compatible API.
 * Pure functions: the clock is passed in, so a published AWS example can check them.
 */
export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string; // R2 uses "auto"
  service: string; // "s3"
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export const encodeRfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Object key to a URL path: each segment encoded, slashes kept. */
export const encodePath = (path: string): string => path.split('/').map(encodeRfc3986).join('/');

const amzDate = (now: Date): string => now.toISOString().replace(/[:-]|\.\d{3}/g, '');

function signingKey(c: Credentials, day: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${c.secretAccessKey}`, day), c.region), c.service), 'aws4_request');
}

const canonicalQuery = (query: Record<string, string>): string =>
  Object.entries(query)
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

interface Target {
  method: string;
  host: string;
  /** Already-encoded path, starting with "/". */
  path: string;
  query?: Record<string, string>;
}

/** A presigned URL: whoever holds it can make that one request until it expires. */
export function presignUrl(c: Credentials, t: Target, expiresSeconds: number, now: Date): string {
  const stamp = amzDate(now);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${c.region}/${c.service}/aws4_request`;
  const query: Record<string, string> = {
    ...t.query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const cq = canonicalQuery(query);
  const canonical = [t.method, t.path, cq, `host:${t.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(c, day)).update(toSign).digest('hex');
  return `https://${t.host}${t.path}?${cq}&X-Amz-Signature=${signature}`;
}

/** Headers for a request the server makes itself (create/list/complete/abort/delete). */
export function signHeaders(
  c: Credentials,
  t: Target & { body?: string; contentType?: string },
  now: Date,
): Record<string, string> {
  const stamp = amzDate(now);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${c.region}/${c.service}/aws4_request`;
  const payloadHash = sha256(t.body ?? '');
  const headers: Record<string, string> = { host: t.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  if (t.contentType) headers['content-type'] = t.contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [t.method, t.path, canonicalQuery(t.query ?? {}), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(c, day)).update(toSign).digest('hex');
  const { host: _host, ...send } = headers; // fetch sets Host itself
  return {
    ...send,
    authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
