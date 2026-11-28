import { QUEUE_SQL } from '../assign/assign.sql.js';
import { REVIEW_SQL } from '../uploads/uploads.sql.js';

/** Jobs per IST day with a count per status. Cancelled jobs are left out. */
export const CALENDAR_MONTH_SQL = `
with d as (
  select (j.starts_at at time zone 'Asia/Kolkata')::date as day, j.status, count(*)::int as n
  from public.jobs j
  where j.starts_at >= $1::timestamptz and j.starts_at < $2::timestamptz and j.status <> 'cancelled'
  group by 1, 2
)
select to_char(day, 'YYYY-MM-DD') as day, sum(n)::int as jobs, jsonb_object_agg(status, n) as by_status
from d group by day order by day`;

/** Everything on one IST day, in time order, with who is doing it. No money. */
export const CALENDAR_DAY_SQL = `
select j.id, j.code, j.status, j.city, j.address, j.starts_at, j.duration_minutes, c.name as client_name,
  (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'status', a.status)
     from public.assignments a join public.profiles p on p.id = a.reelmaker_id
    where a.job_id = j.id and a.status in ('pending', 'accepted') limit 1) as reelmaker
from public.jobs j join public.clients c on c.id = j.client_id
where j.starts_at >= $1::timestamptz and j.starts_at < $2::timestamptz and j.status <> 'cancelled'
order by j.starts_at`;

/** A reelmaker's own month: their shoots per day, and their leave days. */
export const MY_CALENDAR_SQL = `
select 'shoot' as kind, to_char((lower(a.time_range) at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day,
  count(*)::int as n, null::text as note
from public.assignments a
where a.reelmaker_id = auth.uid() and a.status in ('pending', 'accepted')
  and lower(a.time_range) >= $1::timestamptz and lower(a.time_range) < $2::timestamptz
group by 2
union all
select 'leave', to_char(g::date, 'YYYY-MM-DD'), 1, max(v.note)
from public.availability v
cross join lateral generate_series(
  greatest((lower(v.time_range) at time zone 'Asia/Kolkata')::date, ($1::timestamptz at time zone 'Asia/Kolkata')::date),
  least((upper(v.time_range) at time zone 'Asia/Kolkata')::date, (($2::timestamptz - interval '1 second') at time zone 'Asia/Kolkata')::date),
  interval '1 day') g
where v.reelmaker_id = auth.uid() and v.time_range && tstzrange($1::timestamptz, $2::timestamptz)
group by g
order by 2, 1`;

// ---- Dashboard (Admin) -------------------------------------------------------------------

export const DASH_STATUS_SQL = `select status, count(*)::int as n from public.jobs group by status`;
export const DASH_TODAY_SQL = `
select count(*)::int as shoots,
  (count(*) filter (where status in ('reached', 'uploaded', 'released', 'paid', 'delivered', 'closed')))::int as reached
from public.jobs where starts_at >= $1::timestamptz and starts_at < $2::timestamptz and status <> 'cancelled'`;
export const DASH_UNASSIGNED_SQL = `select count(*)::int as total, (count(*) filter (where flagged))::int as flagged from (${QUEUE_SQL}) q`;
export const DASH_CHECKINS_SQL = `select count(*)::int as waiting from public.checkins where verified_at is null`;
export const DASH_OVERDUE_SQL = `select (count(*) filter (where raw_overdue or edited_overdue))::int as overdue from (${REVIEW_SQL}) r`;
export const DASH_APPROVALS_SQL = `
select (select count(*)::int from public.price_changes where status = 'pending') as price_changes,
       (select count(*)::int from public.extra_time where decision = 'pending') as extra_time`;
export const DASH_MONEY_SQL = `
select coalesce(sum(balance) filter (where balance > 0), 0) as outstanding,
       (count(*) filter (where balance > 0))::int as jobs_owing,
       (select coalesce(sum(amount), 0) from public.payments where received_at >= $1::timestamptz and received_at < $2::timestamptz) as received_this_month
from public.jobs_accounts`;
export const DASH_CONTACTS_SQL = `
select count(*)::int as spoken,
  (count(*) filter (where outcome = 'approved'))::int as approved,
  (count(*) filter (where outcome = 'rejected'))::int as rejected,
  (count(*) filter (where outcome = 'follow_up'))::int as follow_ups
from public.contact_log where created_at >= $1::timestamptz and created_at < $2::timestamptz`;

export const AUDIT_SQL = `
select a.id, a.at, a.actor_id, p.full_name as actor_name, a.action, a.entity, a.entity_id, a.details
from public.audit_log a left join public.profiles p on p.id = a.actor_id
where ($1::text is null or a.entity = $1::text)
  and ($2::text is null or a.action = $2::text)
  and ($3::bigint is null or a.id < $3::bigint)
order by a.id desc limit $4::int`;

export const LIST_SETTINGS_SQL = `select key, value, updated_at from public.settings order by key`;
export const UPDATE_SETTING_SQL = `update public.settings set value = $2::jsonb where key = $1::text returning key, value, updated_at`;
