# Session handoff

> ⚠️ **This handoff is a lead sheet, not evidence, and it goes stale fast.**
> The snapshot below was written on **Aug 19, 2026 at v1.105.113**. HEAD is far past it.
> **If `git log` disagrees with anything here, trust `git log`.** Every single 🔴 this
> handoff originally carried was later disproved. Re-check before building on it.
>
> Overwrite this file at the end of a working session; do not append.

---

## Sept 13, 2026 · v1.106.5 on `main` — remediation Batches 0, 1 and 2 shipped

The Sept 13 code review (`docs/plans/InPlace_Remediation_Plan_2026-09-13.md`) is being worked
batch by batch. Where it stands:

| Batch | What | Version | State |
|---|---|---|---|
| 0 | CLAUDE.md rewritten, `docs/` split out, `scripts/gen-architecture.js` + `--check` gate | v1.106.0 | shipped |
| — | `location_source` hotfix (migration 030) + frozen-array lint | v1.106.1 | shipped |
| 1a | session/offer authorization → `sessionAccess()`, `lint-authz` gate | v1.106.2 | shipped |
| 1b | stored-file safety, upload validation, **impersonation now requires a passkey, no bypass** | v1.106.3 | shipped |
| 1c | session revocation, trusted devices, Checkr fail-closed, CSV injection, schema-drift endpoint | v1.106.4 | shipped |
| 2 | abuse & denial-of-service (below) | v1.106.5 | shipped |
| 3–8 | waste, data leanness, correctness, de-duplication, guardrails, native/PWA | — | not started |

### What Batch 2 actually added

- **Sockets.** 64 KB frame cap, 12 sockets per account, 120 events / 10 s enforced by
  `socket.use` middleware (so a new `socket.on` is covered by default, not by remembering),
  and both per-socket maps cleaned on disconnect. The refused client stops reconnecting
  instead of knocking every five seconds forever.
- **Per-account daily counters** (`usage_counters`, migration 032, `src/utils/usageLimits.js`).
  50 MB/day of uploaded bytes across all six blob routers, counted from `Content-Length`
  before the body is stored. The iPAi cap moved here too — it was a `Map` in process memory,
  so "30 a day" really meant "30 per deploy".
- **Geocoding.** Two-layer cache (`geocode_cache`, migration 033) plus a serialising queue that
  refuses rather than piles up, and per-account daily budgets on `/api/caregivers?address=`
  and `/api/geocode/suggest`. Every call site went through one function already, which is why
  this was cheap.
- **Outbound email.** Per-ADDRESS daily ceiling and identical-body suppression inside
  `sendEmail` — the half that survives an attacker rotating IPs — plus `authLimiter` on
  `/api/auth/signup-intent` and `/api/consent/respond`.
- **`statement_timeout = 20000`** on every pool connection, with `SET LOCAL statement_timeout = 0`
  inside the migration transaction. That escape is the whole reason there was no timeout before.
- **Dependencies:** 42 advisories → 10, and **zero high or critical**. Every fix landed inside
  the existing semver ranges, so `package.json` did not change. CI now runs
  `npm audit --omit=dev --audit-level=high`.
- **Cloudflare:** one rate-limiting rule, live and verified (block at 20 req/10 s per IP on the
  expensive and upload paths, webhooks excluded).
- **`docs/OPS_RUNBOOK.md`** gained an incident runbook: triage, rollback, pool exhaustion,
  disk, under-attack, compromise, third-party outages.

### Two things Pete needs to decide

1. **Cloudflare Pro (~$20/mo).** The free plan gives one rate-limiting rule with a
   ten-second window and a ten-second block, and no managed WAF. That is the ceiling on what
   Cloudflare can do for us today. Detail in `docs/OPS_RUNBOOK.md` → "Under attack".
2. **Retention windows** (Batch 3/4: how much chat history, how many photos, for how long).
   Possibly a question for a lawyer, not just a product call.

### Correction to the review — read this before acting on it

The review claimed the Cloudflare proxy could be bypassed by hitting the Railway origin
directly. It cannot: `ab31xrt3.up.railway.app` returns Railway's own "train has not arrived"
404, because Railway routes by Host header. **The "origin lock" finding is downgraded** —
do not spend time on it.

---



**Aug 19, 2026, 10pm ET · baseline v1.105.113 on `main`, staging and prod both current.**
Nothing uncommitted, nothing half-finished. Fourteen releases tonight, all user-driven.

> If `git log` disagrees with this section, trust `git log`.
> **⚠️ Pete's mounted checkout runs stale.** Run `Sync InPlace.command` before reading
> anything in `~/Documents/Claude Working Folder/kincare-repo` as current.

---

### Do this first

Nothing is mid-flight, so pick a lane:

**A. Verify last night's work reached the people it was for.** Three unconfirmed, in order of
consequence:

1. ~~**Does Pete's admin account have a push subscription at all?**~~ ✅ **ANSWERED Aug 20 — it
   does, and the follow-on theory was wrong too.** `GET /api/push/status` as Pete returns
   `{vapidConfigured: true, userSubscriptions: 4, ready: true}`. A second theory — that his
   `role` is `family` rather than `admin`, so an admin fan-out would skip him — is **also
   dead**: the fan-out never reads `role`. `sendPushToAdmins` selects
   `FROM users WHERE is_admin = 1`, and `/api/auth/me` returns Pete with `is_admin: true`.
   **`role: family` and `is_admin: true` live on the same row — never infer admin-ness from
   `role`.** The chain is intact end to end: `caregiveronboarding.js:337` and
   `selfOnboarding.js:263` both lazy-`require("./push")` and call
   `notifyAdmins("identity_submitted", …)` → `push.js:310` fans out to push + email →
   recipients `WHERE is_admin = 1` → opt-out is `prefs['push_' + eventType] === false`, and
   Pete's `notification_prefs` holds only `{email_new_registration: false}`.

   **AND THE LAST TWO PIECES ARE NOW CLOSED TOO (Aug 20).**

   *Why Julia's submission was silent:* **there was no code to notify anyone.** `notifyAdmins`
   itself is old — v1.13.1, Feb 22 — but the `notifyAdmins("identity_submitted", …)` call was
   added to `caregiveronboarding.js` and `selfOnboarding.js` on **Aug 18 in v1.105.68**, in the
   commit literally titled *"she sent in her ID, was told it worked, and nobody was told."*
   Julia submitted before that shipped. Nothing is broken; the gap was real and is already
   fixed. Do not re-open this.

   *Subscription health:* all four are live. `POST /api/push/test` as Pete on Aug 20 returned
   `{success: true, sent: 4, total: 4, removed: 0}`. Since `sendPushToUser` deletes on 403/404/
   410/401 and prunes after `MAX_FAIL_COUNT`, a clean 4-of-4 with zero removals means no dead
   endpoints. `POST /api/push/test` is the cheapest subscription-health probe there is — it
   answers the question AND garbage-collects, no SQL needed.

   **Method note:** every single 🔴 this handoff carried has now been disproved — the push red,
   the `role` lead, and geolocation (twice). Each fell to one same-origin fetch. **A handoff is
   a lead sheet, not evidence.** Re-check before you build on it.

   *Ops note:* live SQL was NOT available this session. Railway's Database → Data tab hung on
   "Attempting to connect", and typing into the Railway web Console is blocked by a classifier.
   When you need prod data, look for an API route that already answers the question.
2. **Does Julia's Find Work card show "Betty" now?** v1.105.107 split trust from Stripe;
   v1.105.108 makes the card say which input is false if it still doesn't. Nobody has looked
   at her screen since.
3. **Is the Doc Review queue empty?** Pete approved his and Julia's on Aug 19. Since
   v1.105.112 every new signup lands there, so a non-empty queue is now normal, not a bug.

**B. Run the feedback loop.** Full cycle in this file below. Sweep Sentry as PART of it, not
after — on 7/29 the queue had one item while Sentry had a P0 blocking every caregiver signup.

**C. Take something from TASKS.md.** The P0/P1 list is empty as of tonight. What is left is
the P2 tail and two long-standing items in "Open" below.

---

### Ground rules for pushing

Fresh clone — **never write-mode git in the mounted repo** (FUSE cannot unlink; the orphaned
`.git/index.lock` is Pete's to clear by hand):

```bash
PAT=$(grep -o 'github_pat_[A-Za-z0-9_]*' "$HOME/Documents/Claude Working Folder/kincare-repo/.git/config" | head -1)
git clone "https://x-access-token:${PAT}@github.com/peterjslee-coder/kincare-app.git" /tmp/kc
```

```bash
npm run lint:client && npm run lint:requires && npm run lint:sql-columns
npx jest                                                                            # ~1,130
npx jest --forceExit --runInBand --testMatch "**/tests/integration/**/*.itest.js"   # 197
```

`npm test -- <name>` does **not** filter — the script ends in `--testPathIgnorePatterns`, so
your argument is appended to *that* and the named test is EXCLUDED. Use `npx jest tests/<file>`.

Bump `APP_VERSION` in `src/server.js` · `node scripts/build-client.js` · commit **from a file**
(backticks in `-m` are eaten by the shell) · push `HEAD:staging` then `HEAD:main`.

---

### Three rules earned tonight

1. **A checklist item has THREE states — done, not done, and NOT KNOWN YET — and the third
   must never draw as the second.** (v1.105.112.) Same family as "a broken feature and a
   switched-off feature look identical."
2. **News is dismissed by being seen; work is dismissed by being done.** Never let a
   seen-snapshot suppress a queue. (v1.105.113.)
3. **Confidence is the weakest link you measured, not the strongest.** A 97% document read
   beside a 40% face match is a 40% answer.

---

### Two things that are now true and were not yesterday

- **⚠️ IDENTITY IS A HUMAN GATE.** The AI never writes `approved`; status is always `pending`;
  below 90% confidence it records no opinion at all. Only an admin approves.
  `src/utils/identityDecision.js`. Anything reasoning about this gate should know that the old
  comments claiming otherwise are gone. Lawyer agenda **L1b closed**.
- **Every signup waits on Pete.** Deliberate. If IDs pile up, that is the design working.

### Open — needs hands, not code

- **GPS check-in is unverified on a real iPhone — but NOT for the reason older notes give.**
  ✅ `@capacitor/geolocation` **is** installed (`^8.2.1`, added v1.105.67), wired through
  `_capPlugin('Geolocation')` in `public/js/utils.js`, declared in `ios/App/CapApp-SPM`, and
  the Info.plist strings went in at v1.105.58 after Apple's ITMS-90683 on Build 8. Any note
  saying the dependency is missing is stale — including the paragraph in `utils.js` that
  describes the original diagnosis in the present tense.
  What is genuinely open: **nobody has stood at a real address with the native build and
  confirmed a check-in captured a location.** Pete's `web:denied(1)` at his mother's house was
  the PWA path, which is not the path that ships. The safety proposition rests on it.
- **Julia is still "Full access"** on Betty's team and should be Viewer.

### Do NOT redo

- `scripts/repair-support-dm-split.js` (v1.105.104). Pete: *"i don't care about the chat with
  julia… i just want it fixed going forward, even if there are two."* Documented in
  `docs/OPS_RUNBOOK.md` if ever wanted.
- Tyler's 1-of-7 First Steps redesign. Superseded by the onboarding track.
- Anything in the "Already done" table of `Onboarding_Path_Plan_2026-08-19.md`.

### Onboarding is a separate track

`Onboarding_Path_Plan_2026-08-19.md` (Working Folder). Pete picked direction B, "the path".
**Read it before touching any onboarding screen.** It carries its own ordered next steps and
its own list of what NOT to redo. No backend changes.
