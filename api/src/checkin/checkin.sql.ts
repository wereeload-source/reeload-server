/** Is this reelmaker holding the job (accepted)? Also returns where the code goes. */
export const START_CONTEXT_SQL = `
select j.id, j.code, coalesce(nullif(j.onsite_contact_phone, ''), nullif(c.whatsapp, ''), nullif(c.phone, '')) as send_to
from public.jobs j
join public.clients c on c.id = j.client_id
where j.id = $1::uuid
  and exists (select 1 from public.assignments a where a.job_id = j.id and a.reelmaker_id = $2::uuid and a.status = 'accepted')`;

export const LOCK_CHECKIN_SQL = `select * from public.checkins where job_id = $1::uuid and reelmaker_id = $2::uuid for update`;
export const LOCK_JOB_CHECKIN_SQL = `select * from public.checkins where job_id = $1::uuid for update`;

export const UPSERT_CODE_SQL = `
insert into public.checkins (job_id, reelmaker_id, otp_hash, otp_expires_at, otp_sends, otp_last_sent_at, otp_attempts)
values ($1::uuid, $2::uuid, $3::text, $4::timestamptz, 1, now(), 0)
on conflict (job_id, reelmaker_id) do update
  set otp_hash = excluded.otp_hash, otp_expires_at = excluded.otp_expires_at,
      otp_sends = public.checkins.otp_sends + 1, otp_last_sent_at = now(), otp_attempts = 0
returning otp_sends, otp_expires_at`;

export const BUMP_ATTEMPTS_SQL = `update public.checkins set otp_attempts = otp_attempts + 1 where id = $1::uuid`;

export const MARK_VERIFIED_OTP_SQL = `update public.checkins set verified_at = now(), method = 'otp', otp_hash = null where id = $1::uuid`;

export const MARK_RELEASED_SQL = `
update public.checkins set verified_at = now(), method = 'ops_release', release_reason = $2::text, released_by = $3::uuid, otp_hash = null
where id = $1::uuid`;

/** The two live photos must be this reelmaker's finished proof uploads for this job. */
export const PROOF_PHOTOS_SQL = `
select id from public.uploads
where id = any($1::uuid[]) and job_id = $2::uuid and kind = 'proof' and status = 'complete' and uploaded_by = $3::uuid`;

export const COMPLETE_CHECKIN_SQL = `
update public.checkins set selfie_upload_id = $2::uuid, location_upload_id = $3::uuid, completed_at = now()
where id = $1::uuid returning completed_at`;

export const JOB_REACHED_SQL = `update public.jobs set status = 'reached' where id = $1::uuid and status = 'accepted'`;

export const AUDIT_SQL = `select public.write_audit($1::text, $2::text, $3::text, $4::jsonb)`;

/** What the reelmaker's screen needs: where they are in the flow and when buttons come back. */
export const MY_STATE_SQL = `
select c.id, c.requested_at, c.otp_sends, c.otp_last_sent_at, c.otp_expires_at, c.otp_attempts, c.method, c.verified_at, c.completed_at
from public.checkins c where c.job_id = $1::uuid and c.reelmaker_id = $2::uuid`;

/** Operations: reelmakers who tapped Reached but are not verified yet. */
export const PENDING_CHECKINS_SQL = `
select c.id as checkin_id, c.job_id, j.code, j.city, j.starts_at, c.reelmaker_id, p.full_name as reelmaker,
  c.requested_at, c.otp_sends, c.otp_attempts, c.otp_last_sent_at
from public.checkins c
join public.jobs j on j.id = c.job_id
join public.profiles p on p.id = c.reelmaker_id
where c.verified_at is null
order by c.requested_at asc`;

/** Everything about one job's check-in for Ops (never the code or its hash). */
export const JOB_CHECKIN_SQL = `
select c.id, c.job_id, c.reelmaker_id, p.full_name as reelmaker, c.requested_at, c.otp_sends, c.otp_attempts, c.method,
  c.verified_at, c.release_reason, c.released_by, rb.full_name as released_by_name, c.completed_at,
  c.selfie_upload_id, c.location_upload_id
from public.checkins c
join public.profiles p on p.id = c.reelmaker_id
left join public.profiles rb on rb.id = c.released_by
where c.job_id = $1::uuid`;
