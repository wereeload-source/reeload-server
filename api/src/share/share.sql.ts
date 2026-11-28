export const JOB_FOR_LINK_SQL = `select id, code, status from public.jobs where id = $1::uuid for update`;

/** Finished files the link would show; a link with nothing behind it is refused. */
export const SHAREABLE_COUNT_SQL = `
select count(*)::int as n from public.uploads
where job_id = $1::uuid and status = 'complete' and kind = any($2::public.upload_kind[])`;

export const INSERT_LINK_SQL = `
insert into public.share_links (job_id, token_hash, include_raw, expires_at, created_by)
values ($1::uuid, $2::text, $3::boolean, now() + make_interval(days => $4::int), $5::uuid)
returning id, expires_at`;

export const JOB_DELIVERED_SQL = `update public.jobs set status = 'delivered' where id = $1::uuid and status = 'paid'`;
export const AUDIT_SQL = `select public.write_audit($1::text, $2::text, $3::text, $4::jsonb)`;

export const LIST_LINKS_SQL = `
select l.id, l.include_raw, l.expires_at, l.revoked_at, l.created_at, p.full_name as created_by_name
from public.share_links l left join public.profiles p on p.id = l.created_by
where l.job_id = $1::uuid order by l.created_at desc`;

export const REVOKE_LINK_SQL = `update public.share_links set revoked_at = now() where id = $1::uuid and revoked_at is null returning id, job_id`;

/** Public page: the link, its job and the client's name (looked up by token hash). */
export const RESOLVE_LINK_SQL = `
select l.id, l.job_id, l.include_raw, l.expires_at, l.revoked_at, j.code, j.starts_at, c.name as client_name
from public.share_links l join public.jobs j on j.id = l.job_id join public.clients c on c.id = j.client_id
where l.token_hash = $1::text`;

export const LINK_FILES_SQL = `
select id, kind, file_name, size_bytes, object_key from public.uploads
where job_id = $1::uuid and status = 'complete' and kind = any($2::public.upload_kind[]) order by kind desc, created_at`;

/** Files past their retention, oldest first. The cut-off is counted from the shoot date. */
export const EXPIRED_FILES_SQL = `
select u.id, u.object_key, u.r2_upload_id, u.status
from public.uploads u join public.jobs j on j.id = u.job_id
where u.kind = $1::public.upload_kind and u.status in ('complete', 'uploading', 'aborted')
  and j.starts_at < now() - make_interval(days => $2::int)
order by j.starts_at limit 500`;

export const MARK_DELETED_SQL = `update public.uploads set status = 'deleted', deleted_at = now(), r2_upload_id = null where id = $1::uuid`;

export const SETTING_SQL = `select public.setting_int($1::text) as value`;
export const SETTING_BOOL_SQL = `select (value #>> '{}') = 'true' as value from public.settings where key = $1::text`;
