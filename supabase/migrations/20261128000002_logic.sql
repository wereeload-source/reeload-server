-- ReelOps business logic: helpers, balance, workflow functions, audit.

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so policies can call them without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.my_role() = any (roles), false)
$$;

-- True when the current user is the reelmaker on a live assignment for the job.
create or replace function public.is_my_job(p_job uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.assignments a
    where a.job_id = p_job
      and a.reelmaker_id = auth.uid()
      and a.status in ('pending', 'accepted')
  )
$$;

create or replace function public.setting_int(p_key text)
returns integer
language sql stable security definer set search_path = public
as $$
  select (value #>> '{}')::integer from public.settings where key = p_key
$$;

-- ---------------------------------------------------------------------------
-- Audit log: written by triggers, never edited or deleted
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}')
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb))
$$;

create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();

create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  -- Never copy secrets into the log.
  v_row := v_row - 'otp_hash' - 'token_hash';
  perform public.write_audit(
    lower(tg_op), tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'job_id'),
    case when tg_op = 'UPDATE'
      then jsonb_build_object('new', v_row, 'old', (to_jsonb(old) - 'otp_hash' - 'token_hash'))
      else jsonb_build_object('row', v_row) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_job_money     after insert or update or delete on public.job_money     for each row execute function public.audit_row();
create trigger audit_payments      after insert or update or delete on public.payments      for each row execute function public.audit_row();
create trigger audit_price_changes after insert or update or delete on public.price_changes for each row execute function public.audit_row();
create trigger audit_assignments   after insert or update or delete on public.assignments   for each row execute function public.audit_row();
create trigger audit_checkins      after insert or update           on public.checkins      for each row execute function public.audit_row();
create trigger audit_share_links   after insert or update           on public.share_links   for each row execute function public.audit_row();
create trigger audit_extra_time    after insert or update           on public.extra_time    for each row execute function public.audit_row();

create or replace function public.audit_job_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.write_audit('status', 'jobs', new.id::text,
      jsonb_build_object('code', new.code, 'from', old.status, 'to', new.status));
  end if;
  return new;
end $$;
create trigger audit_jobs_status after update on public.jobs for each row execute function public.audit_job_status();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();
create trigger job_money_touch before update on public.job_money for each row execute function public.touch_updated_at();

-- Agreed amount is fixed once a job is confirmed: changes go through price_changes.
create or replace function public.lock_agreed_amount()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.agreed_amount is distinct from old.agreed_amount
     and exists (select 1 from public.jobs where id = new.job_id and status not in ('lead', 'draft')) then
    raise exception 'Agreed amount is locked after confirmation. Request a price change instead.';
  end if;
  return new;
end $$;
create trigger job_money_lock before update on public.job_money for each row execute function public.lock_agreed_amount();

-- ---------------------------------------------------------------------------
-- Balance: agreed amount + approved changes - payments. Paid when <= 0.
-- ---------------------------------------------------------------------------
create or replace view public.job_balances
with (security_invoker = true) as
select
  m.job_id,
  m.agreed_amount,
  coalesce((select sum(pc.delta) from public.price_changes pc where pc.job_id = m.job_id and pc.status = 'approved'), 0) as approved_changes,
  coalesce((select sum(p.amount) from public.payments p where p.job_id = m.job_id and p.is_advance), 0) as advance,
  coalesce((select sum(p.amount) from public.payments p where p.job_id = m.job_id), 0) as received,
  m.agreed_amount
    + coalesce((select sum(pc.delta) from public.price_changes pc where pc.job_id = m.job_id and pc.status = 'approved'), 0)
    - coalesce((select sum(p.amount) from public.payments p where p.job_id = m.job_id), 0) as balance
from public.job_money m;

create or replace function public.job_balance(p_job uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(m.agreed_amount, 0)
    + coalesce((select sum(delta) from public.price_changes where job_id = p_job and status = 'approved'), 0)
    - coalesce((select sum(amount) from public.payments where job_id = p_job), 0)
  from public.job_money m where m.job_id = p_job
$$;

-- When a released job's balance reaches zero, it becomes Paid.
create or replace function public.mark_paid_if_settled()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.jobs set status = 'paid'
  where id = new.job_id and status = 'released' and public.job_balance(new.job_id) <= 0;
  return new;
end $$;
create trigger payments_settle after insert on public.payments for each row execute function public.mark_paid_if_settled();
create trigger price_changes_settle after update on public.price_changes for each row execute function public.mark_paid_if_settled();

-- ---------------------------------------------------------------------------
-- Workflow functions (called from the client with supabase.rpc)
-- ---------------------------------------------------------------------------

-- Advance rule: a job can only be confirmed when an advance payment exists.
create or replace function public.confirm_job(p_job uuid)
returns public.jobs
language plpgsql security definer set search_path = public
as $$
declare v_job public.jobs;
begin
  if not public.has_role('admin', 'sales') then raise exception 'Only Sales or Admin can confirm a job'; end if;
  select * into v_job from public.jobs where id = p_job for update;
  if v_job.id is null then raise exception 'Job not found'; end if;
  if v_job.status not in ('lead', 'draft') then raise exception 'Job % is already %', v_job.code, v_job.status; end if;
  if not v_job.consent then raise exception 'Record the client''s consent before confirming'; end if;
  if v_job.starts_at is null or v_job.duration_minutes is null then raise exception 'Set the shoot date, time and duration first'; end if;
  if not exists (select 1 from public.job_money where job_id = p_job) then raise exception 'Enter the agreed amount first'; end if;
  if not exists (select 1 from public.payments where job_id = p_job and is_advance) then
    raise exception 'An advance payment is required to confirm a job';
  end if;
  update public.jobs set status = 'confirmed', confirmed_at = now() where id = p_job returning * into v_job;
  return v_job;
end $$;

-- Operations assigns a free reelmaker. Overlaps are refused by the exclusion constraint.
create or replace function public.assign_job(p_job uuid, p_reelmaker uuid, p_reason text default null)
returns public.assignments
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.jobs;
  v_range tstzrange;
  v_row public.assignments;
begin
  if not public.has_role('admin', 'ops') then raise exception 'Only Operations or Admin can assign'; end if;
  select * into v_job from public.jobs where id = p_job for update;
  if v_job.status not in ('confirmed', 'assigned', 'accepted') then
    raise exception 'Job % cannot be assigned while %', v_job.code, v_job.status;
  end if;
  if not exists (select 1 from public.profiles where id = p_reelmaker and role = 'reelmaker' and active) then
    raise exception 'Not an active reelmaker';
  end if;
  v_range := tstzrange(v_job.starts_at, v_job.starts_at + make_interval(mins => v_job.duration_minutes), '[)');
  if exists (select 1 from public.availability where reelmaker_id = p_reelmaker and time_range && v_range) then
    raise exception 'Reelmaker is on leave at this time';
  end if;

  -- Reassignment releases the old booking first.
  update public.assignments set status = 'cancelled', reason = coalesce(p_reason, 'Reassigned')
  where job_id = p_job and status in ('pending', 'accepted');

  begin
    insert into public.assignments (job_id, reelmaker_id, time_range, assigned_by)
    values (p_job, p_reelmaker, v_range, auth.uid()) returning * into v_row;
  exception when exclusion_violation then
    raise exception 'Reelmaker already has a shoot that overlaps this time';
  end;

  update public.jobs set status = 'assigned' where id = p_job;
  insert into public.notifications (user_id, title, body, link)
  values (p_reelmaker, 'New shoot request', v_job.code || ' on ' || to_char(v_job.starts_at at time zone 'Asia/Kolkata', 'DD Mon, HH24:MI'), '/m/shoots/' || p_job);
  return v_row;
end $$;

-- Reelmaker accepts or declines.
create or replace function public.respond_assignment(p_assignment uuid, p_accept boolean, p_reason text default null)
returns public.assignments
language plpgsql security definer set search_path = public
as $$
declare v_row public.assignments;
begin
  select * into v_row from public.assignments where id = p_assignment for update;
  if v_row.reelmaker_id is distinct from auth.uid() then raise exception 'Not your assignment'; end if;
  if v_row.status <> 'pending' then raise exception 'Already answered'; end if;
  update public.assignments
     set status = case when p_accept then 'accepted' else 'declined' end::public.assignment_status,
         reason = p_reason, responded_at = now()
   where id = p_assignment returning * into v_row;
  update public.jobs set status = case when p_accept then 'accepted' else 'confirmed' end::public.job_status
   where id = v_row.job_id;
  return v_row;
end $$;

-- Sales decides whether to charge extra time; charging creates a price change for admin.
create or replace function public.decide_extra_time(p_extra uuid, p_charge boolean, p_amount numeric default null)
returns public.extra_time
language plpgsql security definer set search_path = public
as $$
declare v_row public.extra_time;
begin
  if not public.has_role('admin', 'sales') then raise exception 'Only Sales or Admin decide extra charges'; end if;
  update public.extra_time
     set decision = case when p_charge then 'charge' else 'no_charge' end::public.charge_decision,
         decided_by = auth.uid()
   where id = p_extra and decision = 'pending' returning * into v_row;
  if v_row.id is null then raise exception 'Extra time not found or already decided'; end if;
  if p_charge then
    if p_amount is null or p_amount <= 0 then raise exception 'Enter the extra amount'; end if;
    insert into public.price_changes (job_id, delta, reason, extra_time_id, requested_by)
    values (v_row.job_id, p_amount, 'Extra time ' || v_row.minutes || ' min', v_row.id, auth.uid());
  end if;
  return v_row;
end $$;

-- Admin approves or rejects a price change.
create or replace function public.decide_price_change(p_change uuid, p_approve boolean)
returns public.price_changes
language plpgsql security definer set search_path = public
as $$
declare v_row public.price_changes;
begin
  if not public.has_role('admin') then raise exception 'Only Admin can approve price changes'; end if;
  update public.price_changes
     set status = case when p_approve then 'approved' else 'rejected' end::public.approval_status,
         decided_by = auth.uid(), decided_at = now()
   where id = p_change and status = 'pending' returning * into v_row;
  if v_row.id is null then raise exception 'Price change not found or already decided'; end if;
  return v_row;
end $$;

-- Operations releases reviewed work.
create or replace function public.release_job(p_job uuid)
returns public.jobs
language plpgsql security definer set search_path = public
as $$
declare v_job public.jobs;
begin
  if not public.has_role('admin', 'ops') then raise exception 'Only Operations or Admin can release work'; end if;
  update public.jobs
     set status = case when public.job_balance(p_job) <= 0 then 'paid' else 'released' end::public.job_status,
         released_at = now()
   where id = p_job and status = 'uploaded' returning * into v_job;
  if v_job.id is null then raise exception 'Only uploaded jobs can be released'; end if;
  return v_job;
end $$;

-- Daily sales counts for the dashboard and contact log.
create or replace view public.contact_counts_today
with (security_invoker = true) as
select
  c.salesperson_id,
  p.full_name,
  count(*)                                         as spoken,
  count(*) filter (where c.outcome = 'approved')   as approved,
  count(*) filter (where c.outcome = 'rejected')   as rejected,
  count(*) filter (where c.outcome = 'follow_up')  as follow_ups
from public.contact_log c
join public.profiles p on p.id = c.salesperson_id
where c.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
group by c.salesperson_id, p.full_name;

-- Hours per reelmaker: booked duration + extra time, for accepted shoots.
create or replace view public.reelmaker_hours
with (security_invoker = true) as
select
  a.reelmaker_id,
  date_trunc('month', lower(a.time_range) at time zone 'Asia/Kolkata')::date as month,
  count(*)                                                                as shoots,
  sum(extract(epoch from upper(a.time_range) - lower(a.time_range)) / 3600)::numeric(8, 2) as booked_hours,
  coalesce(sum((select sum(e.minutes) from public.extra_time e where e.job_id = a.job_id)) / 60.0, 0)::numeric(8, 2) as extra_hours
from public.assignments a
where a.status = 'accepted'
group by a.reelmaker_id, 2;
