/**
 * Confirmed jobs with nobody holding them, soonest first. `flagged` is true when the shoot is
 * closer than the "unassigned_flag_hours" setting (48 by default). A job a reelmaker declined or
 * dropped out of comes back here with the reason.
 */
export const QUEUE_SQL = `
select j.id, j.code, j.status, j.city, j.address, j.starts_at, j.duration_minutes, c.name as client_name,
  (j.starts_at is not null and j.starts_at < now() + make_interval(hours => public.setting_int('unassigned_flag_hours'))) as flagged,
  extract(epoch from (j.starts_at - now())) / 3600 as hours_to_start,
  (select jsonb_build_object('reelmaker', p.full_name, 'status', a.status, 'reason', a.reason, 'at', coalesce(a.responded_at, a.created_at))
     from public.assignments a join public.profiles p on p.id = a.reelmaker_id
    where a.job_id = j.id and a.status in ('declined', 'cancelled')
    order by coalesce(a.responded_at, a.created_at) desc limit 1) as last_release
from public.jobs j
join public.clients c on c.id = j.client_id
where j.status = 'confirmed'
  and not exists (select 1 from public.assignments a where a.job_id = j.id and a.status in ('pending', 'accepted'))
order by j.starts_at asc nulls last`;

/** Jobs already assigned but not yet accepted, so Ops can chase them. */
export const AWAITING_SQL = `
select j.id, j.code, j.city, j.starts_at, c.name as client_name, a.id as assignment_id, a.reelmaker_id, p.full_name as reelmaker, a.created_at as assigned_at
from public.assignments a
join public.jobs j on j.id = a.job_id
join public.clients c on c.id = j.client_id
join public.profiles p on p.id = a.reelmaker_id
where a.status = 'pending' and j.status = 'assigned'
order by j.starts_at asc nulls last`;

/**
 * Every active reelmaker with how they stand for one job's time: free, busy (another shoot
 * overlaps), or on leave. Free reelmakers in the job's city come first.
 */
export const CANDIDATES_SQL = `
with job as (
  select id, city, tstzrange(starts_at, starts_at + make_interval(mins => duration_minutes), '[)') as span
  from public.jobs where id = $1::uuid
)
select p.id, p.full_name, p.phone, r.kind, r.base_city,
  (lower(r.base_city) = lower(job.city)) as same_city,
  case
    when exists (select 1 from public.availability v where v.reelmaker_id = p.id and v.time_range && job.span) then 'leave'
    when exists (select 1 from public.assignments a where a.reelmaker_id = p.id and a.status in ('pending', 'accepted') and a.time_range && job.span and a.job_id <> job.id) then 'busy'
    else 'free'
  end as availability,
  (select count(*)::int from public.assignments a where a.reelmaker_id = p.id and a.status in ('pending', 'accepted')
      and lower(a.time_range) >= date_trunc('day', now()) and lower(a.time_range) < date_trunc('day', now()) + interval '7 days') as shoots_next_7_days
from job, public.profiles p
join public.reelmakers r on r.profile_id = p.id
where p.role = 'reelmaker' and p.active
order by (case
    when exists (select 1 from public.availability v where v.reelmaker_id = p.id and v.time_range && job.span) then 2
    when exists (select 1 from public.assignments a where a.reelmaker_id = p.id and a.status in ('pending', 'accepted') and a.time_range && job.span and a.job_id <> job.id) then 1
    else 0 end),
  (lower(r.base_city) = lower(job.city)) desc, p.full_name`;

export const ASSIGN_SQL = `select * from public.assign_job($1::uuid, $2::uuid, $3::text)`;

export const REELMAKERS_SQL = `
select p.id, p.full_name, p.phone, p.active, r.kind, r.base_city
from public.profiles p join public.reelmakers r on r.profile_id = p.id
where p.role = 'reelmaker' and ($1::boolean or p.active)
order by p.full_name`;

export const LIST_LEAVE_SQL = `
select v.id, v.reelmaker_id, p.full_name, lower(v.time_range) as starts_at, upper(v.time_range) as ends_at, v.note, v.created_at
from public.availability v join public.profiles p on p.id = v.reelmaker_id
where ($1::uuid is null or v.reelmaker_id = $1::uuid)
  and (not $2::boolean or upper(v.time_range) > now())
order by lower(v.time_range)
limit 300`;

/** Leave over a booked shoot is refused, so Ops resolves the shoot first. */
export const CLASHING_SHOOTS_SQL = `
select j.code, a.status from public.assignments a join public.jobs j on j.id = a.job_id
where a.reelmaker_id = $1::uuid and a.status in ('pending', 'accepted')
  and a.time_range && tstzrange($2::timestamptz, $3::timestamptz, '[)')`;

export const INSERT_LEAVE_SQL = `
insert into public.availability (reelmaker_id, time_range, note, created_by)
values ($1::uuid, tstzrange($2::timestamptz, $3::timestamptz, '[)'), $4::text, auth.uid())
returning id, reelmaker_id, lower(time_range) as starts_at, upper(time_range) as ends_at, note`;

export const DELETE_LEAVE_SQL = `delete from public.availability where id = $1::uuid returning id`;
