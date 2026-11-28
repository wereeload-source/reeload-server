# Hosted development environment (free tiers)

A shared, internet-reachable copy of Reeload for testing, on free plans. It runs the API in **development mode**, so WhatsApp is not needed and the check-in code `111111` always works. It is not for real client data: when that day comes, follow [GO-LIVE.md](GO-LIVE.md) instead (production mode, WhatsApp, backups).

```
 browser ──► Vercel (static site, reeload-client)
                │  /api/*  is forwarded by vercel.json
                ▼
             Render (NestJS API, reeload-server/api) ──► Supabase Postgres
                                                     └─► Cloudflare R2 (files)
```

The browser only ever talks to the Vercel address, so the sign-in cookies are first-party and no cross-site cookie settings are needed.

## Accounts to create (in this order)

| # | Account | Used for | Free plan limits to know |
|---|---|---|---|
| 1 | **GitHub** (the two repos, set to **private**) | Source for Vercel and Render | none |
| 2 | **Supabase** | Postgres database | Project pauses after about 7 days without use (one click to resume); no downloadable backups |
| 3 | **Cloudflare** (R2) | Raw, edited and proof files | 10 GB free; needs a payment card on file to enable R2 |
| 4 | **Render** | The API | A free web service sleeps after 15 minutes idle: the first request after that takes about a minute. The daily file clean-up only runs while it is awake |
| 5 | **Vercel** (Hobby) | The static web app | Personal, non-commercial use only |
| later | Meta WhatsApp Business | Real check-in codes | Not needed in development |

## Step 1: push the code

Both repos need a commit and a push first (nothing is committed yet). Merge or choose the branch you want to deploy:
- `reeload-server`: `feat/refresh-cookie-static-client`
- `reeload-client`: `ui/sidebar-shell-and-components`

## Step 2: Supabase (database)

1. New project, region Mumbai (`ap-south-1`) for India. Save the database password.
2. **Connect** → copy both strings, put your password in, keep `?sslmode=require`:
   - Transaction pooler (port 6543) → `DATABASE_URL`
   - Session pooler (port 5432) → `DIRECT_URL`
3. Project Settings → Data API → turn it **off** (Reeload does not use it).
4. Create the tables from your computer: in `reeload-server/api`, set `DIRECT_URL` and run `pnpm db:deploy`.
5. Add the demo accounts (this is a *development* database, so seeding is fine). **Set your own password first**, because this site will be on the internet:
   ```powershell
   $env:SEED_PASSWORD = "<a password only you know>"
   pnpm db:seed
   ```
   It needs the same env as the API (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`) in `api/.env`. Use a **separate `.env` or inline variables** so your local `.env` keeps pointing at the local database.

## Step 3: Cloudflare R2 (files)

1. R2 → Create bucket `reeload-files` (private).
2. R2 → Manage API tokens → Object Read & Write on that bucket. Keep the Access Key ID, Secret and your Account ID.
3. Bucket → Settings → CORS policy (replace the origin after Step 5 with your Vercel address):
   ```json
   [{ "AllowedOrigins": ["https://<your-app>.vercel.app"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```
   `ExposeHeaders: ETag` is required or large uploads fail.

## Step 4: Render (API)

New **Web Service** from the `reeload-server` repo.
- Root directory: `api`
- Build command: `pnpm install --frozen-lockfile && pnpm build`
- Start command: `pnpm start:prod`
- Instance type: Free. Run exactly **one** instance.

Environment variables:

```
NODE_ENV=development
PORT=10000                      # or leave unset: Render provides it
DATABASE_URL=<Supabase transaction pooler string, port 6543>
JWT_SECRET=<48+ random characters>
JWT_REFRESH_SECRET=<a different 48+ random characters>
HASH_PEPPER=<random, set once and never change>
FRONTEND_URL=https://<your-app>.vercel.app
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
TRUST_PROXY=2                   # Render's proxy + Vercel's: confirm in Test 3 below
CHECKIN_TEST_CODE=111111        # development only: code 111111 always passes the check-in code screen
R2_ACCOUNT_ID=...  R2_BUCKET=reeload-files  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...
DATABASE_CA_CERT=<optional: Supabase SSL certificate>
```

Generate each secret with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Leave the WhatsApp keys empty: codes are written to the Render log instead of being sent.

When it is live, `https://<api>.onrender.com/health` must answer 200.

## Step 5: Vercel (web app)

1. Edit `reeload-client/vercel.json`: replace only `YOUR-API-HOST` with your Render host (for example `reeload-api.onrender.com`). The destination keeps its `https://` and has no trailing slash. Commit and push.
2. Import the client repo in Vercel (framework Next.js is detected).
3. Environment variable: `NEXT_PUBLIC_API_URL=/api`.
4. Deploy. Then put the real Vercel address into Render's `FRONTEND_URL` and R2's CORS policy, and redeploy the API.

## Test plan

Run these in order on the hosted environment. A test passes only if the whole path works, not just the page opens.

**A. Wiring (10 min)**
1. `/health` on the API answers 200; opening the app address shows the sign-in page.
2. Sign in as Admin. In the browser tools, the cookies `access_token` and `refresh_token` exist with HttpOnly and Secure, and `document.cookie` shows neither.
3. Sign in as Sales and check Render's log shows each person's own address (not the same one for everybody). If it shows one address, change `TRUST_PROXY` (try 1, 2, 3) until it does.
4. Reload the page: still signed in. Sign out: the next page load goes to sign-in.
5. Silent refresh: set `ACCESS_TOKEN_TTL=60s` on Render once, sign in, wait two minutes, click a menu link. It must load without signing you out. Put it back to `15m`.

**B. One job from start to finish (30 min)** (one browser per role, or sign out between)
1. **Sales:** New client with an advance and consent, confirm it. The list, search and the filters work.
2. **Ops:** the client appears under Unassigned, assign it to the reelmaker, add and remove a leave day.
3. **Reelmaker (on a phone):** accept the request, tap Reached, type a wrong code (error, boxes clear), then `111111`. The camera step opens: allow the camera, take both photos, Check in.
4. **Reelmaker:** upload a raw file from Photos (use one larger than 8 MB to test multi-part), then an edited one. Interrupt and resume once.
5. **Ops:** Review files shows it, send back once, Release work.
6. **Accounts/Admin:** the Payments ledger, record a payment, print the receipt, export the CSV.
7. **Ops/Admin:** create a client download link, open it in a private window (no sign-in), download a file, revoke it and confirm it no longer opens.
8. **Admin:** the dashboard numbers match; approve a price change; create and disable a user (the disabled user is signed out at once); change a setting.
9. Notifications: the bell shows the new-shoot and rescheduled notices and "Mark all as read" works.

**C. Safety checks (10 min)**
1. A Sales user cannot open `/users`, `/settings`, `/dashboard` (sent to their home), and a direct API call to `/users` gives 403.
2. Ops never sees a price anywhere.
3. A reelmaker cannot open `/jobs` and only sees their own shoots.
4. Five wrong passwords for one account give "Too many tries".
5. Change your own password: every other device is signed out.

**D. Automated checks before each deploy (on your computer)**
```powershell
cd reeload-server\api;   pnpm test;  pnpm test:e2e   # e2e needs the LOCAL database (pnpm db:local), never the hosted one
cd reeload-client;       pnpm lint;  pnpm typecheck; pnpm test; pnpm build
```

## Known limits of this setup

- Render's free API sleeps: expect a slow first request after idle time. Open `/health` before a demo.
- Supabase pauses an unused free project: resume it from the dashboard.
- `CHECKIN_TEST_CODE=111111` lets anyone who knows it pass the check-in code screen. Keep real client data out of this environment.
- The demo logins are public knowledge unless you set `SEED_PASSWORD` (Step 2.5).
- WhatsApp, backups and production mode are deliberately left for GO-LIVE.
