# Testing (documentation section 10)

Run everything automated, then do the phone checks by hand.

```bash
cd api
pnpm build && pnpm test                    # compile, then unit tests of the pure rules
pnpm db:migrate && pnpm db:seed && pnpm test:e2e   # every role against the real routes
SOURCE_URL=... TARGET_URL=... # backup and restore: see docs/GO-LIVE.md
```

## Section 10, line by line

| Documentation test | How it is checked | Where |
|---|---|---|
| **Access.** Operations and reelmakers never see money | `roles.e2e-spec.ts`: five roles call every route group and must get 200 or 403 exactly as `AccessPolicy` says; Sales sees `agreed_amount` on jobs, Ops never does | `api/test/roles.e2e-spec.ts`, `api/src/access` |
| **Login and logout.** Wrong password and unknown email look the same; a refresh token works once; logout ends the session on the server | e2e | `api/test/roles.e2e-spec.ts` |
| **Advance.** Confirming without an advance is refused | Service rule in `jobs.service.ts`; add an e2e case before go-live | `api/src/jobs` |
| **Double booking.** Overlapping assignments and leave are refused | `booking.service.ts` under an advisory lock; add an e2e case before go-live | `api/src/assign` |
| **OTP.** Wrong-code limit, expiry, resend limit, cooldown, 5-minute rule | Unit tests at every boundary (59 s / 60 s, 3rd / 4th send, 4th / 5th wrong code, 9:59 / 10:01, 4:59 / 5:00) | `api/src/checkin/checkin.rules.spec.ts` |
| **Camera.** Two photos in iPhone Safari and Android Chrome | **By hand**, checklist below | |
| **Uploads.** Several photos and a large video from Photos; resume after losing the connection; HEIC and HEVC | **By hand**. Request signing is unit tested against AWS's published example | `api/src/uploads/sigv4.spec.ts` |
| **Download link.** Not before Paid; expires after 7 days; revoked links stop | Unit tests for who may create and link states | `api/src/share/share.rules.spec.ts` |
| **Deletion.** Raw gone at 10 days, edited at 20 | `retention.service.ts`; check by hand on a dev branch with backdated jobs | `api/src/share` |
| **Audit.** Entries cannot be edited or deleted | `AuditService` has insert only; nothing else touches the table | `api/src/common/audit.service.ts` |

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

- The API was rewritten to Prisma without being able to install dependencies, so nothing has been compiled or run yet. Run `pnpm install && pnpm build && pnpm test` in `api/` first and fix what the compiler reports.
- The earlier database-level rule tests were removed together with the SQL rules; their cases (advance, double booking, price approval, payments never above the balance, ops cannot see money) now need service or e2e tests. Writing more of those as e2e tests (they run against `pnpm db:local`) is the next testing task.
- No test has talked to the real Supabase project, a real R2 bucket or the real WhatsApp API (the e2e tests run on a real local Postgres).
