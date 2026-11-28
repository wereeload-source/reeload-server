import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../common/env.js';
import { encodePath, presignUrl, signHeaders, type Credentials } from './sigv4.js';

export interface Part {
  PartNumber: number;
  ETag: string;
  Size?: number;
}

const tag = (xml: string, name: string): string | undefined => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

/**
 * Cloudflare R2 through its S3-compatible API. The bucket stays private: phones upload, and
 * clients download, with short-lived presigned URLs. Credentials are read when first used, so the
 * rest of the API starts without R2 configured.
 */
@Injectable()
export class R2Service {
  private readonly log = new Logger('R2');

  private get cfg() {
    try {
      const r2 = env.r2;
      const creds: Credentials = { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey, region: 'auto', service: 's3' };
      return { creds, host: `${r2.accountId}.r2.cloudflarestorage.com`, bucket: r2.bucket };
    } catch (e) {
      this.log.error((e as Error).message);
      throw new ServiceUnavailableException('File storage is not set up yet. Call operations.');
    }
  }

  private path(key: string): string {
    return `/${this.cfg.bucket}/${encodePath(key)}`;
  }

  private presign(method: string, key: string, query: Record<string, string>, seconds: number): string {
    const { creds, host } = this.cfg;
    return presignUrl(creds, { method, host, path: this.path(key), query }, seconds, new Date());
  }

  private async call(method: string, key: string, query: Record<string, string>, opts: { body?: string; contentType?: string } = {}): Promise<string> {
    const { creds, host } = this.cfg;
    const path = this.path(key);
    const headers = signHeaders(creds, { method, host, path, query, ...opts }, new Date());
    const qs = Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`https://${host}${path}${qs ? `?${qs}` : ''}`, { method, headers, body: opts.body });
    const text = await res.text();
    if (!res.ok) {
      this.log.error(`R2 ${method} ${res.status}: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException('File storage is not answering. Try again in a moment.');
    }
    return text;
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const xml = await this.call('POST', key, { uploads: '' }, { contentType: contentType || 'application/octet-stream' });
    const id = tag(xml, 'UploadId');
    if (!id) throw new ServiceUnavailableException('File storage did not start the upload.');
    return id;
  }

  signPart(key: string, uploadId: string, partNumber: number): string {
    return this.presign('PUT', key, { partNumber: String(partNumber), uploadId }, 60 * 60);
  }

  /** Parts already stored, so a dropped upload resumes where it stopped. */
  async listParts(key: string, uploadId: string): Promise<Part[]> {
    const parts: Part[] = [];
    let marker = '0';
    for (let page = 0; page < 20; page++) {
      const xml = await this.call('GET', key, { uploadId, 'part-number-marker': marker });
      for (const m of xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)) {
        parts.push({ PartNumber: Number(tag(m[1]!, 'PartNumber')), ETag: tag(m[1]!, 'ETag')!, Size: Number(tag(m[1]!, 'Size')) });
      }
      if (tag(xml, 'IsTruncated') !== 'true') break;
      marker = tag(xml, 'NextPartNumberMarker') ?? String(parts.at(-1)?.PartNumber ?? 0);
    }
    return parts;
  }

  async completeMultipart(key: string, uploadId: string, parts: Part[]): Promise<void> {
    const body = `<CompleteMultipartUpload>${[...parts]
      .sort((a, b) => a.PartNumber - b.PartNumber)
      .map((p) => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`)
      .join('')}</CompleteMultipartUpload>`;
    await this.call('POST', key, { uploadId }, { body, contentType: 'application/xml' });
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.call('DELETE', key, { uploadId });
  }

  signPut(key: string): string {
    return this.presign('PUT', key, {}, 15 * 60);
  }

  signGet(key: string, seconds = 15 * 60, fileName?: string): string {
    return this.presign('GET', key, fileName ? { 'response-content-disposition': `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"` } : {}, seconds);
  }

  async deleteObject(key: string): Promise<void> {
    await this.call('DELETE', key, {});
  }

  /** Size in bytes of a stored object, or null if it is not there. */
  async size(key: string): Promise<number | null> {
    const { creds, host } = this.cfg;
    const headers = signHeaders(creds, { method: 'HEAD', host, path: this.path(key) }, new Date());
    const res = await fetch(`https://${host}${this.path(key)}`, { method: 'HEAD', headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new ServiceUnavailableException('File storage is not answering. Try again in a moment.');
    return Number(res.headers.get('content-length') ?? 0);
  }
}
