# reeload-server

Backend for **ReelOps**, the reel-shoot operations system: Supabase (Postgres, Auth, Row Level Security, Edge Functions) plus Cloudflare R2 for files and the WhatsApp Business Cloud API for check-in codes.

The frontend lives in [`reeload-client`](https://github.com/wereeload-source/reeload-client).

## What is here

```
supabase/
  config.toml                 local Supabase settings
  migrations/
    ..._schema.sql            tables, enums, no-double-booking constraint
    ..._logic.sql             audit log, balance, confirm_job, assign_job, price changes, release
    ..._rls.sql               Row Level Security for every table (section 3 access matrix)
  functions/
    checkin/                  Reached → WhatsApp OTP → verify / ops release → two live photos
    uploads/                  multipart uploads straight to R2, with resume (Uppy AwsS3 compatible)
    share-links/              7-day client download links (create / revoke)
    share-link-resolve/       public: token → presigned download URLs
    retention-sweep/          daily: delete raw after 10 days, edited after 15–20
  seed.sql                    one user per role + sample jobs (password: reelops123)
  tests/rules.sql             database rule tests (access, advance, double booking, price approval, audit)
scripts/test-db.sh            runs migrations + seed + rule tests on any Postgres
```

## Rules enforced in the database

| Rule | Where |
| --- | --- |
| Ops and reelmakers never see prices | money in `job_money`, `payments`, `price_changes`, RLS limited to Admin, Sales, Accounts |
| No confirmation without an advance | `confirm_job()` |
| No double booking, no booking over leave | exclusion constraint on `assignments`, check in `assign_job()` |
| Price changes need Admin | `decide_price_change()`; agreed amount locked after confirmation |
| Balance = agreed + approved changes − payments; Paid at zero | `job_balances` view, `payments_settle` trigger |
| Audit log can't be edited or deleted | triggers on `audit_log` |
| OTP: 6 digits, hashed, 10 min, 3 sends, 60 s wait, 5 attempts, ops release after 5 min | `functions/checkin` |
| Download link only after Paid (admin earlier, logged), 7 days, revocable | `functions/share-links`, `share-link-resolve` |

## Getting started

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and Docker.

```bash
cp .env.example supabase/functions/.env   # fill in R2 and WhatsApp keys (WhatsApp optional locally: OTPs are logged)
supabase start                            # Postgres, Auth, Studio on localhost
supabase db reset                         # applies migrations + seed.sql
supabase functions serve --env-file supabase/functions/.env
```

Studio: http://localhost:54323 · API: http://localhost:54321. Copy the `anon key` printed by `supabase start` into the client's `.env.local`.

Seed logins (password `reelops123`): `kavya@` (Admin), `rohan@` (Sales), `neha@` (Ops), `sanjay@` (Accounts), `arjun@`, `priya@`, `vikram@` (Reelmakers), all `@reelops.local`.

### Test the database rules

```bash
PGHOST=localhost PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres scripts/test-db.sh
```

## Deploying

```bash
supabase link --project-ref <ref>          # Pro plan, Mumbai (ap-south-1) region
supabase db push
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy
```

R2: create a private bucket and an API token with Object Read & Write, then add a CORS rule allowing `PUT` from the app's origin and exposing the `ETag` header (needed for multipart uploads).

Schedule the retention sweep daily with `pg_cron` + `pg_net`:

```sql
select cron.schedule('retention-sweep', '30 21 * * *',  -- 03:00 IST
  $$ select net.http_post(
       url := 'https://<ref>.functions.supabase.co/retention-sweep',
       headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')) $$);
```

## Still to build (per the build plan)

- Leave requests from the reelmaker app, reschedule flow, notifications fan-out for more events
- Admin user invites (an Edge Function calling `auth.admin.inviteUserByEmail`)
- Column-level hiding of the shoot brief from Accounts (today Accounts reads jobs through `jobs_accounts`)
