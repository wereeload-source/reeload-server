// Shoot-day check-in (section 5 of the documentation).
//   POST { action: "start",    job_id }                         reelmaker taps Reached; sends or resends the OTP
//   POST { action: "verify",   job_id, code }                   reelmaker enters the client's code
//   POST { action: "release",  job_id, reason }                 ops approves without OTP after 5 minutes
//   POST { action: "complete", job_id, selfie_upload_id, location_upload_id }   two live photos done
import { HttpError, json, serve } from "../_shared/http.ts";
import { admin, audit, isAssigned, requireCaller } from "../_shared/supabase.ts";
import { hash, otp, safeEqual } from "../_shared/crypto.ts";
import { sendOtp } from "../_shared/whatsapp.ts";

const OTP_TTL_MS = 10 * 60_000;
const MAX_SENDS = 3;
const RESEND_WAIT_MS = 60_000;
const MAX_ATTEMPTS = 5;
const OPS_RELEASE_AFTER_MS = 5 * 60_000;

serve(async (req) => {
  const body = await req.json();
  const jobId: string = body.job_id;
  if (!jobId) throw new HttpError(400, "job_id is required");

  switch (body.action) {
    case "start": {
      const me = await requireCaller(req, "reelmaker");
      if (!(await isAssigned(jobId, me.id, ["accepted"]))) throw new HttpError(403, "Accept this shoot first");
      const { data: job } = await admin.from("jobs").select("code, onsite_contact_phone, client_id, clients(whatsapp, phone)")
        .eq("id", jobId).single();
      // deno-lint-ignore no-explicit-any
      const client = (job as any)?.clients;
      const to = job?.onsite_contact_phone || client?.whatsapp || client?.phone;
      if (!to) throw new HttpError(400, "No WhatsApp number on this job. Call operations.");

      const { data: existing } = await admin.from("checkins").select("*")
        .eq("job_id", jobId).eq("reelmaker_id", me.id).maybeSingle();
      if (existing?.verified_at) throw new HttpError(409, "Already verified");
      const now = Date.now();
      if (existing) {
        if (existing.otp_sends >= MAX_SENDS) throw new HttpError(429, "Code sent 3 times. Call operations.");
        const wait = RESEND_WAIT_MS - (now - new Date(existing.otp_last_sent_at).getTime());
        if (wait > 0) throw new HttpError(429, `Wait ${Math.ceil(wait / 1000)} seconds before resending`);
      }
      const code = otp();
      const row = {
        job_id: jobId,
        reelmaker_id: me.id,
        otp_hash: await hash(`${jobId}:${code}`),
        otp_expires_at: new Date(now + OTP_TTL_MS).toISOString(),
        otp_sends: (existing?.otp_sends ?? 0) + 1,
        otp_last_sent_at: new Date(now).toISOString(),
        otp_attempts: 0,
      };
      const { error } = await admin.from("checkins").upsert(row, { onConflict: "job_id,reelmaker_id" });
      if (error) throw error;
      await sendOtp(to, code);
      const masked = to.replace(/\D/g, "").replace(/^(\d*)(\d{3})$/, (_: string, a: string, b: string) => "•".repeat(a.length) + b);
      return json({ sent_to: masked, sends_left: MAX_SENDS - row.otp_sends, expires_at: row.otp_expires_at });
    }

    case "verify": {
      const me = await requireCaller(req, "reelmaker");
      const { data: c } = await admin.from("checkins").select("*")
        .eq("job_id", jobId).eq("reelmaker_id", me.id).single();
      if (!c?.otp_hash) throw new HttpError(400, "Tap Reached first");
      if (c.verified_at) return json({ ok: true });
      if (c.otp_attempts >= MAX_ATTEMPTS) throw new HttpError(429, "Too many wrong codes. Call operations.");
      if (Date.now() > new Date(c.otp_expires_at).getTime()) throw new HttpError(410, "Code expired. Send a new one.");
      const good = safeEqual(await hash(`${jobId}:${String(body.code ?? "")}`), c.otp_hash);
      if (!good) {
        await admin.from("checkins").update({ otp_attempts: c.otp_attempts + 1 }).eq("id", c.id);
        throw new HttpError(400, `Wrong code. ${MAX_ATTEMPTS - c.otp_attempts - 1} tries left.`);
      }
      await admin.from("checkins").update({ verified_at: new Date().toISOString(), method: "otp", otp_hash: null }).eq("id", c.id);
      return json({ ok: true });
    }

    case "release": {
      const me = await requireCaller(req, "ops", "admin");
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 5) throw new HttpError(400, "Write a reason");
      const { data: c } = await admin.from("checkins").select("*").eq("job_id", jobId).maybeSingle();
      if (!c) throw new HttpError(400, "The reelmaker has not tapped Reached yet");
      if (c.verified_at) throw new HttpError(409, "Already verified");
      // The 5-minute rule is enforced here, on the server.
      if (Date.now() - new Date(c.requested_at).getTime() < OPS_RELEASE_AFTER_MS) {
        throw new HttpError(409, "Wait 5 minutes after the code was requested");
      }
      await admin.from("checkins").update({
        verified_at: new Date().toISOString(), method: "ops_release",
        release_reason: reason, released_by: me.id, otp_hash: null,
      }).eq("id", c.id);
      return json({ ok: true });
    }

    case "complete": {
      const me = await requireCaller(req, "reelmaker");
      const { data: c } = await admin.from("checkins").select("*")
        .eq("job_id", jobId).eq("reelmaker_id", me.id).single();
      if (!c?.verified_at) throw new HttpError(400, "Verify the code first");
      const ids = [body.selfie_upload_id, body.location_upload_id];
      const { data: photos } = await admin.from("uploads").select("id")
        .in("id", ids).eq("job_id", jobId).eq("kind", "proof").eq("status", "complete").eq("uploaded_by", me.id);
      if ((photos?.length ?? 0) !== 2) throw new HttpError(400, "Take both live photos first");
      const completedAt = new Date().toISOString(); // server time stamp
      await admin.from("checkins").update({
        selfie_upload_id: ids[0], location_upload_id: ids[1], completed_at: completedAt,
      }).eq("id", c.id);
      await admin.from("jobs").update({ status: "reached" }).eq("id", jobId).eq("status", "accepted");
      await audit(me.id, "checkin", "jobs", jobId, { method: c.method, completed_at: completedAt });
      return json({ ok: true, completed_at: completedAt });
    }
  }
  throw new HttpError(400, "Unknown action");
});
