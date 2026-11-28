-- Workflow functions the first three migrations left out (project doc, sections 2.1 and 7):
--   reschedule_job        old slot released, new slot blocked, ops reassigns if the reelmaker is not free
--   drop_out              a reelmaker withdraws after accepting; the reason is logged and ops is told
--   add_extra_time        operations records extra time (no prices involved), sales is told to decide
--   request_price_change  any amount change after confirmation, pending until Admin approves

-- ---------------------------------------------------------------------------
-- Internal helper: in-app notice to everyone holding one of the roles.
-- Not callable from the app, only from the functions below.
-- ---------------------------------------------------------------------------
create or replace function public.notify_roles(p_roles public.app_role[], p_title text, p_body text, p_link text)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (user_id, title, body, link)
  select id, p_title, p_body, p_link from public.profiles where role = any (p_roles) and active
$$;
revoke execute on function public.notify_roles(public.app_role[], text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reschedule: Sales, Operations or Admin move a confirmed job to a new time.
-- If the assigned reelmaker is free at the new time the booking moves with the job.
-- Otherwise the old booking is released, the job goes back to Confirmed and
-- Operations is told to reassign. Sales tells the client by phone.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_job(
  p_job uuid, p_starts_at timestamptz, p_duration_minutes integer default null, p_reason text default null
)
returns public.jobs
language plpgsql security definer set search_path = public
as $$
declare
  v_job   public.jobs;
  v_old   timestamptz;
  v_range tstzrange;
  v_asg   public.assignments;
  v_moved boolean := false;
  v_when  text;
begin
  if not public.has_role('admin', 'sales', 'ops') then
    raise exception 'Only Sales, Operations or Admin can reschedule';
  end if;
  if p_starts_at is null then raise exception 'Choose the new date and time'; end if;
  if p_duration_minutes is not null and p_duration_minutes <= 0 then
    raise exception 'Duration must be more than zero';
  end if;

  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status not in ('confirmed', 'assigned', 'accepted') then
    raise exception 'Job % cannot be rescheduled while %', v_job.code, v_job.status;
  end if;

  v_old := v_job.starts_at;
  update public.jobs
     set starts_at = p_starts_at, duration_minutes = coalesce(p_duration_minutes, duration_minutes)
   where id = p_job returning * into v_job;
  v_range := tstzrange(v_job.starts_at, v_job.starts_at + make_interval(mins => v_job.duration_minutes), '[)');
  v_when  := to_char(v_job.starts_at at time zone 'Asia/Kolkata', 'DD Mon, HH24:MI');

  select * into v_asg from public.assignments
   where job_id = p_job and status in ('pending', 'accepted') for update;

  if v_asg.id is not null then
    if not exists (select 1 from public.availability
                    where reelmaker_id = v_asg.reelmaker_id and time_range && v_range) then
      begin
        update public.assignments set time_range = v_range where id = v_asg.id;
        v_moved := true;
      exception when exclusion_violation then
        v_moved := false;
      end;
    end if;

    if v_moved then
      insert into public.notifications (user_id, title, body, link)
      values (v_asg.reelmaker_id, 'Shoot rescheduled', v_job.code || ' is now ' || v_when, '/m/shoots/' || p_job);
    else
      update public.assignments
         set status = 'cancelled', reason = 'Rescheduled: reelmaker not free at the new time'
       where id = v_asg.id;
      update public.jobs set status = 'confirmed' where id = p_job returning * into v_job;
      insert into public.notifications (user_id, title, body, link)
      values (v_asg.reelmaker_id, 'Shoot moved, booking released', v_job.code || ' moved to ' || v_when, null);
      perform public.notify_roles(array['ops', 'admin']::public.app_role[], 'Reassign needed',
        v_job.code || ' moved to ' || v_when || '. The booked reelmaker is not free.', '/assign');
    end if;
  end if;

  perform public.write_audit('reschedule', 'jobs', p_job::text, jsonb_build_object(
    'code', v_job.code, 'from', v_old, 'to', v_job.starts_at, 'reason', p_reason,
    'booking_moved', v_moved, 'had_booking', v_asg.id is not null));
  return v_job;
end $$;

-- ---------------------------------------------------------------------------
-- Drop out: the assigned reelmaker withdraws before the shoot starts.
-- ---------------------------------------------------------------------------
create or replace function public.drop_out(p_job uuid, p_reason text)
returns public.assignments
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.jobs;
  v_row public.assignments;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for dropping out'; end if;

  select * into v_row from public.assignments
   where job_id = p_job and reelmaker_id = auth.uid() and status in ('pending', 'accepted') for update;
  if v_row.id is null then raise exception 'You have no live booking on this job'; end if;

  select * into v_job from public.jobs where id = p_job for update;
  if v_job.status not in ('assigned', 'accepted') then
    raise exception 'Too late to drop out of % (it is %). Call operations.', v_job.code, v_job.status;
  end if;

  update public.assignments
     set status = 'cancelled', reason = 'Dropped out: ' || btrim(p_reason), responded_at = now()
   where id = v_row.id returning * into v_row;
  update public.jobs set status = 'confirmed' where id = p_job;

  perform public.notify_roles(array['ops', 'admin']::public.app_role[], 'Reelmaker dropped out',
    v_job.code || ': ' || btrim(p_reason), '/assign');
  perform public.write_audit('drop_out', 'assignments', v_row.id::text,
    jsonb_build_object('code', v_job.code, 'reelmaker', auth.uid(), 'reason', btrim(p_reason)));
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Extra time: Operations adds hours and minutes with a note. No prices here.
-- ---------------------------------------------------------------------------
create or replace function public.add_extra_time(p_job uuid, p_minutes integer, p_note text default null)
returns public.extra_time
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.jobs;
  v_row public.extra_time;
begin
  if not public.has_role('admin', 'ops') then raise exception 'Only Operations or Admin can add extra time'; end if;
  if p_minutes is null or p_minutes <= 0 then raise exception 'Enter the extra minutes'; end if;

  select * into v_job from public.jobs where id = p_job;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status not in ('accepted', 'reached', 'uploaded', 'released') then
    raise exception 'Extra time can only be added once the shoot is booked and before it is paid (job is %)', v_job.status;
  end if;

  insert into public.extra_time (job_id, minutes, note, added_by)
  values (p_job, p_minutes, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;

  perform public.notify_roles(array['sales', 'admin']::public.app_role[], 'Extra time to decide',
    v_job.code || ': ' || p_minutes || ' min extra. Decide whether to charge.', '/jobs');
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Price change after confirmation: pending until Admin approves (decide_price_change).
-- Before confirmation, the agreed amount is edited directly on job_money.
-- ---------------------------------------------------------------------------
create or replace function public.request_price_change(p_job uuid, p_delta numeric, p_reason text)
returns public.price_changes
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.jobs;
  v_row public.price_changes;
begin
  if not public.has_role('admin', 'sales') then raise exception 'Only Sales or Admin can request a price change'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'Enter the change in amount'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for the price change'; end if;

  select * into v_job from public.jobs where id = p_job;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status in ('lead', 'draft') then
    raise exception 'Job % is not confirmed yet: edit the agreed amount instead', v_job.code;
  end if;
  if v_job.status in ('closed', 'cancelled') then
    raise exception 'Job % is %', v_job.code, v_job.status;
  end if;

  insert into public.price_changes (job_id, delta, reason, requested_by)
  values (p_job, p_delta, btrim(p_reason), auth.uid())
  returning * into v_row;

  perform public.notify_roles(array['admin']::public.app_role[], 'Price change to approve',
    v_job.code || ': ' || to_char(p_delta, 'FM999G999G990.00') || '. ' || btrim(p_reason), '/dashboard');
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Create a job in one step: client (matched by phone), job, agreed amount, advance,
-- and optionally confirm. All or nothing, so a refused confirmation saves nothing.
--   p_client  {name, phone, whatsapp?, city?}
--   p_job     {city, address?, maps_url?, starts_at?, duration_minutes?, onsite_contact_name?,
--              onsite_contact_phone?, brief?, consent?}
--   p_advance {amount, method, reference?}
-- ---------------------------------------------------------------------------
create or replace function public.create_job(
  p_client jsonb, p_job jsonb, p_agreed numeric default null, p_advance jsonb default null, p_confirm boolean default false
)
returns public.jobs
language plpgsql security definer set search_path = public
as $$
declare
  v_phone  text := regexp_replace(coalesce(p_client ->> 'phone', ''), '\D', '', 'g');
  v_client uuid;
  v_job    public.jobs;
begin
  if not public.has_role('admin', 'sales') then raise exception 'Only Sales or Admin can create jobs'; end if;
  if v_phone = '' then raise exception 'Enter the client''s phone number'; end if;
  if coalesce(btrim(p_client ->> 'name'), '') = '' then raise exception 'Enter the client''s name'; end if;
  if coalesce(btrim(p_job ->> 'city'), '') = '' then raise exception 'Enter the city'; end if;

  -- Repeat clients are matched by phone number.
  select id into v_client from public.clients where phone = v_phone;
  if v_client is null then
    insert into public.clients (name, phone, whatsapp, city, created_by)
    values (btrim(p_client ->> 'name'), v_phone,
            coalesce(nullif(regexp_replace(coalesce(p_client ->> 'whatsapp', ''), '\D', '', 'g'), ''), v_phone),
            nullif(btrim(coalesce(p_client ->> 'city', '')), ''), auth.uid())
    returning id into v_client;
  end if;

  insert into public.jobs (client_id, status, city, address, maps_url, starts_at, duration_minutes,
                           onsite_contact_name, onsite_contact_phone, brief, consent, created_by)
  values (v_client, 'draft', btrim(p_job ->> 'city'),
          nullif(btrim(coalesce(p_job ->> 'address', '')), ''),
          nullif(btrim(coalesce(p_job ->> 'maps_url', '')), ''),
          (p_job ->> 'starts_at')::timestamptz,
          (p_job ->> 'duration_minutes')::integer,
          nullif(btrim(coalesce(p_job ->> 'onsite_contact_name', '')), ''),
          nullif(regexp_replace(coalesce(p_job ->> 'onsite_contact_phone', ''), '\D', '', 'g'), ''),
          nullif(btrim(coalesce(p_job ->> 'brief', '')), ''),
          coalesce((p_job ->> 'consent')::boolean, false), auth.uid())
  returning * into v_job;

  if p_agreed is not null and p_agreed > 0 then
    insert into public.job_money (job_id, agreed_amount) values (v_job.id, p_agreed);
  end if;

  if p_advance is not null and coalesce((p_advance ->> 'amount')::numeric, 0) > 0 then
    insert into public.payments (job_id, amount, method, reference, is_advance, recorded_by)
    values (v_job.id, (p_advance ->> 'amount')::numeric, coalesce(p_advance ->> 'method', 'upi')::public.payment_method,
            nullif(btrim(coalesce(p_advance ->> 'reference', '')), ''), true, auth.uid());
  end if;

  if p_confirm then
    v_job := public.confirm_job(v_job.id);
  end if;
  return v_job;
end $$;

-- Same lock-down as 0003: signed-out visitors can call none of these.
revoke execute on function public.reschedule_job(uuid, timestamptz, integer, text) from anon;
revoke execute on function public.drop_out(uuid, text) from anon;
revoke execute on function public.add_extra_time(uuid, integer, text) from anon;
revoke execute on function public.request_price_change(uuid, numeric, text) from anon;
revoke execute on function public.create_job(jsonb, jsonb, numeric, jsonb, boolean) from anon;
