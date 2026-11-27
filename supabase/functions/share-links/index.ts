// Client download links (section 6).
//   POST { action: "create", job_id, include_raw? } -> { url, expires_at }
//   POST { action: "revoke", link_id }               -> { ok }
// Ops can create a link only when the job is Paid. Admin can create it earlier; that is logged.
import { HttpError, json, serve } from "../_shared/http.ts";
import { admin, audit, requireCaller, setting } from "../_shared/supabase.ts";
import { hash, token } from "../_shared/crypto.ts";

serve(async (req) => {
  const me = await requireCaller(req, "ops", "admin");
  const b = await req.json();

  if (b.action === "create") {
    const { data: job } = await admin.from("jobs").select("id, code, status").eq("id", b.job_id).single();
    if (!job) throw new HttpError(404, "Job not found");
    const paid = ["paid", "delivered", "closed"].includes(job.status);
    if (!paid && me.role !== "admin") throw new HttpError(409, "The link unlocks when Accounts marks this job Paid");
    if (!paid && job.status !== "released") throw new HttpError(409, "Release the work first");
    const allowRaw = (await setting("share_include_raw")) === true;
    const days = Number(await setting("share_link_days") ?? 7);
    const t = token();
    const expires = new Date(Date.now() + days * 86_400_000).toISOString();
    const { data: link, error } = await admin.from("share_links").insert({
      job_id: job.id, token_hash: await hash(t), include_raw: allowRaw && !!b.include_raw,
      expires_at: expires, created_by: me.id,
    }).select("id").single();
    if (error) throw error;
    if (!paid) await audit(me.id, "early_link", "jobs", job.id, { code: job.code, status: job.status });
    if (job.status === "paid") await admin.from("jobs").update({ status: "delivered" }).eq("id", job.id);
    return json({ id: link.id, url: `${Deno.env.get("APP_URL")}/d/${t}`, expires_at: expires });
  }

  if (b.action === "revoke") {
    const { error } = await admin.from("share_links").update({ revoked_at: new Date().toISOString() })
      .eq("id", b.link_id).is("revoked_at", null);
    if (error) throw error;
    return json({ ok: true });
  }
  throw new HttpError(400, "Unknown action");
});
