# InPlace Remediation Plan
**Written:** September 13, 2026 · **Baseline:** v1.105.191 (`main`, ce47112) · **Source:** `InPlace_Code_Review_2026-09-13.md`
**Scope:** every finding in the review except the explicitly deferred list in §11, plus Pete's two additional asks — lean out the data, and kill redundancy that isn't earning its keep.

---

## 1. What changed, and what that means for how we work

Until this month a bad deploy cost Pete an evening. Now Julia checks in at Betty's house on a phone in a driveway, and Sara pays real money. That changes three things about how this plan runs, and they apply to every batch below:

**Staging first, always.** Every batch goes to `staging` and gets exercised with demo-login bearer tokens before it touches `main`. No exceptions, including "obviously safe" one-liners — two of the worst bugs in this codebase's history were one-liners.

**Every batch must be revertible in one Railway redeploy.** That means no batch mixes a schema migration with a behavior change unless the migration is additive and the old code still runs against the new schema. Where a batch has to move data (photos to R2, archiving), the read path handles both shapes for at least one release before anything is deleted — the same contract `storage.js` already uses (`r2:<key>` markers with legacy base64 rows working forever). That pattern is the model; reuse it.

**A manual DB backup before any batch tagged 🗄️.** Pete did this before the money-column migration in July and it was the right call. The nightly R2 dump is a floor, not a plan.

**One batch at a time, verified before the next starts.** The review found that the two worst *shapes* in this codebase regrew after being fixed once. Batches that end with a lint or a test that makes the shape un-reintroducible are marked 🔒 — those guardrails are not optional extras, they are the point of the batch.

**Version bump per push** (Dev Rule 2) and tell Pete what to look for in the footer (Dev Rule 3). I suggest the series runs **v1.106.0 → v1.106.8**, one minor per batch, so "which batch is live" is answerable at a glance from the footer for the first time.

---

## 2. Answering the two questions you added

### "Lean out what we have" — where the bytes actually are

Your instinct to cap history is right, but I want to point the effort at the right place before we build the wrong feature.

Measured per family per year, at 3 visits/week and 20 messages/day:

| What | Bytes/family/year | Share |
|---|---|---|
| Visit photos (base64 in Postgres) | ~47 MB | **74%** |
| Recipient + profile photos | ~2–4 MB | ~5% |
| audit_log + activity_feed + notifications rows | ~10 MB | ~16% |
| **Message text** | **~1.5 MB** | **~2%** |

**Archiving chat text would recover about 2% of the footprint.** It is not where the win is. Photos are. So the plan does three separate things that your one idea was pointing at, and keeps them separate because they have different costs and different risks:

1. **Photos move to R2** (Batch 4). The code path already exists and is live for receipts and identity documents — photos just never got wired to it. This is the single biggest byte reduction available and it also fixes the takedown vector and the dashboard load time. One project, three problems.
2. **Threads paginate** (Batch 4). The 3 MB-per-open thread is a *load* problem, not a *storage* problem — `messages.js:609-635` returns the entire history since you joined, with no `LIMIT`. Fixing the read is cheap, reversible, and gets you the "only keep some amount of it" feel with zero data loss.
3. **Operational tables get retention** (Batch 4). `audit_log`, `notifications`, `activity_feed`, `onboarding_events` grow forever and nothing ever deletes from them. These are the tables where a real retention window belongs — and where a window is also a privacy improvement, not just a disk one.

If after all three you still want message archiving as a *product* feature — a family archiving an old thread out of their list — that is a UI concept on `conversation_members` (the `deleted_at` soft-hide column already exists from Batch 4 of the July work) and it belongs in a feature batch, not a hardening one. I've noted it in §10 rather than building it here.

### "Redundancy that isn't earning its keep"

You drew the line exactly right, so let me make it explicit and then apply it.

**Redundancy we keep** — it protects the business: nightly encrypted R2 backups; the audit and evidence trail (`audit_log`, `admin_audit_log`, visit logs, geofence evidence) which is the whole liability proposition; `boot_snapshots` as a pre-migration undo buffer, now byte-capped; the offline check-in queue holding a second copy of a check-in until the server confirms it.

**Redundancy that is pure waste** — measured, in this codebase today:

| Waste | Evidence | Cost |
|---|---|---|
| The same avatar bytes in **two columns** | `users.profile_photo` and `users.avatar_url` written to identical values in 4 places (`auth.js:1111`, `admin/userFlags.js:267`, `seed.js:632`, `repair-demo.js:316`) | 2× storage on every avatar, and `/api/auth/me` ships both |
| `/api/auth/me` called **9 times** on boot | 8 sites in `app.js` (`:988, :1104, :1176, :1491, :1667, :1720, :1856, :1976`) + `Dashboard.js:293` | 9 round trips, each carrying the doubled avatar |
| `/api/messages/conversations` fetched **3 ways** | `app.js:880`, `app.js:972`, plus a 30 s poll at `app.js:889` — and it's the 1+3×C N+1 route | the most expensive list endpoint, called the most often |
| The 15-minute check-in rule in **4 files** | `sessions.js:1589`, `CaretakerHub.js:957`, `CaretakerHub.js:2017`, `CaregiverCalendar.js:749` | change one, three stay wrong |
| `formatDate` ×5, `formatTime` ×5, `timeAgo` ×4, `resizeImage` ×3, `getDaysInMonth` ×3 | across `public/js/components/` | every date bug is 5 bugs |
| **8 authorization helper variants** | `utils/access.js` + `hasAccess` ×3 + `userCanAccessRecipient` + `canAccessOwner` + `teamAccess`, and 19 files with inline access SQL | this is the direct cause of the two Criticals |
| **Two complete time-change subsystems** | `sessions.js:2221/2345/2537` and `sessions.js:3634/3753/3831` | double the surface, half the testing |
| Every screen shipped to every role | one 1.6 MB bundle; 609 KB caregiver-only + 891 KB family-only source | families download the caregiver app and vice versa |
| Three copies of the client on disk, all served | `bundle.js` (1.6 MB) + `bundle.js.map` (3.7 MB, full source) + a stray untracked 2.7 MB file named `bundle` + raw `/js/**` (3.4 MB) | 11 MB in `public/`, and the maps hand your full source to anyone |
| 84 dual-name fallbacks at the API boundary | `s.time \|\| s.scheduled_time` ×13, `r.first_name \|\| r.firstName` ×11, etc. | the client defends against its own server |

Every row in that table has a batch below.

---

## 3. Batch 0 — Ground truth 📄 🔒
**Ship as v1.106.0 · ~1 session · no app code changes · zero deploy risk**

You're right to be annoyed, and right to put this first. `CLAUDE.md` is the first thing every session reads, it is wrong on 13 of ~22 checkable structural claims, and the cost isn't the wrong sentences — it's that every subsequent decision was made from a bad map. Fixing the sentences without fixing *why they drifted* just resets the clock, so this batch does both.

### 0.1 Generate what can be generated
Write `scripts/gen-architecture.js` (~60 lines) that emits `docs/ARCHITECTURE.md` with these sections marked ⚙ (generated, do not hand-edit):

- **Route map** — every `app.use()` prefix in `server.js` → the file(s) mounted there → route count. **Flags multi-file mounts**, which is how `offers.js` hiding under `/api/sessions` stops being a trap.
- **Background jobs** — each poller: advisory-lock id (101–109), interval, source file, what it queries.
- **Realtime** — every `emit(` name in `src/` paired with its client listener; **orphans flagged** (there are 13 today).
- **Push types** — each `eventType` string (51 today) → its `push_<type>` pref key → capability gate → client tap target.
- **`window.__*` registry** — the 51 mutable client globals and who writes each.

Hand-write the one section that can't be generated: **"Where is…"** — a task→`file:function` index covering the check-in gate, the cancellation fee, push send, authz, pay calculation, the identity gate, the session status machine, and reimbursement approve. This is the section that turns the review's four-hop tasks into one hop.

### 0.2 Correct CLAUDE.md, and cut it to ~150 lines
Every one of these is wrong today and gets fixed:

| Claim | Reality |
|---|---|
| "No build step — Babel compiles JSX in-browser" (`:18, :111, :400, :403`) | `npm start` runs `scripts/build-client.js`; `index.html:136` loads a compiled, minified bundle |
| "index.html fetches & compiles all JS" (`:38`) | 295 lines, loads one bundle |
| "React via CDN" | React is self-hosted at `/vendor/` |
| `styles.css ~1,600 lines` (`:40`) | 3,422 |
| "16 tables" (`:78`) / list of 27 (`:164`) | 89 `CREATE TABLE`, 318 `ADD COLUMN` |
| `src/routes/admin.js` (`:106, :117, :123, :189`) | split into `src/routes/admin/` at v1.92.0 |
| `ROADMAP.md` at root (`:31`) | it's in `archive/` |
| 4 socket events (`:19, :555`) | 35 emitted, 13 with no listener |
| seed "5 users, 4 caregivers" (`:76, :154`) | 11 accounts incl. `linda@`, `peggy@`, `raj@` |
| "53 tests" (`:427`) | 1,734 unit + 290 integration |
| "unregisters ALL service workers every load" (`:115`) | removed at v1.105.187 |
| Dev Rule 2 "bump three locations by hand" (`:581`) | `build-client.js` auto-syncs them; the same file says so at `:335` |
| "All responses follow `{ fieldName }`" (`:179`) | `GET /api/sessions` spreads raw DB rows |

**Move out** (this is 70% of the file): the Project Structure tree → a pointer at `docs/ARCHITECTURE.md`; the Last Session Handoff (138 lines, 78 releases stale) → `docs/HANDOFF.md`; Checkr/Payments/Consent essays → `docs/integrations/`; the feedback loop → `docs/FEEDBACK_LOOP.md`.
**Keep**: what this is, the corrected stack, demo accounts, Dev Rules, the timezone rules, commands, Known Limitations.

Also fix `README.md` (demo accounts that don't exist, "no build step" ×2, a documented route that isn't there) and `docs/OPS_RUNBOOK.md`'s stale test counts.

### 0.3 🔒 Make drift fail CI
Two new gates, both cheap:

- **`tests/docsTruth.test.js`** — fails if `CLAUDE.md` or `README.md` contains any of: `Babel standalone`, `No build step`, `routes/admin.js`, `in-browser`, a hard-coded test count, or a hard-coded table count. The codebase already knows how to write these (`tests/helpers/source.js` — use `code()`/`raw()` deliberately per Dev Rule 8).
- **`npm run gen:architecture -- --check`** in CI — regenerates the ⚙ sections and fails if they differ from what's committed. A new route or poller that isn't in the map turns CI red.

**Acceptance:** a fresh session, given only `CLAUDE.md` + `docs/ARCHITECTURE.md`, answers "where is the check-in gate disabled?", "what must change to add a push type?", and "where does reimbursement approve write?" in one hop each. Re-run the review's three discoverability tasks as the test.

---

## 4. Batch 1 — Security criticals 🔴 🔒
**Ship as v1.106.1 · ~1.5 days · staging soak 24h before main**

Everything here is reachable today by anyone who can register an account.

### 1.1 One authorization door (fixes C1 and H2)
Replace every role-only gate with `sessionAccess()` / `recipientAccess()` from `utils/access.js`:

- `sessions.js:3006` cancel · `:2256` propose-time-change · `:2378` time-change respond · `:2808` cancel-preview · `:2596` instructions (the `care_for` hole) · `:2537` GET time-change
- `offers.js:41-47` — `isCaregiver = userRoles.includes("caregiver")` on any session
- `interviews.js:468-478` — `/session/:sessionId` read
- `media.js` — `/user/:id/photo` and `/recipient/:id/photo` serve any photo to any account
- `kindred.js:1026-1060` — `/admin/instructions` GET/PUT
- `videoCall.js:22-52` — grant bound to a room derived server-side from a conversation the caller belongs to

Derive `cancelledBy` from `access.isCaregiver`, never from `activeRole`. Keep the 404-not-403 convention.

### 1.2 🔒 The lint that stops C1 regrowing
`scripts/lint-authz.js`, added to CI: any handler in `src/routes/` whose path contains `:id`, `:sessionId`, `:recipientId`, or `:noteId` must call `sessionAccess`/`recipientAccess`/`requireAdmin`/a named allowlist entry. Baseline it at zero — the review found this exact shape twice in two months, in different files, and a lint is the only thing that ends that.

### 1.3 Stored XSS (C2)
- **Write:** `auth.js:1105-1112`, `careRecipients.js:399-409`, `admin/userFlags.js:267` — require `^data:image/(jpeg|png|webp);base64,` and run `validateMagicBytes` on the decoded bytes.
- **`fileValidation.js:37-40`** — fail *closed* on unknown MIME. Today it returns `{valid:true}` for anything it has no signature for, which is how `image/svg+xml` gets through.
- **Read:** `media.js:19-25` — set Content-Type only from an allowlist; add `Content-Disposition: inline`; add a per-route `Content-Security-Policy: default-src 'none'; sandbox` on `/api/media/*`, `messages.js:702`, and the note/family-visit photo routes. Delete the `https?://` redirect branch (`media.js:19`) — it's an authenticated open redirect and seed no longer needs it.

### 1.4 Demo token containment (H1)
- `denyDemo` middleware on `connections`, `messages`, `media`, `reports`, `video`, `ipaiChat`, `careIntelligence`, and the socket handshake.
- `POST /api/auth/demo-login` under `authLimiter` (`server.js:450-455`).
- Add a `demo: true` JWT claim so routes stop paying for a `SELECT is_demo` per request — cheaper *and* harder to forget.
- `connections.js:11-31` — the real-user directory should require a non-demo, onboarding-complete account.

### 1.5 Session revocation (H3)
`revokeAllUserRefreshTokens` (`middleware/auth.js:216`) is written, exported, imported into `auth.js:6`, and called nowhere. Call it from: change-password, `password-reset/confirm`, admin set-password, admin reset-password, and account freeze. Then add `password_changed_at` to the existing `is_active` lookup in `authenticate` (`auth.js:99-102`) and reject tokens issued before it. Make `caregiver_profiles.account_paused` actually block auth.

### 1.6 The rest of the security set
- **M1** `trustedIps.js:16` → `WHERE id = ? AND is_admin = 1`; read `cf-connecting-ip`; retire the empty-table bootstrap at `admin/index.js:43-52` once one IP is registered.
- **M3** `server.js:134-200` `call_invite` — require a personal conversation between caller and target, check `isBlockedBetween`, take `callerName` from the DB, throttle per socket, pass an `eventType` so prefs can mute it.
- **M4** `messages.js:331` — run the relationship loop for groups, not just `type === "direct"`.
- **M5** `checkr.js:416` — return 503 when `CHECKR_WEBHOOK_SECRET` is unset (copy `payments.js:85-97`), and use `crypto.timingSafeEqual`.
- **M6** `reports.js:108-125` — escape interpolations, restrict the recipient to the caregiver's own verified address, rate-limit.
- **M7** replace the 32-bit trusted-device hash (`LoginPage.js:111-116`) with a random 256-bit token in an httpOnly cookie, hashed at rest; add attempt counters to `2fa/disable` and the `x-admin-totp` path.
- **M2 — your call.** Close the no-passkey impersonation bypass (`admin/access.js:40-46`). My recommendation is yes, now that passkeys are enrolled, plus an `impersonated` denylist (payments, password, 2FA, delete, message-send) regardless of how you decide.
- Low set: `push.js:125-156` endpoint allowlist (blind SSRF), constant-time `ADMIN_API_KEY` compare (`auth.js:30`), delete the `"inplace-dev-secret"` fallback (`careEvents.js:42`).

### 1.7 Two five-minute checks that belong to you
- **`location_source` on prod.** `database.js:498` added the column inside the *frozen* legacy array, which never replays on a database that recorded `000_legacy_baseline` (prod did, at v1.82.0). Run `SELECT column_name FROM information_schema.columns WHERE table_name='caregiver_profiles' AND column_name='location_source'`. If it's absent, `POST /api/caregivers/me/location` — the caregiver "share my location" write that gates her job list — has been failing since Aug 20. Fix is a V2 migration entry. 🔒 Add a lint: no line inside the frozen array may carry a version tag newer than v1.82.
- **`CHECKR_WEBHOOK_SECRET` in Railway.** Set or not set decides whether 1.6's M5 is a latent bug or a live one.

**Acceptance:** a script that registers a throwaway caregiver account and gets 404 on every `/:id/*` route of a session it doesn't own; an uploaded `data:text/html` photo rejected at write and, if one is already stored, rendered inert; a demo token 403'd on connections/media/ipai; a password change invalidating an old token. All on staging.

---

## 5. Batch 2 — Abuse and denial-of-service 🔴
**Ship as v1.106.2 · ~1 day code + an afternoon of Cloudflare · staging first**

This is the batch that stops the site being taken down on purpose. The proven outage class — fill the volume — is currently one authenticated token away.

### 2.1 Edge (Cloudflare — highest leverage, mostly config)
- WAF managed rules on; Bot Fight Mode on.
- Rate-limiting rules on `/api/auth/*`, `/api/ipai*`, `/api/care-intelligence*`, `/api/*onboarding*`, `/api/notes`, `/api/photos`, `/api/family-visits`, `/api/reimbursements`, `/api/waitlist`. **These survive origin restarts; the in-process limiter does not.**
- **Authenticated Origin Pulls**, or an interim shared-secret header via a Transform Rule that `server.js` requires. This single change makes the "forge X-Forwarded-For at the origin" bypass impossible and restores every app-layer limit.
- Turnstile on register, waitlist, password-reset, demo-login.
- Document where the "I'm Under Attack" toggle is.

### 2.2 Application limits
- Per-**user** limiters (keyed `req.user.id`, not IP) on uploads and AI routes; 10/min for uploads, and a persistent daily cap for AI in Postgres rather than the in-memory Map at `utils/ipaiChat.js:66-93`.
- Demo gate on `ipaiChat.js` and `careIntelligence.js` — copy `careRecipients.js:567-568`. Remove the quota exemption at `ipaiChat.js:238`; "lightweight" is not the same as "free".
- Socket: `maxHttpBufferSize: 65536` (`server.js:65`), per-socket event throttle, connections-per-user cap, and `typing_start` must check membership *before* the DB call (`server.js:244-259` — a random conversation uuid per event misses the cache and costs one query each).
- `statement_timeout` (15 s) on request-path connections only, leaving boot migrations alone (`database.js:34` explains why it's globally unset).
- Geocode: cache by normalized address, per-user cap, and get it off the request path (`caregivers.js:60`) so OSM can't be provoked into banning the origin IP.
- Outbound email: `auth.js:18` `signup-intent` under `authLimiter`; per-address cooldown on waitlist and verification resends.

### 2.3 Dependencies
`npm audit --omit=dev` reports **40 vulnerabilities, 3 critical, 17 high**, several remotely reachable: `multer 2.0.2` (8 DoS advisories, on every upload route), the Socket.IO stack (`ws`, `engine.io`, `socket.io-parser` — memory and connection exhaustion), `path-to-regexp 0.1.12` ReDoS in the Express 4 router, `express-rate-limit 8.2.1` IPv6 bypass, and `protobufjs`/`tar`/`websocket-driver` criticals pulled in by `firebase-admin`.

Upgrade multer, socket.io, express-rate-limit, and Express first; test uploads and sockets on staging carefully — multer and socket.io are the two most likely to break something. **Consider dropping `firebase-admin` entirely**: iOS push is direct APNs, so it's only there for Android, and FCM HTTP v1 over `fetch` would remove three critical advisories and a large dependency tree. 🔒 Add `npm audit --audit-level=high` to CI.

### 2.4 Ops
- External uptime monitor that **texts** Pete. `.github/workflows/uptime.yml` runs every 15 minutes and only emails on a failed workflow — a 3 a.m. outage is currently discovered at breakfast.
- Sentry alert rules on the crash-handler event and `db idle client`.
- Cost alarms on Anthropic, Twilio, Resend.
- Railway volume alerts at 70% and 85%.
- The 10-line incident runbook from the review into `docs/OPS_RUNBOOK.md`.

---

## 6. Batch 3 — Self-inflicted waste 🟡
**Ship as v1.106.3 · ~half a day · the best payoff-per-hour in the plan**

Nothing here changes behavior. It all makes the app faster for the people already using it.

- **Cache headers.** `server.js:469-476` sets `no-store` on every `.js` and `.css`, which defeats the browser cache, Cloudflare's edge, and the service worker at once. Keep `no-store` for `/`, `/index.html`, `/sw.js`; send `public, max-age=31536000, immutable` for `/js-compiled/*`, `/vendor/*`, `/css/*`. The `?v=build-<hash>` scheme already guarantees freshness. **Repeat loads drop from ~700 KB compressed to ~6 KB.**
- **Hash-only cache stamp.** `build-client.js:194-195` appends `Date.now()`, so every container *restart* — crash restarts included — busts every cache and costs each device three downloads plus a spurious "App updated" reload. Drop the timestamp.
- **Build in the build phase.** `npm start` currently runs a 29-second Babel+terser build before the server listens. Move it to Nixpacks build; `start` becomes `node src/server.js`. Move `terser` from devDependencies to dependencies while you're there.
- **`"healthcheckPath": "/api/health"`** in `railway.json`. Combined with the above, the per-deploy 502 window goes from 30–60 s to roughly zero.
- **Drop the two synchronous script tags.** `index.html:78` ships 624 KB of Twilio to everyone, and `VideoCallOverlay.js:94-101` already lazy-loads it itself. `index.html:74` Stripe is synchronous, external, and blocks everything after it — lazy-load it the same way. −210 KB gz off every first paint, and one fewer third-party host that can white-screen the app.
- **Dashboard photos by URL** (`dashboard.js:203-218, 367-369`) — add `GET /api/photos/:id/image` mirroring `messages.js:702`, return URLs, serve thumbnails. Dashboard JSON drops from up to 4–6 MB to ~50 KB. Same for `careRecipients` (`dashboard.js:79, 285`; `careRecipients.js:57-59, 96`).
- **A `'restoring'` state** (`app.js:538-551`). A returning user currently sees the marketing splash while `/me` runs, and *stays* there if it fails — a deploy 502 looks exactly like being logged out. Add the state, retry `/me` with backoff for 60 s, say "Reconnecting…".
- **Version-skew guard.** `X-App-Version` is sent and only recorded (`auth.js:734-760`). Return `426` + `X-Min-App-Version` and let `apiFetch` trigger the existing safe-moment reload.
- **Stop serving the source.** Don't write `.map` files into `public/` (3.7 MB with full `sourcesContent`, comments naming real users 53 times); don't serve raw `/js/**`; delete the stray untracked 2.7 MB `bundle` artifact.
- **Gate the polls on visibility** (`app.js:889, 911, 928`) — none check `visibilityState`, and the socket already delivers `new_message`. Fix the `visibilitychange` listener leak at `Dashboard.js:475-477`.
- **Un-waterfall CaretakerHub** (`CaretakerHub.js:381-397`) — seven calls wait on `/api/dashboard` for no reason; cache the Stripe `accounts.retrieve` server-side instead of calling it live on every open.

---

## 7. Batch 4 — Data leanness 🗄️ 🔒
**Ship as v1.106.4 · ~2–3 days · take a manual backup first · the read path handles both shapes for one full release before anything is deleted**

This is your "lean it out" batch. It's also the one that removes the takedown vector, so it's the highest-value structural work in the plan.

### 4.1 Photos to R2 — the 74%
`utils/storage.js` already does this for receipts, verified documents, consent uploads, and caregiver ID/selfies, with the `r2:<key>` marker contract and legacy base64 rows working forever. Wire the remaining five writers to it:

`photos.js:76-84` (visit photos) · `notes.js:196` (note photos) · `familyVisits.js` (visit photos) · `auth.js:1111` + `careRecipients.js:407` (profile/recipient) · `messages.js:770-780` (message photos).

Then a one-time backfill migration that walks existing base64 rows into R2 and rewrites them as markers, in batches, resumable, with the old column readable throughout. Confirm the four `R2_*` vars are set on Railway (they were set July 11 and the uploads bucket is live).

### 4.2 De-duplicate the avatar
`users.avatar_url` and `users.profile_photo` hold **identical bytes**, written together at `auth.js:1111`, `admin/userFlags.js:267`, `seed.js:632`, `repair-demo.js:316`, and both are returned by `/api/auth/me`. Pick one column (`profile_photo`), make the other a derived `/api/media/user/:id/photo` URL, stop returning bytes from `/me` entirely. Halves avatar storage and cuts the most-called endpoint's payload.

### 4.3 Cap the reads
- **Thread pagination** — `messages.js:609-635` gets `LIMIT 50` + a `before` cursor; the client already understands `hiddenBefore`.
- **Clamp every client-supplied limit** — `sessions.js:138, 237` take `parseInt(limit)` straight from the query string with no ceiling; `payments.js:1368` runs three unbounded scans.
- Sweep the other 81 unbounded list endpoints for the ones that touch growth tables.

### 4.4 Retention — the tables nothing ever deletes from
A monthly poller (advisory-locked, same pattern as the other nine), with the windows as your decision (§9):

| Table | Suggested window | Note |
|---|---|---|
| `audit_log` | 180 days | shorten only if legal says so — this is evidence |
| `admin_audit_log` | 365 days | admin actions, keep longer |
| `notifications` | 90 days | already delivered |
| `activity_feed` | 180 days | user-visible history |
| `onboarding_events` | 30 days | telemetry, and it's the unauthenticated writer |
| `boot_snapshots` | keep 5 (unchanged) | already byte-capped post-Sept 2 |

Also: `SNAPSHOT_TABLES` (`database.js:211-223`) still snapshots `messages` with no column exclude. The 4 MB byte cap catches it now, but excluding message `metadata` explicitly is the belt to that braces — the Sept 2 root cause was base64 in `messages` getting copied five times.

### 4.5 Per-user quotas
A daily upload byte budget per user, enforced at every blob writer. Without this, Batch 2's rate limits slow the fill attack down but don't stop it.

### 4.6 🔒 The guardrail
`scripts/lint-blobs.js`: any `INSERT`/`UPDATE` writing a column matching `photo|image|receipt|document|attachment` must route through `storage.storeFileData`. Baseline zero. This is what stops photos-in-Postgres coming back a third time.

---

## 8. Batch 5 — Correctness and efficiency debt 🟡
**Ship as v1.106.5 · ~1.5 days**

- **Transactions on money paths.** Check-out (`sessions.js:1923-1935`) writes `completed` + `payment_due_at`, captures on Stripe, then updates again in `accountability.js` — three writes, no `BEGIN`. Auto-pay (`payments.js:1721-1743`) inserts `payments`, inserts `tips`, updates `care_sessions` separately. The Stripe idempotency key prevents double-charging; it does not prevent a half-written ledger. `db.transaction` exists (`database.js:155-190`) and is used 11 times elsewhere — Stripe calls stay outside it, DB writes go inside.
- **Indexes** in one V2 migration (`CREATE INDEX CONCURRENTLY`, outside the transaction): `visit_photos(visit_log_id)`, `conversation_members(user_id)`, `conversation_members(conversation_id)`, `care_sessions(offered_to_caregiver_id) WHERE NOT NULL`, `care_team_members(user_id)`.
- **Get the writes off the dashboard GET.** `dashboard.js:49-74` runs two fire-and-forget offer-expiry UPDATEs on every family dashboard load, seq-scanning an unindexed column. They belong in poller 102.
- **Collapse the conversation list** (`messages.js:84-111`) from 1+3×C queries to one with `LATERAL` + `COUNT(*) FILTER` + `json_agg`. It's polled every 30 s per client, so this is the highest-frequency query in the app.
- **Batch the care-task poller** (`careTasks.js:629-643`) — currently ≥3 queries per active task per minute.
- **One Anthropic client factory** in `aiModels.js` with `timeout: 30000, maxRetries: 1`. Ten route-path clients currently use the SDK default of **10 minutes with 2 retries**; two raw `fetch` calls (`nlScheduling.js:72`, `aiMatching.js:357`) and the Checkr call inside the Stripe webhook (`payments.js:1553`) have no timeout at all.
- **Stop hiding poller failures.** `server.js:1126-1131, 1155-1157, 1393-1395` `console.error` only, and *filter out* any message containing "relation" or "column" — precisely the errors that mean a schema bug. Replace with `captureException`.
- **The 95 silent catches** (19 bare, 76 comment-only). Don't sweep all of them; do the ones in payment, auth, and session paths, and give them `captureException`. Concentrations: `admin/overview.js` 15, `database.js` 15, `reimbursements.js` 7, `payments.js` 7.
- **Boot geocode backfill** (`server.js:1282-1357`) — 1 req/s per NULL-coordinate row on every deploy. Move it to a one-shot poller with a marker.

---

## 9. Batch 6 — Structural de-duplication 🟢
**Ship as v1.106.6 · ~2 days · pure refactor, no behavior change, so it needs the strongest test discipline**

This is the rest of your redundancy table.

- **Delete one time-change subsystem.** `sessions.js` has two complete implementations (`:2221/2345/2537` vs `:3634/3753/3831`). Find which the client calls, delete the other, then split `sessions.js` (3,878 lines, 32 routes) by sub-domain using the `register(router)` pattern the admin split already uses.
- **Constants with one owner.** `src/constants/{sessionStatus,pushTypes,checkIn,roles}.js`, mirrored to `public/js/constants.js` by the build. This kills: the 15-minute rule in 4 files; the 51 loose push-type strings; the label drift where `open` is "Requested" in one modal and "Open" in another, and `completed` is "Done" and "Completed"; and the server statuses `negotiating`/`matching` that the client has zero references to and would render as "Pending". 🔒 Lint: every `sendPushToUser(…, "x")` literal must exist in the enum.
- **Promote libraries out of `routes/`.** `routes/push.js` is a library required by 23 files; `utils/push.js` is a legacy adapter with a *different signature*, which is a trap for anyone grepping by name. Move to `src/services/push.js`, retire the adapter, so `routes/` holds only routers.
- **One copy of each client helper.** `formatDate` ×5, `formatTime` ×5, `timeAgo` ×4, `resizeImage` ×3, `getDaysInMonth`/`getFirstDayOfWeek` ×3, haversine ×2 — into `utils.js` / `TimezoneHelper.js`. Server-side: `safeJson` ×3, `getStripe` ×2, `getPlatformFeePercent` ×2, `getClientIp` ×2, `compareFaces` ×2, `callClaudeChat` ×2.
- **Fix the API boundary instead of defending against it.** 84 dual-name fallbacks exist because `/api/sessions` spreads raw DB rows while `/api/dashboard` camelCases. Pick one shape, fix the server, delete the fallbacks.
- **Stop calling `/api/auth/me` nine times.** One boot fetch into a context or a single `window.__me` populated once, consumed everywhere (`app.js:988, 1104, 1176, 1491, 1667, 1720, 1856, 1976` + `Dashboard.js:293`). With 4.2 done, that endpoint also stops carrying photo bytes.
- **Role-split the bundle.** 609 KB caregiver-only + 891 KB family-only source ships to everyone. The lazy mechanism exists (`AdminPanelLazy`, `app.js:425-455`); apply it to `bundle-caregiver.js` / `bundle-family.js`. Core drops to ~40%.

---

## 10. Batch 7 — Tests and guardrails 🟢 · Batch 8 — Native and PWA 🟢
**v1.106.7 and v1.106.8 · ~1.5 days combined**

**Batch 7:**
- **Integration tests for money.** Today there are *zero* covering `/api/payments`, check-in, check-out, `/cancel`, cancellation fees, or a Stripe webhook — the highest blast radius in the product. Write: check-in → check-out → pay; cancel with fee; one webhook with a fake event. The embedded-Postgres harness already exists.
- **Convert the worst source-regex tests.** 111 of 122 unit files read source text; 67% of assertions are `toMatch`/`toContain` against source. Don't convert all of them — convert the ones guarding authz and money, where "the string is present" and "the behavior is correct" have already diverged once.
- `eslint src/` (no-undef, no-unused-vars) — there's currently no ESLint on the server at all.
- A route-collision lint (the duplicate propose-time systems would have been caught) and a socket emit↔listener lint (13 orphans).
- Archive the 211 closed `TASKS.md` items — the archive stopped in March and the file is 314 KB, half of it done work.

**Batch 8:**
- `server.errorPath: 'error.html'` in `capacitor.config.ts` — `public/error.html` was written for the offline cold-launch white screen and is currently unused.
- Auto-apply the version heartbeat at a safe moment in non-SW contexts, so the Sep 9 "old bundle after a deploy" can't recur on iOS.
- `WKAppBoundDomains = yourinplace.com` in `Info.plist` to get the service worker (and offline shell) in the native build. Test carefully — app-bound domains restrict what the WebView can load.
- `FindWork.js:223` fetches Nominatim from the client but CSP `connectSrc` doesn't allow it, so that fallback silently always fails.
- Remove `'unsafe-eval'` and the unused CDN hosts from the CSP (`server.js:362-368`) — no `eval` or `new Function` exists in either bundle. Move the four inline blocks in `index.html` to a nonce so `'unsafe-inline'` can go too.

---

## 11. What this plan deliberately does not do

Restating so it doesn't creep in. Each has a trigger; none has fired:

| Deferred | Trigger to revisit |
|---|---|
| Redis Socket.io adapter, shared rate-limit store, challenge stores in Postgres | one instance >60% CPU at peak (~1,000+ concurrent clients) |
| A second Railway replica | the above — **until then, replicas stays at 1, and it goes in the runbook** |
| PgBouncer / pool `max` above 10 | Sentry showing connection timeouts *after* Batch 5 |
| A job queue (BullMQ) for pushes | a single fan-out exceeding ~50 devices |
| Server-side image resizing (`sharp`) | phones stop resizing client-side (they don't) |
| Prepared-statement caching | never, at this scale |
| A client state-management rewrite | not a rewrite candidate; Batch 6 gets the benefit incrementally |
| Message *archiving* as a product feature | after Batch 4, if the thread list still feels heavy — see §2 for why it's ~2% of bytes |

---

## 12. Decisions that are yours

I've put a recommendation on each so nothing blocks. Correct me where you disagree and I'll fold it in.

1. **Retention windows** (§7.4). My defaults: audit 180d, admin audit 365d, notifications 90d, activity 180d, onboarding events 30d. Legal may want the audit trail longer — this is arguably a lawyer-list item given the evidence-trail argument is central to the liability posture.
2. **The impersonation bypass** (M2). Recommend closing it now.
3. **`firebase-admin`** — drop it and move Android push to FCM HTTP v1 over `fetch`? Removes three critical advisories and a large tree. Recommend yes, but it's a real change to a working push path.
4. **Per-user daily upload quota** — what number? Recommend 50 MB/day/user, which no honest user reaches and no attacker can fill a volume with.
5. **Cloudflare Authenticated Origin Pulls now, or the interim shared-secret header?** Recommend the header this week (10 minutes) and proper origin pulls when you next have an hour in the Cloudflare dashboard.

---

## 13. Sequence and effort

| Batch | Version | Effort | Risk | Gate before next |
|---|---|---|---|---|
| 0 Ground truth | v1.106.0 | 1 session | none | docs CI gates green |
| 1 Security criticals | v1.106.1 | 1.5 days | medium | throwaway-account probe script passes on staging |
| 2 Abuse / DoS | v1.106.2 | 1 day + CF afternoon | medium | uploads and sockets verified after dep upgrades |
| 3 Self-inflicted waste | v1.106.3 | 0.5 day | low | footer version + a cold load measured on a phone |
| 4 Data leanness | v1.106.4 | 2–3 days | **high — backup first** | backfill resumable; both read shapes work |
| 5 Correctness / efficiency | v1.106.5 | 1.5 days | medium | money paths exercised on staging |
| 6 Structural de-dup | v1.106.6 | 2 days | medium | full suite + a manual pass of both role views |
| 7 Tests / guardrails | v1.106.7 | 1 day | none | — |
| 8 Native / PWA | v1.106.8 | 0.5 day | low | TestFlight build verified on a real phone |

**About 11 working days of agent time**, but the shape that matters is: Batches 0–3 are roughly four days and remove every finding that can hurt a real user *this month*. Batch 4 is the one that needs a calm evening and a backup. Batches 5–8 are steady work that can interleave with feature development.

**Suggested first sitting:** Batch 0 end to end (it makes every later batch cheaper), then the two five-minute prod checks in §4.7, then start Batch 1.

---

## 14. A standing rule for this plan

The review found that the two worst problem *shapes* in this codebase — "authenticated but not authorized" and "base64 blobs in Postgres" — were each fixed once and grew back somewhere else. Every batch above that closes one of those ends with a lint or a CI test (marked 🔒), and those are the deliverable, not a nice-to-have. A fix without a guardrail is a fix with an expiry date.
