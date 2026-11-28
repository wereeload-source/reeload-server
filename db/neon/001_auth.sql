-- Stand-in for Supabase's `auth` schema, for running on plain Postgres (Neon).
--
-- The ReelOps migrations were written for Supabase: they use the roles `anon`, `authenticated`
-- and `service_role`, the table `auth.users`, and the function `auth.uid()`. This file gives plain
-- Postgres the same shape, so Row Level Security and the workflow functions work unchanged:
--
--   * the API connects as the database owner,
--   * for each request it runs:  set local role authenticated;
--                                select set_config('request.jwt.claim.sub', '<user id>', true);
--   * auth.uid() reads that setting, exactly as it does on Supabase.
--
-- DO NOT run this on Supabase: it already has all of this. When ReelOps moves to Supabase, skip
-- this file (scripts/migrate.sh does so with SKIP_AUTH_STUB=1) and copy the users across.

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- service_role is only here to match Supabase; the API itself connects as the owner.
    -- BYPASSRLS needs a privilege some managed Postgres plans withhold, so fall back without it.
    begin
      create role service_role nologin bypassrls;
    exception when insufficient_privilege then
      create role service_role nologin;
    end;
  end if;
end $$;

-- The connecting role must be allowed to `set role authenticated`. Explicit, because on
-- Postgres 16 a role that creates another role is not automatically allowed to switch to it.
do $$ begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
end $$;

create schema if not exists auth;

-- Same columns Supabase uses, so users and their bcrypt password hashes can move across unchanged.
create table if not exists auth.users (
  id                  uuid primary key,
  instance_id         uuid,
  aud                 text,
  role                text,
  email               text,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  created_at          timestamptz,
  updated_at          timestamptz,
  raw_app_meta_data   jsonb,
  raw_user_meta_data  jsonb
);
create unique index if not exists users_email_lower_idx on auth.users (lower(email));

-- The signed-in user, set per request by the API.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
