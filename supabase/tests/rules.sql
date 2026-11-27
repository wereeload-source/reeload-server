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
