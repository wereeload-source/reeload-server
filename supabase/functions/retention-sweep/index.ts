// Daily scheduled job: deletes raw files 10 days after the shoot and edited reels
// after the admin setting (15 to 20 days). Proof photos are small and stay.
// Schedule with pg_cron (see README). Protected by a shared secret header.
import { HttpError, json, serve } from "../_shared/http.ts";
import { admin, audit, setting } from "../_shared/supabase.ts";
import { abortMultipart, deleteObject } from "../_shared/r2.ts";

serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) throw new HttpError(401, "Unauthorized");
  const rawDays = Number(await setting("raw_retention_days") ?? 10);
  const editedDays = Number(await setting("edited_retention_days") ?? 20);
  const now = Date.now();
  const result: Record<string, number> = { raw: 0, edited: 0, failed: 0 };

  for (const [kind, days] of [["raw", rawDays], ["edited", editedDays]] as const) {
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    const { data: rows } = await admin.from("uploads")
      .select("id, object_key, r2_upload_id, status, jobs!inner(starts_at)")
      .eq("kind", kind).in("status", ["complete", "uploading", "aborted"])
      .lt("jobs.starts_at", cutoff).limit(500);
    for (const u of rows ?? []) {
      try {
        if (u.status === "complete") await deleteObject(u.object_key);
        else if (u.r2_upload_id) await abortMultipart(u.object_key, u.r2_upload_id).catch(() => {});
        await admin.from("uploads").update({ status: "deleted", deleted_at: new Date().toISOString(), r2_upload_id: null })
          .eq("id", u.id);
        result[kind]++;
      } catch (e) {
        console.error("delete failed", u.id, e);
        result.failed++;
      }
    }
  }
  await audit(null, "retention_sweep", "uploads", "-", result);
  return json(result);
});
