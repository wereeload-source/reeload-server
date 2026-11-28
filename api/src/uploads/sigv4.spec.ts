import { encodePath, encodeRfc3986, presignUrl, signHeaders } from './sigv4.js';

// The example in AWS's "Authenticating Requests: Using Query Parameters" documentation.
const aws = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3' };

describe('SigV4', () => {
  it('matches the AWS documentation presigned URL', () => {
    const url = presignUrl(aws, { method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt' }, 86400, new Date('2013-05-24T00:00:00Z'));
    expect(url).toContain('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });

  it('encodes characters encodeURIComponent leaves alone', () => {
    expect(encodeRfc3986("a b!'()*")).toBe('a%20b%21%27%28%29%2A');
    expect(encodePath('jobs/1/raw/clip (1).mp4')).toBe('jobs/1/raw/clip%20%281%29.mp4');
  });

  it('includes query parameters (part number, upload id) in the signature', () => {
    const a = presignUrl(aws, { method: 'PUT', host: 'h.example', path: '/b/k', query: { partNumber: '1', uploadId: 'u' } }, 3600, new Date('2026-01-01T00:00:00Z'));
    const b = presignUrl(aws, { method: 'PUT', host: 'h.example', path: '/b/k', query: { partNumber: '2', uploadId: 'u' } }, 3600, new Date('2026-01-01T00:00:00Z'));
    expect(a.split('X-Amz-Signature=')[1] === b.split('X-Amz-Signature=')[1]).toBe(false);
    expect(a).toContain('partNumber=1&uploadId=u');
  });

  it('signs server requests with the body hash and never sends the secret', () => {
    const h = signHeaders(aws, { method: 'POST', host: 'h.example', path: '/b/k', query: { uploads: '' }, body: '' }, new Date('2026-01-01T00:00:00Z'));
    expect(h['x-amz-date']).toBe('20260101T000000Z');
    expect(h['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(h.authorization).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20260101/us-east-1/s3/aws4_request');
    expect(h.authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
    expect(JSON.stringify(h)).not.toContain('wJalrXUtnFEMI');
  });
});
