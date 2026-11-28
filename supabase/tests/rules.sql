-- Behaviour tests for the rules in section 10. Run with scripts/test-db.sh.
-- Each block raises if a rule is broken.
\set ON_ERROR_STOP on
set role authenticated;

-- Ops cannot read money.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ begin
  if (select count(*) from public.job_money) > 0 then raise exception 'FAIL: ops can read job_money'; end if;
  if (select count(*) from public.payments) > 0 then raise exception 'FAIL: ops can read payments'; end if;
  if (select count(*) from public.jobs_accounts) > 0 then raise exception 'FAIL: ops can read jobs_accounts'; end if;
  raise notice 'ok: ops sees no money';
end $$;

-- Reelmaker sees only their own job, and no money.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
do $$ begin
  if (select count(*) from public.jobs) <> 1 then raise exception 'FAIL: reelmaker sees % jobs', (select count(*) from public.jobs); end if;
  if (select count(*) from public.payments) > 0 then raise exception 'FAIL: reelmaker can read payments'; end if;
  raise notice 'ok: reelmaker sees own job only';
end $$;

-- Advance rule: confirming without an advance is refused.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ declare v uuid; begin
  insert into public.jobs (client_id, city, starts_at, duration_minutes, consent)
  values ('10000000-0000-0000-0000-000000000003', 'Bengaluru', now() + interval '5 days', 120, true) returning id into v;
  insert into public.job_money (job_id, agreed_amount) values (v, 12000);
  begin
    perform public.confirm_job(v);
    raise exception 'FAIL: confirmed without advance';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: advance required (%)', sqlerrm;
  end;
end $$;

-- Double booking: an overlapping assignment is refused.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ declare v uuid; begin
  insert into public.jobs (client_id, city, starts_at, duration_minutes, consent)
  select client_id, city, starts_at + interval '1 hour', 60, true from public.jobs where id = '20000000-0000-0000-0000-000000000001'
  returning id into v;
  insert into public.job_money (job_id, agreed_amount) values (v, 8000);
  insert into public.payments (job_id, amount, method, is_advance) values (v, 2000, 'cash', true);
  perform public.confirm_job(v);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  begin
    perform public.assign_job(v, '00000000-0000-0000-0000-000000000011');
    raise exception 'FAIL: overlapping assignment accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: overlap refused (%)', sqlerrm;
  end;
  perform public.assign_job(v, '00000000-0000-0000-0000-000000000012');
  raise notice 'ok: free reelmaker assigned';
end $$;

-- Price changes need admin.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ declare v uuid; begin
  insert into public.price_changes (job_id, delta, reason) values ('20000000-0000-0000-0000-000000000001', 2000, 'Extra time') returning id into v;
  begin
    perform public.decide_price_change(v, true);
    raise exception 'FAIL: sales approved a price change';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: only admin approves (%)', sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
  perform public.decide_price_change(v, true);
  if (select balance from public.job_balances where job_id = '20000000-0000-0000-0000-000000000001') <> 13500 then
    raise exception 'FAIL: balance is %', (select balance from public.job_balances where job_id = '20000000-0000-0000-0000-000000000001');
  end if;
  raise notice 'ok: balance 17500 + 2000 - 6000 = 13500';
end $$;

-- Audit log cannot be edited, even by the table owner.
reset role;
do $$ begin
  begin
    delete from public.audit_log;
    raise exception 'FAIL: audit log deleted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: audit log is append-only (% entries)', (select count(*) from public.audit_log);
  end;
end $$;

-- Sales cannot skip the workflow by writing the status column.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  begin
    update public.jobs set status = 'paid' where id = '20000000-0000-0000-0000-000000000002';
    raise exception 'FAIL: sales changed status directly';
  exception when insufficient_privilege then
    raise notice 'ok: status only changes through workflow functions';
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Migration 0004: reschedule, drop-out, extra time, price-change requests.
-- ---------------------------------------------------------------------------
set role authenticated;

-- Helper: a confirmed job (sales creates it with an advance), then ops assigns it.
create or replace function pg_temp.mk_job(p_start timestamptz, p_mins int, p_reelmaker uuid default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  insert into public.jobs (client_id, city, starts_at, duration_minutes, consent)
  values ('10000000-0000-0000-0000-000000000003', 'Bengaluru', p_start, p_mins, true) returning id into v;
  insert into public.job_money (job_id, agreed_amount) values (v, 9000);
  insert into public.payments (job_id, amount, method, is_advance) values (v, 3000, 'cash', true);
  perform public.confirm_job(v);
  if p_reelmaker is not null then
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
    perform public.assign_job(v, p_reelmaker);
  end if;
  return v;
end $$;

-- Reschedule: the booking moves with the job when the reelmaker is free.
do $$
declare
  vik constant uuid := '00000000-0000-0000-0000-000000000013';
  base timestamptz := date_trunc('day', now()) + interval '30 days 9 hours';
  a uuid; b uuid; j public.jobs; r tstzrange;
begin
  a := pg_temp.mk_job(base, 120, vik);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  j := public.reschedule_job(a, base + interval '1 day', null, 'Client asked');
  select time_range into r from public.assignments where job_id = a and status in ('pending', 'accepted');
  if lower(r) <> base + interval '1 day' then raise exception 'FAIL: booking did not move with the job'; end if;
  if j.status <> 'assigned' then raise exception 'FAIL: status is % after a clean reschedule', j.status; end if;
  raise notice 'ok: reschedule moves the booking when the reelmaker is free';

  -- Another job already holds Vikram at +40 days 09:00-11:00. Moving job A on top of it releases A's booking.
  b := pg_temp.mk_job(date_trunc('day', now()) + interval '40 days 9 hours', 120, vik);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  j := public.reschedule_job(a, date_trunc('day', now()) + interval '40 days 10 hours');
  if j.status <> 'confirmed' then raise exception 'FAIL: job is % after a clashing reschedule, expected confirmed', j.status; end if;
  if exists (select 1 from public.assignments where job_id = a and status in ('pending', 'accepted')) then
    raise exception 'FAIL: clashing booking was not released';
  end if;
  raise notice 'ok: clashing reschedule releases the booking, ops must reassign';

  -- Wrong state and wrong role.
  begin
    perform public.reschedule_job('20000000-0000-0000-0000-000000000003', now() + interval '3 days');
    raise exception 'FAIL: rescheduled a lead';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: only confirmed jobs reschedule (%)', sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
  begin
    perform public.reschedule_job(a, now() + interval '3 days');
    raise exception 'FAIL: reelmaker rescheduled';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: reelmaker cannot reschedule';
  end;
end $$;

-- Drop-out: reason required, own booking only, job returns to Confirmed.
do $$
declare
  vik constant uuid := '00000000-0000-0000-0000-000000000013';
  c uuid; s text;
begin
  c := pg_temp.mk_job(date_trunc('day', now()) + interval '50 days 9 hours', 90, vik);
  perform set_config('request.jwt.claim.sub', vik::text, false);
  begin
    perform public.drop_out(c, '   ');
    raise exception 'FAIL: dropped out without a reason';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: drop-out needs a reason';
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
  begin
    perform public.drop_out(c, 'Not mine');
    raise exception 'FAIL: another reelmaker dropped Vikram out';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: only the booked reelmaker drops out (%)', sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', vik::text, false);
  perform public.drop_out(c, 'Fever');
  -- Vikram can no longer see the job (RLS), so read the result as Operations.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  select status::text into s from public.jobs where id = c;
  if s is distinct from 'confirmed' then raise exception 'FAIL: job is % after drop-out', s; end if;
  if (select reason from public.assignments where job_id = c order by created_at desc limit 1) <> 'Dropped out: Fever' then
    raise exception 'FAIL: drop-out reason not stored';
  end if;
  raise notice 'ok: drop-out logs the reason and frees the job';

  -- Extra time is refused on a job that is not booked.
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  begin
    perform public.add_extra_time(c, 30, 'x');
    raise exception 'FAIL: extra time on an unbooked job';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: extra time needs a booked shoot';
  end;
end $$;

-- Extra time then charge, and price-change requests.
do $$
declare
  pri constant uuid := '00000000-0000-0000-0000-000000000012';
  d uuid; e public.extra_time; pc public.price_changes; asg uuid; n int;
begin
  d := pg_temp.mk_job(date_trunc('day', now()) + interval '60 days 9 hours', 120, pri);
  select id into asg from public.assignments where job_id = d and status = 'pending';
  perform set_config('request.jwt.claim.sub', pri::text, false);
  perform public.respond_assignment(asg, true);

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  begin
    perform public.add_extra_time(d, 30, 'x');
    raise exception 'FAIL: sales added extra time';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: sales cannot add extra time';
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  begin
    perform public.add_extra_time(d, 0, null);
    raise exception 'FAIL: zero minutes accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: extra minutes must be positive';
  end;
  e := public.add_extra_time(d, 45, 'Client ran over');
  if e.decision <> 'pending' or e.added_by <> '00000000-0000-0000-0000-000000000003' then
    raise exception 'FAIL: extra time row wrong (%, %)', e.decision, e.added_by;
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  perform public.decide_extra_time(e.id, true, 1500);
  select count(*) into n from public.price_changes where job_id = d and extra_time_id = e.id and status = 'pending';
  if n <> 1 then raise exception 'FAIL: charging extra time made % price changes', n; end if;
  raise notice 'ok: extra time added by ops, charged by sales, waits for admin';

  pc := public.request_price_change(d, -500, 'Goodwill discount');
  if pc.requested_by <> '00000000-0000-0000-0000-000000000002' or pc.status <> 'pending' then
    raise exception 'FAIL: price change request wrong';
  end if;
  begin
    perform public.request_price_change('20000000-0000-0000-0000-000000000003', 100, 'x');
    raise exception 'FAIL: price change on a lead';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: price change needs a confirmed job (%)', sqlerrm;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  begin
    perform public.request_price_change(d, 100, 'x');
    raise exception 'FAIL: ops requested a price change';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: ops cannot request price changes';
  end;
end $$;

-- Notices reached the right people (read as the owner, past RLS).
reset role;
do $$ begin
  if not exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-000000000003' and title in ('Reassign needed', 'Reelmaker dropped out')) then
    raise exception 'FAIL: ops was not told about the reassign or drop-out';
  end if;
  if not exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-000000000002' and title = 'Extra time to decide') then
    raise exception 'FAIL: sales was not told about the extra time';
  end if;
  if not exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-000000000001' and title = 'Price change to approve') then
    raise exception 'FAIL: admin was not told about the price change';
  end if;
  if not exists (select 1 from public.audit_log where action = 'reschedule') then raise exception 'FAIL: reschedule not audited'; end if;
  raise notice 'ok: notices and audit entries written';
end $$;

-- create_job: one step, repeat clients by phone, all-or-nothing confirmation.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$
declare j public.jobs; j2 public.jobs; n_before int; n_clients int;
begin
  j := public.create_job(
    '{"name":"Test Bakery","phone":"98765-43210","city":"Pune"}',
    jsonb_build_object('city','Pune','starts_at', (now() + interval '70 days')::text, 'duration_minutes', 90, 'consent', true),
    7000, '{"amount":2000,"method":"upi","reference":"UPI 1"}', true);
  if j.status <> 'confirmed' then raise exception 'FAIL: create_job + confirm left status %', j.status; end if;
  raise notice 'ok: create_job creates, takes the advance and confirms in one call';

  -- Same phone again (different formatting) reuses the client.
  select count(*) into n_clients from public.clients;
  j2 := public.create_job('{"name":"Someone Else","phone":"9876543210"}', '{"city":"Pune"}', null, null, false);
  if (select count(*) from public.clients) <> n_clients then raise exception 'FAIL: repeat client was duplicated'; end if;
  if j2.client_id <> j.client_id then raise exception 'FAIL: repeat client not matched by phone'; end if;
  if j2.status <> 'draft' then raise exception 'FAIL: draft job has status %', j2.status; end if;
  raise notice 'ok: repeat clients are matched by phone';

  -- Asking to confirm without an advance saves nothing.
  select count(*) into n_before from public.jobs;
  begin
    perform public.create_job('{"name":"No Advance","phone":"9000000001"}',
      jsonb_build_object('city','Pune','starts_at', (now() + interval '80 days')::text, 'duration_minutes', 60, 'consent', true),
      5000, null, true);
    raise exception 'FAIL: confirmed without an advance';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if (select count(*) from public.jobs) <> n_before then raise exception 'FAIL: a refused confirmation left a job behind'; end if;
  if exists (select 1 from public.clients where phone = '9000000001') then raise exception 'FAIL: a refused confirmation left a client behind'; end if;
  raise notice 'ok: refused confirmation rolls everything back';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  begin
    perform public.create_job('{"name":"X","phone":"9111111111"}', '{"city":"Pune"}');
    raise exception 'FAIL: ops created a job';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok: ops cannot create jobs';
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- send_back: Ops returns uploaded work to the reelmaker
-- ---------------------------------------------------------------------------
reset role;
do $$
declare v_job uuid; v_status public.job_status; n int;
begin
  select id into v_job from public.jobs where status = 'uploaded' limit 1;
  if v_job is null then
    -- Build one: a confirmed job assigned to Arjun, accepted, reached, uploaded.
    insert into public.clients (name, phone) values ('Sendback Client', '9100000321');
    insert into public.jobs (client_id, city, starts_at, duration_minutes, status, consent)
    values ((select id from public.clients where phone = '9100000321'), 'Mumbai', now() + interval '40 days', 60, 'uploaded', true)
    returning id into v_job;
    insert into public.assignments (job_id, reelmaker_id, time_range, status)
    values (v_job, '00000000-0000-0000-0000-000000000011', tstzrange(now() + interval '40 days', now() + interval '40 days 1 hour'), 'accepted');
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);  -- Sales
  set local role authenticated;
  begin
    perform public.send_back(v_job, 'Colour looks off in clip 2');
    raise exception 'FAIL: Sales sent work back';
  exception when others then
    if sqlerrm not like 'Only Operations or Admin%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);  -- Ops
  begin
    perform public.send_back(v_job, 'no');
    raise exception 'FAIL: a vague note was accepted';
  exception when others then
    if sqlerrm not like 'Tell the reelmaker%' then raise; end if;
  end;
  perform public.send_back(v_job, 'Colour looks off in clip 2');
  reset role;
  select status into v_status from public.jobs where id = v_job;
  if v_status <> 'reached' then raise exception 'FAIL: job is % after send back', v_status; end if;
  select count(*) into n from public.notifications where title = 'Changes needed' and body like '%Colour looks off%';
  if n <> 1 then raise exception 'FAIL: reelmaker was not told (% notices)', n; end if;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
  begin
    perform public.send_back(v_job, 'Second time should fail');
    raise exception 'FAIL: a reached job was sent back';
  exception when others then
    if sqlerrm not like 'Only uploaded jobs%' then raise; end if;
  end;
  reset role;
  raise notice 'ok: send_back';
end $$;

-- ---------------------------------------------------------------------------
-- A reelmaker's hours include extra time, but never the charge decision
-- ---------------------------------------------------------------------------
reset role;
do $$
declare v_job uuid; v_extra numeric; v_rows int; v_min int;
begin
  insert into public.clients (name, phone) values ('Hours Client', '9100000654');
  insert into public.jobs (client_id, city, starts_at, duration_minutes, status, consent)
  values ((select id from public.clients where phone = '9100000654'), 'Pune', now() + interval '50 days', 120, 'reached', true)
  returning id into v_job;
  insert into public.assignments (job_id, reelmaker_id, time_range, status)
  values (v_job, '00000000-0000-0000-0000-000000000011', tstzrange(now() + interval '50 days', now() + interval '50 days 2 hours'), 'accepted');
  insert into public.extra_time (job_id, minutes) values (v_job, 90);

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);  -- Arjun
  select extra_hours into v_extra from public.reelmaker_hours
   where reelmaker_id = '00000000-0000-0000-0000-000000000011'
     and month = date_trunc('month', (now() + interval '50 days') at time zone 'Asia/Kolkata')::date;
  if v_extra is distinct from 1.5 then raise exception 'FAIL: reelmaker sees % extra hours, expected 1.5', v_extra; end if;
  select count(*) into v_rows from public.extra_time;
  if v_rows <> 0 then raise exception 'FAIL: reelmaker can read extra_time rows (charge decisions)'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', true);  -- Priya, not on this job
  select public.job_extra_minutes(v_job) into v_min;
  if v_min <> 0 then raise exception 'FAIL: another reelmaker learned % extra minutes', v_min; end if;
  reset role;
  raise notice 'ok: extra hours visible to the reelmaker, charge decision not';
end $$;
