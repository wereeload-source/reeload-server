# Testing (documentation section 10)

Run everything automated with one command, then do the phone checks by hand.

```bash
PGHOST=localhost PGUSER=postgres scripts/test-db.sh          # database: rules, security, acceptance (throwaway local database)
cd api && DATABASE_URL=... npm run check:sql && npm test     # every API query against a migrated database, then unit tests
SOURCE_URL=... TARGET_URL=... scripts/restore-drill.sh       # backup and restore (see docs/GO-LIVE.md)
```

## Section 10, line by line

| Documentation test | How it is checked | Where |
|---|---|---|
| **Access.** Every role tries every table. Operations and reelmakers cannot read any money table | Automated: 5 roles against `job_money`, `payments`, `price_changes`, `job_balances`, `audit_log`, `share_links`; Ops and Reelmaker also cannot insert a payment; a disabled user sees nothing | `supabase/tests/foundation.sql`, `acceptance.sql` |
| **Advance.** Confirming without an advance is refused | Automated, including all-or-nothing rollback in `create_job` | `rules.sql` |
| **Double booking.** Overlapping assignments are refused | Automated (exclusion constraint), plus leave and reschedule clashes | `rules.sql`, Step 3 flow |
| **OTP.** Wrong-code limit, expiry, resend limit, cooldown, 5-minute rule on the server | Automated rules with unit tests at every boundary (59 s / 60 s, 3rd / 4th send, 4th / 5th wrong code, 9:59 / 10:01, 4:59 / 5:00); the row locking and committed-attempt behaviour were exercised against the database | `api/src/checkin/checkin.rules.spec.ts` |
| **Camera.** Two photos work in iPhone Safari and Android Chrome; no gallery; no location asked | **By hand**, checklist below (client app) | |
| **Uploads.** Several photos and a large video from Photos in Safari; lock screen, drop the connection, reopen and resume; HEIC and HEVC | **By hand**, checklist below. The server side (resume of the same file, part listing, completion, job moves to Uploaded) is automated | `api/src/uploads/*` |
| **Download link.** Not before Paid; expires after 7 days; revoked links stop working | Automated: who may create (`share.rules.spec.ts`), expiry and revoke states, link lookup by hash | `api/src/share/*` |
| **Deletion.** Raw gone at 10 days, edited at 20 | Automated: the exact query the sweep runs, at both boundaries, counted from the shoot date | `acceptance.sql` |
| **Audit.** Entries cannot be edited or deleted | Automated for Admin, Ops and the database owner (update, delete, truncate) | `rules.sql`, `acceptance.sql` |

## By-hand checks (real phones, real R2 bucket)

Do these on the pilot devices before the first real shoot. Use Meta's test number until the WhatsApp template is approved.

- [ ] **iPhone Safari**: open the shoot, tap Reached, receive the code on WhatsApp, enter it. Take the selfie (front camera) and the location photo (back camera). The gallery is not offered for these two. The browser does not ask for location.
- [ ] **Android Chrome**: same as above.
- [ ] A wrong code four times shows tries left; the fifth locks. Resend is greyed for 60 s; the fourth send is refused. Ops sees the waiting check-in, and Release only becomes available after 5 minutes and needs a written reason.
- [ ] **Upload from Photos in Safari**: pick 3 photos and one large video (over 500 MB) at once. Progress shows per file. The screen stays awake.
- [ ] **Resume**: start the large video, lock the screen or switch on aeroplane mode halfway, reopen the job, pick the same file again. It continues from where it stopped (the part counter does not restart from zero).
- [ ] **HEIC photos and HEVC video** upload and can be downloaded by Ops.
- [ ] R2 CORS: `PUT` allowed from the app origin and the `ETag` header exposed, otherwise uploads stall at the first part.
- [ ] Ops uploads a file on behalf of a reelmaker from a computer; the file list shows who uploaded for whom.
- [ ] Download link opened in a private window: works before expiry, shows only edited files, stops after Revoke.
- [ ] Overdue raw (24 h) and edited (3 days) show red in the review list.

## Known gaps

These are things nobody has been able to run yet, so they are the first things to watch in the pilot:

- The NestJS API was written and checked without installing its dependencies (`@nestjs/*`, `pg`, `zod`) in the authoring environment. Run `npm install && npm run build && npm test` in `api/` first; fix anything the compiler reports before anything else.
- No test has talked to a real Neon database, a real R2 bucket or the real WhatsApp API. The R2 request signing is verified against the signature in AWS's published example, not against R2 itself.
