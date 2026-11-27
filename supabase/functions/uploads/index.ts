// Direct-to-R2 uploads from the phone (section 6), shaped for Uppy's AwsS3 multipart plugin.
//   POST { action: "create", job_id, kind, file_name, size_bytes, content_type, on_behalf_of? }
//        -> { upload_id, key, r2_upload_id, parts: [...already uploaded] }  (resumes a matching unfinished upload)
//   POST { action: "sign-part", upload_id, part_number }   -> { url }
//   POST { action: "list-parts", upload_id }                -> { parts }
//   POST { action: "complete", upload_id, parts }           -> { ok }
//   POST { action: "abort", upload_id }                     -> { ok }
//   POST { action: "proof", job_id, which: "selfie"|"location", content_type } -> { upload_id, url } single PUT, then "complete"
import { HttpError, json, serve } from "../_shared/http.ts";
import { admin, Caller, isAssigned, requireCaller } from "../_shared/supabase.ts";
import * as r2 from "../_shared/r2.ts";

const KINDS = ["raw", "edited"] as const;

async function canUploadTo(me: Caller, jobId: string) {
  if (me.role === "ops" || me.role === "admin") return true;
  return me.role === "reelmaker" && (await isAssigned(jobId, me.id, ["accepted"]));
}

async function ownUpload(me: Caller, uploadId: string) {
  const { data: u } = await admin.from("uploads").select("*").eq("id", uploadId).single();
  if (!u) throw new HttpError(404, "Upload not found");
  if (u.uploaded_by !== me.id && me.role !== "admin") throw new HttpError(403, "Not your upload");
  return u;
}

const safeName = (n: string) => n.replace(/[^\w.\-]+/g, "_").slice(-120);

serve(async (req) => {
  const me = await requireCaller(req, "reelmaker", "ops", "admin");
  const b = await req.json();

  switch (b.action) {
    case "create": {
      if (!KINDS.includes(b.kind)) throw new HttpError(400, "kind must be raw or edited");
      if (!(await canUploadTo(me, b.job_id))) throw new HttpError(403, "You cannot upload to this job");
      // Picking the same file again resumes the unfinished upload.
      const { data: open } = await admin.from("uploads").select("*")
        .eq("job_id", b.job_id).eq("uploaded_by", me.id).eq("file_name", b.file_name)
        .eq("size_bytes", b.size_bytes).eq("status", "uploading").maybeSingle();
      if (open) {
        const parts = await r2.listParts(open.object_key, open.r2_upload_id);
        return json({ upload_id: open.id, key: open.object_key, r2_upload_id: open.r2_upload_id, parts });
      }
      const key = `jobs/${b.job_id}/${b.kind}/${crypto.randomUUID()}-${safeName(b.file_name)}`;
      const r2UploadId = await r2.createMultipart(key, b.content_type);
      const { data: row, error } = await admin.from("uploads").insert({
        job_id: b.job_id, kind: b.kind, file_name: b.file_name, size_bytes: b.size_bytes,
        content_type: b.content_type, object_key: key, r2_upload_id: r2UploadId, uploaded_by: me.id,
        on_behalf_of: me.role === "reelmaker" ? null : (b.on_behalf_of ?? null),
      }).select().single();
      if (error) throw error;
      return json({ upload_id: row.id, key, r2_upload_id: r2UploadId, parts: [] });
    }

    case "sign-part": {
      const u = await ownUpload(me, b.upload_id);
      if (u.status !== "uploading") throw new HttpError(409, "Upload is not open");
      return json({ url: await r2.signPart(u.object_key, u.r2_upload_id, Number(b.part_number)) });
    }

    case "list-parts": {
      const u = await ownUpload(me, b.upload_id);
      return json({ parts: await r2.listParts(u.object_key, u.r2_upload_id) });
    }

    case "complete": {
      const u = await ownUpload(me, b.upload_id);
      if (u.kind !== "proof") await r2.completeMultipart(u.object_key, u.r2_upload_id, b.parts ?? []);
      await admin.from("uploads").update({ status: "complete", completed_at: new Date().toISOString(), r2_upload_id: null })
        .eq("id", u.id);
      if (u.kind === "raw" || u.kind === "edited") {
        await admin.from("jobs").update({ status: "uploaded" }).eq("id", u.job_id).in("status", ["reached"]);
      }
      return json({ ok: true });
    }

    case "abort": {
      const u = await ownUpload(me, b.upload_id);
      if (u.r2_upload_id) await r2.abortMultipart(u.object_key, u.r2_upload_id).catch(() => {});
      await admin.from("uploads").update({ status: "aborted" }).eq("id", u.id);
      return json({ ok: true });
    }

    case "proof": {
      if (me.role !== "reelmaker" || !(await isAssigned(b.job_id, me.id, ["accepted"]))) {
        throw new HttpError(403, "Only the assigned reelmaker takes proof photos");
      }
      const which = b.which === "selfie" ? "selfie" : "location";
      const key = `jobs/${b.job_id}/proof/${me.id}-${which}-${Date.now()}.jpg`;
      const { data: row, error } = await admin.from("uploads").insert({
        job_id: b.job_id, kind: "proof", file_name: `${which}.jpg`, size_bytes: b.size_bytes ?? 0,
        content_type: "image/jpeg", object_key: key, uploaded_by: me.id,
      }).select().single();
      if (error) throw error;
      return json({ upload_id: row.id, url: await r2.signPut(key) });
    }
  }
  throw new HttpError(400, "Unknown action");
});
