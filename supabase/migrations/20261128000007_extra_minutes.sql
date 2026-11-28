-- A reelmaker's hours include extra time, but extra_time rows also say whether it was charged,
-- which is money. This returns the minutes only, to the people who may know them.
create or replace function public.job_extra_minutes(p_job uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select case
    when public.has_role('admin', 'ops', 'sales')
      or exists (select 1 from public.assignments a where a.job_id = p_job and a.reelmaker_id = auth.uid() and a.status = 'accepted')
    then coalesce((select sum(e.minutes) from public.extra_time e where e.job_id = p_job), 0)::int
    else 0
  end
$$;
revoke execute on function public.job_extra_minutes(uuid) from public, anon;
grant execute on function public.job_extra_minutes(uuid) to authenticated;

create or replace view public.reelmaker_hours
with (security_invoker = true) as
select
  a.reelmaker_id,
  date_trunc('month', lower(a.time_range) at time zone 'Asia/Kolkata')::date as month,
  count(*)                                                                as shoots,
  sum(extract(epoch from upper(a.time_range) - lower(a.time_range)) / 3600)::numeric(8, 2) as booked_hours,
  (sum(public.job_extra_minutes(a.job_id)) / 60.0)::numeric(8, 2)         as extra_hours
from public.assignments a
where a.status = 'accepted'
group by a.reelmaker_id, 2;
