import type { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createLocalS3 } from '../scripts/local-s3.js';
import type { Env } from '../src/config/env.js';
import { R2Service } from '../src/uploads/r2.service.js';

/** R2Service against the local S3 stand-in: signing, multipart resume, single PUT, download, CORS. */
describe('file storage (R2Service + local stand-in)', () => {
  let server: Server;
  let dir: string;
  let r2: R2Service;
  let endpoint: string;
  const MB = 1024 * 1024;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reeload-s3-'));
    server = createLocalS3({ dir, accessKeyId: 'test', secretAccessKey: 'test-secret', origins: ['http://localhost:3000'] });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const env: Partial<Env> = { R2_ENDPOINT: endpoint, R2_BUCKET: 'reeload-files', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test-secret' };
    r2 = new R2Service({ get: (k: keyof Env) => env[k] } as unknown as ConfigService<Env, true>);
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });

  it('uploads in parts, resumes from the parts already stored, and downloads the whole file', async () => {
    const key = 'jobs/j1/raw/abc-clip one.mov';
    const a = Buffer.alloc(5 * MB, 1);
    const b = Buffer.from('the end');
    const id = await r2.createMultipart(key, 'video/quicktime');

    const put1 = await fetch(r2.signPart(key, id, 1), { method: 'PUT', body: a });
    expect(put1.status).toBe(200);
    // A dropped connection: the next attempt asks which parts arrived.
    const stored = await r2.listParts(key, id);
    expect(stored).toEqual([{ PartNumber: 1, ETag: put1.headers.get('etag'), Size: a.length }]);

    const put2 = await fetch(r2.signPart(key, id, 2), { method: 'PUT', body: b });
    await r2.completeMultipart(key, id, [...stored, { PartNumber: 2, ETag: put2.headers.get('etag')! }]);
    expect(await r2.size(key)).toBe(a.length + b.length);

    const got = await fetch(r2.signGet(key, 60, 'clip one.mov'));
    expect(got.headers.get('content-type')).toBe('video/quicktime');
    expect(got.headers.get('content-disposition')).toBe('attachment; filename="clip one.mov"');
    expect(Buffer.from(await got.arrayBuffer()).equals(Buffer.concat([a, b]))).toBe(true);

    await r2.deleteObject(key);
    expect(await r2.size(key)).toBeNull();
  });

  it('takes a check-in photo as one signed PUT', async () => {
    const key = 'jobs/j1/proof/u1-selfie-1.jpg';
    const res = await fetch(r2.signPut(key), { method: 'PUT', body: Buffer.from('jpeg'), headers: { 'Content-Type': 'image/jpeg' } });
    expect(res.status).toBe(200);
    expect(await r2.size(key)).toBe(4);
  });

  it('refuses tampered, foreign or reused signatures', async () => {
    const url = new URL(r2.signPut('jobs/j1/proof/a.jpg'));
    const other = url.href.replace('/a.jpg', '/b.jpg');
    expect((await fetch(other, { method: 'PUT', body: 'x' })).status).toBe(403);
    url.searchParams.set('X-Amz-Signature', '0'.repeat(64));
    expect((await fetch(url, { method: 'PUT', body: 'x' })).status).toBe(403);
    expect((await fetch(`${endpoint}/reeload-files/jobs/j1/proof/a.jpg`)).status).toBe(403);
    expect((await fetch(`${endpoint}/reeload-files/../../etc/passwd`)).status).toBeGreaterThanOrEqual(400);
  });

  it('aborts an upload, after which its parts are gone', async () => {
    const key = 'jobs/j1/raw/abort.mov';
    const id = await r2.createMultipart(key, 'video/quicktime');
    await fetch(r2.signPart(key, id, 1), { method: 'PUT', body: 'x' });
    await r2.abortMultipart(key, id);
    await expect(r2.listParts(key, id)).rejects.toThrow();
  });

  it('answers the browser like the R2 CORS rule: ETag exposed for the client only', async () => {
    const pre = await fetch(`${endpoint}/reeload-files/x`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'PUT' },
    });
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(pre.headers.get('access-control-expose-headers')).toBe('ETag');
    const evil = await fetch(`${endpoint}/reeload-files/x`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
});
