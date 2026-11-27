import { AwsClient } from "aws4fetch";

// Cloudflare R2 through its S3-compatible API. The bucket stays private:
// the phone uploads and the client downloads with short-lived presigned URLs.
const accountId = Deno.env.get("R2_ACCOUNT_ID")!;
const bucket = Deno.env.get("R2_BUCKET") ?? "reelops-files";
const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;

const r2 = new AwsClient({
  accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
  secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
  service: "s3",
  region: "auto",
});

const objectUrl = (key: string, query = "") =>
  `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}${query}`;

async function presign(method: string, url: string, expiresSeconds: number): Promise<string> {
  const u = new URL(url);
  u.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await r2.sign(new Request(u, { method }), { aws: { signQuery: true } });
  return signed.url;
}

async function call(method: string, url: string, body?: string): Promise<string> {
  const res = await r2.fetch(url, { method, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`R2 ${method} failed: ${res.status} ${text}`);
  return text;
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

export async function createMultipart(key: string, contentType: string): Promise<string> {
  const res = await r2.fetch(objectUrl(key, "?uploads"), {
    method: "POST",
    headers: { "Content-Type": contentType || "application/octet-stream" },
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`R2 create multipart failed: ${xml}`);
  return tag(xml, "UploadId")!;
}

export const signPart = (key: string, uploadId: string, partNumber: number) =>
  presign("PUT", objectUrl(key, `?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`), 60 * 60);

/** Parts already stored, so a dropped upload can resume where it stopped. */
export async function listParts(key: string, uploadId: string) {
  const xml = await call("GET", objectUrl(key, `?uploadId=${encodeURIComponent(uploadId)}`));
  return [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({
    PartNumber: Number(tag(m[1], "PartNumber")),
    ETag: tag(m[1], "ETag")!,
    Size: Number(tag(m[1], "Size")),
  }));
}

export async function completeMultipart(key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]) {
  const body = `<CompleteMultipartUpload>${
    parts.sort((a, b) => a.PartNumber - b.PartNumber)
      .map((p) => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`).join("")
  }</CompleteMultipartUpload>`;
  await call("POST", objectUrl(key, `?uploadId=${encodeURIComponent(uploadId)}`), body);
}

export const abortMultipart = (key: string, uploadId: string) =>
  call("DELETE", objectUrl(key, `?uploadId=${encodeURIComponent(uploadId)}`));

export const signPut = (key: string) => presign("PUT", objectUrl(key), 15 * 60);
export const signGet = (key: string, seconds = 15 * 60) => presign("GET", objectUrl(key), seconds);
export const deleteObject = (key: string) => call("DELETE", objectUrl(key));
