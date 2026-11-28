# Go-live and handover

For a free, shared testing copy (development mode, test check-in code) see [DEV-HOSTING.md](DEV-HOSTING.md).

What you (the owner) set up, in order. Each step says where to click and which value goes where.
Nothing here is needed for local development: `pnpm db:local` gives you a real Postgres, and check-in codes are printed in the API log.

## 1. Supabase (the Postgres database)

Supabase is used **only as the Postgres database**. Sign-in, permissions and every rule stay in the NestJS API, so Supabase Auth, Storage and Edge Functions are not used.

1. Create a project at supabase.com. Pick the region closest to your users (for India: Mumbai, `ap-south-1`). Save the **database password** in a password manager.
2. **Connection strings**: open the project and click **Connect** at the top.
   - **Transaction pooler** (port **6543**) → `DATABASE_URL` in `api/.env`.
   - **Session pooler** (port **5432**) → `DIRECT_URL` (used only by migrations).
   - Replace `[YOUR-PASSWORD]` in both, and keep `?sslmode=require` at the end.
3. **SSL certificate** (recommended): Project Settings → Database → SSL Configuration → **Download certificate**. Put its contents in `DATABASE_CA_CERT` on one line, writing `\n` where the lines break. The API then refuses to talk to anything that is not your database.
4. On the same page, turn on **Enforce SSL**.
5. **Data API**: Project Settings → Data API. Reeload does not use it, so **turn it off**. If you leave it on, the `lock_down_data_api` migration has already turned on row level security and removed access for the `anon` and `authenticated` roles, so the public anon key cannot read any table. Turning it off is still the safest choice.
6. Create the tables from your computer: `cd api && pnpm db:deploy` (with `DIRECT_URL` set). **Never run `pnpm db:seed` on production.**
7. Backups: the free plan keeps no backups you can download. Use the daily `scripts/backup.sh` (below), or the Pro plan's point-in-time recovery, before real data goes in.

## 2. WhatsApp (check-in codes)

The API sends the 6-digit check-in code to the on-site contact through the **WhatsApp Business Cloud API** (Meta), using an **authentication template**.

1. Go to developers.facebook.com → **My Apps → Create App** → type **Business**. Connect it to your **Meta Business account** (create one at business.facebook.com if you do not have one).
2. In the app, choose **Add product → WhatsApp**. Meta gives you a **test phone number** and a temporary token straight away. With those you can send to up to 5 recipient numbers you verify.
3. **Phone number ID**: WhatsApp → API Setup. Copy *Phone number ID* → `WHATSAPP_PHONE_NUMBER_ID`.
4. **Message template**: WhatsApp Manager → Message templates → **Create template**:
   - Category **Authentication**, name **`reeload_checkin_otp`**, language **English** (`en`).
   - Code delivery: **Copy code** button. Meta writes the body text itself ("{{1}} is your verification code").
   - Submit. Approval usually takes minutes to a day. The name and language must match `WHATSAPP_OTP_TEMPLATE` and `WHATSAPP_TEMPLATE_LANG`.
5. **Permanent token** (the temporary one expires after 24 hours): business.facebook.com → Business settings → Users → **System users** → Add (role Admin) → **Assign assets**: your app and your WhatsApp account, full control → **Generate new token** for the app with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`, expiry **Never** → `WHATSAPP_TOKEN`.
6. **Your real business number**: WhatsApp Manager → Phone numbers → Add phone number. The number must not be in use on the WhatsApp phone app. Complete **Business verification** (Business settings → Security center) to send beyond the test limits. Start this early: Meta can take several days.
7. Add a payment method in WhatsApp Manager. Meta charges authentication messages per message (check the current rate for India).
8. Test it: create a job with your own WhatsApp as the on-site number, assign it, sign in as the reelmaker and tap **Reached**. The code should arrive on WhatsApp. Until `WHATSAPP_TOKEN` is set, development prints the code in the API log and production refuses to send.

## 3. Cloudflare R2 (files)

1. Cloudflare dashboard → R2 → **Create bucket** `reeload-files` (private, no public access).
2. R2 → **Manage API tokens** → Create token with **Object Read & Write** on this bucket only. Copy the Access Key ID and Secret → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Your account ID → `R2_ACCOUNT_ID`.
3. Bucket → Settings → **CORS policy**:
   ```json
   [{ "AllowedOrigins": ["https://YOUR-APP-DOMAIN"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
   Without `"ExposeHeaders": ["ETag"]` large uploads fail.

## 4. Secrets and hosting

- `JWT_SECRET` and `HASH_PEPPER`: generate each with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Never change `HASH_PEPPER` once live: it would break open check-in codes and existing download links.
- **API**: a long-lived Node 22+ process (Render, Railway, Fly.io, or a small VPS with `pm2`), not serverless, because the daily clean-up runs inside it. Run **exactly one** instance. It needs outbound HTTPS to Supabase, R2 and graph.facebook.com. Set `FRONTEND_URL` to the app's origin, `JWT_SECRET` and `JWT_REFRESH_SECRET` to two different 48+ character secrets, `COOKIE_SECURE=true` (the API refuses to start in production without it), and `TRUST_PROXY=1` when it sits behind one proxy.
- **Web app**: a static site (`pnpm build` in reeload-client, upload `out/`). Build it with `NEXT_PUBLIC_API_URL` set to the API's address. Put the app and the API on the same site (e.g. `app.example.com` and `api.example.com`) with `COOKIE_SAME_SITE=lax` and `COOKIE_DOMAIN=example.com`; on different sites use `COOKIE_SAME_SITE=none` with `COOKIE_SECURE=true`.
- Serve both over HTTPS. Make both GitHub repositories **private** before real data exists.

## 5. First production setup

1. `pnpm db:deploy` against Supabase (no seed).
2. Create the first Admin with a one-off script (copy `api/src/seed/seed.ts`, keep only the admin, use a strong password), run it once, then delete it.
3. Sign in as Admin and create the real users. Reelmakers need a base city.
4. Review Settings: retention (raw 10, edited 20), link days 7, raw deadline 24 h, edited deadline 3 days, 48 h flag.
5. Schedule the daily backup (below) and run the restore drill once.

## Backup and restore drill

```bash
DATABASE_URL=<DIRECT_URL> scripts/backup.sh                         # writes reeload-YYYYMMDD-HHMMSS.dump
TARGET_URL=<an empty database> scripts/restore.sh reeload-YYYYMMDD-HHMMSS.dump
```

Restore into an empty database (a spare Supabase project, or a local `pnpm db:local`), compare row counts per table, then sign in with a real account. Do this once before go-live and note the date. Keep backups somewhere other than Supabase.

## 6. Training session (one live online session, about 90 minutes)

1. 10 min: how a job flows (documentation section 4), who sees what (section 3).
2. 20 min Sales and Accounts: new job, repeat client, advance, price change request, contact log; recording payments and printing receipts.
3. 20 min Operations: queue and the 48-hour flag, candidates, assign, leave, reschedule, drop-outs; review, send back, release, extra time; creating and revoking a download link.
4. 20 min Reelmakers on their own phones: install to the home screen, accept, Reached, code, photos, upload from Photos, resume.
5. 10 min Admin: users, settings, dashboard, audit.
6. 10 min: what to do when it goes wrong (OTP does not arrive: resend twice, then call Ops; Ops releases after 5 minutes with a reason).

## 7. Pilot (2 or 3 reelmakers, real shoots)

Acceptance (documentation section 12): advance rule, assignment and blocking, OTP check-in with live photos, uploads from Photos, extra time, payment recording, download link after Paid, automatic deletion. Keep a list of every defect; defects are fixed free for 30 days after go-live.
