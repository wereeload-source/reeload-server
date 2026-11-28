/** May this user put files on this job? Ops and Admin always; a reelmaker only on a shoot they accepted. */
export const CAN_UPLOAD_SQL = `
select j.id, j.status from public.jobs j
where j.id = $1::uuid
  and ($3::boolean or exists (select 1 from public.assignments a where a.job_id = j.id and a.reelmaker_id = $2::uuid and a.status = 'accepted'))`;

export const IS_REELMAKER_SQL = `select 1 as ok from public.profiles where id = $1::uuid and role = 'reelmaker' and active`;

/** Choosing the same file again resumes the unfinished upload. */
export const OPEN_UPLOAD_SQL = `
select * from public.uploads
where job_id = $1::uuid and uploaded_by = $2::uuid and file_name = $3::text and size_bytes = $4::bigint and status = 'uploading' and kind <> 'proof'`;

export const INSERT_UPLOAD_SQL = `
insert into public.uploads (job_id, kind, file_name, size_bytes, content_type, object_key, r2_upload_id, uploaded_by, on_behalf_of)
values ($1::uuid, $2::public.upload_kind, $3::text, $4::bigint, $5::text, $6::text, $7::text, $8::uuid, $9::uuid)
returning id`;

export const INSERT_PROOF_SQL = `
insert into public.uploads (job_id, kind, file_name, size_bytes, content_type, object_key, uploaded_by)
values ($1::uuid, 'proof', $2::text, $3::bigint, 'image/jpeg', $4::text, $5::uuid)
returning id`;

export const GET_UPLOAD_SQL = `select * from public.uploads where id = $1::uuid for update`;

export const COMPLETE_UPLOAD_SQL = `
update public.uploads set status = 'complete', completed_at = now(), r2_upload_id = null,
  size_bytes = case when $2::bigint > 0 then $2::bigint else size_bytes end
where id = $1::uuid`;
export const ABORT_UPLOAD_SQL = `update public.uploads set status = 'aborted' where id = $1::uuid`;

/** Raw or edited work arrived: the job moves from Reached to Uploaded (Ops may also upload for an accepted shoot). */
export const JOB_UPLOADED_SQL = `
update public.jobs set status = 'uploaded'
where id = $1::uuid and (status = 'reached' or ($2::boolean and status = 'accepted'))`;

export const AUDIT_SQL = `select public.write_audit($1::text, $2::text, $3::text, $4::jsonb)`;

/** Files on a job. Row Level Security limits reelmakers to their own. */
export const LIST_UPLOADS_SQL = `
select u.id, u.kind, u.file_name, u.content_type, u.size_bytes, u.status, u.created_at, u.completed_at,
  u.uploaded_by, p.full_name as uploaded_by_name, u.on_behalf_of, ob.full_name as on_behalf_of_name
from public.uploads u
join public.profiles p on p.id = u.uploaded_by
left join public.profiles ob on ob.id = u.on_behalf_of
where u.job_id = $1::uuid and u.status in ('uploading', 'complete') and ($2::boolean or u.kind <> 'proof')
order by u.created_at`;

export const DOWNLOAD_UPLOAD_SQL = `select id, job_id, object_key, file_name, status, kind from public.uploads where id = $1::uuid and status = 'complete'`;

/**
 * Ops review: shoots that have started and still have work to check, with raw and edited
 * deadlines. Raw is due raw_due_hours after the shoot ends, edited edited_due_days after.
 */
export const REVIEW_SQL = `
with due as (
  select j.id, j.code, j.status, j.city, j.starts_at, c.name as client_name,
    j.starts_at + make_interval(mins => j.duration_minutes) as ends_at,
    j.starts_at + make_interval(mins => j.duration_minutes) + make_interval(hours => public.setting_int('raw_due_hours')) as raw_due,
    j.starts_at + make_interval(mins => j.duration_minutes) + make_interval(days => public.setting_int('edited_due_days')) as edited_due,
    (select count(*) from public.uploads u where u.job_id = j.id and u.kind = 'raw' and u.status = 'complete') as raw_files,
    (select count(*) from public.uploads u where u.job_id = j.id and u.kind = 'edited' and u.status = 'complete') as edited_files,
    (select p.full_name from public.assignments a join public.profiles p on p.id = a.reelmaker_id where a.job_id = j.id and a.status = 'accepted' limit 1) as reelmaker
  from public.jobs j join public.clients c on c.id = j.client_id
  where j.status in ('accepted', 'reached', 'uploaded')
    and j.starts_at is not null
)
select *, (raw_files = 0 and raw_due < now()) as raw_overdue, (edited_files = 0 and edited_due < now()) as edited_overdue
from due
where not $1::boolean or (raw_files = 0 and raw_due < now()) or (edited_files = 0 and edited_due < now())
order by (raw_files = 0 and raw_due < now()) or (edited_files = 0 and edited_due < now()) desc, starts_at`;
