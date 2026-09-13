# Session handoff

> ⚠️ **This handoff is a lead sheet, not evidence, and it goes stale fast.**
> The snapshot below was written on **Aug 19, 2026 at v1.105.113**. HEAD is far past it.
> **If `git log` disagrees with anything here, trust `git log`.** Every single 🔴 this
> handoff originally carried was later disproved. Re-check before building on it.
>
> Overwrite this file at the end of a working session; do not append.



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
