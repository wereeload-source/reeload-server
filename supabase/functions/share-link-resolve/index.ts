// Public download page data: GET ?token=...  (no login, verify_jwt = false)
// Checks expiry and revocation, then returns short-lived presigned download URLs.
import { HttpError, json, serve } from "../_shared/http.ts";
import { admin } from "../_shared/supabase.ts";
import { hash } from "../_shared/crypto.ts";
import { signGet } from "../_shared/r2.ts";

serve(async (req) => {
  const t = new URL(req.url).searchParams.get("token") ?? "";
  if (t.length < 20) throw new HttpError(404, "This link is not valid");
  const { data: link } = await admin.from("share_links")
    .select("id, job_id, include_raw, expires_at, revoked_at, jobs(code, starts_at, clients(name))")
    .eq("token_hash", await hash(t)).maybeSingle();
  if (!link || link.revoked_at) throw new HttpError(404, "This link is not valid");
  if (new Date(link.expires_at) < new Date()) throw new HttpError(410, "This link has expired");

  const kinds = link.include_raw ? ["edited", "raw"] : ["edited"];
  const { data: files } = await admin.from("uploads").select("id, kind, file_name, size_bytes, object_key")
    .eq("job_id", link.job_id).in("kind", kinds).eq("status", "complete");

  // deno-lint-ignore no-explicit-any
  const job = link.jobs as any;
  return json({
    client: job?.clients?.name,
    job: job?.code,
    shot_on: job?.starts_at,
    expires_at: link.expires_at,
    files: await Promise.all((files ?? []).map(async (f) => ({
      name: f.file_name, kind: f.kind, size_bytes: f.size_bytes, url: await signGet(f.object_key, 30 * 60),
    }))),
  });
});
