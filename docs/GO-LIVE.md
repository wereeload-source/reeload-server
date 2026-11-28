# Go-live and handover (build plan step 11)

## 1. Accounts to hand over

| Account | Used for | Notes |
|---|---|---|
| Neon project | Postgres database | Use the **pooled** string in `api/.env`; the **direct** string for backups. Turn on the paid plan before go-live for longer history |
| Cloudflare R2 | Private bucket `reelops-files` | API token with Object Read & Write; CORS rule: `PUT` from the app origin, expose `ETag` |
| Meta WhatsApp Business | Check-in codes | Start verification in week 1. Template below |
| Domain + hosting | App and API | See section 3 |
| GitHub | `reeload-client`, `reeload-server` | Make both repositories **private** before real data exists |

## 2. WhatsApp authentication template

Category **Authentication**, name `reelops_checkin_otp`, language English, with the "copy code" button. Body: the standard authentication text ("{{1}} is your verification code."). The API sends the code in the body and the button parameter. Until Meta approves it, use the test number; with no `WHATSAPP_TOKEN` set, the code is printed in the API log in development and refused in production.

## 3. Environment

`api/.env` (never commit): `DATABASE_URL`, `JWT_SECRET` (`openssl rand -base64 48`), `HASH_PEPPER` (`openssl rand -base64 32`, set once, **never change**: it protects open check-in codes and existing download links), `CLIENT_URL`, `R2_*`, `WHATSAPP_*`, `CRON_SECRET`.

Run the API as a long-lived Node 22 process (a small VPS with `pm2` or a container host). It needs outbound HTTPS to Neon, R2 and graph.facebook.com. Put it behind HTTPS and set `CLIENT_URL` to the app's address (CORS follows it).

## 4. First production setup

1. `scripts/migrate.sh` (no `--seed`) against the production database.
2. Create the Admin user: sign in with a temporary seeded admin on a **dev branch**, or insert one with `psql` (see `api/src/users` for the columns) and set a strong password. Never seed the demo users in production.
3. Create the real users from the Admin screen. Reelmakers need a base city.
4. Review settings (Admin): retention (raw 10, edited 20), link days 7, raw deadline 24 h, edited deadline 3 days, 48 h flag.
5. Schedule the daily clean-up: `ops/retention-sweep.workflow.yml` (GitHub Actions) or any scheduler that POSTs `/retention/sweep` with the `x-cron-secret` header at 03:00 IST.
6. Daily backup (below).

## 5. Backup and restore drill

```bash
DATABASE_URL=<direct url> scripts/backup.sh                          # writes reelops-YYYYMMDD-HHMMSS.dump
SOURCE_URL=<direct url> TARGET_URL=<empty db or Neon branch> scripts/restore-drill.sh
```

The drill restores into an empty database and checks: every table has the same row count, a user can still sign in, Ops reads no payments, and the audit log is still read-only. It passed against a local copy; **run it once against the real Neon project before go-live** and keep the date. Schedule `backup.sh` daily (cron or a GitHub Action) and store the file outside Neon. To restore for real: create an empty database, `TARGET_URL=... scripts/restore.sh <file>`, point `DATABASE_URL` at it.

## 6. Training session (one live online session, about 90 minutes)

1. 10 min: how a job flows (documentation section 4), who sees what (section 3).
2. 20 min Sales and Accounts: new job, repeat client, advance, price change request, contact log; recording payments and printing receipts.
3. 20 min Operations: queue and the 48-hour flag, candidates, assign, leave, reschedule, drop-outs; review, send back, release, extra time; creating and revoking a download link.
4. 20 min Reelmakers on their own phones: install to the home screen, accept, Reached, code, photos, upload from Photos, resume.
5. 10 min Admin: users, settings, dashboard, audit.
6. 10 min: what to do when it goes wrong (OTP does not arrive: resend twice, then call Ops; Ops releases after 5 minutes with a reason).

## 7. Pilot (2 or 3 reelmakers, real shoots)

Acceptance (documentation section 12): advance rule, assignment and blocking, OTP check-in with live photos, uploads from Photos, extra time, payment recording, download link after Paid, automatic deletion. Keep a list of every defect; defects are fixed free for 30 days after go-live.

## 8. Moving to Supabase later

The database already speaks Supabase's dialect (`auth.uid()`, roles, RLS). Run `SKIP_AUTH_STUB=1 scripts/migrate.sh` against the Supabase project (Supabase provides the `auth` schema), copy `public.*` and the users, set `DATABASE_URL` to the Supabase connection string, and change the API's login to verify against Supabase Auth, or keep API-issued tokens against the copied `auth.users` hashes. `supabase/functions/` holds the Deno edge-function versions of check-in, uploads, share links and the sweep for that phase.
