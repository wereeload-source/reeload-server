# reeload-server

Backend for **ReelOps**, the reel-shoot operations system: Postgres (Neon now, Supabase later) with Row Level Security, a NestJS API, Cloudflare R2 for files and the WhatsApp Business Cloud API for check-in codes.

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

## Where it runs now: Neon

The database is **Neon** (plain Postgres) for now; Supabase comes later. Neon has no Supabase Auth, Edge Functions or REST layer, so the **NestJS API in `api/`** is the backend:

```
Next.js client  ->  NestJS API (api/)  ->  Neon Postgres
                    login + roles          tables, Row Level Security, workflow functions
```

- **Rules stay in the database.** For every request the API runs `set local role authenticated` and sets `request.jwt.claim.sub` to the signed-in user, so Row Level Security and `confirm_job()`, `assign_job()` and friends apply exactly as they did on Supabase. The API checks roles first; the database is the stricter second line.
- **Login is the API's.** `POST /auth/login` checks the bcrypt hash in `auth.users` and returns a signed token. `db/neon/001_auth.sql` creates the `auth` schema stand-in (roles, `auth.users`, `auth.uid()`), using the same columns Supabase uses so users can move across unchanged.
- **Moving to Supabase later** is mostly changing `DATABASE_URL`: run `SKIP_AUTH_STUB=1 scripts/migrate.sh` (Supabase has its own `auth` schema) and copy `auth.users` and `public.*`. `supabase/functions/` (the Deno Edge Functions) is kept for that phase; on Neon the API does their work.

## Getting started

Needs Node 22, `psql`, and a Neon project (free plan is fine for development; use the **pooled** connection string).

```bash
# 1. Database
export DATABASE_URL='postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require'
scripts/migrate.sh --seed          # tables, security rules, workflow functions, demo users. Dev branch only.
scripts/migrate.sh                 # on production: migrations only, no demo data

# 2. API
cd api
npm install
cp .env.example .env               # DATABASE_URL, JWT_SECRET (openssl rand -base64 48), CLIENT_URL
npm run start:dev                  # http://localhost:4000   (GET /health)
```

Demo logins (password `reelops123`): `kavya@` (Admin), `rohan@` (Sales), `neha@` (Ops), `sanjay@` (Accounts), `arjun@`, `priya@`, `vikram@` (Reelmakers), all `@reelops.local`. **Change them or do not seed production.**

```bash
curl -s localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"kavya@reelops.local","password":"reelops123"}'     # -> { token, user }
curl -s localhost:4000/me -H "authorization: Bearer $TOKEN"
```

### Test it

```bash
# Database rules: runs every migration on a throwaway local Postgres and the rule tests in supabase/tests
PGHOST=localhost PGUSER=postgres scripts/test-db.sh

# Every SQL string the API uses is checked against a migrated database (tables, columns, types)
cd api && DATABASE_URL=... npm run check:sql

# API unit tests
cd api && npm test
```

## Deploying to Supabase (later phase)

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

## API reference (Steps 1–2)

All routes except `/health` and `POST /auth/login` need `Authorization: Bearer <token>`. Errors are `{ statusCode, message }`.

| Route | Roles | What it does |
|---|---|---|
| `POST /auth/login`, `GET /me`, `POST /auth/password` | any | Sign in, who am I, change own password |
| `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/password` | admin | Create, disable, change role, reset password |
| `GET /jobs`, `GET /jobs/:id` | admin, sales, ops (+ own jobs for reelmaker) | List (filter `status`, `q`, `city`, `from`, `to`) and detail. Money fields only for roles allowed to see them |
| `POST /jobs` | admin, sales | Client (matched by phone) + job + amount + advance + optional confirm, all or nothing |
| `PATCH /jobs/:id`, `PUT /jobs/:id/amount` | admin, sales | Edit details / set the agreed amount before confirmation |
| `POST /jobs/:id/confirm` | admin, sales | Refused without consent and an advance |
| `POST /jobs/:id/reschedule` | admin, sales, ops | Moves the booking; unassigns the reelmaker if they are no longer free |
| `GET /clients/lookup?phone=` | admin, sales | Repeat client by phone |
| `GET /jobs/:id/summary`, `POST /jobs/:id/advance` | admin, sales (+accounts read) | Agreed, approved changes, advance, received, balance |
| `POST /jobs/:id/price-changes`, `GET /price-changes`, `POST /price-changes/:id/decision` | sales request, admin decides | Price changes need Admin approval |
| `POST /contacts`, `GET /contacts?date=` | admin, sales | Daily contact log and counts (IST day) |

### Step 3: assigning

| Route | Roles | What it does |
|---|---|---|
| `GET /assign/queue` | admin, ops | Unassigned confirmed jobs, soonest first; `flagged` inside 48 h (setting `unassigned_flag_hours`); declined/dropped jobs return with the reason; plus jobs awaiting a reply |
| `GET /jobs/:id/candidates` | admin, ops | Active reelmakers as `free`, `busy` or `leave` for that job's time, same-city first |
| `POST /jobs/:id/assign` | admin, ops | Assign or reassign; refused on leave, on overlap (database exclusion constraint) or wrong job state |
| `GET /reelmakers` | admin, ops, sales | Reelmaker list |
| `GET/POST /leave`, `DELETE /leave/:id` | admin, ops | Leave; refused over a booked shoot |
| `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | any | Own in-app notices and unread count |

### Step 4: the reelmaker app

| Route | Roles | What it does |
|---|---|---|
| `GET /me/shoots?when=upcoming\|past\|all` | reelmaker | Own shoots (no money fields) |
| `GET /me/shoots/:jobId` | reelmaker | One shoot: address, map link, on-site contact, brief |
| `POST /me/shoots/:jobId/respond` | reelmaker | `{accept, reason}`; a decline needs a reason and the job returns to Operations |
| `POST /me/shoots/:jobId/drop-out` | reelmaker | Give back an accepted shoot with a reason; Ops and Admin are told |
| `GET /hours?month=YYYY-MM` | reelmaker (own), admin, ops | Booked and extra hours per reelmaker |

### Step 5: check-in

| Route | Roles | What it does |
|---|---|---|
| `GET /me/shoots/:jobId/checkin` | reelmaker | Which step they are on (`not_started`, `code_sent`, `photos`, `done`), sends left, seconds until resend |
| `POST /me/shoots/:jobId/checkin/start` | reelmaker | "Reached": sends a 6-digit code to the on-site contact's WhatsApp (3 sends, 60 s apart) |
| `POST /me/shoots/:jobId/checkin/verify` | reelmaker | `{code}`: 10-minute life, 5 wrong tries, then locked |
| `POST /me/shoots/:jobId/checkin/complete` | reelmaker | `{selfie_upload_id, location_upload_id}`: both live photos finished; job becomes Reached with a server time stamp |
| `GET /checkins/pending`, `GET /jobs/:id/checkin` | admin, ops | Who is waiting on a code; `release_in_seconds` counts down the 5 minutes |
| `POST /jobs/:id/checkin/release` | admin, ops | `{reason}` (5+ characters), only 5 minutes after Reached; recorded with who and why |

Codes are stored only as a salted hash (`HASH_PEPPER`). Without `WHATSAPP_TOKEN` the code is printed to the API log in development and refused in production.
