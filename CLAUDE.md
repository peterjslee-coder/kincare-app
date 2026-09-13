# InPlace — Project Context

**Read `docs/ARCHITECTURE.md` next.** It carries the route map, the background jobs, the socket
events, the push types and a "Where is…" index, and most of it is generated from the code by
`npm run gen:architecture`, so it cannot quietly go stale. This file is only the things a
generator cannot derive: what the product is, how we work, and the rules that were each paid for
with a shipped bug.

> **Why this file is short now.** On 2026-09-13 a review found CLAUDE.md wrong on 13 of ~22
> checkable structural claims — it described a build that no longer existed, a file that had been
> split ten months earlier, and a test count off by 1,700. Every session read it first, so every
> session started from a bad map. Anything that can drift is now generated or tested. Keep it
> that way: if you are about to add a fact here that code could tell you instead, put it in the
> generator.

## What this is

InPlace is a care-coordination marketplace connecting families with vetted non-medical caregivers
for elderly care. Built by Pete Lee, who is coordinating care for his own mother in Blacksburg,
VA — that is the real case the product is designed against. Live at https://yourinplace.com.

**It has real users.** A real caregiver works real visits through it and a real family pays real
money. Treat production accordingly: staging first, always.

## Stack (verified 2026-09-13, v1.105.194)

- **Backend** Node 22 + Express 4, port 3001 · **DB** PostgreSQL 17 via `pg` (one Railway service,
  one instance) · **Realtime** Socket.io, JWT-authenticated handshake
- **Auth** JWT (7-day) + rotating refresh token, bcryptjs, Google OAuth, TOTP 2FA, passkeys/WebAuthn
- **Frontend** React 18 SPA. **There is a build step**: `scripts/build-client.js` runs Babel +
  terser over `public/js/**` and emits `public/js-compiled/bundle.js` (~1.6 MB) plus a lazy
  `bundle-admin.js` (~376 KB). React, socket.io and Leaflet are **self-hosted** from `/vendor/`,
  not fetched from a CDN. Edit anything in `public/js/` and you must rebuild before a browser
  sees it.
- **Native** Capacitor iOS + Android, both loading the same origin (`server.url =
  https://yourinplace.com`), so the native app *is* the web app and CORS does not apply today
- **Money** Stripe Connect (live keys, 20% platform fee) · **Vetting** Checkr · **AI** Anthropic
  SDK ("iPAi") · **Email** Resend · **Video/SMS** Twilio · **Files** Cloudflare R2 ·
  **Push** direct APNs on iOS, web-push elsewhere
- **Deploy** Railway (NIXPACKS) behind Cloudflare · **IDs** UUID v4 everywhere

Scale of the thing: 125 server files / 77 client files · 522 HTTP routes · 89 tables ·
47 utils · 14 admin route modules · 125 unit test files + 37 integration.

## The three roles

Family (care team) · caregiver · care recipient ("care_for"). Each gets a different sidebar and
dashboard. **A user can hold more than one role, and `is_admin` is a separate column from `role`
— Pete is `role: family` AND `is_admin: true`. Never infer admin-ness from `role`.**

## Demo accounts — all 11, password `inplace123`

| Email | Who | Role |
|---|---|---|
| `paul@inplace.care` | Paul Lowe | family (the main demo family) |
| `david.lowe@inplace.care` | David Lowe | family (sibling) |
| `susan.lowe@inplace.care` | Susan Lowe | family (sibling) |
| `barbara@inplace.care` | Barbara Lowe, 78 | care recipient |
| `maria@inplace.care` | Maria Santos | caregiver |
| `james@inplace.care` | James Okafor | caregiver |
| `sarah@inplace.care` | Sarah Chen | caregiver |
| `david@inplace.care` | David Kim | caregiver |
| `peggy@inplace.care` | Peggy Nolan | helper |
| `linda@inplace.care` | Linda | see `src/seed.js` |
| `raj@inplace.care` | Raj | see `src/seed.js` |

⚠️ `david@inplace.care` (caregiver David Kim) and `david.lowe@inplace.care` (sibling David Lowe)
are different people. `POST /api/auth/demo-login` logs in as any of these without a password —
which is also why demo tokens must never reach an expensive or real-data endpoint.

## Commands

```bash
npm run dev            # build + server with --watch
npm start              # build + server (what Railway runs)
node scripts/build-client.js   # rebuild the bundle after ANY public/js change
npm run seed           # wipe + repopulate demo data

npm run lint:client && npm run lint:requires && npm run lint:sql-columns && npm run lint:contrast
npm test               # unit
npm run test:integration       # embedded PostgreSQL
npm run gen:architecture       # rewrite docs/ARCHITECTURE.md (--check in CI)
```

⚠️ **`npm test -- <name>` does not filter.** The script ends in `--testPathIgnorePatterns`, so
your argument is appended to *that* and the named test is **excluded** — this has produced a
green run that silently skipped the test it was checking. Use `npx jest tests/<file>`.

## Dev Rules (persistent — do not skip)

1. **Phone inputs** all use `formatPhone()` from `utils.js` with an "International number"
   toggle. Wrong format → fix `formatPhone()`, one place, not twenty.
2. **Bump `APP_VERSION` on every deploy.** `scripts/build-client.js` syncs the cache-bust
   parameters and `sw.js` for you; you change `APP_VERSION` in `src/server.js`.
3. **Tell Pete the version to look for** after a push, so he can confirm from the footer.
4. **Ask before design changes.** Don't assume the intent of a UX or layout change.
5. **Offer a mockup** before building a significant UI change.
6. **Trust the bug report.** When Pete reports something, read the code before suggesting
   caching or user error. He is usually right.
7. **Never let demo or seed data reach Stripe.** Live keys are on Railway. Demo accounts have no
   Connect accounts. Any code path that could hit Stripe's API with demo data is a bug — enforced
   at the boundary by `isDemoSession` (`accountability.js`), not only by a poller's SQL filter.
8. **A test that reads source must choose raw or stripped deliberately** — `tests/helpers/source.js`,
   `raw()` for "this is on the page", `code()` for "this must NOT appear". Never hand-roll
   `replace(/\/\*[\s\S]*?\*\//g, "")`: a `/*` inside a string literal like `accept="image/*"`
   opens a phantom comment and swallows thousands of characters. A positive assertion then fails
   loudly; a negative one passes silently having verified nothing. **A test that cannot fail is
   worse than no test.**
9. **Fixes to a recurring bug class end in a lint or a test.** Two of this codebase's worst
   shapes — "authenticated but not authorized" and "base64 blobs into Postgres" — were each
   fixed once and grew back somewhere else. A fix without a guardrail has an expiry date.

## Timezone Design Principle

**All times are care-location times.** An 8am session means 8am where the care happens, whoever
is booking, viewing or being notified. If Pete is in China scheduling care for his mother in
Virginia, the calendar, the pushes and the check-in gate are all Virginia time.

Session dates/times are stored as naive TEXT (`scheduled_date` "2026-02-26", `scheduled_time`
"08:00"); `care_recipients.timezone` decides the zone.

- Never `new Date().toISOString().split('T')[0]` for "today" — that is the UTC date.
- Never `new Date(dateStr + 'T' + timeStr)` — that parses in the server's zone.
- Backend: `getNowInZone(tz)` / `buildDateTimeInZone(date, time, tz)` (`src/utils/timezone.js`).
  Frontend: `TimezoneHelper`.
- ⚠️ `buildDateTimeInZone` returns a **shifted-frame** Date. Compare it only against
  `getNowInZone()`. Never store its `.toISOString()` and never compare it to `Date.now()` — that
  is wrong by the server's UTC offset, and it would have fired care-task pushes 4 h early.
  For stored or exported timestamps use `zonedDateTimeToInstant`.
- Always `JOIN care_recipients` and select `cr.timezone AS care_timezone` in time-sensitive queries.
- Check-in/out timestamps are recorded server-side via `NOW()`. Pay is computed server-side from
  actual check-in to check-out in 15-minute blocks. Never trust the client's clock for either.

## Rules that are not about code

- **Copy:** never call users or caregivers "heroes". Signups are *limited early access*, and each
  one gets a personal welcome call. Money copy says plainly where the money moves.
- **Care Tasks record that care happened. We never advise on medication.**
- **iPAi cardinal rule:** an AI-derived artifact is never a ground-truth input to another AI
  document. Derivation chains turn interpolation into stated fact ("doesn't drive anymore" →
  "no longer drives legally"). Raw notes and visit logs only; anything leaving the platform gets
  human review.
- **Identity is a human gate.** The AI never writes `approved`; below 90% confidence it records
  no opinion at all. Only an admin approves. `src/utils/identityDecision.js`.
- **A checklist item has three states — done, not done, and NOT KNOWN YET** — and the third must
  never render as the second.
- **Onboarding philosophy: get them in fast, motivate them to complete later.** Signup collects
  the minimum; documents and background checks gate *accepting jobs*, not *creating an account*.
  Full version: `docs/PRODUCT_PRINCIPLES.md`.

## Known limitations (true as of 2026-09-13)

1. Stripe is live. See Dev Rule 7.
2. Siblings each have separate `care_recipient` records — no shared-access model yet.
3. Resend needs domain verification; the sandbox sender only delivers to the account owner.
4. **Visit photos, note photos, family-visit photos and profile photos are still base64 in
   Postgres.** R2 (`src/utils/storage.js`) is live for receipts, documents and identity uploads
   but photos were never wired to it. This is the largest single consumer of database volume and
   the cause of the Sept 2 outage class. Scheduled for remediation batch v1.106.4.
5. Geocoding is Nominatim (OSM) — free, best-effort, 4 s timeout, and rate-limited upstream.
6. Google OAuth needs `GOOGLE_CLIENT_ID`/`SECRET` on Railway.
7. **One Railway replica only.** Socket fan-out, the rate-limit store, OAuth/passkey challenges
   and the iPAi quota are all in-process. A second replica breaks all four. See
   `docs/ARCHITECTURE.md` §5.

## Where everything else lives

| | |
|---|---|
| Route map, jobs, socket events, push types, "Where is…" | `docs/ARCHITECTURE.md` |
| What happened last session, what's mid-flight | `docs/HANDOFF.md` |
| Stripe, Checkr, consent/authorization tiers | `docs/integrations/` |
| The feedback loop ("Run feedback loop") | `docs/FEEDBACK_LOOP.md` |
| Onboarding and product principles | `docs/PRODUCT_PRINCIPLES.md` |
| Deploys, Railway, backups, incidents | `docs/OPS_RUNBOOK.md` |
| Active work | `TASKS.md` · current remediation plan: `docs/plans/InPlace_Remediation_Plan_2026-09-13.md` |
