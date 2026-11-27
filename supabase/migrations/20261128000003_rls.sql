-- Row Level Security for every table, following the access matrix in section 3.
-- Writes that carry business rules (confirm, assign, check-in, uploads, links)
-- go through the functions in 0002 or through Edge Functions using the service key.

alter table public.profiles       enable row level security;
alter table public.reelmakers     enable row level security;
alter table public.clients        enable row level security;
alter table public.jobs           enable row level security;
alter table public.job_money      enable row level security;
alter table public.payments       enable row level security;
alter table public.extra_time     enable row level security;
alter table public.price_changes  enable row level security;
alter table public.assignments    enable row level security;
alter table public.availability   enable row level security;
alter table public.uploads        enable row level security;
alter table public.checkins       enable row level security;
alter table public.share_links    enable row level security;
alter table public.contact_log    enable row level security;
alter table public.audit_log      enable row level security;
alter table public.notifications  enable row level security;
alter table public.settings       enable row level security;

-- Profiles: everyone signed in sees names (needed for avatars and lists). Admin manages.
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_admin on public.profiles for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy reelmakers_read on public.reelmakers for select to authenticated
  using (public.has_role('admin', 'ops', 'accounts') or profile_id = auth.uid());
create policy reelmakers_write on public.reelmakers for all to authenticated
  using (public.has_role('admin', 'ops')) with check (public.has_role('admin', 'ops'));

-- Clients: Admin, Sales, Ops see all; reelmakers only clients of their shoots.
-- Accounts sees client names through jobs_accounts (below), not this table.
create policy clients_read on public.clients for select to authenticated
  using (
    public.has_role('admin', 'sales', 'ops')
    or exists (select 1 from public.jobs j where j.client_id = clients.id and public.is_my_job(j.id))
  );
create policy clients_write on public.clients for insert to authenticated with check (public.has_role('admin', 'sales'));
create policy clients_update on public.clients for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

-- Jobs
create policy jobs_read on public.jobs for select to authenticated
  using (public.has_role('admin', 'sales', 'ops') or public.is_my_job(id));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (public.has_role('admin', 'sales') and status in ('lead', 'draft'));
-- Sales edits details; status changes go through functions (security definer).
create policy jobs_update on public.jobs for update to authenticated
  using (public.has_role('admin', 'sales'))
  with check (public.has_role('admin', 'sales'));

-- Money: Admin, Sales, Accounts only. Ops and reelmakers never see these rows.
create policy job_money_read on public.job_money for select to authenticated
  using (public.has_role('admin', 'sales', 'accounts'));
create policy job_money_write on public.job_money for insert to authenticated
  with check (public.has_role('admin', 'sales'));
create policy job_money_update on public.job_money for update to authenticated
  using (public.has_role('admin', 'sales')) with check (public.has_role('admin', 'sales'));

create policy payments_read on public.payments for select to authenticated
  using (public.has_role('admin', 'sales', 'accounts'));
-- Sales records the advance; Accounts records every payment.
create policy payments_insert on public.payments for insert to authenticated
  with check (
    public.has_role('admin', 'accounts')
    or (public.has_role('sales') and is_advance)
  );

create policy price_changes_read on public.price_changes for select to authenticated
  using (public.has_role('admin', 'sales', 'accounts'));
create policy price_changes_insert on public.price_changes for insert to authenticated
  with check (public.has_role('admin', 'sales') and status = 'pending');

-- Extra time: Ops adds it (no prices here), Sales and Admin see it.
create policy extra_time_read on public.extra_time for select to authenticated
  using (public.has_role('admin', 'sales', 'ops'));
create policy extra_time_insert on public.extra_time for insert to authenticated
  with check (public.has_role('admin', 'ops') and decision = 'pending');

-- Assignments and availability
create policy assignments_read on public.assignments for select to authenticated
  using (public.has_role('admin', 'ops', 'sales') or reelmaker_id = auth.uid());

create policy availability_read on public.availability for select to authenticated
  using (public.has_role('admin', 'ops') or reelmaker_id = auth.uid());
create policy availability_write on public.availability for all to authenticated
  using (public.has_role('admin', 'ops')) with check (public.has_role('admin', 'ops'));

-- Files: Admin and Ops see everything, reelmakers their own uploads.
create policy uploads_read on public.uploads for select to authenticated
  using (public.has_role('admin', 'ops') or uploaded_by = auth.uid() or on_behalf_of = auth.uid());

create policy checkins_read on public.checkins for select to authenticated
  using (public.has_role('admin', 'ops') or reelmaker_id = auth.uid());

create policy share_links_read on public.share_links for select to authenticated
  using (public.has_role('admin', 'ops'));

-- Sales contact log: Admin all, Sales their own.
create policy contact_log_read on public.contact_log for select to authenticated
  using (public.has_role('admin') or (public.has_role('sales') and salesperson_id = auth.uid()));
create policy contact_log_insert on public.contact_log for insert to authenticated
  with check (public.has_role('sales', 'admin') and salesperson_id = auth.uid());

-- Audit: Admin reads. No one writes directly (triggers do) and no one edits.
create policy audit_read on public.audit_log for select to authenticated using (public.has_role('admin'));

create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_admin on public.settings for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- Edited-reel retention must stay between 15 and 20 days.
alter table public.settings add constraint settings_edited_retention_range
  check (key <> 'edited_retention_days' or ((value #>> '{}')::int between 15 and 20));

-- ---------------------------------------------------------------------------
-- Accounts view: job list with client name only (no address, brief or phone).
-- security definer view (owner bypasses RLS) gated on role inside.
-- ---------------------------------------------------------------------------
create or replace view public.jobs_accounts as
select j.id, j.code, j.status, j.starts_at, j.city, c.name as client_name,
       b.agreed_amount, b.approved_changes, b.advance, b.received, b.balance
from public.jobs j
join public.clients c on c.id = j.client_id
left join public.job_balances b on b.job_id = j.id
where public.has_role('admin', 'accounts', 'sales');

-- Lock down direct grants: anon gets nothing; the share page uses an Edge Function.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke insert, update, delete on public.audit_log from authenticated;
