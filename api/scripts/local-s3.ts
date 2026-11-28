/**
 * A small S3-compatible stand-in for Cloudflare R2, for local development and tests only.
 *
 *   pnpm storage:local     # http://127.0.0.1:9100, files in api/.local-storage (git-ignored)
 *
 * Then in api/.env:  R2_ENDPOINT=http://127.0.0.1:9100, R2_ACCESS_KEY_ID=local, R2_SECRET_ACCESS_KEY=local-secret
 *
 * It does only what Reeload uses: multipart uploads (create, part, list parts, complete, abort),
 * single PUT, GET (with response-content-disposition), HEAD and DELETE. Every request must carry a
 * valid SigV4 signature (header or presigned URL) for the same host, path and query, and it answers
 * browser CORS like the R2 rule in docs/GO-LIVE.md (ETag exposed). Never use it for real files.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { presignUrl, signHeaders, type Credentials } from '../src/uploads/sigv4.js';

export interface LocalS3Options {
  dir: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Browser origins allowed by CORS (the Next.js client). */
  origins: string[];
}

const MAX_BODY = 200 * 1024 * 1024;
const SIGNING_PARAMS = ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature'];

class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const md5 = (b: Buffer) => `"${createHash('md5').update(b).digest('hex')}"`;
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const parseAmzDate = (s: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new S3Error(403, 'AccessDenied');
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new S3Error(400, 'EntityTooLarge');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createLocalS3(opts: LocalS3Options): Server {
  const creds: Credentials = { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, region: 'auto', service: 's3' };
  const root = resolve(opts.dir);
  const uploads = join(root, '.multipart');

  /** Bucket + key from the raw path, refusing anything that could leave the storage folder. */
  const locate = (rawPath: string) => {
    const [, bucket, ...rest] = rawPath.split('/');
    const key = rest.map(decodeURIComponent).join('/');
    if (!bucket || !key || key.split('/').some((s) => s === '' || s === '.' || s === '..')) throw new S3Error(400, 'InvalidKey');
    const file = resolve(root, decodeURIComponent(bucket), key);
    if (!file.startsWith(root + sep)) throw new S3Error(400, 'InvalidKey');
    return { bucket, key, file };
  };

  const authorize = (req: IncomingMessage, rawPath: string, query: Record<string, string>, body: Buffer) => {
    const host = req.headers.host ?? '';
    if (query['X-Amz-Signature']) {
      const date = parseAmzDate(query['X-Amz-Date'] ?? '');
      const expires = Number(query['X-Amz-Expires']);
      if (!(Date.now() <= date.getTime() + expires * 1000)) throw new S3Error(403, 'AccessDenied: request has expired');
      const rest = Object.fromEntries(Object.entries(query).filter(([k]) => !SIGNING_PARAMS.includes(k)));
      const expected = presignUrl(creds, { method: req.method!, host, path: rawPath, query: rest }, expires, date).split('X-Amz-Signature=')[1]!;
      if (!same(expected, query['X-Amz-Signature'])) throw new S3Error(403, 'SignatureDoesNotMatch');
      return;
    }
    const auth = req.headers.authorization ?? '';
    const date = parseAmzDate(String(req.headers['x-amz-date'] ?? ''));
    if (Math.abs(Date.now() - date.getTime()) > 15 * 60 * 1000) throw new S3Error(403, 'RequestTimeTooSkewed');
    const signsType = /SignedHeaders=[^,]*content-type/.test(auth);
    const expected = signHeaders(
      creds,
      { method: req.method!, host, path: rawPath, query, body: body.toString('utf8'), contentType: signsType ? req.headers['content-type'] : undefined },
      date,
    ).authorization!;
    if (!auth || !same(expected, auth)) throw new S3Error(403, 'SignatureDoesNotMatch');
  };

  const cors = (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && opts.origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
      res.setHeader('Access-Control-Max-Age', '3600');
    }
  };

  const xml = (res: ServerResponse, status: number, body: string) => {
    res.writeHead(status, { 'Content-Type': 'application/xml' }).end(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
  };

  const uploadDir = (id: string) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new S3Error(404, 'NoSuchUpload');
    return join(uploads, id);
  };
  const readMeta = async (id: string, key: string) => {
    const d = uploadDir(id);
    if (!existsSync(join(d, 'meta.json'))) throw new S3Error(404, 'NoSuchUpload');
    const meta = JSON.parse(await readFile(join(d, 'meta.json'), 'utf8')) as { key: string; contentType: string };
    if (meta.key !== key) throw new S3Error(404, 'NoSuchUpload');
    return { d, meta };
  };
  const listParts = async (d: string) => {
    const names = (await readdir(d)).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
    return Promise.all(names.map(async (n) => ({ n, etag: md5(await readFile(join(d, String(n)))), size: (await stat(join(d, String(n)))).size })));
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    cors(req, res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();

    const raw = req.url ?? '/';
    const qi = raw.indexOf('?');
    const rawPath = qi < 0 ? raw : raw.slice(0, qi);
    const query: Record<string, string> = {};
    if (qi >= 0) {
      for (const pair of raw.slice(qi + 1).split('&').filter(Boolean)) {
        const eq = pair.indexOf('=');
        const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
        query[k] = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, '%20'));
      }
    }
    const body = await readBody(req);
    authorize(req, rawPath, query, body);
    const { key, file } = locate(rawPath);
    const method = req.method!;

    if (method === 'POST' && 'uploads' in query) {
      const id = randomUUID();
      await mkdir(uploadDir(id), { recursive: true });
      await writeFile(join(uploadDir(id), 'meta.json'), JSON.stringify({ key, contentType: req.headers['content-type'] ?? 'application/octet-stream' }));
      return xml(res, 200, `<InitiateMultipartUploadResult><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (method === 'PUT' && query.uploadId) {
      const { d } = await readMeta(query.uploadId, key);
      const n = Number(query.partNumber);
      if (!Number.isInteger(n) || n < 1 || n > 10_000) throw new S3Error(400, 'InvalidPartNumber');
      await writeFile(join(d, String(n)), body);
      return void res.writeHead(200, { ETag: md5(body) }).end();
    }
    if (method === 'GET' && query.uploadId) {
      const { d } = await readMeta(query.uploadId, key);
      const after = Number(query['part-number-marker'] ?? 0);
      const parts = (await listParts(d)).filter((p) => p.n > after);
      return xml(
        res,
        200,
        `<ListPartsResult><UploadId>${query.uploadId}</UploadId><IsTruncated>false</IsTruncated>${parts
          .map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag><Size>${p.size}</Size></Part>`)
          .join('')}</ListPartsResult>`,
      );
    }
    if (method === 'POST' && query.uploadId) {
      const { d, meta } = await readMeta(query.uploadId, key);
      const stored = new Map((await listParts(d)).map((p) => [p.n, p.etag]));
      const wanted = [...body.toString('utf8').matchAll(/<Part><PartNumber>(\d+)<\/PartNumber><ETag>([^<]*)<\/ETag><\/Part>/g)].map((m) => ({ n: Number(m[1]), etag: m[2]! }));
      if (!wanted.length) throw new S3Error(400, 'MalformedXML');
      for (const [i, p] of wanted.entries()) {
        if (i > 0 && p.n <= wanted[i - 1]!.n) throw new S3Error(400, 'InvalidPartOrder');
        const etag = p.etag.replace(/&quot;/g, '"');
        if (stored.get(p.n) !== (etag.startsWith('"') ? etag : `"${etag}"`)) throw new S3Error(400, 'InvalidPart');
      }
      const data = Buffer.concat(await Promise.all(wanted.map((p) => readFile(join(d, String(p.n))))));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, data);
      await writeFile(`${file}.meta.json`, JSON.stringify({ contentType: meta.contentType }));
      await rm(d, { recursive: true, force: true });
      return xml(res, 200, `<CompleteMultipartUploadResult><Key>${key}</Key><ETag>${md5(data)}</ETag></CompleteMultipartUploadResult>`);
    }
    if (method === 'DELETE' && query.uploadId) {
      const { d } = await readMeta(query.uploadId, key);
      await rm(d, { recursive: true, force: true });
      return void res.writeHead(204).end();
    }
    if (method === 'PUT') {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(`${file}.meta.json`, JSON.stringify({ contentType: req.headers['content-type'] ?? 'application/octet-stream' }));
      return void res.writeHead(200, { ETag: md5(body) }).end();
    }
    if (method === 'GET' || method === 'HEAD') {
      if (!existsSync(file)) throw new S3Error(404, 'NoSuchKey');
      const data = await readFile(file);
      const meta = existsSync(`${file}.meta.json`) ? (JSON.parse(await readFile(`${file}.meta.json`, 'utf8')) as { contentType: string }) : { contentType: 'application/octet-stream' };
      res.writeHead(200, {
        'Content-Type': meta.contentType,
        'Content-Length': data.length,
        ETag: md5(data),
        ...(query['response-content-disposition'] ? { 'Content-Disposition': query['response-content-disposition'] } : {}),
      });
      return void res.end(method === 'HEAD' ? undefined : data);
    }
    if (method === 'DELETE') {
      await rm(file, { force: true });
      await rm(`${file}.meta.json`, { force: true });
      return void res.writeHead(204).end();
    }
    throw new S3Error(405, 'MethodNotAllowed');
  }

  return createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const err = e instanceof S3Error ? e : new S3Error(500, 'InternalError');
      if (!(e instanceof S3Error)) console.error(e);
      if (!res.headersSent) xml(res, err.status, `<Error><Code>${err.code}</Code></Error>`);
      else res.end();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const envFile = join(import.meta.dirname, '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const port = Number(process.env.LOCAL_S3_PORT ?? 9100);
  const server = createLocalS3({
    dir: join(import.meta.dirname, '..', '.local-storage'),
    accessKeyId: process.env.R2_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'local-secret',
    origins: [process.env.CLIENT_URL || 'http://localhost:3000'],
  });
  server.listen(port, '127.0.0.1', () => console.log(`Local file storage ready: http://127.0.0.1:${port} (bucket folder api/.local-storage)`));
}
