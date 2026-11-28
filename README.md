# reeload-server

Backend for **Reeload**, the reel-shoot operations system: a NestJS API on Postgres (Supabase) through Prisma, Cloudflare R2 for files and the WhatsApp Business Cloud API for check-in codes.

The frontend lives in [`reeload-client`](https://github.com/wereeload-source/reeload-client).

## How it is built

Everything is TypeScript. The database holds **tables only**; every business rule and every permission lives in the API.

```
Next.js client  ->  NestJS API (api/)  ->  Supabase Postgres (through Prisma)
                    login, roles, rules
```

| Concern | Where |
| --- | --- |
| Tables and enums | `api/prisma/schema.prisma` (migrations in `api/prisma/migrations`) |
| Sign-in, access and refresh tokens, password hashing | `@nestjs/authentication` (`api/src/auth`, refresh tokens stored by `auth/refresh-token.store.ts`) |
| Who may do what | `@nestjs/authorization`: one `AccessPolicy` class, `api/src/access/access.policy.ts`. A route with no rule is refused |
| Who sees which rows (reelmakers only their own shoots; money only for Admin, Sales, Accounts) | the services (`jobs`, `money`, `shoots`, ...) |
| Status changes, audit log, notices | `common/workflow.service.ts`, `audit.service.ts`, `notices.service.ts` (the audit log has no update or delete method) |
| No double booking, no booking over leave | `assign/booking.service.ts`, under a Postgres advisory lock per reelmaker |
| Advance before confirmation, price changes need Admin, Paid at zero balance | `jobs`, `sales`, `money` services |
| Check-in code: 6 digits, hashed, 10 min, 3 sends, 60 s wait, 5 attempts, Ops release after 5 min | `checkin/checkin.rules.ts` and `checkin.service.ts` |
| Download links: after Paid (Admin earlier, logged), 7 days, revocable, stored hashed | `share/` |
| Daily clean-up (raw 10 days, edited 20) | `share/retention.service.ts` (`@nestjs/schedule`) |
| Settings, health, rate limiting, config | `settings/`, `@nestjs/terminus`, `@nestjs/throttler`, `@nestjs/config` (validated in `config/env.ts`) |

## Getting started

Needs Node 22+ and pnpm 10. No Docker and no cloud account are needed to develop: `pnpm db:local` runs a real Postgres on your machine.

```bash
cd api
pnpm install                       # also runs `prisma generate`
cp .env.example .env               # then set DATABASE_URL to the local one below, JWT_SECRET and HASH_PEPPER
pnpm db:local                      # terminal 1: Postgres on 127.0.0.1:54329 (leave it running)
pnpm db:deploy                     # terminal 2: creates the tables
pnpm db:seed                       # five demo accounts and three sample jobs. Never on production
pnpm start:dev                     # http://localhost:4000   (GET /health)
```

File uploads and check-in photos work locally too: `pnpm storage:local` (terminal 3) runs an S3-compatible stand-in for R2 on `http://127.0.0.1:9100`, with files in `api/.local-storage`. Set `R2_ENDPOINT=http://127.0.0.1:9100`, `R2_ACCESS_KEY_ID=local` and `R2_SECRET_ACCESS_KEY=local-secret` in `api/.env`. It checks signatures and answers CORS like the real R2 rule. The API refuses to start in production with `R2_ENDPOINT` set.

Demo logins (password `Reeload#2025`, or `SEED_PASSWORD`): `admin@`, `sales@`, `ops@`, `accounts@`, `reelmaker@` `reeload.test`. **Do not seed production.**

Production runs on **Supabase Postgres**: see [docs/GO-LIVE.md](docs/GO-LIVE.md) for the exact steps (connection strings, SSL certificate, locking down Supabase's Data API, WhatsApp and R2).

### Test it

```bash
cd api
pnpm lint && pnpm build            # oxlint (type-aware) and a full type-check
pnpm test                          # unit tests: check-in rules, signing, share links, ledger, time, job codes, throttling
pnpm test:e2e                      # every role against the real routes (needs the migrated, seeded database)
```

## Security notes

- Passwords are hashed by `@nestjs/authentication`'s `PasswordHasher` (and re-hashed automatically when its settings get stronger). They are never returned by any route; `GET /users` is covered by an e2e test for that.
- A wrong password, an unknown email and a disabled account get the same 401 and take the same time.
- Login is limited to 5 tries per 15 minutes per account and address, and 30 per address (`common/throttle.ts`).
- Access tokens last 15 minutes; refresh tokens rotate, work once, and a reused one ends the whole sign-in.
- Every route is refused unless `AccessPolicy` names a rule for it. Row rules (own shoots, money roles) live in the services.
- Bad input is a 400 with a plain message (Zod schemas on every body and query); unknown errors are logged and returned as a generic 500, never a stack trace.
- Check-in codes and download-link tokens are stored only as peppered SHA-256 hashes.
- On Supabase, migration `lock_down_data_api` turns on row level security and revokes the `anon`/`authenticated` roles, so the tables cannot be read through Supabase's public REST API. **Every new table added later needs the same** (add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` to its migration).

## Known gaps

- Not yet tried against a real Supabase project, a real R2 bucket or the real WhatsApp API (all three need your accounts; see GO-LIVE). Everything else, including every route and role, runs against a real Postgres in the e2e tests, and uploads run against the local R2 stand-in (`test/storage.e2e-spec.ts`).
- `pg` prints a deprecation warning about overlapping queries from inside Prisma's own adapter (`@prisma/adapter-pg` 7.10), not from this code. Harmless until `pg@9`; update Prisma when a fix is released.

## Still to build (per the build plan)

- Leave requests from the reelmaker app, reschedule flow, notifications fan-out for more events
- Admin user invites by email

## API reference (Steps 1–2)

All routes except `/health`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` and `GET /public/share/:token` need `Authorization: Bearer <access_token>`. Errors are `{ statusCode, message }`. Field names on the wire are `snake_case`.

| Route | Roles | What it does |
|---|---|---|
| `POST /auth/login` | public (5 tries per 15 min) | `{email, password}` returns `{access_token, refresh_token, expires_in, user}` |
| `POST /auth/refresh` | public | `{refresh_token}`: swaps it for a new pair. Each refresh token works once; a reused one ends the whole sign-in |
| `POST /auth/logout` | public | `{refresh_token}`: ends that sign-in on the server |
| `GET /me`, `POST /auth/password` | any | Who am I; change own password (signs out every other device) |
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
| `POST /jobs/:id/assign` | admin, ops | Assign or reassign; refused on leave, on overlap (checked under a per-reelmaker lock) or wrong job state |
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

### Step 6: uploads (Cloudflare R2)

Set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in `api/.env`. The bucket stays private. Add a CORS rule allowing `PUT` from the app's origin and exposing the `ETag` header (multipart uploads need it).

| Route | Roles | What it does |
|---|---|---|
| `POST /uploads` | reelmaker (accepted shoot), ops, admin | Start a multipart upload of `raw` or `edited` work, or resume the same file; Ops can set `on_behalf_of` |
| `POST /uploads/:id/sign-part`, `GET /uploads/:id/parts` | owner | Signed URL for one part; parts already stored (resume) |
| `POST /uploads/:id/complete`, `POST /uploads/:id/abort` | owner | Finish (job moves Reached to Uploaded) or cancel |
| `POST /uploads/proof` | reelmaker | One signed PUT for a live check-in photo, then `complete` |
| `GET /jobs/:id/uploads`, `GET /uploads/:id/download` | reelmaker (own), ops, admin | File list and a 15-minute download link |
| `GET /review?overdue=true` | ops, admin | Shoots with raw (24 h) and edited (3 days) deadlines, overdue first |

### Step 7: review, release, extra time, hours

| Route | Roles | What it does |
|---|---|---|
| `POST /jobs/:id/release` | admin, ops | Reviewed work released (Paid automatically if nothing is owed) |
| `POST /jobs/:id/send-back` | admin, ops | `{note}`: job returns to Reached, the reelmaker is told what to fix |
| `POST /jobs/:id/extra-time` | admin, ops | Add extra minutes; Sales and Admin are told |
| `GET /extra-time`, `POST /extra-time/:id/decision` | sales, admin (list also ops) | Charge or not; charging creates a price change Admin must approve |
| `GET /hours`, `GET /hours/:reelmakerId?month=` | admin, ops, reelmaker (own) | Booked + extra hours; the reelmaker sees extra minutes but never whether they were charged |

### Step 8: accounts

| Route | Roles | What it does |
|---|---|---|
| `GET /ledger` (+ `ledger.csv`) | admin, accounts, sales (csv: admin, accounts) | One row per job with agreed, approved changes, advance, received, balance; totals cover every match, not just the page |
| `GET /jobs/:id/payments` | admin, accounts, sales | Summary and payment history |
| `POST /jobs/:id/payments` | admin, accounts | Record a payment. Refused if it is more than the balance, or the job is unconfirmed or cancelled. A released job becomes Paid when the balance reaches zero |
| `GET /payments/:id/receipt` | admin, accounts, sales | Receipt number (`RCPT-RL-1042-AB12CD`) and everything the printable page needs |

### Step 9: client download links and clean-up

| Route | Roles | What it does |
|---|---|---|
| `POST /jobs/:id/share-links` | ops (after Paid), admin (once released, logged as `early_link`) | `{include_raw?}`; returns the link **once** (`CLIENT_URL/d/<token>`); only the token's hash is stored. Refused if there are no finished edited files. Raw files are included only if Admin allowed it in settings |
| `GET /jobs/:id/share-links`, `POST /share-links/:id/revoke` | ops, admin | Links with `active` / `expired` / `revoked`; revoke is audited |
| `GET /public/share/:token` | public | Client, job code, shoot date and 30-minute file URLs; 404 if invalid or revoked, 410 if expired (7 days, setting `share_link_days`) |
| *(scheduled, no route)* | the API itself | A `@Cron` job at 03:00 IST deletes raw files after 10 days and edited after 20 (admin setting 15 to 20). Run one API instance |

### Step 10: calendars, dashboard, audit, settings

| Route | Roles | What it does |
|---|---|---|
| `GET /calendar/month?month=YYYY-MM`, `GET /calendar/day?date=` | admin, sales, ops | Jobs per IST day with status counts; one day's shoots with client and reelmaker (no money) |
| `GET /me/calendar?month=` | reelmaker | Own shoots and leave days |
| `GET /dashboard` | admin | Jobs by status, today's shoots, unassigned (flagged), check-ins waiting, overdue uploads, pending approvals, outstanding money, received this month, sales calls today, recent activity |
| `GET /audit?entity=&action=&before=` | admin | The audit log, newest first, paged |
| `GET /settings`, `PUT /settings/:key` | any read, admin write | Retention days (edited 15 to 20), link days, raw sharing, deadlines, 48 h flag; changes are audited |
