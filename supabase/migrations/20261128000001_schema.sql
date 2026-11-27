-- ReelOps core schema
-- Tables follow section 8 of the project documentation.
-- Money lives in its own tables (job_money, payments, price_changes) so that
-- Row Level Security can keep it away from Operations and Reelmakers.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'sales', 'ops', 'reelmaker', 'accounts');
create type public.reelmaker_kind as enum ('full_time', 'freelance');
create type public.job_status as enum (
  'lead', 'draft', 'confirmed', 'assigned', 'accepted', 'reached',
  'uploaded', 'released', 'paid', 'delivered', 'closed', 'cancelled'
);
create type public.assignment_status as enum ('pending', 'accepted', 'declined', 'cancelled');
create type public.payment_method as enum ('upi', 'bank_transfer', 'cash');
create type public.approval_status as enum ('pending', 'approved', 'rejected');
create type public.charge_decision as enum ('pending', 'charge', 'no_charge');
create type public.upload_kind as enum ('proof', 'raw', 'edited');
create type public.upload_status as enum ('uploading', 'complete', 'aborted', 'deleted');
create type public.contact_outcome as enum ('spoken', 'follow_up', 'approved', 'rejected');
create type public.checkin_method as enum ('otp', 'ops_release');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  phone       text,
  email       text,
  role        public.app_role not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.reelmakers (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  kind        public.reelmaker_kind not null default 'full_time',
  base_city   text not null,
  notes       text
);

-- ---------------------------------------------------------------------------
-- Clients and jobs
-- ---------------------------------------------------------------------------
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null unique,           -- repeat clients are matched by phone
  whatsapp    text,
  city        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

create sequence public.job_code_seq start 1001;

create table public.jobs (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique default ('RO-' || nextval('public.job_code_seq')),
  client_id             uuid not null references public.clients (id),
  status                public.job_status not null default 'draft',
  city                  text not null,
  address               text,
  maps_url              text,
  starts_at             timestamptz,
  duration_minutes      integer check (duration_minutes > 0),
  onsite_contact_name   text,
  onsite_contact_phone  text,                -- WhatsApp number the OTP goes to
  brief                 text,
  consent               boolean not null default false,
  created_by            uuid references public.profiles (id),
  confirmed_at          timestamptz,
  released_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index jobs_status_idx on public.jobs (status);
create index jobs_starts_at_idx on public.jobs (starts_at);

create table public.job_money (
  job_id         uuid primary key references public.jobs (id) on delete cascade,
  agreed_amount  numeric(12, 2) not null check (agreed_amount >= 0),
  updated_at     timestamptz not null default now()
);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  amount       numeric(12, 2) not null check (amount > 0),
  method       public.payment_method not null,
  reference    text,
  is_advance   boolean not null default false,
  received_at  timestamptz not null default now(),
  recorded_by  uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);
create index payments_job_idx on public.payments (job_id);

create table public.extra_time (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  minutes      integer not null check (minutes > 0),
  note         text,
  added_by     uuid references public.profiles (id),
  decision     public.charge_decision not null default 'pending',
  decided_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);

create table public.price_changes (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id) on delete cascade,
  delta          numeric(12, 2) not null,
  reason         text not null,
  extra_time_id  uuid references public.extra_time (id),
  status         public.approval_status not null default 'pending',
  requested_by   uuid references public.profiles (id),
  decided_by     uuid references public.profiles (id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------
create table public.assignments (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,
  reelmaker_id    uuid not null references public.profiles (id),
  time_range      tstzrange not null,
  status          public.assignment_status not null default 'pending',
  reason          text,                       -- decline / drop-out / reassign reason
  assigned_by     uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  -- No double booking: one reelmaker cannot hold two live bookings that overlap.
  constraint assignments_no_overlap exclude using gist (
    reelmaker_id with =,
    time_range with &&
  ) where (status in ('pending', 'accepted'))
);
create index assignments_job_idx on public.assignments (job_id);

create table public.availability (
  id            uuid primary key default gen_random_uuid(),
  reelmaker_id  uuid not null references public.profiles (id) on delete cascade,
  time_range    tstzrange not null,
  note          text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index availability_rm_idx on public.availability using gist (reelmaker_id, time_range);

-- ---------------------------------------------------------------------------
-- Shoot day
-- ---------------------------------------------------------------------------
create table public.uploads (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,
  kind            public.upload_kind not null,
  file_name       text not null,
  content_type    text,
  size_bytes      bigint not null check (size_bytes >= 0),
  object_key      text not null unique,
  r2_upload_id    text,                      -- S3 multipart UploadId while in progress
  status          public.upload_status not null default 'uploading',
  uploaded_by     uuid not null references public.profiles (id),
  on_behalf_of    uuid references public.profiles (id),   -- ops uploading for a reelmaker
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  deleted_at      timestamptz
);
create index uploads_job_idx on public.uploads (job_id, kind);
-- Lets a reelmaker pick the same file again and resume the same multipart upload.
create index uploads_resume_idx on public.uploads (job_id, uploaded_by, file_name, size_bytes) where status = 'uploading';

create table public.checkins (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs (id) on delete cascade,
  reelmaker_id        uuid not null references public.profiles (id),
  requested_at        timestamptz not null default now(),   -- tapped "Reached / About to start"
  otp_hash            text,
  otp_expires_at      timestamptz,
  otp_sends           integer not null default 0,
  otp_last_sent_at    timestamptz,
  otp_attempts        integer not null default 0,
  method              public.checkin_method,
  verified_at         timestamptz,
  release_reason      text,
  released_by         uuid references public.profiles (id),
  selfie_upload_id    uuid references public.uploads (id),
  location_upload_id  uuid references public.uploads (id),
  completed_at        timestamptz,                         -- server time stamp
  unique (job_id, reelmaker_id)
);

create table public.share_links (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  token_hash   text not null unique,
  include_raw  boolean not null default false,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sales, audit, notices, settings
-- ---------------------------------------------------------------------------
create table public.contact_log (
  id              uuid primary key default gen_random_uuid(),
  salesperson_id  uuid not null default auth.uid() references public.profiles (id),
  client_id       uuid references public.clients (id),
  client_name     text not null,
  phone           text,
  outcome         public.contact_outcome not null,
  note            text,
  created_at      timestamptz not null default now()
);
create index contact_log_day_idx on public.contact_log (salesperson_id, created_at);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at);

create table public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('raw_retention_days',     '10'),
  ('edited_retention_days',  '20'),   -- admin may set 15 to 20
  ('share_link_days',        '7'),
  ('share_include_raw',      'false'),
  ('raw_due_hours',          '24'),
  ('edited_due_days',        '3'),
  ('unassigned_flag_hours',  '48');
