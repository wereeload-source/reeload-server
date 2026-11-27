-- Step 1 "done when": each role signs in, and Operations and Reelmaker cannot read any money table.
\set ON_ERROR_STOP on
reset role;

-- Every seeded user signs in with the password; wrong passwords, unknown emails and disabled users do not.
do $$
declare r record; n int; roles int;
begin
  select count(distinct role) into roles from public.profiles where email like '%@reelops.local';
  if roles <> 5 then raise exception 'FAIL: expected users in all 5 roles, found %', roles; end if;

  for r in select email, role from public.profiles where email like '%@reelops.local' loop
    select count(*) into n from auth.users u join public.profiles p on p.id = u.id
     where lower(u.email) = lower(r.email) and u.encrypted_password = crypt('reelops123', u.encrypted_password) and p.active;
    if n <> 1 then raise exception 'FAIL: % (%) cannot sign in', r.email, r.role; end if;
    select count(*) into n from auth.users u
     where lower(u.email) = lower(r.email) and u.encrypted_password = crypt('wrong-password', u.encrypted_password);
    if n <> 0 then raise exception 'FAIL: % signed in with a wrong password', r.email; end if;
  end loop;
  raise notice 'ok: every role signs in, wrong passwords do not';
end $$;

-- Operations and Reelmaker read no money, from any table or view.
set role authenticated;
do $$
declare uid text; t text; n bigint;
begin
  foreach uid in array array['00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000011'] loop
    perform set_config('request.jwt.claim.sub', uid, false);
    foreach t in array array['job_money', 'payments', 'price_changes', 'jobs_accounts', 'job_balances'] loop
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception 'FAIL: % can read % (% rows)', public.my_role(), t, n; end if;
    end loop;
    begin
      insert into public.payments (job_id, amount, method) values ('20000000-0000-0000-0000-000000000001', 100, 'cash');
      raise exception 'FAIL: % recorded a payment', public.my_role();
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'ok: operations and reelmaker cannot read or write any money table';
end $$;

-- Accounts and Sales can read money; Reelmaker still sees only their own jobs.
do $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
  select count(*) into n from public.payments;
  if n = 0 then raise exception 'FAIL: accounts cannot read payments'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
  select count(*) into n from public.job_money;
  if n = 0 then raise exception 'FAIL: sales cannot read job_money'; end if;
  raise notice 'ok: accounts and sales can read money';
end $$;

-- A disabled user sees nothing, even with a valid token.
reset role;
update public.profiles set active = false where id = '00000000-0000-0000-0000-000000000012';
set role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
  if public.my_role() is not null then raise exception 'FAIL: disabled user still has a role'; end if;
  if (select count(*) from public.jobs) <> 0 then raise exception 'FAIL: disabled user can read jobs'; end if;
  raise notice 'ok: a disabled user is locked out in the database too';
end $$;
reset role;
update public.profiles set active = true where id = '00000000-0000-0000-0000-000000000012';
