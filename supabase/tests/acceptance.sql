-- Section 10 of the documentation ("Testing"), the parts the database can prove by itself.
-- Phone-only checks (camera, Photos picker, resume after a dropped connection) are in docs/TESTING.md.
\set ON_ERROR_STOP on
reset role;

-- ACCESS: every role tries every table. Ops and Reelmaker read no money; nobody but Admin reads the audit log
-- or the sales contact log of others; nobody edits the audit log.
create temp table access_expect (role_name text, rel text, may_read boolean);
insert into access_expect
select r.role_name, t.rel, t.may_read from
 (values
   ('admin',     '00000000-0000-0000-0000-000000000001'),
   ('sales',     '00000000-0000-0000-0000-000000000002'),
   ('ops',       '00000000-0000-0000-0000-000000000003'),
   ('accounts',  '00000000-0000-0000-0000-000000000004'),
   ('reelmaker', '00000000-0000-0000-0000-000000000011')) as r(role_name, uid)
cross join lateral (values
   ('job_money',     r.role_name in ('admin','sales','accounts')),
   ('payments',      r.role_name in ('admin','sales','accounts')),
   ('price_changes', r.role_name in ('admin','sales','accounts')),
   ('job_balances',  r.role_name in ('admin','sales','accounts')),
   ('audit_log',     r.role_name = 'admin'),
   ('share_links',   r.role_name in ('admin','ops'))
) as t(rel, may_read);

grant select on access_expect to authenticated;
grant select on public.profiles to authenticated;

set role authenticated;
do $$
declare
  r record; uid text; n bigint; bad text := '';
begin
  for r in select * from (values
      ('admin','00000000-0000-0000-0000-000000000001'),('sales','00000000-0000-0000-0000-000000000002'),
      ('ops','00000000-0000-0000-0000-000000000003'),('accounts','00000000-0000-0000-0000-000000000004'),
      ('reelmaker','00000000-0000-0000-0000-000000000011')) v(role_name, uid) loop
    perform set_config('request.jwt.claim.sub', r.uid, false);
    for uid in select rel from access_expect where role_name = r.role_name and not may_read loop
      execute format('select count(*) from public.%I', uid) into n;
      if n <> 0 then bad := bad || format(' %s reads %s (%s rows);', r.role_name, uid, n); end if;
    end loop;
    for uid in select rel from access_expect where role_name = r.role_name and may_read and rel in ('job_money','payments') loop
      execute format('select count(*) from public.%I', uid) into n;
      if n = 0 then bad := bad || format(' %s cannot read %s;', r.role_name, uid); end if;
    end loop;
  end loop;
  if bad <> '' then raise exception 'FAIL access matrix:%', bad; end if;
  raise notice 'ok: access matrix (5 roles x money, audit and link tables)';
end $$;

-- Nobody changes or removes audit entries, whatever their role.
do $$
declare r text;
begin
  foreach r in array array['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003'] loop
    perform set_config('request.jwt.claim.sub', r, false);
    begin
      update public.audit_log set action = 'tampered';
      raise exception 'FAIL: audit entries edited';
    exception when insufficient_privilege then null; end;
    begin
      delete from public.audit_log;
      raise exception 'FAIL: audit entries deleted';
    exception when insufficient_privilege then null; end;
  end loop;
  raise notice 'ok: audit entries cannot be edited or deleted';
end $$;
reset role;

-- Even the database owner cannot rewrite history.
do $$
begin
  begin update public.audit_log set action = 'tampered'; raise exception 'FAIL: owner edited audit'; exception when others then
    if sqlerrm like 'FAIL%' then raise; end if; end;
  begin delete from public.audit_log; raise exception 'FAIL: owner deleted audit'; exception when others then
    if sqlerrm like 'FAIL%' then raise; end if; end;
  begin truncate public.audit_log; raise exception 'FAIL: owner truncated audit'; exception when others then
    if sqlerrm like 'FAIL%' then raise; end if; end;
  raise notice 'ok: audit is immutable for the owner too';
end $$;

-- Each reelmaker sees only their own shoots and clients.
set role authenticated;
do $$
declare a bigint; b bigint; total bigint;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', false);
  select count(*) into a from public.jobs;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
  select count(*) into b from public.jobs;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
  select count(*) into total from public.jobs;
  if a >= total or b >= total then raise exception 'FAIL: a reelmaker sees every job (% / % of %)', a, b, total; end if;
  raise notice 'ok: reelmakers see only their own jobs (% and % of %)', a, b, total;
end $$;
reset role;

-- DELETION: the sweep's query picks raw at 10 days and edited at 20, counted from the shoot date.
do $$
declare v_job_old uuid; v_job_new uuid; v_raw_old uuid; v_edit_old uuid; v_edit_new uuid; found_ids uuid[];
begin
  insert into public.clients (name, phone) values ('Retention Client', '9100000987');
  insert into public.jobs (client_id, city, starts_at, duration_minutes, status, consent)
  values ((select id from public.clients where phone = '9100000987'), 'Pune', now() - interval '25 days', 60, 'delivered', true) returning id into v_job_old;
  insert into public.jobs (client_id, city, starts_at, duration_minutes, status, consent)
  values ((select id from public.clients where phone = '9100000987'), 'Pune', now() - interval '12 days', 60, 'delivered', true) returning id into v_job_new;
  insert into public.uploads (job_id, kind, file_name, size_bytes, object_key, status, uploaded_by) values
    (v_job_old, 'raw',    'a.mov', 1, 'acc/' || gen_random_uuid(), 'complete', '00000000-0000-0000-0000-000000000011') returning id into v_raw_old;
  insert into public.uploads (job_id, kind, file_name, size_bytes, object_key, status, uploaded_by) values
    (v_job_old, 'edited', 'a.mp4', 1, 'acc/' || gen_random_uuid(), 'complete', '00000000-0000-0000-0000-000000000011') returning id into v_edit_old;
  insert into public.uploads (job_id, kind, file_name, size_bytes, object_key, status, uploaded_by) values
    (v_job_new, 'edited', 'b.mp4', 1, 'acc/' || gen_random_uuid(), 'complete', '00000000-0000-0000-0000-000000000011') returning id into v_edit_new;
  -- same predicate as EXPIRED_FILES_SQL
  select array_agg(u.id) into found_ids from public.uploads u join public.jobs j on j.id = u.job_id
   where u.kind = 'raw' and u.status = 'complete' and j.starts_at < now() - make_interval(days => 10);
  if not v_raw_old = any(found_ids) then raise exception 'FAIL: 25-day-old raw not due'; end if;
  select array_agg(u.id) into found_ids from public.uploads u join public.jobs j on j.id = u.job_id
   where u.kind = 'edited' and u.status = 'complete' and j.starts_at < now() - make_interval(days => 20);
  if not v_edit_old = any(found_ids) or v_edit_new = any(found_ids) then raise exception 'FAIL: edited retention wrong'; end if;
  raise notice 'ok: raw due at 10 days, edited at 20';
  delete from public.uploads where job_id in (v_job_old, v_job_new);
  delete from public.jobs where id in (v_job_old, v_job_new);
  delete from public.clients where phone = '9100000987';
end $$;
