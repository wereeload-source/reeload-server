-- A disabled user must see nothing, even holding a valid token and a live booking.
-- is_my_job() is what lets a reelmaker read their own job and client; it did not check `active`.
create or replace function public.is_my_job(p_job uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.assignments a
    join public.profiles p on p.id = a.reelmaker_id and p.active
    where a.job_id = p_job
      and a.reelmaker_id = auth.uid()
      and a.status in ('pending', 'accepted')
  )
$$;
