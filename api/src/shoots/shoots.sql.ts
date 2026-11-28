/**
 * A reelmaker's own bookings. Row Level Security already limits jobs and clients to their live
 * shoots; the explicit filter keeps the list to bookings they still hold or have worked.
 * No money columns are selected here.
 */
export const MY_SHOOTS_SQL = `
select a.id as assignment_id, a.status as assignment_status, a.reason, a.responded_at,
  j.id as job_id, j.code, j.status as job_status, j.city, j.address, j.maps_url, j.starts_at, j.duration_minutes,
  j.onsite_contact_name, j.onsite_contact_phone, j.brief,
  c.name as client_name,
  (select coalesce(sum(e.minutes), 0)::int from public.extra_time e where e.job_id = j.id) as extra_minutes,
  (select to_jsonb(k) - 'otp_hash' from (select ck.id, ck.verified_at, ck.completed_at, ck.otp_sends from public.checkins ck where ck.job_id = j.id and ck.reelmaker_id = auth.uid() order by ck.requested_at desc limit 1) k) as checkin
from public.assignments a
join public.jobs j on j.id = a.job_id
join public.clients c on c.id = j.client_id
where a.reelmaker_id = auth.uid()
  and a.status in ('pending', 'accepted', 'declined')
  and (
    ($1::text = 'all' and a.status <> 'declined')
    or ($1::text = 'upcoming' and a.status in ('pending', 'accepted') and upper(a.time_range) > now() - interval '12 hours')
    or ($1::text = 'past' and a.status = 'accepted' and upper(a.time_range) <= now() - interval '12 hours')
  )
order by case when $1::text = 'past' then null else lower(a.time_range) end asc, lower(a.time_range) desc`;

export const MY_SHOOT_SQL = `
select a.id as assignment_id, a.status as assignment_status, a.reason,
  j.id as job_id, j.code, j.status as job_status, j.city, j.address, j.maps_url, j.starts_at, j.duration_minutes,
  j.onsite_contact_name, j.onsite_contact_phone, j.brief, c.name as client_name,
  (select coalesce(sum(e.minutes), 0)::int from public.extra_time e where e.job_id = j.id) as extra_minutes
from public.assignments a
join public.jobs j on j.id = a.job_id
join public.clients c on c.id = j.client_id
where a.job_id = $1::uuid and a.reelmaker_id = auth.uid() and a.status in ('pending', 'accepted')`;

export const PENDING_ASSIGNMENT_FOR_JOB_SQL = `
select id from public.assignments where job_id = $1::uuid and reelmaker_id = auth.uid() and status = 'pending'`;

export const RESPOND_SQL = `select * from public.respond_assignment($1::uuid, $2::boolean, $3::text)`;
export const DROP_OUT_SQL = `select * from public.drop_out($1::uuid, $2::text)`;

/** Booked + extra hours per month, per reelmaker. Reelmakers see only their own row. */
export const HOURS_SQL = `
select h.reelmaker_id, p.full_name, h.month, h.shoots, h.booked_hours, h.extra_hours, (h.booked_hours + h.extra_hours) as total_hours
from public.reelmaker_hours h join public.profiles p on p.id = h.reelmaker_id
where h.month = $1::date and ($2::uuid is null or h.reelmaker_id = $2::uuid)
order by p.full_name`;
