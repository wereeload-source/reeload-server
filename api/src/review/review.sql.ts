export const SEND_BACK_SQL = `select * from public.send_back($1::uuid, $2::text)`;
export const ADD_EXTRA_TIME_SQL = `select * from public.add_extra_time($1::uuid, $2::int, $3::text)`;
export const DECIDE_EXTRA_TIME_SQL = `select * from public.decide_extra_time($1::uuid, $2::boolean, $3::numeric)`;

/** Extra time with its job and client. Ops sees the minutes only; the charge decision is Sales/Admin's. */
export const LIST_EXTRA_TIME_SQL = `
select e.id, e.job_id, j.code, j.city, c.name as client_name, e.minutes, e.note, e.decision, e.created_at,
  p.full_name as added_by_name, d.full_name as decided_by_name
from public.extra_time e
join public.jobs j on j.id = e.job_id
join public.clients c on c.id = j.client_id
left join public.profiles p on p.id = e.added_by
left join public.profiles d on d.id = e.decided_by
where ($1::public.charge_decision is null or e.decision = $1::public.charge_decision)
  and ($2::uuid is null or e.job_id = $2::uuid)
order by (e.decision = 'pending') desc, e.created_at desc
limit 200`;

/** One reelmaker's accepted shoots in a month with booked and extra minutes (Admin, Ops, or the reelmaker themself). */
export const HOURS_DETAIL_SQL = `
select j.id as job_id, j.code, j.city, j.starts_at, a.status,
  extract(epoch from upper(a.time_range) - lower(a.time_range))::int / 60 as booked_minutes,
  public.job_extra_minutes(j.id) as extra_minutes
from public.assignments a join public.jobs j on j.id = a.job_id
where a.reelmaker_id = $1::uuid and a.status = 'accepted'
  and (lower(a.time_range) at time zone 'Asia/Kolkata')::date >= $2::date
  and (lower(a.time_range) at time zone 'Asia/Kolkata')::date < ($2::date + interval '1 month')
order by lower(a.time_range)`;
