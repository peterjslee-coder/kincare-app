# InPlace Tasks

> **How this works:** Add bugs and features below as you find them. Don't worry about wording or order. When you're ready for a dev session, say "let's work the task list" and Claude will batch everything together into one efficient push. Nothing gets executed until you say go.

## Bugs

> Open bugs ranked P0–P4. P0 = blocks users or creates liability. P1 = significant UX issue. P2 = moderate improvement. P3 = nice-to-have. P4 = aspirational.

### P0

> **Aug 19 2026 — feedback loop.** 16 new items from THREE real users now: Pete, Julia and
> Tyler Huth. Sentry clean, zero unresolved. Two of these are regressions in work I shipped
> yesterday; one is a dead end I created.

- [ ] **⛔ Phone and video calls never ring.** (8d27e33c, mood "terrible") Pete: *"Phone and
      video calls do not ring or notify the user until I push notification after the call."*
      A call feature that cannot summon the person is not a feature. Related and probably the
      same area: the call buttons have VANISHED from chat — Pete (e452db48) *"I don't see the
      video call or phone options in the chat anymore. Where are they?"* and Julia (d378b267)
      *"The call button is hidden."* Two users, independently, same day. **P0**

- [x] **⛔ "Welcome to InPlace!" popup cannot be dismissed.** (8a05e737, Tyler) *"does not go
      away at all or when navigating to new screens."* ✅ **Fixed v1.105.101.** Not a modal —
      the `verifyMessage` banner in `app.js`, rendered above `renderPage()`, so it is app-level
      state that no page change touches. It is set the instant he accepts the legal docs, which
      happens BEHIND the full-screen `DisclaimerModal`, so he never saw it appear; it simply
      materialised over the app and stayed. And the only dismissal was a bare 16px `×` with no
      padding — about a **10x18px tap target** against Apple's 44x44 minimum, so *"does not go
      away at all"* was literally true: he was tapping it and missing.
      Success banners now clear themselves after 6s (errors never do — an error is the only
      thing telling the user what went wrong; and not on the login page, where *"Email verified!
      Sign in to continue."* is an instruction they may still be reading). Both dismiss buttons
      meet 44x44 and carry `aria-label`. `tests/verifyBannerDismissal.test.js` (9).
      Side effect worth noting: `app.js:2021` suppresses the *verify your email* nudge while a
      `verifyMessage` is up, so a stuck success banner was also permanently hiding it.

- [x] **⛔ Decline STILL fails for Julia — and it is my design error, not a stale bundle.**
      (17b2434c) *"Still not working when I press 'Decline Request.'"* v1.105.91 fixed the
      SERVER to accept `offered_to_caregiver_id`. What it did not fix is that the "Can't make
      it" button renders on EVERY job that is not your own request, including open-pool jobs
      where nobody was named — and the server correctly 404s those, because you decline an open
      job by not claiming it.
      Worse, `dashboard.js:51-68` expires an exclusive offer by clearing
      `offered_to_caregiver_id` and setting the session back to `open`. So a request that WAS
      directed at her becomes an open job after its window, and the button that worked yesterday
      stops working today with no visible change.
      **Two things to decide:** (a) hide the button unless the job is genuinely directed at her
      — the dashboard needs to send that flag, it does not today; and (b) decide what an open
      job should offer instead — probably "not for me", which hides it from her list without
      telling a family that nobody named has declined. Do not just widen the server check:
      declining a job you were never offered has no meaning to send to the family. **P0**

      ✅ **Fixed v1.105.100.** `dashboard.js` now sends `isDirectedAtMe`
      (`offered_to_caregiver_id` OR `caregiver_id` === me); `CaretakerHub` shows "Can't make it"
      only for those, at both job-card sites. Open jobs get **"Not for me"**, which hides them
      on the device and tells nobody — a family should not hear that a caregiver they never
      approached passed on their job. A job directed at her is never hidden that way: that one
      needs an answer, and quietly removing it would turn a request into silence.
      `tests/declineButtonVisibility.test.js` (8).


> **Aug 4 2026 — code + task review.** Two agents swept the client and the server for every
> failure pattern this codebase has already been bitten by; every finding below was verified
> against the code before being written down. 13 stale items were closed, 5 stated causes were
> corrected, and the confirmed defects shipped as **v1.105.35**. The P0 list below used to hold
> exactly one item, closed since March — which meant anyone opening this file saw an empty P0
> and concluded nothing was urgent. These are the things that are.

- [ ] **⛔ REMOVE THE GEO STATUS LINE FROM THE TOP OF THE DASHBOARD as part of fixing GPS.**
      Pete, Aug 18: *"the gps checkin text at the top of my screen…it's not useful. if we need
      to keep it there until we are able to fix the check in location, fine. but it's not
      staying there long term."* His call: it stays for now, it does not stay permanently.
      `VisitNudgeCard` (`FamilyVisitLog.js`) renders directly under the greeting in
      `Dashboard.js`. When you are opted in but not within 1,000 ft it renders `VisitGeoStatus`
      — *"N ft from <name>'s at last check… check now"* — and when permission is unavailable,
      which is the branch iOS lands in, it renders the `VisitGeoInvite` opt-in card.
      **Do not just delete it.** Both were added deliberately: v1.105.45 and v1.105.59, because
      when it rendered nothing "the feature was on and looked identical to the feature being
      broken, which is the whole complaint." It is a stand-in for a check-in that does not work
      yet. The moment GPS check-in is genuinely working on a real device, the stand-in has no
      job and comes off the home screen — move it into the Log Visit sheet or a settings row if
      the diagnostic is still wanted. Removing it BEFORE GPS works would restore the exact
      ambiguity .59 was written to kill. **Tied to the P0 below — same piece of work.**

- [ ] **⛔ Verify GPS check-in actually works on a real iPhone before submitting.** `@capacitor/geolocation` is NOT in `package.json` or `node_modules`, and nothing calls `requestWhenInUseAuthorization()`. The Info.plist string alone may not satisfy `navigator.geolocation` in WKWebView. If it doesn't, **check-in — the app's entire safety proposition — is broken on every iPhone**, and you find out after submission. Needs Pete + a real device. **P0**
- [x] **⛔ AI not-medical-care acknowledgment — SHIPPED v1.105.37.** One string defined once (`IPAI_NOT_MEDICAL` / `<IPAiDisclaimer>` in `IPAiBadge.js`) so the surfaces cannot drift apart: *"iPAi does not provide medical care. It can only reflect what your care team has recorded."* Carried by the care-intelligence card and the iPAi chat thread — in chat it sits with the COMPOSER, not only on the empty state, so it is on screen while an answer is being read rather than once before anyone asks. Person-to-person threads deliberately do not show it. The doctor-report path already had its acknowledged-send flow. Pinned by `tests/aiAcknowledgment.test.js`. **The age-rating answer *Medical or Treatment Information = Infrequent* is now defensible.**
- [x] **🔒 No-passkey impersonation bypass — DECIDED Aug 4: leave it alone.** Pete's call, asked and answered. `src/routes/admin/access.js` grants a bypass when the admin has no passkey on file (logged, then proceeds). Closing it could lock him out of Test Mode on a device with no passkey registered, and that costs more than the gap does. **Do not re-raise this; it is a decision, not an oversight.**


- [x] **Timezone architecture — P0 fix complete (v1.50.21, Mar 19).** All time-sensitive backend operations now use care recipient's timezone (`care_recipients.timezone` column) instead of hardcoded Eastern. Fixed: (1) notification poller queries JOIN `care_recipients` and use per-session timezone for timing decisions, (2) check-in gate and late detection use `buildDateTimeInZone(date, time, careTz)` instead of naive `new Date()` parsing, (3) check-out early-minutes calculation uses care timezone, (4) accountability pollers (payment auth, late check-in, no-show) all use per-session timezone, (5) cancellation late-cancel detection uses care timezone, (6) poller date filter widened to cover all US timezones (no more single-timezone `scheduled_date = today` filter). Frontend `TimezoneHelper.js` and backend `src/utils/timezone.js` already existed — the fix was threading the timezone through all callers. ✅ Fixed v1.50.21
  - **Real-world example (Mar 19):** Pete is in Texas (CST). Betty's care is in Virginia (EST). Betty has an 8:00 AM EST appointment. Pete should get the "almost time" push notification at 6:45 AM CST (= 7:45 AM EST, 15 min before). Previously fired 45 min late because push timing used default Eastern without per-session lookup. Now fixed — poller reads `cr.timezone` per session.
  - **Real-world example (Mar 19):** Cary checked out early from a 4-hour session in Virginia. Her phone clock was 1 hour behind EST. The app computed duration using naive date parsing, making it look like she left 2 hours early instead of 1. Now fixed — check-out duration uses `buildDateTimeInZone` with care recipient's timezone.
  - **Core rule: All timing is anchored to where care happens.** Push notifications, check-in/check-out gates, session duration calculations, pay calculations, and dashboard displays must all use the care recipient's timezone. The caregiver's or family member's device timezone is irrelevant for session timing.


> **Aug 11 2026 — silent-failure sweep, round two.** Five parallel audits over `src/` and
> `public/js/`, one per recurring root cause from the v1.105.4x–5x run. Every finding below was
> verified against the code — the producer AND the consumer traced — before being written down.
> **Five shipped as v1.105.60** (doctor-report visit join, family-dashboard 200-on-error,
> badge-clearing 200-on-error, the Apple-link unhandled rejection, invisible block requests).
> The rest are listed here rather than fixed, so nobody re-derives them at 2am.
>
> The through-line, again: **a broken feature and a switched-off feature look identical.** None
> of these logged anything a user would see. Several have been live since the feature shipped.

- [x] **⛔ SHIPPED v1.105.65 — features that had never once worked.** All six wrong column/table names fixed; only the explanatory comments remain in the source. Verified against the code Aug 18. `lint:sql-columns` now guards the class. Each is a wrong column or
      table name that throws on every call into a `catch` that logs and returns empty. To a user
      the feature simply isn't there. All are one-line fixes; the work is verifying the intended
      column, not writing the change. **P0 as a group — this is what "silent" costs.**
  - `src/utils/nlScheduling.js:38,189–199` — **five** nonexistent columns (`cr.family_id` →
    `family_user_id`, `cp.experience_summary`, `cp.skills`, `av.user_id` → `caregiver_id`,
    `av.date` → `specific_date`, `u.status` → `is_active`). `POST /api/scheduling/natural` 500s
    on **every** request; it is mounted at `server.js:431`. Also `av.type != 'unavailable'` is
    vacuous — the column only ever holds `'available'` or `'blocked'`, so blocked slots would
    read as available even once the names are fixed.
  - `src/utils/careIntelligence.js:659` — `cr.mobility` does not exist. **iPAi caregiver
    coaching has never been generated for any visit**; `visit_logs.ai_coaching` is always NULL
    and the `ipai_coaching` socket event never fires. Swallowed at `sessions.js:1993` as
    "(non-blocking)".
  - `src/utils/kindredBrain.js:96` — `cs.care_type` does not exist (`care_sessions` has
    `service_type`). Kindred never has scheduled-visit context; ask it when a caregiver is
    coming and it answers as though nothing is booked.
  - `src/routes/admin/sessionOps.js:89,250` — `UPDATE visit_logs SET … updated_at = NOW()`;
    there is no `updated_at` on that table. Admin **restore session** and **force check-in**
    500 whenever a visit log already exists.
  - `src/routes/kindred.js:1382,1388` — `users.ipai_access` does not exist (it is
    `companion_access`). The admin iPAi-access toggle always 500s.
  - `src/utils/careIntelligence.js:88` — `reviews.reviewer_id` does not exist. Log noise only
    today, since the `reviews` result is never used in a prompt — but it is a wasted round trip
    on every call and the next person to use that variable inherits an always-empty array.

- [x] **⛔ SHIPPED v1.105.66 — `withPollerLock` double-charge.** Stripe PaymentIntents now carry an idempotency key (`payments.js`). Verified Aug 18. `src/models/database.js:2236–2259` races
      the tick against a 120s deadline with `Promise.race`, which does **not** cancel the work.
      On timeout the `finally` releases the advisory lock while the original tick is still
      running — overlap protection is void in exactly the case it exists for. Poller 105 is
      auto-pay: `processOverduePayments` creates a Stripe PaymentIntent *before* inserting the
      `payments` row its own re-entry guard reads, Stripe's default is 80s/attempt with retries,
      and **there is no idempotency key on the PaymentIntent**. Reported only as
      `console.error`, never `captureException`, so it would not reach Sentry. **P0.**
  - Related, same helper: the release itself is an unbounded `await client.query(pg_advisory_unlock)`
    in the `finally`. A half-open connection means the client is never released (pool of 10) and
    the lock is never freed — that poller is dead until the process restarts, silently.
    `idle_in_transaction_session_timeout` does not cover it: the session is idle, not in a
    transaction.

- [ ] **⛔ Untimed outbound calls — the same bug already fixed in `src/utils/`, still live in
      `src/routes/`.** Node's global `fetch` has no default timeout at all, and the Anthropic
      SDK default is 600s × 2 retries ≈ **30 minutes**. The user-visible result is an infinite
      spinner indistinguishable from a dead feature, and nothing logs during the wait. **P0 for
      the auth-path ones, P1 for the rest.**
  - **Raw `fetch`, unbounded forever:** `src/utils/aiMatching.js:357` (called in a loop from
    `GET /api/matching/ranked` — "find me a caregiver" never returns) and
    `src/utils/nlScheduling.js:69` (which `ipaiChat.js:55` calls *after* correctly setting a 30s
    client timeout, bypassing it entirely).
  - **`new Anthropic()` with no `timeout`/`maxRetries` at eleven route sites:**
    `careRecipients.js:565,739,884` (doctor report + questions + care profile),
    `caregiveronboarding.js:179` and `selfOnboarding.js:28` (**identity verification**, vision,
    two base64 images), `sessions.js:1288` (pre-check-in briefing), `careEvents.js:161`,
    `ipaiChat.js:291`, `kindred.js:963` (the summarizer that raises **abuse flags**),
    `careIntelligence.js:157,221`. Every file in `src/utils/` already passes
    `{ timeout: 30000, maxRetries: 1 }` — copy that.
  - **Resend has no default timeout** (`src/utils/email.js:67`) and is awaited inline on
    `passwordReset.js:39` — **forgot password hangs forever** and the user never learns whether
    the mail was sent. Same at `careTeams.js:364,444`, `consent.js:284,664`, `waitlist.js:14`,
    `reports.js:241`, `careRecipients.js:1079`, `admin/people.js:679`.
  - ElevenLabs ×5 (`src/utils/voiceService.js`) — the companion goes silent with no error, and
    `kindred.js:376` throws away an already-completed Claude answer while it hangs.
  - R2/S3 client built with no `requestTimeout`/`connectionTimeout` (`src/utils/storage.js:49`,
    AWS SDK v3 defaults to unlimited + 3 retries) — reached by every document, receipt and ID
    upload/download. Env-gated, which is the only reason it hasn't bitten.
  - `payments.js:1541` — an untimed loopback `fetch` to our own `/api/checkr/initiate`, awaited
    **after the card is charged**, with a comment claiming it is non-blocking.
  - No handler-level deadline anywhere: `server.js`'s `requestTimeout` bounds *receiving* a
    request, not producing the response. One `res.setTimeout` would convert this whole class
    from "infinite spinner" into "visible error".

- [x] **SHIPPED v1.105.77 — predicates that read like filters and filtered nothing.** The
      no-show poller's `NULL NOT LIKE` (it had never fired for a session confirmed inside the
      reminder window, after its start time, or while the poller was down); `login_failed`,
      an action written nowhere, so "failed logins (24h)" was hard zero and credential stuffing
      read as a clean night; the `warn`/`warning`/`error` vocabulary split that hid five audit
      rows from Admin → Monitoring, now one constant in `src/utils/auditSeverity.js`;
      hardcoded `0 AS flagged_pending`; and a sessions chart that omitted `in_progress`.
      Pinned by `tests/vacuousPredicates.test.js`, which also sweeps for any new unguarded
      `NOT LIKE` on a nullable column.
      **Note:** the old entry claimed 14 `'warning'` call sites. Nine of those are business
      insight objects in a `financials.js` API response, not `audit_log` rows. Five were real.

- [ ] **(superseded) Predicates that read like filters and filter nothing.** Same family as the `is_read`
      column that produced the app-icon 78. **P1.**
  - `src/routes/accountability.js:814` — `cs.notifications_sent NOT LIKE '%no_show_flagged%'`
    on a nullable column with no default. `NULL NOT LIKE` is NULL, so the row is excluded: the
    **no-show poller never fires** for a confirmed session that never got a reminder (confirmed
    inside the 15-min window, or after start time, or while the poller was down). The four
    sibling queries in `server.js` all guard this with `IS NULL OR …`; this one doesn't.
  - `src/routes/admin/reviews.js:438` — counts `action = 'login_failed'`, which is **never
    written** (`auditLog.js:14` writes `login_attempt` and escalates severity). The admin
    briefing's "failed logins (24h)" is hard zero forever — a credential-stuffing run reports
    as a clean night.
  - `src/routes/admin/monitoring.js:93,187,222` — filters `severity IN ('critical','error')`
    but 14 call sites write `'warning'` (`checkr.js` ×5, `admin/access.js`). Background-check
    flags, expirations, suspensions, disputes and admin access grants are written to
    `audit_log` and never surface in Admin → Monitoring. The security panel looks quiet.
  - `src/routes/admin/overview.js:32` — `consent_status = 'attestation_pending'` is never
    written. The consent-review badge counts untouched recipients and **never counts the ones
    who have actually attested and are waiting on admin verification** — the queue that needs
    action. `admin/verification.js:342` gets this right; copy it.
  - `src/routes/admin/reviews.js:418` — `0 AS flagged_pending`, hardcoded, then tested with
    `> 0` at `:510`. The briefing can never mention flagged reviews. The real number is
    computed correctly 200 lines earlier at `:185`.
  - `src/routes/financials.js:233` — `status IN ('completed','confirmed','checked_in','scheduled')`;
    the last two are never written. The admin sessions-per-day chart silently omits every
    `in_progress`, `pending`, `open` and `negotiating` session — a visit being delivered right
    now is not counted.

- [ ] **A test that asserts nothing, guarding the surveillance line.**
      `tests/familyVisits.test.js:81` slices `route.indexOf("SELECT fv.id")` →
      `route.indexOf("FROM family_visits")`, and since v1.105.46 added a dedupe query earlier in
      the file the **end marker now precedes the start** — `listQuery` is `""` and the assertion
      is vacuous. It is the guard that stops `latitude`/`geo_flag` reaching the team-visible
      list. The route is correct today; adding a column would ship green. Three more slices are
      `-1` and currently passing by luck: `tests/apiTimeout.test.js:40` (uses a `//` comment as
      a marker, which `code()` strips — structurally guaranteed to fail),
      `tests/attentionBadge.test.js:156,242`, `tests/familyVisits.test.js:149`. **Bounds-check
      every source slice**; `tests/silentFailures.test.js` has a `region()` helper that does.
      **P1.**

- [ ] **Errors that render as reassurance — the server half.** Same shape as the two fixed in
      v1.105.60. Each answers 200 with an empty or zeroed body on an internal error. **P1,
      safety-relevant ones first.**
  - `src/utils/attention.js:25–34` — `safe()` swallows each of four sub-queries to `0` and sums
    them. One failing query means a **smaller badge number**, pushed to the phone as
    authoritative and written to `push_subscriptions.last_badge`, where it sticks. "3 care tasks
    are due" becomes silence.
  - `src/routes/push.js:883` — notifications → `200 {notifications: [], unreadCount: 0}`. Care
    alerts and no-show notices vanish into "nothing new".
  - `src/routes/careRecipients.js:767` — doctor-report clarifying questions → `200 {questions: []}`,
    which reads as "iPAi reviewed the notes and had none". That step exists specifically to
    catch sparse-data bias before a doctor-facing document is drafted.
  - `src/routes/dashboard.js:238` — pending **time proposals** `.catch(() => [])`. The family
    never sees the caregiver's schedule-change request and the 2-hour window expires without
    them. `:619` does the same to the caregiver's own sent proposals.
  - `src/routes/matching.js:200` — a caregiver that fails to score is `continue`d out, and the
    partial list is then `.slice(0, limit)` and presented as complete.
  - Money/cosmetic tier: `payments.js:605` (tells a family with a card on file to set up
    payments), `reimbursements.js:942`, `geocode.js:77`, `ipaiChat.js:328`,
    `admin/overview.js:146–180`, `admin/reviews.js:366–409`.

- [ ] **Errors that render as reassurance — the client half.** 276 `if (res.ok)`-with-no-else
      blocks exist; ~262 are the background reads we deliberately deferred. **These 14 are not
      deferrable** — they are safety data or the entire content of a screen someone navigated to
      on purpose. **P1.**
  - Cards that **vanish entirely** on failure (worse than an empty state — the profile looks
    like one where the feature was never set up): `CareTasks.js:403` (**medication reminders**)
    and `CareEvents.js:285`. Both servers return a correct 500; the client throws it away.
  - `Dashboard.js:141,152` — today's care tasks and upcoming events drop out of **Next Up** with
    no row, no badge, no toast. A due medication reminder is simply not there.
  - Screens whose only content is the failed fetch, rendering a reassuring empty state:
    `Schedule.js:30` ("No care sessions scheduled yet" — a family checking whether anyone is
    coming tomorrow), `ActivityFeed.js:10` ("No activity yet"), `CaredForView.js:35` (the
    recipient's own view), `CaregiverCalendar.js:66` (explicit `setCareRequests([])` on both
    failure paths — a caregiver doesn't claim a shift that was waiting), `CareTeamPage.js:8`.
  - `CareProfile.js:538,550` — notes and family visits both collapse to "No notes yet. Add one
    to share care observations with your team." These are the observations the doctor report is
    generated from.
  - `Documents.js:155,186` — per-recipient fetches swallowed **inside a loop**, so recipient A's
    POA and advance directive are absent while B's are present, with nothing marking the
    difference. Consent likewise reads as none-on-file.
  - `ConsentVerification.js:52` — an already-uploaded authorization document reads as never
    uploaded, and the UI offers to upload it again.
  - `MyAccount.js:625` — `setPreferences({})` on three paths renders **every notification
    toggle off**, including `med_reminders`; saving from that screen then persists it.
  - `AdminPanel.js:150` — safety flags → "No flags match this filter."
  - `Messages.js:1286` — block-preview consequences fall back to generic prose.
  - `FindWork.js:232` — sets `jobsLoadFailed` on `!res.ok` but **not in the catch**, so an
    offline/DNS failure takes the ⚠️ path's opposite branch and the caregiver reads "No open
    requests." The correct UI already exists at `:850`; it is one line.

- [ ] **Capability guards written against Chrome — the WebKit tail.** Same root cause as the
      geolocation and `setAppBadge` misses. **P1.**
  - `Documents.js:1523` — **PDF care documents render as a blank white box on every iPhone**
    (insurance card, POA, DNR, med list). WebKit will not render a PDF in a subframe. The fix
    already exists in this codebase: `AttachmentViewer.js:30` has `isWebKitLike()` and an
    "Open PDF" button, added v1.105.49, and the two files share a bundle scope. Same blank box
    in the admin document modal, `AdminPanel.js:4929`. Secondary: `handlePreview` never resets
    `previewFileUrl`, so a failed fetch shows the **previous document**.
  - `AttachmentViewer.js:274` — that iOS fallback is itself dead **inside the native app**: it
    hands a `blob:` URL to `Browser.open`, and SFSafariViewController accepts only http/https.
    `openExternalUrl` returns `true` so neither fallback runs, and the return value is
    discarded. The "Save" button beside it works — offer that instead.
  - `TwoFactorSetup.js:55` — the **2FA backup-codes** copy button. Its fallback targets
    `#backup-codes-text`, an element that **does not exist anywhere in the repo**, and
    `navigator.clipboard` is dereferenced unguarded so it throws synchronously before `.catch`
    can run. These are the only way back into an account whose authenticator is lost.
    `DisclaimerModal.js:111` has the correct shape.
  - Three clipboard writes that toast success unconditionally, one line after an unawaited or
    optional-chained call: `CaretakerHub.js:2838` (the referral link — the caregiver pastes
    nothing and loses the credit), `CareProfile.js:1067` (the drafted doctor report),
    `MyAccount.js:1069` (whose `.catch(() => {})` also hides a real share failure behind
    user-cancel).
  - `HourReports.js:70` — `window.print()` is a **no-op in both native shells**, under copy
    promising "you can download it as a PDF". A caregiver's school-credit hours.
  - `AdminPanel.js:1617` — the one export `saveBlob` missed (waitlist CSV): `<a download>` is
    not implemented in WKWebView, and `revokeObjectURL` fires synchronously on the next line,
    racing the download even on desktop. `:6656` — `window.open('', '_blank')` returns `null`
    in the WebView with **no else**, so tapping a caregiver's uploaded ID does nothing at all.
  - `Messages.js:910` — an **incoming call never rings** for anyone whose permission is
    `'default'` (i.e. anyone who dismissed the prompt). It calls `Notification.requestPermission()`
    from a hidden document, which has no user activation, so the state never changes and the
    `return` on the next line skips the notification on every subsequent call, forever.
  - `navigator.storage.persist()` is never called, so the IndexedDB offline check-in queue is
    evictable under iOS's 7-day policy in a non-installed PWA.

- [ ] **Work computed and thrown away.** **P2 unless noted.**
  - `FamilyVisitLog.js:388` — "check now" destructures only `pos` from `getDeviceLocation()`,
    discarding `reason`/`tried`/`detail`. With Location Services off it flips to "checking…",
    flips back, and changes nothing — no message, no Sentry report. `VisitGeoInvite.enable()`
    sixty lines above does it correctly. This is the v1.105.59 failure family on the component
    v1.105.59 added. **P1.**
  - `src/routes/careTeams.js:364,444` — `sendEmail`'s `{success, error}` discarded, then
    "Invite resent to …" printed regardless. The **resend** endpoint exists because the first
    one didn't arrive, and it reports success on a second failure too. `careRecipients.js:1079`
    and `consent.js:284` do this correctly. **P1.**
  - `src/routes/familyVisits.js:96–108` — `latitude`, `longitude`, `distance_ft`, `geo_flag`,
    `logged_via` are written on every insert and **read by nothing** — `shape()` strips them,
    no admin screen, no export, no report. Coarsened home-proximity coordinates for family
    members retained indefinitely for no feature. (`visit_logs.check_out_distance_ft` and
    `check_out_geo_flag` likewise.) Either wire a consumer or stop writing them; this is the
    kind of thing the lawyer list exists for. **P1 — retention, not correctness.**
  - Socket events emitted with no client listener: all five `interview_*`, plus `checkin_nudge`,
    `family_no_show`, `late_resolution`, `proposal_expired`, `reminder_delivered`,
    `ipai_coaching`, `ipai_session_summary`, `new_feedback`. Declining, completing or cancelling
    an interview updates nothing on the other party's screen until reload. All are paired with a
    push, so only the real-time half is dead.
  - `src/middleware/validate.js:164` — `validateMessage` is defined, exported, and mounted on no
    route. `MAX_LENGTHS.text` (2000) is never enforced; message length is bounded only by the
    global body limit. A validator that looks installed and isn't.

- [x] **SHIPPED v1.105.39 — PHI on lock screens.** The push body is now `"<author> — tap to read"`; note content never leaves the app. Verified Aug 18.
      `body: \`${authorName}: ${content.slice(0,120)}\`` — the note text itself. The family-visit
      push was deliberately built to say nothing ("Pete added a note about Betty — Tap to read")
      for exactly this reason, and the existing note push was flagged to Pete as a copy decision
      rather than changed unilaterally. Still unchanged. **P1 — decide it.**


### P1

- [x] **The signup age gate gave a different answer depending on where the server was.**
      ✅ **Fixed v1.105.102.** `ageInYears` (`src/utils/age.js`) parsed the date of birth as
      bare calendar integers but read the reference date with `getFullYear/getMonth/getDate` —
      the **server's local date**. Two frames in one comparison, the exact class CLAUDE.md's
      timezone rule exists to prevent. Railway runs UTC and GitHub Actions runs UTC, so
      production and CI agreed and nothing ever showed; on a machine in Eastern time, every
      evening after 8pm the gate rejected people on their own 13th birthday — and that is how
      it was found, as `tests/integration/auth.itest.js` failing at 9pm ET and only at 9pm ET.
      Both sides now read UTC. `tests/age.test.js` gained a five-timezone invariance check
      (validated in both directions), and its `on()` fixture moved from local noon to UTC noon.
      This is a legal boundary that is part of the app-store age declaration, so it mattering
      only 1/6 of the day on one machine is not a reason to leave it.

- [x] **Messages show Pete as "InPlace support".** (7972ed90) *"I started messages between
      Julia and I and it is showing me as InPlace support. Not my name as a family member."*
      ✅ **Fixed v1.105.102.** **Seven** places asked "is there already a direct conversation
      containing these two users?" with a query that matched ANY direct conversation. Pete is
      an admin, so an `InPlace Support` thread between him and Julia already existed
      (`admin/safety.js` creates it) — and every one of those lookups found it. His personal
      messages went into the platform's thread: `messages.js` (create-conversation,
      send-to-recipient, read-thread-by-partner), `sessions.js` (interview request),
      `interviews.js`, `connections.js` (accept).
      The distinction the code was missing: **a personal DM has no name.** Its title is
      whoever the other person is. A NAMED direct row is a system thread — `InPlace Support`,
      `iPAi`, `Kindred (…)` — and that is a different conversation even though it holds the
      same two user rows. `src/utils/conversations.js` now owns `PERSONAL_DIRECT_WHERE`, and
      `POST /conversations` forces `name` to NULL for direct rows so a user's DM cannot
      impersonate the platform. `tests/integration/supportThreadIsNotADm.itest.js` (4).
      Not only a label problem: `safety.js:175` refuses to let anyone block "InPlace Support",
      so the merged thread was **unblockable** too.
      ✅ **The existing merged thread is repaired by v1.105.104** —
      `scripts/repair-support-dm-split.js`. I first told Pete the split would be guesswork.
      **It is not:** `messages.sender_label` already records it. `admin/safety.js` stamps
      `InPlace Support` on everything sent AS the platform; every ordinary send path leaves it
      NULL. The only unlabelled case is the other party's replies, which follow whatever they
      were replying to.
      Two outcomes: **CLEAR** (named `InPlace Support` but the platform never actually spoke —
      it was a DM wearing the wrong name, so clear the name, no message moves) and **SPLIT**
      (holds both — the personal half moves to a real DM). Report-only by default.
      ⚠️ The trap it avoids: a thread's visible history starts at
      `COALESCE(cm.joined_at, c.created_at)` (v1.105.92), so moving an old message into a newer
      DM delivers it into the **invisible** half — the repair would report success and Pete's
      messages would vanish. The destination is back-dated. Validated in both directions:
      without the back-dating, two integration tests fail.
      **Pete's call, Aug 19: do not bother running it.** *"honestly, i don't care about the
      chat with julia. you can nuke it if you want. i just want it fixed going forward, even if
      there are two."* Going forward is handled by v1.105.102. The script stays in the repo,
      documented in `docs/OPS_RUNBOOK.md`, if the duplicate threads ever become annoying —
      it is optional, not pending work.
      Noticed in passing, not fixed: `kindred.js` names its relay `Kindred (<name>)`, which is
      not in the reserved list, so `messages.js:113` retitles it to the Kindred system user's
      first/last name in the conversation list.

- [x] **The "Needs you" tile counts the wrong things and dead-ends on the right one.**
      (917f3787) Pete: five unread messages show there and should not — *"I wanted to show up as
      the notifications over the message pill"* — while the thing that DOES need him, Julia's
      time-change request, *"doesn't do anything. It is a dead end."*
      ✅ **Fixed v1.105.105.**
      **The noise:** unread messages left the tile AND the total. They already ride the message
      pill (`app.js` `unreadMsgCount`); counting them twice made the badge a number about
      correspondence rather than about decisions, against `attention.js`'s own stated
      definition — *a number here means YOU are the blocker.* The count is still returned, just
      not summed, so the card and the app icon still agree.
      **The dead end was literal.** The row's target page was `'sessions'`. **app.js has no
      such page** — `renderPage` falls through to `return <Dashboard/>`, so tapping it
      re-rendered the screen he was already on. Now it targets `dashboard` and carries the
      session id, and `tests/attentionCardTargets.test.js` checks every `page:` in the card
      against the pages app.js actually renders.
      **And a second, wider dead end found on the way:** `window.__pendingFocus` is SET in four
      places in `app.js` (a `?focus=` param, a push tap, two `session:<id>` paths) and was READ
      in exactly one component, `Reimbursements.js`. **Every `session:` focus was written and
      discarded** — the v1.105.72 discarded-value class again — so tapping a schedule-change
      *push* has never opened anything either. `Dashboard` and `CaretakerHub` now claim it and
      open the visit detail.
      `tests/attentionCardTargets.test.js` (14, validated against the pre-fix source),
      `tests/integration/attention.itest.js` (+4), `tests/attentionBadge.test.js` updated where
      it pinned the old total.

- [x] **Push notifications fire while you are looking at the very chat they describe** —
      and the message does not appear in the open thread. (97783012) *"I am on the messaging
      interface messaging Julia and I get push notifications that Julia has sent a message, but
      I don't see it in the chat. I have to back out."*
      ✅ **Fixed v1.105.102 + v1.105.103.** Two bugs braided, and they had different causes.
      **The message not landing** was the same defect as 7972ed90: TWO direct conversation rows
      existed between Pete and Julia (a personal one and `InPlace Support`), and the lookup had
      no `ORDER BY` and no `LIMIT`, so different calls could return different rows. Her message
      went into one; his open thread was the other; `msg.conversationId !== activeConvId` so it
      was never appended; backing out refetched and showed it. Fixed by v1.105.102.
      **The push** is v1.105.103: `src/utils/presence.js` tracks which conversation each SOCKET
      has open (socket-scoped — the same person on a laptop and a phone is looking at one of
      them), the client announces it and closes it on `visibilitychange` (a hidden page is not
      being read), and all four send paths in `messages.js` skip the push for a member who is
      reading that thread. Membership is verified server-side, an unknown answer means the push
      goes out, and a disconnect clears the entry — the failure direction is an extra push,
      never a swallowed one.
      Two more found in the same pass: the socket payload omitted `sender_label`, so a message
      from the platform showed the admin's real name when it arrived live and "InPlace Support"
      after a refetch; and the live append had no dedupe, so a socket reconnect could show the
      same message twice. `tests/openThreadPush.test.js` (20, seven of them running the
      registry rather than reading it).
      The duplicate Pete↔Julia rows are reconciled by the repair script under 7972ed90.

- [x] **A job shows two different rates.** (dc5e86b5, Julia) *"$24 and then $29 listed on same
      job (doesn't match up)."*
      ✅ **Fixed v1.105.106. She was right, and it was arithmetic, not taste.** Both job cards
      computed the money inline: `basePerHour = Math.round(baseCost / hours)` (whole dollars)
      and `effectiveTotal` rendered with `.toFixed(0)` — **two independent roundings of the
      same money** — and the total carried **no label at all**. A 1.2-hour job at $29 showed a
      `$24/hr` pill in the badge row and a bare `$29` in the detail line. 24 × 1.2 = 28.8, so
      multiplying what she could see never produced what she could see.
      `jobPay()` and `formatMoney()` in `utils.js` now derive everything from ONE total,
      round only at the end, and never round a rate independently of its total. She sees
      **$24.17/hr** and **$29 total** — and 24.17 × 1.2 = 29.00.
      (`estimated_cost` really is her take: `sessions.js` sets `caregiver_payout: estimatedCost`
      — "caregiver gets the full amount" — with the platform fee added on top for the family.
      So labelling it as what she earns is honest.)

      **And the second half — *"the 'Accept Job' button disappears and reappears but the
      description length stays the same"* — was not the expand toggle at all.**
      `exclusiveTick` was incremented every 30s purely to force a re-render and **never read**.
      Every place that asked "is this offer still exclusive?" called `new Date()` **during
      render** — twice, in the two filters that decide whether a job sits in "Just for You" or
      in Find Work, plus once per card for the countdown. So list membership depended on the
      wall clock at the instant React happened to render. Tap "Read more" on a job whose window
      had just lapsed and the split is recomputed: the purple section returns `null`, the card
      reappears further down, the Accept button goes and comes back — and the description is
      unchanged, because the description was never what moved.
      One `now` in state, changed only by the ticker; `exclusiveMinutesLeft` / `isExclusiveExpired`
      take it as an argument. The boundary can now only move on a tick.
      `tests/jobPay.test.js` (12), `tests/jobCardMoney.test.js` (7) — both validated against the
      pre-fix source.
      ⚠️ If Julia still reports the description not expanding, that is a THIRD thing and the
      next step is her client version (`GET /api/admin/client-versions`) — the 200-char server
      cut was removed in v1.105.91 and she has been on a stale bundle before.


- [ ] **Special rules for helpers under 18, before this goes beyond one family.** (Aug 18 2026.)
      v1.105.93 lets a minor of 13+ be added as a `helper` with exactly the capabilities the
      family owner ticks. Pete's deliberate call was no extra age handling for now: *"there may
      need to be some special rules applied to someone under 18. but we can add that later. this
      is just for my kids and their grandma at this point."* That is a sound call at this scale
      and a bad one at any other, so it needs closing before a second family uses it.
      What to consider when it comes back round: capping under-18s at write-only regardless of
      what is ticked (the Helper preset already is, but nothing enforces it); recording the
      parent's consent against the child's account rather than relying on the inviter being the
      parent; showing on the roster that a member is a minor; and whether a note authored by a
      minor should be annotated as such in the record.
      **Blocked on counsel** — Case A in `Legal/Lawyer_Agenda_2026-07-31.md`, updated Aug 18
      with the four sharpened questions now that a helper can be write-only. **P1.**


- [ ] **Caregivers can finish onboarding with no address, and then be findable by nobody.**
      (Aug 18, from Pete trying to book Julia.) The booking picker offers people with a prior
      session for this recipient, and people with coordinates in range. A caregiver who never
      gave an address has neither, so she cannot receive a FIRST booking from anyone — a cold
      start with no exit. v1.105.83 unblocks the case that matters most (an active
      `bg_admin_vouches` row for this family now makes her bookable), but the general problem
      stands for any caregiver a family has not vouched for.
      Pete's steer: *"we might need to ask to register their phone's location if they want to
      accept work around where they are otherwise...we may not get people's addresses in
      onboarding."* So the options are roughly: ask for an address in onboarding; or ask for
      device location with a clear purpose string and store a coarsened point (note
      `coarsenCoordinate` already exists in utils/geocode.js and the family-visit nudge sets
      the privacy precedent); or let a caregiver name a service area by town rather than a
      precise point. Also relevant: this is the same population as the GPS P0 — location
      permission on iOS is already unproven. **P1**


> **Aug 18 2026 — feedback loop.** 5 new items, all from Pete on iOS native 1.105.71, all within
> 100 minutes of each other while he was checking Julia's verification. Sentry swept as part of
> the loop: 3 unresolved, all low-volume (2 geolocation failures that corroborate the GPS P0,
> 1 bot probe). No hidden P0 this time.

- [x] **🔴 FIXED v1.105.75 — Julia was verified to the admin and unverified to herself.**
      Not two producers disagreeing: the client never asked. `checkIdentity()` and
      `checkStripe()` sat inside a `useEffect` opening `if (activeTab !== 'earnings') return;`
      and the hub opens on `'schedule'`, so on the landing screen both states held their
      initial values and both initial values read as "no". First Steps told an approved
      caregiver to photograph her ID and a connected caregiver to connect Stripe; `stripeStatus`
      is also a term in `_autoStepCount`, so that count could never reach 6, `mark-onboarding-
      complete` never fired, and `showFirstSteps` never went false — which is why the whole
      panel never went away. Both fetches now run on mount, and an unanswered fetch no longer
      renders as a denial. **Note for whoever reads this next: v1.105.68 fixed the VOUCH term of
      that same count and did not notice a second term was only fetched on a tab most caregivers
      never open. Check the other terms.**

- [ ] **(superseded, kept for the trail) Julia verified to admin, unverified to herself.**
      (feedback 52cbb793) Pete: *"Julia shows is completely verified on my side. When I am
      personally as her, it still has lots of complete your profile verify your identity. Crap
      she has to deal with. It's very confusing for her."* He saw this **through Test Mode from
      his own device on 1.105.71**, so this is NOT her stale 1.105.64 bundle — v1.105.70 fixed
      the two `setCurrentUser` sites in app.js and something ELSE is still telling her to verify.
      Suspects, in order: the caregiver First Steps list in `CaretakerHub.js` (the 'identity'
      step reads `idVerification.submitted` / `.verified` from
      `/api/caregiver-onboarding/identity-status`, a different source than `user.identityStatus`
      that MyAccount reads), and the impersonation token path. **Two surfaces disagreeing about
      the same fact is the whole identity saga repeating.** Trace BOTH producers before touching
      anything. **P0-adjacent — this is the one real caregiver's experience.**

- [ ] **🔴 Admin identity review: the selfie says 0% confidence, the ID says 97%.**
      (feedback 26c70f5a) Same submission, two documents, contradictory AI verdicts — and the
      readout does not link to the selfie it is talking about. An admin cannot act on this: the
      panel added in v1.105.71 (`aiExtractedRows`, `aiConcernList`) surfaces the AI's numbers,
      and the numbers disagree with each other. Given the AI auto-approves government IDs with
      no human asked, a 0%/97% split that nobody can reconcile is a liability, not a cosmetic
      bug. Also in the same report: **the page cannot be scrolled** (only the picture scrolls),
      and **"View photo" in Admin shows nothing** — Pete has to use View in People instead, and
      does not know why the two differ. **P1**

- [ ] **Admin page: cannot scroll to the danger zone; the ✕ hides behind the battery.**
      (feedback 0cddfaab) Two separate unreachable-UI bugs on one screen. The ✕ is a safe-area
      inset problem on iOS native — `env(safe-area-inset-top)`. The danger zone being
      unreachable means an admin cannot get to destructive actions at all. Same family as the
      scroll trap in 26c70f5a; likely the same root cause, check them together. **P1**

- [ ] **Feedback screenshot picker can only attach a screenshot taken BEFORE opening feedback.**
      (feedback 7800fca9) The picker offers camera or photo library. You cannot screenshot from
      the camera, and the library only helps if you thought to capture the screen first — so the
      one thing a user wants to attach (the screen they are complaining about) is the one thing
      they cannot. Pete wants capture-the-screen-behind-the-modal. Worth checking what is
      actually possible in a WKWebView before promising it. **P2**

- [ ] **No way to attach a picture when quickly logging a visit.** (feedback e201c58c, mood
      "terrible") The Family Visit Log quick-log path has no photo affordance. Photo notes exist
      elsewhere (`src/routes/notes.js`), so this is wiring an existing capability into the quick
      path, not new infrastructure. Remember the BODY-LIMIT RULE: any base64 endpoint needs BOTH
      the route-scoped express.json limit and the limitBodySize exemption. **P2**


> **Aug 18 2026 — the unreachable-function sweep (v1.105.72).** The Aug 18 handoff asked for a
> gate on "fields the server computes and sends that no client ever reads." Tracing the five
> known instances showed they were not one bug class but three: (a) a key the client never
> mentions anywhere, (b) a relay object that rebuilds a payload field-by-field and drops fields
> — how `identityStatus` and `idVerified` both went missing, and (c) a value computed on the
> client and never rendered. (c) generalised into the one that shipped: **functions that are
> written, maintained, and wired to nothing.** 22 found, all deleted; `lint:client` now fails on
> a new one. What follows is what that sweep found and deliberately did NOT fix.

- [ ] **Features whose code exists but whose UI never did.** Each was a complete, working
      implementation with no entry point anywhere in the app — deleted in v1.105.72 because
      unreachable code cannot be exercised, but the *capability* is genuinely missing and may be
      wanted. Nothing regressed: no user could reach any of these.
      - **Rename a passkey** — `MyAccount.handleRenamePasskey`. Passkeys can be added and removed
        but never renamed, so a user with two devices sees two indistinguishable entries.
      - **Edit the AI care summary** — `CareProfile.saveSummaryEdit`, plus `editingSummary` /
        `editedSummary` / `savingSummary` state and a working `PUT /api/care-recipients/:id`.
        Given the iPAi cardinal rule about AI-derived text being reviewed by a human, an edit
        affordance here is arguably the point. **Worth a decision, not just a re-add.**
      - **Delete a help article** — `AdminPanel.deleteHelpArticle`. Admin can create and edit
        help articles but not remove them.
      **P1**

- [ ] **`AvailabilityTab.js` is an entire component that nothing renders.** `<AvailabilityTab`
      appears nowhere in the codebase; it takes its handlers as props and no parent passes them.
      CaretakerHub's copies of those handlers were the dead ones deleted in v1.105.72 — the live
      availability editor is in `FindWork.js`, which the 'avail-rates' First Step already
      navigates to. The file still ships in every user's bundle. Confirm nothing needs it, then
      remove it from the `scripts` array in `build-client.js` and delete it. Not done in
      v1.105.72 because deleting a whole component is a bigger call than deleting dead functions.
      **P2**

- [ ] **117 unused client values — the noisy half of the same sweep.** Enabling `no-unused-vars`
      across the bundle reports 224; 77 are JSX-used components and 8 are `window.` exports
      (both excused by the gate), 22 were the functions now deleted. The remaining ~117 are
      mostly `useState` values whose setter is called and whose value is never read — state
      being maintained that nothing displays. Some are harmless (`tick` counters that exist only
      to force a re-render); some are real, e.g. `Dashboard`'s `tipAmount` / `tipCustom` /
      `tipReason` / `tipSent`, which look like a tipping feature that computes state nothing
      renders, and `CheckrEmbed`'s `status`. Not gated on today because the false-positive rate
      would get the gate switched off. Reproduce with the rule enabled and the
      function-name filter removed in `scripts/lint-client.js`. **P2**

- [ ] **110 server response keys no client mentions.** The mechanism-(a) half of the sweep:
      `res.json({...})` keys across `src/routes/` that appear nowhere in `public/`. Includes
      whole payloads like `safety.js` (`needsApproval`, `upcomingVisits`, `cancelledVisits`),
      `payments.js` (`achAvailable`, `sessionCost`, `manualPaymentTotal`, `pendingAmount`), and
      `matching.js` (`reasons`, `rankedCount`). Some are legitimately internal or for external
      callers; each needs the producer AND consumer traced before it means anything. **No gate
      built** — too many false positives to fail CI on, and the identity cases proved this
      mechanism is not the one that actually bit users. Triage as a list, not as a gate. **P2**

- [ ] **A test can pin unreachable code and prove nothing.** `tests/noSilentFailures.test.js` had
      four assertions against functions nobody could call, and they passed for months.
      v1.105.51 went further and *edited* `MyAccount.handleSaveRates` to add an else branch —
      careful maintenance on a dead function, with a green test on top. Repointed at the live
      copies in v1.105.72. Worth a look at whether other source-matching tests assert against
      code that is reachable. **P2**


- [x] **Async route handlers hang instead of erroring — FIXED v1.105.37 for all 87 at once.** Express 4 does not catch a rejected promise from an `async` handler: no 500, no log, no Sentry event — the request HANGS and the client spins to its own timeout. `src/utils/asyncRoutes.js` wraps the router methods once at boot so a rejection becomes `next(err)` and lands in the existing error handler. Deliberately does not wrap 4-arg error handlers (Express reads arity) or routers (mounting needs their properties). 16 tests against a real express app, including "a handler that already responded then rejects must not double-send". Individual try/catch still wins where a handler wants its own message — this is the floor, not a replacement.
- [x] **Silent mutations — the ones that mattered, FIXED v1.105.37.** ~240 `if (res.ok)` blocks have no `else`; most are background reads that correctly need none. These eight were user-initiated actions that failed with NO visible effect: the legal-acceptance gate (a silent lockout at the front door — the button re-enabled and nothing else happened), the caregiver's visit log (which gates their pay, and whose nested photo upload already toasted, so the outer failure was quieter than the inner one), cancel-with-review (family believes a session is cancelled while it is still booked and billable), group creation (which also stranded the UI mid-flow), care-recipient note edit and delete, remove-photo, and delete-passkey. The remaining ~230 are background reads — leave them.

- [ ] **Auto-pay blocked by 2FA requirement.** "How are we supposed to have auto payments if we have to do 2FA every time?" Needs pre-authorized payment tokens or session-scoped auth bypass for recurring charges. Architectural decision needed. *(Feedback `3373060b` — Pete, Mar 30)* **P1**
- [x] **Session countdown shows wrong time remaining.** ✅ Fixed v1.105.33 — the ticket blamed timezone; it was not that. `TimezoneHelper.buildDateTime` returns a true UTC epoch and `realNowMs()` is `Date.now()`, so the frame was already correct. The bug was the ANCHOR: "remaining" counted from actual check-in + booked hours, so a late arrival silently moved the finish line — check in 45 min late on a 10–12 visit and at 11:45 it read "1h 15m remaining", past the noon the family was promised. All three countdown labels (Dashboard hero, Dashboard session rows, CaretakerHub in-progress card) now count down to the SCHEDULED end. Pay is unaffected — computed server-side from real check-in to check-out in 15-min blocks. The overdue alarm deliberately KEEPS the check-in anchor: a caregiver working their booked hours after a late start is not overdue, and that alarm is the one thing that must not cry wolf. Pinned by `tests/sessionCountdown.test.js`. *(Feedback `77f89256` — Pete, Mar 28; fixed Aug 4)* **P1**
- [x] **Receipt link opened a page saying "Authentication required."** ✅ Fixed v1.105.34 — Pete could not view the receipt Dan attached to the $600 sink. Railway log: `[Auth 401] No token — path: /api/reimbursements/receipt/2c1c…, hasBearerHeader: false, hasCookie: false, cookieKeys:` — an EMPTY cookie jar on a same-origin path, so the link was not opened in the app at all. It was a raw `<a href="/api/…" target="_blank">`, and in the Capacitor WebView `_blank` hands the URL to the system browser, which has its own jar and no session. Whole-class bug, three sites: both receipt lists (Reimbursements, MoneyView) and the care-note photo in CareProfile. All now fetch through `apiFetch` and render in-app. `tests/attachmentAuth.test.js` fails on any new `href="/api/…"` anywhere in the client. *(Pete — Aug 4)* **P1**
- [x] **Receipts downloaded instead of previewing; no pinch/zoom.** ✅ Fixed v1.105.34 — new `public/js/components/AttachmentViewer.js`: lazy-loaded thumbnails in each row (IntersectionObserver, so a long ledger is not a burst of megabyte fetches), tap for a full-screen viewer with pinch, double-tap and wheel zoom anchored to the fingers, pan, prev/next, and Save. PDFs render inline. Blob URLs are cached per attachment and revoked on eviction. Verified by rendering the real component against the real styles.css in Chromium at 320/390/430/1200 — image decodes, `touch-action: none`, no overflow, wheel zoom moves the transform 1.00 → 1.15. *(Pete — Aug 4)* **P1**
- [x] **"Pending approval" vs "Awaiting approval".** ✅ Fixed v1.105.34 — same state, three surfaces, three names (`Reimbursements` said "Pending approval", `MoneyView` and the recurring-schedule chip said "Awaiting approval"). Nothing to do with who submitted it, which is how it read. Now "Awaiting approval" everywhere, asserted in `tests/attachmentAuth.test.js`. *(Pete — Aug 4)* **P2**
- [ ] **Admin notifications bleed into family dashboard.** When a care_for user (e.g., Granny Tester) creates a care request, `notifyAdmins()` sends an in-app notification to all users with `is_admin = true`. Since Pete is both admin and family, the notification shows in his family dashboard's "Recent Activity" section with vague text ("companion for a care recipient") — looks like it's about Betty but it's actually about Granny. Fix: either visually distinguish admin notifications from family ones, filter admin-type notifications out of the family dashboard, or add the requester's name to the notification text. *(Pete — Apr 3)* **P2**
- [x] **No-show poller duplicate guard.** ✅ Fixed v1.57.18 — Added `NOT EXISTS (SELECT 1 FROM admin_audit_log WHERE target_id = cs.id AND action = 'restore_session')` guard to `pollCaregiverNoShows()` query. Restored sessions are now skipped by the poller. *(Pete — Mar 31)*
- [x] **Notes endpoint lacks access control.** ✅ Fixed v1.57.18 — Added `hasAccess()` function to notes.js (same pattern as careRecipients.js). Checks owner, shared, care team membership, and assigned caregiver. GET and POST both gated. *(Found during care team access audit — Mar 31)*
- [x] **No thumbnail photos on any demo profile.** None of the demo users (Pete, Maria, Betty, other caregivers) have real profile photos — just emoji placeholders or SVG initials. Need: seed realistic avatar images for all demo users so the app looks polished during demos. Consider using generated placeholder headshots or styled SVG avatars with distinct colors per person. ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** `src/seed.js` `avatarAssignments` sets `avatar_url` and `profile_photo` for all 8 demo users. v1.8.0 (`3f24ee9`).
- [x] **Real users can see/message other users without an accepted connection.** ✅ Fixed v1.51.10 — Added connection validation to POST /conversations (checks care team membership, caregiver assignment, or accepted connection). Also added legacy message filtering to skip conversations with unconnected users. Admins bypass all checks.
- [x] **Push notifications still not working on iOS.** Pete allowed notifications in settings but nothing comes through. Has been an ongoing issue for weeks. Needs end-to-end debug of SW registration + push subscription flow. *(Feedback — Feb 22, #26)* ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** Fixed by direct APNs — `src/utils/apns.js`, v1.96.0 (`539038f`), verified 5/5 on prod 7/13. The stated cause was also wrong: Service Worker / Web Push was never the iOS native path, since the Capacitor app registers a raw APNs token that FCM rejects. Debugging the SW would have found nothing.
- [x] **Desktop push notifications not working.** ✅ Fixed v1.51.12 — Root cause: `checkPushHealth()` checked `window.AUTH_TOKEN` (always null) instead of closure variable `AUTH_TOKEN`. The 30-minute health check never ran, so stale subscriptions were never re-synced. One-char fix in utils.js. *(Feedback — Sara Huber, Feb 25)* **P1**
- [x] **Care team member management UX overhaul.** Member cards should look like the leader card, with options on click (remove, promote, read-only, etc.) instead of showing blunt "Member" and "Remove" buttons. Ties into authority delegation feature. *(Feedback — new)* ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** `CareTeamManage.js` renders avatar + role pill + chevron, expanding on tap to Member / View Only / Remove — which is the ask. v1.10.0 (`6f4819d`).
- [x] **Caregiver onboarding does not ask about pets/allergies/medical conditions.** Carry Taiker's onboarding flow completed without collecting any pet, food allergy, or medical condition info. The "Onboarding profile questions — all roles" feature (in Features below) covers the full design, but at minimum the caregiver signup wizard should collect this before completing registration. ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** `CaregiverOnboarding.js` has the "🐾 Pets, Allergies & Medical" step and persists all four fields; the columns exist in `database.js`. v1.33.14 (`f24bc75`). (This entry was also filed twice — the duplicate is removed.)
- [ ] **Photo upload crop + auto-resize.** Need in-app crop tool and auto-resize to 1.5MB before uploading profile photos. Current UX too manual. *(Feedback — reviewed)*
- [ ] **Admin 2FA/biometrics gate.** Admin panel should require 2FA or biometrics to access. Destructive actions (delete users, override background checks) should require additional verification. *(Feedback — Feb 22)*
- [ ] **Block user with legal evidence logging.** When blocking a user, collect more than just "spam or abuse" — log location data, timestamps, payment receipts, chat logs for potential legal action. Ties into admin incident management. *(Feedback — Feb 22)*
- [ ] **Dual-role users can't manage caregiver profile from family view.** When a family user adds a caregiver role, they can't access admin-like caregiver profile management (mark background check done, set up payments, etc.) from within the family dashboard. Need admin options or a dedicated path for dual-role users to manage their caregiver onboarding steps. *(Feedback — Feb 25, new)*
- [ ] **Family members need ability to add care locations in Care Profile.** Families should be able to add one or more care locations (e.g., home address, adult day center, doctor's office) to a care recipient's profile. Caregivers see these locations when accepting sessions. Ties into care location address with private instructions feature. *(Pete — Feb 25)*
- [ ] **DL/cert photo upload not enforced in onboarding.** Caregiver onboarding doesn't require driver's license or certification photos. Should at least ask for DL front/back. Allow skip with acknowledgment (same gate pattern as bg check), but no jobs until uploaded. *(Feedback — Feb 23, #5)*
- [x] **Push notification icon is white square on Android.** ✅ Fixed v1.51.11 — Changed notification icons from badge-monochrome-96.png to icon-192.png (icon) and icon-maskable-96.png (badge) in both sw.js and push.js. *(Feedback — reviewed)*
- [x] **Visit photo upload not accessible from CaretakerHub during sessions.** ✅ Fixed v1.51.41 — Added `POST /api/photos/session/:sessionId` endpoint that auto-creates visit_log if needed. Added photo upload button to VisitDetailModal for both completed and in-progress sessions. Both family members and caregivers can now upload photos from the session summary view. *(Feedback — Cary Taker, Mar 1)* **P1**
- [x] **No push notification to check out.** ✅ Fixed v1.51.11 — Added `overdue_check_out` reminder type that fires 15 minutes after scheduled session end time. Sends push + SMS to caregiver ("Don't Forget to Check Out") and push to family. Poller in server.js queries in_progress sessions past their scheduled end. *(Feedback — Cary Taker, Mar 1)* **P1**
- [x] **Kindred button doesn't work on Android app.** ✅ Fixed v1.57.36 — Root cause was multi-layered: (1) UUID↔TEXT type mismatches in Kindred queries (v1.57.29), (2) TEXT scheduled_date compared to DATE without cast (v1.57.31-32), (3) SQLite DATE('now') syntax in PostgreSQL (v1.57.32), (4) UUID↔TEXT JOIN mismatch on voice_reminders.created_by (v1.57.33), (5) Service Worker auto-reload disrupting active use (v1.57.35), (6) Capacitor navigated to /kindred without auth token — kindred/index.html couldn't authenticate and redirected back (v1.57.36). Final fix: CareProfile.js passes AUTH_TOKEN in URL, kindred/index.html tries cookie-based refreshToken() as fallback. *(Fixed — Pete, Apr 1)* **P2**
- [ ] **Overlapping caregiver map pins.** When caregivers are at similar locations (Cary and Pete), pins overlap so you can't tell there are two. Need clustered pins with "2 Caregivers" label that expands on tap. *(Feedback #14 — Son Tester, Mar 5)* **P2**
- [x] **Overdue session — no popup to call caretaker.** If a session runs 15+ minutes past end time, show a popup giving the family option to call the caregiver directly. Safety feature. *(Feedback #20 — Son Tester, Mar 5)* **P1** ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** `Dashboard.js` `showOverduePopup` fires at 15 minutes past scheduled end and renders a `tel:` "📞 Call {caregiver}" link. v1.51.64 (`301ece4`).
- [x] **Bottom nav hides buttons on Schedule page (Android).** ✅ Fixed v1.57.18 — Increased `.main-content` mobile bottom padding from 90px to 120px (covers Android gesture bar which doesn't report safe-area-inset-bottom). Also added `padding-bottom: calc(env(safe-area-inset-bottom) + 40px)` to `.modal-content` on mobile. *(Feedback `8faa1cc3` — Pete, Apr 1)* **P1**

- [x] **Paused caregiver can still see and accept jobs.** Cary's account is paused (no-show) but the Find Work section still shows "Accept Job" buttons. A paused caregiver should not be able to accept new work. Need to gate job acceptance behind `account_paused` check on both client and server. *(Found — Mar 17, v1.46.6)* **P1** ✅ Fixed Mar 19
- [x] **"Set Up Payments" card showing for previously-connected caregiver.** Cary was connected to Stripe but her dashboard still shows the "Set Up Payments" onboarding card. May be caused by Stripe account reset during testing, or the status check is broken. *(Found — Mar 17, v1.46.6)* **P1** ✅ Fixed Mar 19
- [x] **"Nobody home" option persists after caregiver checks in.** After Cary checks in with Betty, the "Nobody home" button should disappear since she's confirmed on-site. Currently it stays visible post-check-in. *(Found — Mar 18, v1.49.11)* **P1** ✅ Fixed Mar 19
- [x] **iPAi chatbot text entry not visible — blank page on open.** When opening the iPAi conversation in Messages, the text input is below the scroll area so it looks like a blank page. User has to scroll down to find it. Welcome card with suggestions was added (v1.49.8) but may not render if the conversation already has messages. *(Found — Mar 18, v1.49.11)* **P1** ✅ Fixed Mar 19
- [x] **"Now open to all caregivers" text showing on accepted appointments.** After a caregiver accepts a private request, the family dashboard Next Up card still shows "Now open to all caregivers" in orange once the exclusive timer expires. Should show nothing (the card already says "with Cary" and "confirmed"). *(Found — Mar 19, v1.50.18)* **P1** ✅ Fixed v1.50.19
- [x] **Early checkout duration miscalculated due to device timezone mismatch.** Cary checked out 1 hour early from a 4-hour session, but the app displayed it as 2 hours early because her phone clock was 1 hour behind EST. Duration calculation relied on client-side time comparison. Fix: compute all session durations server-side using UTC timestamps converted to the care recipient's timezone. *(Found — Mar 19)* **P1** ✅ Fixed v1.50.21 — check-out `earlyMinutes` now uses `buildDateTimeInZone` with care recipient's timezone.

- [x] **Pending review gate blocks booking for cancelled (non-no-show) sessions.** ✅ Fixed v1.51.44 — `/api/accountability/can-book` and `/pending-reviews` queries included all cancelled sessions. Now only blocks on completed sessions (no-show reviews are optional, shown on dashboard but don't gate booking). Migration clears stale review_required flags on cancelled non-no-show sessions. *(Found — Pete, Mar 26)* **P1**
- [x] **Caregiver can't accept jobs — Stripe gate blocks when Stripe not live.** ✅ Fixed v1.51.45 — `caregiverCleared` in dashboard.js required both `is_background_checked AND stripe_onboard_complete`. Since Stripe isn't live, no caregiver could accept. Fixed frontend (BG check OR is_available admin override) and backend (commented out Stripe gate on claim endpoint, added is_available override to BG check gate). *(Found — Pete, Mar 26)* **P1**
- [x] **Caregiver First Steps checklist stuck on Stripe step.** ✅ Fixed v1.51.47 — Stripe and BG check steps in onboarding checklist now respect admin overrides (is_available or is_background_checked). Admin-cleared caregivers see all steps as done. New caregivers still see the normal Stripe → BG check flow. *(Found — Pete, Mar 26)* **P1**
- [x] **Kindred promises to deliver messages but can't.** ✅ Fixed v1.51.37 — Added relay_message intent detection. When Betty says "tell Pete..." Kindred sends a push notification to the target care team member with Betty's message. System prompt updated so Kindred knows it CAN make this promise. *(Feedback — Pete, Mar 25)* **P1**
- [x] **Voice routing dropdown hidden behind credit-saving tip.** ✅ Fixed v1.51.37 — Changed container `overflow: visible`, bumped dropdown z-index to 9999. *(Feedback — Pete, Mar 25)* **P1**
- [x] **Voice routing save shows toast but reverts to previous voice.** ✅ Fixed v1.51.37 — Pete's clone added to seedDefaultVoices so voice_profiles row exists. Fixed save to pass provider_voice_id (not null). Fixed getAssignedVoice to match by display_name. *(Feedback — Pete, Mar 25)* **P1**
- [x] **Mobile chat keyboard pushes content off screen.** ✅ Fixed v1.51.37 — Replaced `justify-content: flex-end` with `::before { flex: 1 }` spacer. Header stays visible when keyboard opens. *(Feedback — Cary Taker, Mar 23)* **P1**

- [x] **Time picker sub-pill resets to midnight.** ✅ Fixed v1.54.2 — Selecting :15/:30/:45 sub-pills reset time to 12a because useEffect checked exact match in getTimeOptions() (only :00 values). Fix: check only hour portion, remove `time` from date-validation effect deps. *(Pete — Mar 29)* **P1**
- [x] **Time picker default scroll position.** ✅ Fixed v1.54.5 — Time pills started at 12a despite 8a being selected. Used `getBoundingClientRect()` with retry at 50/200/500ms for reliable mobile scroll positioning. 8a now justified left as default. *(Pete — Mar 29)* **P1**
- [x] **Care type validation missing on Request Care.** ✅ Fixed v1.54.6 — No warning when hitting Next without selecting care type. Added orange validation banner: "Select a care type above, or choose Other and leave instructions." *(Pete — Mar 29)* **P1**
- [x] **Calendar today dot looks like in-progress indicator.** ✅ Fixed v1.54.7 — Replaced 6px dot with light blue background highlight (`rgba(59,130,246,0.1)`) and blue text for today's date. *(Pete — Mar 29)* **P1**
- [x] **Private-only care requests ("Cary only — don't open to others").** ✅ Fixed v1.54.8 — Toggle in RequestCareModal when specific caregiver selected. `private_only` column on care_sessions. Expired exclusive offers: private_only=1 → cancel, private_only=0 → open to all. *(Pete — Mar 29)* **P1**
- [x] **Dual-role self-offer — caregiver sees own family request.** ✅ Fixed v1.55.0 — Caregiver-Pete could see family-Pete's care request as an available job. Added `AND cs.family_user_id != ?` filter to caregiver dashboard job query. *(Pete — Mar 29)* **P1**
- [x] **Payment method management — Link label + remove card.** ✅ Fixed v1.55.2 — Link ****0000 now shows as "Saved via Stripe Link" (confirmed as Pete's USAA account). Added DELETE endpoint + UI button to remove payment methods. Payments paused banner when disabled. *(Pete — Mar 29)* **P1**
- [x] **Manual payments (Send Payment feature).** ✅ Done v1.55.2–v1.55.7 — Send money to a caregiver without a care session. Amount, note, caregiver selector. Stripe Checkout with `transfer_data` to connected account. Fee transparency: real-time breakdown shows caregiver receives / processing fee / total. Gross-up so caregiver gets exact intended amount and platform balance stays neutral. Webhook records in `manual_payments` table. *(Pete — Mar 29)*
- [x] **Manual payments not showing in payment history.** ✅ Fixed v1.55.3 — History endpoint only queried `payments` table. Now queries both `payments` and `manual_payments`, combined and sorted by date. *(Pete — Mar 29)* **P1**
- [x] **Caregiver has no persistent record of received payments.** ✅ Fixed v1.55.4–v1.55.5 — Push notification was only trace. Added "Payments Received" card to caregiver dashboard with amount, sender, note, date, status badge, and payout expected date from Stripe's `balance_transaction.available_on`. Earnings endpoint now includes manual payments. *(Pete — Mar 29)* **P1**
- [x] **Manual payment checkout shows wrong bank accounts.** ✅ Fixed v1.55.6 — Checkout session created without `customer` param, so Stripe Link matched by email/phone and showed caregiver Connect accounts to dual-role users. Now passes family's `stripe_customer_id`. *(Pete — Mar 29)* **P1**
- [x] **Stripe fees creating negative platform balance.** ✅ Fixed v1.55.7 → further corrected v1.57.5–6 — Originally grossed up charges; Pete corrected that Stripe's 2.9%+30¢ should come OUT of InPlace's 20% cut, not be added on top. v1.57.5 removed gross-up from session payments. v1.57.6 removed gross-up from manual payments and added 20% platform fee to manual payments (previously had none). Final rule: family pays caregiver + 20%, Stripe comes from InPlace's share. *(Pete — Mar 29)* **P0**
- [x] **Payment lockout enforcement.** ✅ Done v1.57.1–3 — When auto-pay fails, family is blocked from booking new sessions and caregiver can't check in. `payment_hold` status for confirmed sessions. `checkPaymentStanding()` gates on both POST /sessions (booking) and check-in. Only triggers on `payment_status = 'failed'`, not during pending/grace period. `restoreHeldSessions()` flips payment_hold → confirmed when family pays. Push notifications to both parties. 402 error handling in RequestCareModal and CaretakerHub. *(Pete — Mar 29)* **P1**
- [x] **Kindred reminder poller crashing every 60s.** ✅ Fixed v1.57.7 — `operator does not exist: uuid = text` because `voice_reminders.care_recipient_id` is UUID but `care_recipients.id` is TEXT. Added `::text` cast on JOIN and family lookup query. Also added missing `cancel_reason` column to `care_sessions` (was only on interviews table), fixing the private-only expiry error. *(Found — Mar 29)* **P1**

<!-- ── Triaged July 29, 2026 (feedback loop; Julia Huth real-signup thread) ── -->

- [x] **Test Mode impersonation may write to the admin, not the impersonated user.** ✅ **Verified safe — no code change needed (traced end to end, Aug 4).** Writes land on the impersonated user, as intended. The chain: `src/routes/admin/access.js:150` mints the impersonation token with `{ id: target.id, … }` — the *target's* id, not the admin's; `utils.js` `apiFetch` sends `IMPERSONATION_TOKEN || AUTH_TOKEN` as the Bearer header; `middleware/auth.js:83` takes **Bearer over cookie** (`header?.startsWith("Bearer ") ? … : cookieToken`), so the admin's httpOnly cookie riding along on the same request is ignored. `req.user` therefore IS the impersonated user for every request in Test Mode, reads and writes alike. The original "/api/auth/me returns the admin" symptom was the **Sentry tagger**, which read cookie-then-Bearer — the inverse precedence — and so filed impersonated traffic under the admin's name; fixed in v1.105.2, which now tags `impersonated`/`impersonated_by`. Prior "I edited it in Test Mode" observations are trustworthy. *(Found — Jul 29; closed Aug 4)* **P1**
- [ ] **Passkey created on laptop didn't carry to phone (Julia).** Partly platform reality — a passkey only appears on another device if the same provider syncs it (iCloud Keychain within Apple ID; Google Password Manager within Chrome/Android); cross-ecosystem never syncs, you use cross-device QR/Bluetooth sign-in or register a second passkey. **Don't assume it's our bug until verified:** (a) ~~check prod `RP_ID`/`ORIGIN`~~ **STRUCK Aug 4 — traced and cleared.** `passkeys.js` derives RP_ID from APP_URL with a yourinplace.com fallback, and branches on `NODE_ENV` nowhere (it appears once, inside a `console.error`). Cross-ecosystem passkey sync is the remaining explanation, and (b)/(c)/(d) below are the real work; (b) confirm a user can register an ADDITIONAL passkey per device and the UI invites it rather than implying one works everywhere; (c) confirm email/password fallback still works so nobody gets locked out; (d) fix the copy: "Passkeys are saved to this device (and synced only if your browser/OS syncs them)." *(Julia — Jul 29)* **P1**
- [x] **`NODE_ENV` is not set on Railway — audit everything gated on it.** ✅ Fixed v1.105.3 — confirmed in the Railway UI (7/30) that `NODE_ENV` is not in the prod service variables at all. Rather than add it (a var the platform doesn't set is one that silently vanishes again when a service is recreated), `src/utils/env.js` now derives the deployment shape from `APP_URL` — which IS set and which the app already trusts for WebAuthn RP_ID/ORIGIN. Fails safe: missing or malformed `APP_URL` yields the PRODUCTION shape, never a silent downgrade. `COOKIE_SECURE`/`SENTRY_ENVIRONMENT` are explicit escape hatches; a legacy `NODE_ENV=production` is still honoured. 16 unit tests in `tests/env.test.js`. **Prod now reports `{environment: "production", secureCookies: true}` on `/api/health`** (was effectively `development` + no Secure flag). Prod Sentry events arrive tagged `environment: development` (confirmed on the v1.104.9 and v1.105.0 releases), which means `process.env.NODE_ENV !== "production"` on prod. Anything branching on it is silently running its dev path in production. Known consumers to check first: `ALLOWED_ORIGINS` in server.js:33 (prod is falling back to the **localhost** CORS list), and the WebAuthn RP_ID/ORIGIN warning in CLAUDE.md — which makes this a prime suspect for the passkey item above. Either set `NODE_ENV=production` on Railway (check what else changes first — this flips several branches at once) or remove the gates in favor of explicit env vars. *(Found Jul 29)* **P1**
- [x] **Lint baseline burn-down — 2 real bugs parked in the ignore list.** `scripts/lint-client.js` BASELINE documents 3 pre-existing findings; two are genuine bugs needing domain intent: **`savedToken`** (app.js invite-boot auth check) and **`loadAlerts`** (AdminPanel approve/reject refresh). The baseline is a ratchet — burn these down, never add to it. *(v1.104.6 — Jul 29)* **P1** ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** Both are gone: `scripts/lint-client.js` BASELINE now holds one entry (`onNavigate`, typeof-guarded and genuinely safe). `savedToken` and `loadAlerts` were real crashes — fixed v1.105.32 (`e499ed8`).

### P2

- [x] **The vouch picker made you transcribe a number.** (Pete, Aug 19) *"i don't like the vouch
      picker, the 'type a number that corresponds with a name'…there needs to be a cleaner
      picker, like when you search for contacts in messages."*
      ✅ **Fixed v1.105.109.** It was three browser dialogs in a row: a `prompt()` holding a
      numbered list you had to read and retype as an index, a second `prompt()` for the note,
      and a `confirm()` carrying the honesty warning. **Transcribing an index fails silently** —
      pick the wrong number and you have vouched a caregiver into a stranger's family, which is
      the most consequential thing an admin can do on that screen.
      `<VouchPicker/>` — search box, results with name and email, one tap to select, the note
      inline, and the confirm button names the family you chose so a mis-tap is visible before
      you commit. All three entry points (People modal, BG Checks vouch, BG Checks convert) open
      it, and one `submitVouch` writes.
      **Two silent bugs went with it:** the old picker fetched `limit=100` and filtered in the
      browser, so **the 101st family could not be vouched for at all**; and `?role=family`
      matched only the singular `role` column, so anyone who signed up as a caregiver and later
      added a family profile — **Pete himself** — was invisible to it. The filter now matches
      the `roles` array too. `tests/vouchPicker.test.js` (16); `vouchReachability.test.js`
      updated to the new shape without weakening what it pins.
      ⚠️ Also: the nav path is **Admin → BG Checks**, not "Admin → Vouches". I sent Pete to a
      page that does not exist by inferring it from an API route name.

- [x] **Care preferences box runs off the screen.** (5eba31dd, Tyler, iPhone 17 Pro) *"the items
      go in a box that extends beyond my phone screen and i can't see the full text."*
      ✅ **Fixed v1.105.107, and it was the hard floor.** The row is
      `[icon] [label flex:1] [three rating buttons flexShrink:0]`. A flex child defaults to
      `min-width: auto`, so the label could not shrink below its longest word, and the buttons
      refused to shrink at all. **Nothing in the row could give, so the row grew past the
      viewport instead** — the same family as v1.105.2's `minmax(220px, 1fr)`.
      `minWidth: 0` + `overflowWrap: anywhere` on the label, `flexWrap` on the row and on the
      button group. **Structural, not tuned:** no breakpoint, so it cannot overflow at any
      width, font size or text-size accessibility setting.
      ⚠️ **Not measured in Chromium**, against the usual rule — this sandbox has no browser and
      can't download one. Worth one look on a real iPhone.
- [x] **"Caregiver preferences" heading and a stray scroll bar.** (93a017e2, Tyler)
      ✅ **Fixed v1.105.107 — and the two halves were the same bug.** Every other account tab
      is one word (Profile, Settings, Payments, Documents); `Care Preferences` was twice as
      long, and that is what pushed the strip past the edge of his phone and produced the
      scroll bar. Renamed to **Preferences**. The strip still scrolls where it must, but via a
      scoped `.scroll-x-quiet` utility that hides the bar chrome — scoped deliberately, because
      a bare `::-webkit-scrollbar` rule would strip the bar off every scrollable panel in the
      app. `tests/carePrefsOverflow.test.js` (8).
- [x] **Calendar starts at 0am and looks odd on the dashboard.** (16328059, Tyler)
      ✅ **Fixed v1.105.110 — and "0am" was literal.** The hour label was
      `hour <= 12 ? hour : hour - 12`, which maps midnight to **0**. There is no 0 o'clock on a
      12-hour clock; the row said `0a`. Now `12a`.
      The grid itself was a fixed `hourStart = 0, hourEnd = 24`, so ten almost-always-empty
      overnight rows pushed the part he came to look at a screen and a half down.
      **Not replaced with a hardcoded 7–21.** Overnight supervision is a service InPlace sells;
      a caregiver working 10pm–6am would find her own shift clipped off the top with nothing to
      say it had been, and a calendar that silently omits a booked visit is worse than a tall
      one. `calendarHourRange()` takes a comfortable 7–21 default and **widens** it with
      whatever is really on the grid — sessions, care requests, and the caregiver's own
      availability and blocked rules. A normal week is 14 rows instead of 24; an overnight week
      still shows midnight.
      Guarded against the obvious trap: `Number(null)` is `0` and 0 is a valid hour, so a
      missing time would have dragged the window back to midnight — the exact complaint.
      `tests/calendarHours.test.js` (13, validated against the pre-fix source).
- [ ] **First Steps is overwhelming.** (aed1e440, Tyler) Suggests a 1-of-7 view showing the
      current task with a slide to the next.
      **Pete's call, Aug 19: not the 1-of-7 redesign.** *"Leave it, just tighten it"* — keep all
      seven visible, collapse completed ones to a single line so the list shrinks as he works
      through it. The existing rule stands: it disappears entirely once complete. **P2**
- [x] **Say "Betty", not "Care Recipient".** (7d94657c, Julia) On the Find Work card. She is
      about to spend an afternoon with a person, not a role.
      ⚠️ **I GOT THE CAUSE WRONG, and the record should say so.** I read the gate, saw
      `stripe_onboard_complete` in it, and told Pete that was why her card said "Care
      Recipient". Pete, Aug 19: *"julia very much has stripe enabled."* So Stripe was never her
      blocker, and v1.105.107 — correct on its own terms, and his call — will not by itself
      have fixed her card. **What actually withheld it is one of the other two inputs:** either
      `is_background_checked = 0` with **no active `bg_admin_vouches` row** for the family that
      posted that job, or a vouch recorded against a *different* `family_user_id` than the
      session's. v1.105.108 makes the payload say which.
      The lesson is the one already written down here twice: **trace the producer AND the
      consumer before believing a finding.** I traced the gate and stopped, without ever
      checking the value of the input I was blaming.

      ✅ **Fixed v1.105.107 — the name was not missing, it was WITHHELD.** `dashboard.js` gated
      every personal detail on `stripe_onboard_complete && (is_background_checked ||
      vouched-by-this-family)`, so a caregiver with no bank account got no name, no city, no
      family name, no instructions, **no care summary**.
      And it was backwards: the Stripe gate on *accepting* a job is **commented out** in
      `sessions.js` ("skipped for now — not live yet"), so Stripe blocked the information and
      not the action — she could take a job for Betty while the card still called her
      "Care Recipient".
      **Pete's call, Aug 19: split them.** Trust (a background check, or a vouch from that
      job's family) decides what she may SEE; Stripe decides whether she can be PAID. One
      definition now, `src/utils/caregiverTrust.js`. Two siblings already omitted Stripe
      (`isCaregiverCleared` in messages.js, `caregiverCleared` in dashboard.js) — line 807 was
      the outlier, not the rule.
      A vouch stays scoped to ONE family (v1.64.0): trusted by Pete says nothing about anyone
      else, and the integration test asserts exactly that so the gate can't be loosened too far
      unnoticed.
      ✅ **v1.105.108 — the payload now says WHICH input was false**: `detailsWithheld`,
      `detailsWithheldReason`, plus the raw `isBackgroundChecked` and `vouchedByThisFamily`.
      A boolean that hides its own reasoning costs a release every time someone guesses wrong
      about it, which is exactly what happened above. Her own standing, never the family's.
      🔴 **[NEEDS YOUR HANDS]** Admin → Vouches: is there an ACTIVE row for Julia against the
      user who posted that job? If not, that is the answer; if there is, the `family_user_id`
      on it does not match `care_sessions.family_user_id`. Where a name genuinely is withheld the card now says so instead of printing a
      label that reads like a bug. `tests/caregiverTrust.test.js` (11),
      `tests/integration/recipientNameVisibility.itest.js` (4, both directions).
- [x] **Photo picker should take more than one picture.** (40ad8896, Pete)
      ✅ **Fixed v1.105.111.** The quick visit-log sheet (`FamilyVisitLog`) took exactly one.
      The caregiver's visit log and `VisitDetailModal` were already `multiple`; this was the
      one Pete uses from his phone, and a visit is often several things worth recording — the
      fridge, the pill organiser, her in the garden — so one slot forced a choice between them.
      Up to **4**, each removable, count on screen, thumbnails in the feed, tap any one to open
      the lightbox at that photo.
      **The compatibility shape mattered more than the feature.** `photos` is a JSON column
      **alongside** `photo`, not instead of it: the first image still goes in `photo`, so every
      row written before today still renders, `/:id/photo` still answers unchanged, and the
      feed's `has_photo` flag still means what it meant. `/:id/photo/:idx` reaches the rest.
      A client that has not reloaded and still sends a single `photo` is still accepted.
      Caps on **count and total**, not just per-photo: `express.json` for this route rejects an
      oversized body in middleware, *before* the handler could explain why, so the client
      downscales harder (1400px / 0.82) and the server checks the combined size and answers in
      words. And a `photos` value the server cannot read is now **refused** rather than
      ignored — falling through would have saved the visit with the pictures silently dropped.
      `tests/visitPhotoPicker.test.js` (22, validated against the pre-fix source),
      `tests/integration/visitPhotos.itest.js` (12, real Postgres, including legacy rows);
      `familyVisitPhoto.test.js` retargeted to the new shape without weakening it.


- [ ] **Stripe Link UX deceptive for bank accounts.** Flow pushes Link, which has higher fees at no benefit. ~~Check Stripe Checkout `payment_method_types` config.~~ **Wrong location — the code is already correct:** all three Checkout call sites set `["card", "us_bank_account"]` and none include `"link"`. Link methods still arrive, so they come from the **Stripe Dashboard's** payment-method settings. This is a Pete-in-a-browser task, not an engineering one. *(Feedback `d63ed33e` — Pete, Apr 4)* **P2**
- [ ] **Notification bell too much space on mobile.** Only shows when notifications exist but takes way too much room. Quick CSS fix — reduce size or use icon-only on mobile. *(Feedback `81cb9e47` — Pete, Mar 29)* **P2**
- [x] **Cancel open request without reason.** Cancelling an unfilled request shouldn't require a reason — just confirm and do it. Only require reason when caregiver is already assigned. *(Feedback `ab7fea88` — Pete, Mar 29)* **P2** ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** Optional on this path all along — the label reads "Reason (optional)" and the handler falls back to "Cancelled by family"; it also already says "free to cancel with no fee" when no caregiver is assigned. v1.33.5 (`492c107`).
- [ ] **Cancel requests from Schedule page.** Currently only possible from Dashboard. Add cancel action to Schedule session cards. *(Feedback `3fdfdc1d` — Pete, Mar 29)* **P2**
- [ ] **Passkey create/cancel buttons off-screen on mobile.** Text is right of screen and unusable. CSS overflow/wrapping issue on passkey modal buttons. *(Feedback `6706317b` — Pete, Mar 28)* **P2**
- [ ] **Admin search text garbled on mobile.** Text in search box is overlapping and unreadable. CSS input styling issue in AdminPanel search. **Probably NOT local to AdminPanel:** the component sets `fontSize: 14` inline while `styles.css` forces `font-size: 16px !important` on every non-checkbox input under 768px. Same broad-rule-clobbers-component family as v1.105.2 — fixing it inside the component will fail. *(Feedback `56386949` — Pete, Mar 28)* **P2**
- [ ] **Caregiver dashboard too cluttered — icon/text overload.** The CaretakerHub tab bar (My Families, Area Map, Earnings, Reviews, etc.) has too many small icons with text labels crammed together. Suggestion: use larger, more illustrative icons without text labels, and show the text label on hover (tooltip) or when selected. Reduce visual noise so the dashboard feels cleaner.
- [ ] **Mobile formatting broken on feedback/general pages.** Pete reports "formatting on mobile screen doesn't work here." Needs investigation — which page specifically. *(Feedback — Pete, Mar 6)* **P2**
- [ ] **Payment architecture: team-leader-assigned billing.** Team leader sets the default payment account (e.g., Betty's bank) for scheduled events. Per-member can pay from own account if they scheduled it. Team leader assigns $ qualifiers (who pays for what). *(Feedback — Pete, Feb 25)* **P2**
- [ ] **Home/mailing/billing address for caregivers and payers.** Address entry with option to flag if billing address differs from home. Needed for payment processing. *(Feedback — Pete, Feb 25)* **P2**
- [ ] **Track user navigation patterns (analytics).** Log how users flow through the app so we can optimize. Where do they go first after login? How often do they hit calendar vs messages? Use Plausible or custom event tracking. *(Feedback — Pete, Feb 25)* **P2**
- [ ] **"Install the app" checklist item — false positive detection.** How does the app know it's installed? May be checking prematurely on desktop browsers. Verify PWA install detection logic doesn't false-positive. *(Feedback #15 — Son Tester, Mar 5)* **P2**
- [ ] **Unfilled request escalation reminders.** If a care request goes unfilled: 48hr out → "raise your pay offer"; 24hr → "still no one, raise offer"; 1hr prior → "cancelled, no caretaker found." Auto-escalation system. *(Feedback — Pete, Mar 6)* **P2**
- [ ] **Map search → caregiver shows only 1 week.** Selecting Cary from map search only shows one week of availability with no way to see more. Should show monthly calendar or a scheduling shortcut with Cary prefilled. *(Feedback — Pete, Mar 6)* **P2**
- [ ] **Caregiver appointment tiles need more detail on tap.** Cary wants to tap appointment tiles for care needs, notes from care team, feedback. Currently too sparse. *(Feedback — Cary, Mar 6)* **P2**
- [ ] **"$120 flew over" animation on accept — visual bug.** When Cary accepted Tony Nav's appointment, "$120" animated to the confirmed tab. Unintended animation. *(Feedback — Cary, Mar 6)* **P2**
- [ ] **Cancellation policy acknowledgment for caregivers.** On accepting an appointment, caregiver must check a box: "I understand I must cancel 24+ hours before start, or the care team can leave a review." *(Feedback — Cary, Mar 6)* **P2**
- [ ] **Family cancellation charge acknowledgment.** Families must click something acknowledging they'll be charged if cancelling inside 24 hours. *(Feedback — Cary, Mar 6)* **P2**

- [ ] **Caregiver referral bonus program.** Add referral mechanism: caregiver gets a bonus when they refer a new caregiver who completes X sessions. Show on splash page as recruiting incentive. Needs: referral code/link system, tracking referral source on signup, bonus payout trigger after threshold, splash page callout. *(Feedback — Cary Taker, Mar 18)* **P2**
- [ ] **My Account page overflows container on mobile.** Content doesn't fit inside the container on mobile view. Seen from admin page on v1.51.29. *(Feedback — Pete, Mar 23)* **P2**
- [x] **Messages input scrolls right instead of wrapping.** ✅ Fixed v1.57.18 — Replaced `<input type="text">` with auto-growing `<textarea>`. Grows from 1 line to max 3 lines (72px), then scrolls vertically. Enter sends, Shift+Enter inserts newline. CSS updated with line-height, max-height, and overflow-y. *(Feedback `4126e671` — Pete, Apr 1)* **P2**
- [ ] **Admin Sessions tab — rethink as analytics dashboard.** Currently just shows missed sessions. Pete wants: tiles ranking care types by popularity, avg session duration, repeat caregiver rate, and an AI-generated insight summary that refreshes on tab open with KPI recommendations (retention, usage patterns, growth levers). *(Feedback `eff71717` — Pete, Mar 31)* **P2**
- [x] **Kindred reminder announcements tied to calendar.** ✅ Done v1.51.42 — Added Reminders tab to Kindred admin panel in CareProfile.js. Family can create voice reminders with message, time picker, recurrence (one-time/daily/weekdays/weekends/custom days), and labels. Backend: new columns on voice_reminders (recurrence, recurrence_time, recurrence_days, label, source), GET/POST/PUT/DELETE endpoints. Delivery poller in server.js checks every 60s, delivers due reminders, auto-schedules next occurrence for recurring. Calendar auto-reminders added v1.51.48 — POST /api/kindred/reminders/sync-calendar creates reminders 30 min before upcoming sessions, "Sync Calendar" button in Reminders tab. *(Feedback — Pete, Mar 25)* **P2**

<!-- ── Triaged July 29, 2026 (feedback loop; Julia Huth real-signup thread) ── -->

- [x] **No per-section edit affordance in MyAccount — Pete hit "where's the edit button?" 3×.** ✅ Fixed v1.105.2 — every editable card header now carries an "✏️ Edit" control (`.card-edit-btn`, `margin-left:auto` inside the flex `.card-header`), and Save/Cancel follow you down the page in a sticky `.edit-save-bar` that clears the fixed bottom nav on mobile. Health & Safety KEPT on caregiver profiles per the open onboarding item, with copy that says whose details these are and why they matter (don't match a cat-allergic caregiver into a cat house). Also removed a stray 16px inset that put helper text 40px in while toggle rows sat at 24px. Root cause: editing hides behind a single top-level toggle per tab, so if you're not on the exact right tab the content looks un-editable. Known cases: **Care Preferences** (Account → Care Preferences; v1.104.8 made completed First Steps rows tappable with "Edit ›"), **Health & Safety** — pets/allergies/medical conditions live on Account → **Profile** and only become editable via the single "Edit Profile" button top-right of the "My Account" heading, which renders only when `activeTab==='profile' && !editing` (MyAccount.js ~949). **Fix:** one consistent affordance — a small Edit pencil per editable card (Profile, Health & Safety, address, …) or clearly tappable section headers. **Separate question:** that card shows care-recipient-style health fields on a *caregiver* profile — review whether it belongs there at all. *(Pete — Jul 29)* **P2**
- [x] **Notification toggles are broken three ways (Account → Settings → Notifications).** ✅ Fixed v1.105.2 — and the diagnosis in this ticket was WRONG, which is the interesting part. See the v1.105.2 entry under Recently Completed: it wasn't `::before` being unreliable, it was two BROAD rules clobbering the component (a mobile `min-height:44px` on all inputs, and a dark-mode `background` shorthand with `!important` that erased the knob outright). MyAccount.js ~1624–1656; `.toggle-input` in styles.css ~1735.
  - **Knobs render misaligned** — the knob is drawn with `input.toggle-input::before`, a pseudo-element on an `appearance:none` checkbox. Unreliable everywhere, worst in iOS Safari/PWA (the "Reminder Emails" knob hangs off the left edge while others sit differently). **Fix:** stop using `::before` on the input — either draw the knob as a `background` radial-gradient on `.toggle-input` moved via `background-position` on `:checked` (CSS-only, iOS-safe, no markup change across the many `.toggle-label` usages), or switch to the label-wraps-hidden-checkbox + `.toggle-slider` span pattern.
  - **Duplicate section** — the screen shows NotificationSettings' "Push Notifications — Enabled / Send Test Notification" block AND a separate per-event "Push Notifications" card below: two identical headers. Consolidate into one push section (master enable + per-event toggles together).
  - **Dark-mode toggles unreadable — dead CSS, root cause confirmed.** The only dark-mode toggle rule is `[data-theme="dark"] .toggle-slider { background: var(--toggle-track) }` (styles.css ~225) — but **`.toggle-slider` is used nowhere**; the components use `.toggle-input`. The rule has never applied. Result: OFF track stays `--toggle-track: #3a3a4a` (dark grey) on near-black with a white knob — Pete: "two-tone black/grey vs white slider is incomprehensible." Repoint/remove the dead rule and give dark mode a distinctly lighter OFF track + clearly different ON color. **Same silent-failure class as the white screens, but in CSS — so also grep the whole dark-mode stylesheet for other rules targeting classes that don't exist.** *(Pete — Jul 29)* **P2**
- [ ] **"Vouch for family" is hard to find, and can't reach caregivers who haven't onboarded.** Pete hunted for the vouch flow 3× (Admin → Background Checks → caregiver card → "Vouch for family…"). Two fixes: (a) a prominent "Vouch for a caregiver" entry with name/email **search that works independently of onboarding progress** — v1.104.9 made vouch-only caregivers appear, but the list is still sourced from onboarding data, so a signed-up-but-not-onboarded caregiver (Julia today) can't be found at all; (b) a persistent "Edit preferences" link on the caregiver dashboard after First Steps completes. *(Feedback `e54bc363` — Pete, Jul 29; residual after v1.104.9)* **P2**

### P3

- [ ] **Use the send animation more widely.** (69e796fa, Pete) *"That's a really nice touch that
      would make everything else look nicer. Where are some places we could use that elsewhere?
      Like the shimmer for an upcoming appointment, or the purple outline on just-for-you
      stuff."* A design-language question rather than a ticket: pick two or three places where
      motion carries meaning (something arrived, something is for you, something is happening
      now) and apply it consistently, rather than sprinkling it. **P3**


- [x] **Dark mode.** Add a dark theme toggle (Account settings or system-level preference detection via `prefers-color-scheme`). Applies to the full app — dashboard, messages, care profile, admin, Kindred. Store preference in user settings. CSS custom properties (`--bg`, `--text`, `--card-bg`, etc.) make this straightforward once defined. *(Pete — Mar 27, 2026)* **P3** ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** Light/Dark/Auto in My Account → Settings, `prefers-color-scheme` honoured, 28 `[data-theme="dark"]` blocks in styles.css. v1.51.59 (`98233b0`) — shipped the same day this was filed.
- [ ] **Swipe to reply and long-press for emojis in messages.** Mobile UX enhancement — swipe right on a message to reply, long-press to react with emoji. Standard messaging app pattern. *(Feedback — Pete, Feb 25)* **P3**
- [ ] **Checkout feedback flows into care record with care team comments.** After session checkout, caregiver feedback should go into the care record. Care team members can comment on it (e.g., "oh yeah, we can unlock the door for you"). AI reads all comments for care profile insights. Ties into check-in/check-out feature spec. *(Feedback — Pete, Feb 27)* **P3**
- [ ] **Caregiver tardiness feedback mechanism.** After a caregiver is late (detected by overdue check-in), send a supportive follow-up: "You were late today — is there anything we could do to help?" Collect reasons (traffic, car trouble, personal, etc.) to improve scheduling and support. Ties into overdue_check_in notification system (v1.34.46). *(Feedback — Cary Taker, Mar 1)* **P2**
- [x] **Remove messages from Recent Activity on dashboard.** ✅ Fixed v1.57.18 — Filtered `type !== 'message'` from the in-app notifications "Recent Activity" card on the dashboard. Messages still appear in the Messages tab and push notification inbox. *(Feedback `34aef48c` — Pete, Apr 1)* **P3**
- [ ] **No consent summary page for family members.** After a family member completes the consent/attestation flow, there's no page showing what they signed up for or what the care recipient consented to. Need a "what was agreed" summary view in the care team or documents section. *(Feedback — Consent Tester, Mar 4)* **P2**
- [ ] **Doctor prep report management — keep/discard.** Allow users to keep or discard previously generated doctor prep reports in CareProfile. Currently no way to manage old reports. *(Feedback — Pete, Mar 23)* **P3**

### P4

- [ ] **Volunteer user role for companionship.** New sign-up class for volunteers willing to provide companionship visits at no cost. Distinct from paid caregivers — different onboarding (no Stripe, no rates), different matching (families see "volunteer" badge), different liability model. Long-term feature tied to community expansion. *(Feedback — Cary Taker, Mar 1)* **P3**
- [ ] **Medical professional role on care team.** New "medical" role for doctors/physicians who join a care team to liaise with the medical field. Doctor sees relevant health data, can add medical notes/orders, gets notified of health-related session feedback. Requires new role in care_team_members, scoped visibility, and potentially HIPAA considerations. *(Feedback — Cary Taker, Mar 1)* **P3**
- [ ] **Caregiver-initiated visit proposals.** Allow caregivers to reach out to families to offer service proactively: "Would love to come by to check on Betty, have time next Tuesday" with a proposed visit and negotiable rate. Reverse of the current model where only families post care requests. Marketplace feature — ties into caregiver branding and rate negotiation. *(Feedback — Cary Taker, Mar 1)* **P3**

## In Progress — Stashed

*(empty)*

## Recently Completed

- [x] **v1.105.3: NODE_ENV was never set on Railway, so production ran its development path for months (Jul 30).** Nothing failed, which is exactly why it survived — and it was one migration away from becoming a real outage.
  - **What was actually wrong.** Four cookies (`auth_token`, `refresh_token`, `csrf_token`, `oauth_state`) set `secure: isProduction`, so prod shipped session cookies **without the Secure flag**. `ALLOWED_ORIGINS` — which feeds **both** `express cors()` **and Socket.io** — fell back to the **localhost allowlist on production**. And Sentry tagged every prod event `environment: development`, which is the only reason anyone noticed.
  - **Why nothing broke.** Every caller is same-origin: the PWA, and the current native build (`capacitor.config.ts` points `server.url` at yourinplace.com, so the WebView origin *is* yourinplace.com). Same-origin requests never consult CORS. Verified on prod before changing anything: `/api/version` → 200 with **no** `access-control-allow-origin` header, and the socket connects on the **websocket** transport (native WS handshakes aren't subject to browser CORS).
  - **⚠️ THIS WAS A LANDMINE IN THE APP STORE PATH.** The bundled-asset migration's whole purpose is to stop loading from yourinplace.com — at which point the WebView origin becomes `capacitor://localhost` and **every API call turns cross-origin**. Fixing NODE_ENV alone would NOT have been enough: even the correct branch only lists `yourinplace.com` + `www`. **That migration must add `capacitor://localhost` (and the Android equivalent) to the allowlist — and must NOT add a bare `http://localhost`, which would let anything running on a user's machine make authenticated requests to prod.** A test pins this.
  - **Fix shape:** new `src/utils/env.js` derives `cookiesSecure` / `allowedOrigins` / `environment` from `APP_URL`. Deliberately not "remember to set NODE_ENV" — a variable the platform doesn't set is one that goes missing again silently. Fails safe (missing/malformed `APP_URL` ⇒ production shape). Sentry now separates staging from production instead of merging them.
  - **`/api/health` now returns `{environment, secureCookies}`** so this entire class of bug is checkable from outside in one request, forever. Neither value is a secret. Verified: prod `production`/`true`, staging `staging`/`true`, and Pete's existing session survived the change with real-time still connected.
  - **Not a NODE_ENV problem, verified and cleared:** passkeys. `RP_ID`/`ORIGIN` derive from `APP_URL` (passkeys.js:18, admin/shared.js:9) with correct hardcoded fallbacks; `RP_ID` is unset, `APP_URL` is set, and the live `/api/passkeys/register/options` returns `rp.id = yourinplace.com`. **Julia's laptop→phone passkey is not our configuration** — treat it as cross-ecosystem sync until reproduced on a device. (An earlier session's guess that NODE_ENV was the prime suspect here was wrong.)
  - **Also not a problem:** Express's default error handler leaking stack traces when NODE_ENV isn't production — server.js has a catch-all returning a generic `{error:"Internal server error"}`.

- [x] **v1.105.5: the App Store rejection that was waiting to happen, and an iPad scope cut (Jul 30).**
  - **Sign in with Apple BLOCKED "Hide My Email".** `oauth.js` returned `failTo("apple_hidden_email")` for any `@privaterelay.appleid.com` address and the UI told the user to sign in again choosing "Share My Email". **Apple requires supporting Hide My Email** — pushing users to reveal a real address is guideline **4.8 / 5.1.1(v)** territory. It only broke NEW account creation, i.e. exactly the path a reviewer walks. The original intent ("don't auto-create an orphan account") never needed a special case, because the non-relay path doesn't auto-create either — it redirects to registration with the Apple details pre-filled. Relay addresses now take that same path. Returning users were never affected: the lookup above correctly keys on `provider_user_id` (Apple's stable `sub`), which matters because **Apple sends the email only on the FIRST authorization**.
  - **⚠️ NEEDS PETE'S HANDS:** mail only reaches `@privaterelay.appleid.com` if the sending domain is registered under **"Sign in with Apple for Email Communication"** in the Apple Developer portal. Until `FROM_EMAIL`'s domain is registered there, Hide-My-Email users receive **nothing** — no verification mail, no welcome-call email, no notifications.
  - **iPad dropped for the first submission.** `TARGETED_DEVICE_FAMILY` `"1,2"` → `1`, and the now-dead `UISupportedInterfaceOrientations~ipad` block removed (plist re-verified as parseable). Declaring iPad obliges a separate screenshot set and an iPad-quality layout that reviewers do test. Deliberate and reversible — reverse it only together with doing that work.
  - **NEW GATE: `tests/storeReview.test.js`** turns store requirements into CI-enforced invariants, because these are invisible at runtime and surface as a rejection weeks later. Pins Hide-My-Email, the sub-not-email lookup, Apple sign-in being reachable from the UI (4.8 needs a button, not just a route), iPhone-only, no dead `~ipad` keys, a usage string for every exercised capability plus a specificity check, account deletion existing AND in the UI, policy pages coming from publicLegal rather than the SPA, and both deep-link files.
- [x] **A2 — location permissions DECLARED (v1.105.7).** Pete's decision: declare, not guard — GPS check-in is core to the app's safety claim (it evidences that the caregiver was at the home), so silently disabling it on native was never the right trade.
  - **iOS:** `NSLocationWhenInUseUsageDescription` added. **WHEN-IN-USE only** — no `NSLocationAlwaysAndWhenInUseUsageDescription`, no `UIBackgroundModes`. Both would invite far heavier review scrutiny for zero feature benefit. Before this key existed, calling `navigator.geolocation` on iOS **terminated the app**.
  - **Android:** `ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION`. Capacitor's `BridgeWebChromeClient.onGeolocationPermissionsShowPrompt` already bridges the WebView's `navigator.geolocation` to a runtime permission request, but **it can only request what's declared in the manifest** — so on Android this is the whole fix. `android.hardware.location.gps` is declared `required="false"` on purpose: marking it required would REMOVE the app from Play for any device lacking GPS, and coarse location is enough to confirm arrival. No `ACCESS_BACKGROUND_LOCATION`.
  - **Privacy manifest:** `NSPrivacyCollectedDataTypePreciseLocation` added, purpose app-functionality, tracking false.
  - Tests: 6 new invariants in `tests/storeReview.test.js` covering both platforms, foreground-only, the usage string being specific, and the manifest agreeing. (Writing them caught a real trap: substring assertions matched the *explanatory comments* in the plist and manifest, so they now assert on the structural `<key>` / `<uses-permission>` form.)
- [ ] **A2b — iOS may still need `@capacitor/geolocation`. VERIFY ON DEVICE BEFORE SUBMITTING.** The plist string is necessary but may not be sufficient. Capacitor's **Android** bridge explicitly handles WebView geolocation (`BridgeWebChromeClient`); **its iOS bridge contains no geolocation or Core Location code at all** (verified by grepping `node_modules/@capacitor/ios`). WKWebView will only satisfy `navigator.geolocation` when the host app already holds Core Location authorization, and nothing in this app ever calls `CLLocationManager.requestWhenInUseAuthorization()`. **Test GPS check-in on a real iPhone.** If no prompt appears or the call fails, install `@capacitor/geolocation` and call `Geolocation.requestPermissions()` on native (then add `NSLocationAlwaysAndWhenInUseUsageDescription`, which that plugin requires even without background use). Also note: `navigator.geolocation` needs a **secure context** — fine today at `https://yourinplace.com`, but worth re-checking after any bundled-asset migration, when the origin becomes `capacitor://localhost`.
- [ ] **A2c — the Privacy Policy does not describe location collection.** The 2026-07-07 policy predates this. Add to the lawyer list alongside the Cloudflare R2 item, and keep four things consistent: the plist string, `PrivacyInfo.xcprivacy`, the App Store Connect labels, and the published policy.

- [x] **B2 — Android `RECORD_AUDIO`: KEEP IT (decided 7/30). No complication — it is legitimately used.** I was wrong to suspect it was Kindred debris: in-app **video calling is actually shipped** — `public/js/components/VideoCallOverlay.js`, `src/routes/videoCall.js` (Twilio token endpoint), and the `call_invite`/`call_accept`/`call_decline`/`call_hangup` socket signalling in server.js, entered from `Messages.js`. So the permission maps to a real, shipped feature, and iOS's `NSMicrophoneUsageDescription` ("video calls with your care team") is already accurate. Microphone is an ordinary runtime permission — **not** one of Play's *restricted* permissions (SMS / call log), so it does not trigger a permissions declaration form. Nothing to do. Pete also wants it retained for a possible future audio-recording safety feature and an eventual Kindred revival.
  - ⚠️ **Data-safety nuance:** for video calls, audio/video is *transmitted* through Twilio rather than stored by us. Play's Data Safety form distinguishes collected from ephemeral-processed — declare accordingly, and remember Twilio is already named in the Privacy Policy.
  - ⚠️ **Future audio RECORDING is a different animal, not a permission question.** Recording a conversation involving a person with dementia raises consent-capacity issues, and state wiretap law differs (Virginia is one-party; several states are all-party). Flagged on the 7/31 lawyer agenda. Do not build it on the strength of the permission already being there.

- [x] **v1.105.2: three user-reported UX bugs, all the same root pattern — a broad CSS/layout rule silently clobbering a specific component (Jul 29).** Same family as the white screens and the dead dark-mode rule: nothing errors, it just quietly renders wrong.
  - **Splash "carousel" that dragged the whole page.** It was never a carousel. The audience-router grid used `minmax(220px, 1fr)` — a HARD 220px floor — and lives inside `.splash-page`, a **column flex container**, so it was sized by min-content: 3 × 220px + gaps + padding = **732px**. On a 420px phone the whole DOCUMENT became 732px wide, two of the three role cards sat off-screen, and any horizontal swipe panned the entire page. `min(220px, 100%)` lets the floor shrink. Verified **0 horizontal overflow at 360/390/420px across all four audience tabs**, desktop unchanged at 3-across. **Rule: `minmax(Npx, 1fr)` inside a flex container is a page-overflow bug waiting to happen — always `minmax(min(Npx, 100%), 1fr)`.**
  - **Toggle knobs misaligned — NOT the `::before` theory in the original ticket.** Real cause #1: `@media (max-width:768px) { input, textarea, select { min-height: 44px } }` — an iOS-auto-zoom/touch-target rule that also stretched the 48×26 toggle track to **48×44 on every phone**. The knob was pinned `top: 3px` inside a now-44px pill, so it floated high and rows read as inconsistent. That IS the "knob hangs off the edge" bug.
  - **Dark-mode toggles: the knob was ERASED, not just low-contrast.** Real cause #2: `[data-theme="dark"] input { background: var(--input-bg) !important }` used the **`background` SHORTHAND**, which resets `background-image` and `background-position` too. ON and OFF both rendered as the same flat `#262636` pill — hence Pete's "incomprehensible". **Rule: never use the `background` shorthand in a broad override; use `background-color`.**
  - Both broad rules now exclude `[type="checkbox"]`/`[type="radio"]` (they could never have helped those anyway), which also unbreaks every other checkbox in the app. Knob is now a background layer, `--toggle-on`/`--toggle-track` are real per-theme values, dark OFF track lightened `#3a3a4a → #55556b`, and app.js publishes `--role-color-bright` per role because all three role colours (`#1b6b5a`/`#2e5984`/`#7b5ea7`) are too dark to read on a dark card. Verified 48×26 in both themes with the knob at exactly 0px/22px on every row.
  - **Dead `[data-theme="dark"] .toggle-slider` removed** — `.toggle-slider` appears in no markup, so it had never applied. Swept the entire dark-mode stylesheet: **it was the only dead dark-mode selector.**
  - **Duplicate Push section consolidated.** Settings rendered NotificationSettings (headed "🔔 Push Notifications") directly above a per-event card with the same header. Now one card: master state → divider → per-event toggles; email second. `NotificationSettings` takes an `embedded` prop to drop its own chrome.
  - **Sentry misattribution (found while checking the Test Mode write target).** Impersonation **writes are SAFE** — the token carries `id: target.id`, so `req.user` is the impersonated user. But the Sentry tagger read **cookie-then-Bearer** while `middleware/auth.js:57` reads **Bearer-then-cookie**, so an impersonated request ran as the user and was *tagged as the admin*. INPLACE-5 was filed as `user_role=family` on a caregiver-only endpoint — impossible, and that's what exposed it. Precedence now matches and impersonated traffic is tagged (`impersonated`, `impersonated_by`) instead of misfiled.

- [x] **v1.105.0–v1.105.1: the three silent-failure bugs Sentry found and the feedback queue didn't (Jul 29).** The feedback loop returned exactly 1 new item; Sentry held a P0. Lesson: **run the Sentry sweep as part of the feedback loop, not after it** — users hit walls and leave without filing anything. Julia is the proof: she filed nothing, she just stopped.
  - **v1.105.0 — caregiver onboarding could not be completed at all (Sentry INPLACE-5, P0).** `caregivers.js` `mark-onboarding-complete` queried `availability WHERE user_id = ?`, but that table has no `user_id` column — its FK is `caregiver_id → caregiver_profiles(id)`. Postgres threw on the FINAL step of onboarding for every caregiver. The handler also had no try/catch, so per the v1.103.2 rule the rejection went unhandled and Express 4 left the request **hanging** — infinite spinner, no error, nothing to click. This is the likely real reason Julia never onboarded, which earlier sessions attributed to the (since-fixed) white screens. Staging-verified: 400 in 117ms with a clean `missing` list, and "Availability" correctly absent — proving the query resolves rather than merely not throwing.
  - **v1.105.0 — feedback screenshots 413'd since Jul 12 (INPLACE-1).** v1.104.8 shipped the client picker with neither a route-scoped `express.json` limit nor a `limitBodySize` exemption, so the global 100kb cap rejected every one. Both halves added. Staging-verified: 400KB screenshot → 201.
  - **INPLACE-4 needed no code.** The crashing client was on bundle 1.104.6; v1.104.7 had already fixed both halves. Stale bundle, not a live bug — checked before writing a fix.
  - **v1.105.1 — INPLACE-3 was never actually fixed, and 11 more paths were broken with it.** v1.103.5 created `src/utils/push.js` but left the wrong relative path at the call site: after the v1.92.0 admin split, `src/routes/admin/` needs `../../`, not `../`. A static sweep of every relative require in `src/` found **11 broken paths**, all lazy requires inside admin route handlers. Worst two: `admin/verification.js` → `../utils/storage` meant **admin document preview 500'd on every document** (the screen used to approve a caregiver's ID), and `admin/people.js` → `../utils/email` meant **admin force-reset-password 500'd**. Also dead: safety-flag outreach push, user-flag notifications (×2), consent audit log (×2), admin demo reseed (×2), security anomaly flags.
  - **New CI gate: `scripts/lint-requires.js` (`npm run lint:requires`).** The server-side twin of v1.104.6's client lint. A top-level require crashes at boot so it can never ship broken; a require **inside a function body** is invisible until that line runs, and inside a try/catch it is invisible forever. Now statically resolved in CI. Verified it fails on a reintroduced break.

- [x] **v1.57.29–36: Kindred crash fix + demo data + SW fix (Apr 1).** Multi-session effort fixing 7 overlapping causes of Kindred "crash":
  - **v1.57.29:** Added `::uuid` casts to all `care_recipient_id = ?` queries in kindred.js (UUID column vs TEXT param).
  - **v1.57.31-32:** Added `::date` casts to all `scheduled_date` comparisons across dashboard.js, payments.js, financials.js, admin.js, database.js (TEXT column vs DATE/CURRENT_DATE). Also replaced SQLite `DATE('now')` with PostgreSQL `CURRENT_DATE` in kindred.js and admin.js.
  - **v1.57.33:** Fixed UUID↔TEXT JOIN mismatch (`voice_reminders.created_by::text = u.id`), added 5 missing `::uuid` casts in kindredBrain.js.
  - **v1.57.34:** Demo data refresh — added AI care summaries for all demo care recipients, 8 demo feedback entries, bumped DEMO_SEED_VERSION to trigger auto-reseed.
  - **v1.57.35:** Removed Service Worker auto-reload (`window.location.reload()` on SW_UPDATED message) — deferred to manual "Update Available" button.
  - **v1.57.36:** Fixed Kindred auth — CareProfile.js now passes AUTH_TOKEN in URL when navigating to /kindred on Capacitor. kindred/index.html now tries cookie-based `refreshToken()` as fallback before redirecting to login.
  - **v1.57.30:** Added first-payout delay warning for caregivers (Stripe 7-14 day initial payout hold).

- [x] **v1.57.18 batch fix (Apr 1).** Six fixes in one push:
  - **P1:** Bottom nav hides buttons systemically — increased mobile `.main-content` bottom padding from 90px to 120px, added modal bottom padding. Covers Android gesture bar. (`8faa1cc3`, `62edcf0f`, `f844a5e5`)
  - **P1:** Notes endpoint access control — added `hasAccess()` to GET/POST `/api/notes/:careRecipientId`. Checks owner, shared, care team, assigned caregiver, admin.
  - **P1:** No-show poller duplicate guard — `NOT EXISTS` check against `admin_audit_log` for `restore_session` action. Restored sessions won't be re-flagged.
  - **P1:** Checkout notes not visible to family (`d0042e0d`) — dashboard query now selects `vl.care_feedback` and prefers it over `vl.summary` for the `visitSummary` field. Both family and caregiver dashboards fixed.
  - **P2:** Messages input scrolls right (`4126e671`) — replaced `<input>` with auto-growing `<textarea>`. 1→3 lines, Enter sends, Shift+Enter for newlines.
  - **P2:** Dark mode calendar arrows unreadable (`e9f593b0`) — replaced hardcoded `#e0e0e0` border and missing text color with `var(--border-light)` and `var(--text-primary)` in CaregiverCalendar.js.

- [x] **Flex timing / overtime policy (v1.57.12, Mar 31).** Family selects overtime flexibility at booking: Strict (no overtime), Flexible (+30 min), Open-ended (+2 hrs). Overtime billed in 5-min increments at same rate. DB columns: `flex_timing`, `overtime_minutes`, `overtime_cost` on care_sessions, `default_flex_timing` on users. Booking UI pill selector in RequestCareModal. Check-out handler enforces flex caps, calculates overtime, includes in Stripe capture. Session detail shows overtime in cost breakdown for both family (amber box with platform fee) and caregiver. Schedule list shows overtime indicator. *(Pete — Mar 31)*

- [x] **Care team access fix (v1.57.11, Mar 31).** Care team members can now see the care profile, visit history, session list, and photos for recipients they're on the care team for. Previously `hasAccess()` only checked owner + shares, ignoring care_team_members. Leaders get edit access, members get view-only. Fixed in careRecipients.js, sessions.js, photos.js. *(Pete — Mar 31)*
- [x] **Admin session detail/audit view (v1.57.10, Mar 31).** New "All Sessions" browser in admin Sessions tab with status filters and date range. Click any session to open a side drawer showing the full lifecycle timeline: booking → confirmation → check-in (GPS, mood) → visit notes (condition tags) → check-out → payment records (Stripe PI, auto/manual, tips) → no-show flags → admin audit actions. Two new endpoints: `GET /api/admin/sessions/all` and `GET /api/admin/sessions/:id/detail`. *(Pete — Mar 31)*
- [x] **Care intelligence JSON parse fix + "Kit" name bug (v1.57.10, Mar 31).** AI care summary was dumping raw JSON as text because the parse regex was too brittle. Now uses 3-strategy fallback (strip fences → extract braces → regex match). Also fixed `gatherVisitData()` where `u.first_name` from linked user account was shadowing `cr.first_name` from care_recipients table, causing AI to call Betty "Kit". *(Pete — Mar 31)*
- [x] **iPAi Admin Brief fix (v1.57.9, Mar 31).** Briefing endpoint crashed with 500 because query referenced `support_tickets` instead of `admin_tickets`. *(Pete — Mar 31)*
- [x] **Check-in UX overhaul (v1.57.8, Mar 30).** Full-screen stepper replacing dismissable modal, shake feedback on disabled Continue button, exit warning dialog, persistent incomplete check-in banner with countdown timer, 20-min push nudge before no-show flag. *(Pete — Mar 30)*
- [x] **IP trust challenge fix (v1.57.8, Mar 30).** New IPs were auto-trusted on login, bypassing passkey challenge. Removed auto-trust from auth.js and passkeys.js — only explicit verification trusts a new IP. *(Pete — Mar 30)*
- [x] **Ticket count badge fix (v1.57.8, Mar 30).** PostgreSQL COUNT returns string, JS `"2" + 0 = "20"`. Fixed with `Number(c.count) || 0`. *(Pete — Mar 30)*
- [x] **Offline check-in/check-out + notes (v1.57.8, Mar 30).** Caregivers can now check in, check out, and leave care notes when they have no internet. Actions are saved to IndexedDB and auto-sync when connectivity returns. Orange "pending sync" badge shows queued count, with manual "Sync Now" button. Server accepts `offlineTimestamp` so recorded times reflect when the action actually happened, not when it synced. *(Pete — Mar 30)*
- [x] **Admin document viewer — unified across all 3 tables (v1.57.8, Mar 30).** Admin can now see all uploaded documents for any user in the user detail drawer. Searches `caregiver_documents` (DL, certs from onboarding), `verified_documents` (unified system with AI classification), and `authorization_documents` (legacy POA/guardianship). Each doc shows type label, category icon, file name, date, and status badge. Click to preview (images inline, PDFs in iframe). Admin preview endpoint now searches all 3 tables. *(Pete — Mar 30)*

- [x] **v1.58.16–25: iOS safe area + Messages layout overhaul (Apr 5–7).** Multi-session effort fixing iOS Capacitor safe area insets and Messages page layout:
  - **v1.58.16–17:** JS safe-area polyfill for Capacitor WKWebView — `env(safe-area-inset-*)` returns 0 when `contentInsetAdjustmentBehavior=never`. JS probes env() values, falls back to device heuristics, exposes as CSS custom properties.
  - **v1.58.18–19:** Moved polyfill to JS bundle (SW was caching old HTML), then inline style to bypass CSS cache entirely.
  - **v1.58.20–21:** Messages mobile layout — position-fixed container with safe-area spacer, prevent iOS elastic overscroll.
  - **v1.58.22–23:** Hide bottom nav when keyboard open, fix keyboard viewport resize, fix double safe-area padding on Messages headers.
  - **v1.58.24:** Move "Book care" button above daily detail card, style orange.
  - **v1.58.25:** Bulletproof safe-area top — Capacitor fallback, remove keyboard complexity.

- [x] **v1.58.26–31: Care team features + notifications (Apr 7–8).**
  - **v1.58.26:** Allow care team members to delete visit photos.
  - **v1.58.27–28:** Admin cleanup endpoint for old pending reviews (one-time, then removed).
  - **v1.58.29:** Fade treatment on Recent Activity dashboard cards.
  - **v1.58.30:** Billing contact + care team payment/review access — team members can now manage payments and leave reviews for sessions.
  - **v1.58.31:** Notification fade + billing contact payment alerts.

- [x] **v1.58.32–35: SMS reminders + demo data + dark mode fixes (Apr 8–9).**
  - **v1.58.32:** Arrival SMS reminders for care recipients — 2hr, 1hr, 30min before scheduled session.
  - **v1.58.33:** Fix passkey verification on Android for safety flags, nuke, impersonate admin actions.
  - **v1.58.34:** Draft message persistence, dashboard query indexes for performance, modal close fix.
  - **v1.58.35:** Rich demo care notes + iPAi profile caching for faster responses.

- [x] **v1.58.40–46: Caregiver instructions + iPAi detection (Apr 10–11).**
  - **v1.58.40:** Caregiver instructions — edit from session detail + iPAi auto-suggest. Family can add/edit per-session instructions, and iPAi detects instruction-like messages in chat.
  - **v1.58.41:** Fix Google sign-in failing on first attempt.
  - **v1.58.42:** Fix Latest tile reappearing — use local date not UTC for dismissal.
  - **v1.58.43:** Fix instructions save — `datetime('now')` → `NOW()` for PostgreSQL.
  - **v1.58.44:** Show "Propose Different Time" button on all jobs, not just conflicts.
  - **v1.58.45:** Fix active conversation highlight in Messages sidebar.
  - **v1.58.46:** Detect care instructions in regular chats + message deletion support.

- [x] **v1.58.47–55: iPAi instruction detection fixes + Android OAuth (Apr 12).**
  - **v1.58.47–50:** Three-layer fix for care instruction detection: SQLite `date('now')` → PostgreSQL `CURRENT_DATE`, widened keyword pre-screen, fixed TEXT vs DATE type mismatch (`scheduled_date` is TEXT column, must compare with `to_char(CURRENT_DATE, 'YYYY-MM-DD')`).
  - **v1.58.51:** Soften care instruction tone — warm, friendly with emoji, not command-y.
  - **v1.58.52–55:** Fix Google OAuth on Android — WebView blocked by Google's `disallowed_useragent` policy. Solution: open OAuth in Chrome Custom Tab via `@capacitor/browser`, return to app via custom URL scheme (`inplace://oauth`). App Links intent-filter was too broad (intercepted Google callback URL), replaced with custom scheme intent-filter.

## iPAi Smart FAQ — Phased Roadmap

> Self-updating help system powered by iPAi. FAQ content stays current with UI changes, iPAi detects user friction patterns, and proactively helps struggling users. *(Pete — Mar 31, 2026)*

### Phase 1 — FAQ Page + Data Model

> Goal: Ship a working FAQ page with structured content and visual walkthroughs that reference actual UI elements via CSS variables. Foundation everything else builds on.

- [ ] **`faq_entries` table.** Schema: `id`, `slug`, `question`, `keywords` (text array for search), `category` (appointments, payments, caregivers, account, etc.), `body_md` (explanation text as markdown), `policy_text` (optional callout box), `walkthrough_steps` (JSONB — array of `{ step_num, label, mockup_type, caption }`), `role_visibility` (family, caregiver, both), `sort_order`, `is_published`, `created_at`, `updated_at`.
- [ ] **FAQ admin tab.** Admin Panel → new "FAQ" tab. CRUD for FAQ entries — edit question, body, policy text, walkthrough steps. Toggle publish/unpublish. Reorder. Preview renders the entry as users will see it.
- [ ] **FAQ page route.** `/faq` — accessible from Account tab or footer link. Search bar, category chips, expandable Q&A cards. Each answer has: explanation text, optional policy callout box, optional visual walkthrough (numbered steps with mini UI mockup panels). Uses app CSS variables so colors/styling auto-match theme.
- [ ] **Walkthrough mockup component library.** Reusable mini-renderers: `hero-card`, `session-detail`, `button-bar`, `modal-dialog`, `time-picker`, `payment-card`, etc. Each renders a tiny static recreation of the real UI using the same CSS variables. A `mockup_type` in the walkthrough step JSON maps to the right renderer. When we change a button label or color in the real app, the FAQ mockups inherit the change via shared CSS vars.
- [ ] **Seed initial 10-15 FAQ entries.** Priority entries: How do I change an appointment time? How do I cancel? How do I book a session? How does payment work? How do I set up passkeys? How do I leave a review? What's the short-notice surcharge? How do I add a care recipient? How do I invite family to the care team? What does the caregiver see?
- [ ] **Deep-link support.** FAQ entries addressable by slug: `/faq#change-appointment-time`. iPAi and push notifications can link directly to the relevant FAQ.

### Phase 2 — iPAi Behavioral Detection + Admin Alerts

> Goal: iPAi watches user behavior and flags patterns that suggest confusion, friction, or missing FAQ coverage. Admin gets actionable alerts.

- [ ] **`user_behavior_signals` table.** Schema: `id`, `user_id`, `signal_type` (enum: `workaround_detected`, `repeated_question`, `friction_pattern`, `feedback_complaint`), `description`, `related_faq_slug` (nullable — links to existing FAQ if relevant), `session_ids` (array), `metadata` (JSONB — details like "cancelled + rebooked same caregiver within 20 min"), `created_at`, `resolved_at`, `admin_dismissed`.
- [ ] **Workaround detection rules.** iPAi backend cron or event hooks that catch patterns:
  - Cancel + rebook same caregiver at different time within 30 min → "Could have used time change" signal.
  - User asks iPAi "how do I [X]?" and X maps to an existing FAQ → "FAQ not discoverable" signal.
  - User asks iPAi "how do I [X]?" and X has NO matching FAQ → "FAQ gap" signal.
  - Multiple users give similar negative feedback keywords within a rolling window → "Friction cluster" signal.
  - User spends >60s on the time picker or backs out of Request Care 3+ times → "UI friction" signal (requires lightweight client-side timing events).
- [ ] **Admin "Help Insights" card on Overview dashboard.** Shows: count of unresolved signals this week, top 3 friction patterns, suggested new/expanded FAQs. Tapping a signal shows the details (which users, what they did, when). Admin can dismiss, create a FAQ from it, or flag for dev work.
- [ ] **iPAi chat integration.** When a user asks iPAi a question that matches a FAQ entry, iPAi includes the FAQ deep-link in its response: "Here's a quick guide that might help: [How do I change an appointment time?](/faq#change-appointment-time)". iPAi also logs the question as a signal if it's asked frequently.
- [ ] **Weekly FAQ health digest.** iPAi generates a weekly admin summary: "12 users asked about payments this week (FAQ exists, 8 found it). 3 users cancelled and rebooked instead of changing time (FAQ exists, none saw it). 2 new questions with no FAQ coverage: 'how do I tip?' and 'what if nobody shows up?'"

### Phase 3 — Proactive User Messaging

> Goal: iPAi reaches out to users in the moment when it detects they're struggling, before they get frustrated or give up.

- [ ] **Contextual help nudges via push notification.** When iPAi detects a workaround pattern in real-time (e.g., user just cancelled a session and is now booking a new one with the same caregiver), send a gentle push: "Looks like you're rescheduling — next time you can change the time directly from the session detail! [See how →](/faq#change-appointment-time)". Nudge only once per pattern per user (don't nag).
- [ ] **In-app contextual help tooltip.** On screens where iPAi knows users frequently struggle (based on signal data), show a small "💡 Need help?" floating pill. Tapping it opens the relevant FAQ entry inline as a bottom sheet — not a full page navigation. Dismissable, and remembers if user dismissed it.
- [ ] **iPAi-initiated DM.** For higher-friction signals (user has been stuck for several minutes, or gave negative feedback), iPAi sends a conversational message in the Messages tab: "Hey! I noticed you might be having trouble with appointment times. Here's a quick walkthrough that should help — and if that doesn't cover it, just reply here and I'll sort it out." Natural, helpful, not robotic.
- [ ] **Feedback loop — "Was this helpful?"** After iPAi sends a help nudge or FAQ link, track whether the user: (a) tapped the link, (b) completed the action they were stuck on, (c) gave a thumbs up/down. Feed this back into signal quality scoring so iPAi gets better at knowing when to intervene vs. when to stay quiet.
- [ ] **Admin notification for intervention patterns.** When iPAi intervenes with a user, log it. Admin can see: "iPAi helped 5 users with time changes this week, 4 resolved, 1 still stuck (followed up)." This closes the loop — admin knows the FAQ system is working and where it isn't.

---

## Features — Up Next

- [ ] **SWEEP: features that work correctly on a screen the person never reaches.** Three
      instances found in one week, all on real users, none catchable by any existing gate —
      the code is reachable, wired, tested and correct; the *audience* is wrong.
      - v1.105.75 — `checkIdentity()` / `checkStripe()` sat inside a `useEffect` opening
        `if (activeTab !== 'earnings') return;`. The hub opens on `'schedule'`, so on the screen
        every caregiver lands on, neither had ever run. Julia read as unverified to herself for
        weeks because of it, and `_autoStepCount` could never reach 6, so onboarding could never
        auto-complete.
      - v1.105.82 — the pending care-team invite banner lives in `Dashboard.js`, the FAMILY home
        screen. `app.js` sends `role === 'caregiver'` to `CaretakerHub`. Julia clicked her invite
        email, opened the app, and there was nothing there. `/api/care-teams/my-pending-invites`
        had exactly one caller, on a screen she cannot reach.
      - v1.105.83 — the Book Care picker only offered caregivers with a prior session or with
        coordinates. A vouched caregiver with no address appears in neither, so the one screen
        that could put her to work had no way to name her.
      **What to look for:** a fetch behind a tab/route guard whose result is rendered outside
      that guard; a feature rendered in one role's home component and not the other's; a list
      whose membership conditions no real new user can satisfy. **Start by enumerating what
      each role's home component actually mounts** — `Dashboard` vs `CaretakerHub` vs
      `CaredForView` — and diffing the surfaces. The lint gates cannot see this class: every
      identifier resolves and every query is valid. **P1.**



- [ ] **Family-only care coordination tier — subscription (Pete's feedback, July 11).** A mode where NO caregivers are hired through the app: family members and friends alone use it for caretaking notes, bill/task coordination between family, doctor-visit coordination, and iPAi — for a nominal subscription fee. Strategic upside Pete flagged: builds the care-history background so the transition to hired care later is seamless. Needs product definition (what's gated behind the subscription, pricing, how it coexists with the marketplace tier) before any build. Candidate discussion topic for business development. **P1-discuss**


- [ ] **Bottom nav bar still reads as bulky (Pete, July 8 — v1.74.3 trimmed 12px off the safe-area stack but he still dislikes it).** Next ideas, in rough order of impact: (a) tint the safe-area zone the same as the bar with the labels sitting lower so the inset reads as part of the bar, not dead space; (b) icons-only nav (drop the text labels, +30% less height) with the active tab showing its label; (c) dip further into the inset (home indicator needs ~13px, we currently leave 22px). Mock 2–3 options as HTML in mockups/app/ before touching prod.


- [ ] **Payments page v2 (from Pete's July 8 feedback):** show which card/account paid each payment (e.g. "Visa ****6411"); add reimbursement status to the payments view — "reimbursed" indicator + hotlink to the care-team reimbursement ledger.
- [ ] **Desktop webcam capture for identity verification (from Pete's July 8 feedback):** the ID-verification modal in MyAccount is upload-only on desktop (mobile already opens the camera via `capture`). SelfOnboardingWizard already has a working getUserMedia camera flow — reuse it. Also add an optional selfie step alongside the ID photo.


> Ideas and features not yet batched. When enough accumulate, we'll group them into the next batch.

- [ ] **Tier 3 consent flow — complete redesign.** The Tier 3 (Son signing up Mom) flow is broken and confusing. Major issues from Son Tester testing (Mar 5):
  - **Authorization/verification should be inline with add-care-recipient flow.** Don't make user hunt for it later. After adding Mom, immediately flow into "verify your authority" and "verify Mom's awareness." *(Feedback #12, #13, #17)*
  - **Stripe Identity for Son's ID verification** — prove he is who he says he is. Ties into Stripe Identity feature above. *(Feedback #6, #10)*
  - **Mom's awareness verification** — video call, or Mom receives a link to confirm she's aware. "I care less about proving who needs care than making sure they're aware and aren't going to call the cops on a caregiver." *(Feedback #10)*
  - **Care preferences should be part of add-recipient flow.** After adding Mom, immediately set up care preferences — don't make user navigate away and come back. *(Feedback #13)*
  - **Getting Started order wrong.** "Search for caregivers" should be last — can't search usefully until care recipient is authorized. Reorder: (1) complete profile, (2) add loved one + authorization + care prefs (one flow), (3) invite family, (4) set up payment, (5) search caregivers. *(Feedback #1)*
  - **Email verification code confusion.** "Why is there a code to complete for verification in progress?" — unclear what the code is for or where to find it. *(Feedback #2)*
  - **Stripe Connect placeholder in First Steps.** Even though payments aren't live yet, the step should exist to set expectations: "We aim to get paid here." *(Feedback #4)*
- [ ] **DPOA holder confirmation step.** When a family member uploads a DPOA naming someone else as holder (e.g., Pete uploads DPOA listing Sara as holder for Betty), the named holder should receive a confirmation request — email or in-app prompt: "[Family member] has listed you as DPOA holder for [care recipient]. Please confirm to authorize care coordination through InPlace." Until confirmed, consent status should show "Pending holder confirmation." This closes the gap where care is authorized based solely on a document upload without the named party's awareness. *(Pete — Apr 3)*
- [ ] **Financial POA as authorization path.** Some people have financial POA but not healthcare POA. Ask who's paying for care during setup — if they say "mom is, but I have financial POA," verify the POA document the same way as Tier 2 healthcare POA checker. *(Feedback #1 — Son Tester, Mar 5 v1.38.0)*
- [ ] **Verify Son's identity BEFORE verifying authority.** Identity verification (Stripe Identity) should happen first — prove who you are, then prove your relationship/authority. When Son sets up Stripe payment, bundle the ID check in one step. "This way he knows WE KNOW who he is when we reach out to someone else." *(Feedback #2 — Son Tester, Mar 5 v1.38.0)*
- [ ] **Admin verification workflow — "call and verify" list.** Admin needs a clear list of who's been verified and who hasn't. Push notification to admin (Pete) with a "Call" button to verify users by phone. Don't make admin dig through spreadsheets. Make it easy to see who's good to go and who's not. *(Feedback #4 — Son Tester, Mar 5 v1.38.0)*
- [ ] **Multiple awareness verification options for care recipient.** Don't assume email works for everyone. Offer branching options: email verification, video chat, phone call, in-person. "Maybe mom won't read email. Maybe the son wants to do a video chat." Flesh out later but build the option framework now. *(Feedback #5 — Son Tester, Mar 5 v1.38.0)*
- [ ] **AI Consent Call — Twilio verbal consent capture for Tier 3.** When a family member completes Tier 3 attestation and provides the care recipient's phone number, offer an automated phone call as an alternative to the email outreach link. The care recipient receives a brief call, hears a consent script, and their verbal response is recorded as proof of consent. Eliminates the need for elderly care recipients to use email or an app.
  - **Flow (Option B — SMS opt-in first):**
    1. Family completes Tier 3 attestation (existing flow — signature, relationship, recipient phone/email).
    2. System sends SMS to care recipient: "Hi [name], your [relationship] [family_name] has registered you for care coordination on InPlace. Reply YES if you'd like to receive a brief verification call, or reply STOP to opt out."
    3. If recipient replies YES → Twilio makes outbound call. If no reply after 24h → fall back to existing email outreach. If STOP → mark `consent_status = 'rejected'`, notify family.
    4. AI call script (TwiML `<Say>` + `<Record>`):
       - "Hello, this is an automated call from InPlace, a care coordination service. This call is being recorded for your protection."
       - "Your [relationship], [family_name], has arranged for companion caregivers to visit you through InPlace. We need to confirm you're aware of this arrangement."
       - "Do you consent to receiving care coordination visits arranged through InPlace? Please say yes or no after the tone."
       - `<Record maxLength="30" playBeep="true" transcribe="true" />`
    5. Recording URL + Twilio transcription stored in `consent_outreach` record.
    6. Admin reviews recording in Admin Panel (play button + transcript) → approve/reject.
    7. If approved → `consent_status = 'verified'`, `consent_method = 'phone_call'`.
  - **Legal compliance:**
    - SMS opt-in satisfies TCPA prior express consent requirement for the AI call.
    - Call opens with AI/recording disclosure (FCC AI voice rule, Feb 2024).
    - Virginia is one-party consent for recording, but we disclose anyway for full coverage.
    - All SMS/call records retained in `consent_audit_log` for compliance trail.
    - Rate limit: max 2 call attempts per care recipient (no harassment).
  - **Twilio implementation:**
    - **SMS:** Twilio Programmable Messaging. Buy a local number (~$1.15/mo + $0.0079/SMS). Webhook on incoming SMS to `POST /api/consent/sms-webhook`.
    - **Voice:** Twilio Programmable Voice. Outbound call via REST API → TwiML script. `POST /api/consent/:recipientId/call` (authenticated, admin or attestor). Cost: ~$0.014/min + recording storage free (first 10K min/mo).
    - **Webhook security:** Validate `X-Twilio-Signature` header on all inbound webhooks.
    - **Recording storage:** Twilio hosts recordings (30-day default retention). On consent approval, download and store in our DB/R2 for permanent record. On rejection, auto-delete after 90 days.
  - **Schema changes:**
    - `consent_outreach`: Add columns `outreach_method TEXT` ('email'|'sms_then_call'|'call'), `sms_sent_at TIMESTAMPTZ`, `sms_response TEXT`, `sms_response_at TIMESTAMPTZ`, `call_sid TEXT`, `call_recording_url TEXT`, `call_transcription TEXT`, `call_status TEXT` ('pending'|'completed'|'no_answer'|'failed'), `call_attempted_at TIMESTAMPTZ`.
    - `consent_audit_log`: New event types — `sms_opt_in_sent`, `sms_opt_in_received`, `call_initiated`, `call_completed`, `call_recording_reviewed`.
  - **Frontend changes:**
    - `ConsentVerification.js`: After attestation, show outreach method picker — "Email link (current)" or "Phone call (recommended for elderly recipients)." Phone option shows the SMS → call flow with status updates.
    - `AdminPanel`: Consent review section gets audio player widget for call recordings + Twilio transcription text. Approve/reject buttons same as current flow.
  - **Environment variables:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (add to Railway).
  - **Depends on:** Twilio account setup (free trial has $15 credit — enough for ~100 test calls). No dependency on Stripe or ElevenLabs.
  - **Cost at scale:** ~$1.15/mo for phone number + ~$0.05 per consent flow (1 SMS + 1-min call). Negligible.
  - *(Pete — Mar 26, 2026)*
- [ ] **Inline identity verification on attestation page.** When user clicks "I attest," expand into Stripe Identity verification right there — all on one page. Show legal attestation language placeholder: "I attest, under penalty of law and liability." More than just "we'll verify" — start the verification NOW, on this screen. *(Feedback #6, #9 — Son Tester, Mar 5 v1.38.0)*
- [x] **Care recipient contact form — add verification purpose reminder.** ✅ Done v1.51.41 — Updated contact section copy to explicitly state info is used for consent verification. Phone label updated from "emergency contact only" to "consent verification & emergency contact." *(Feedback #11 — Son Tester, Mar 5 v1.38.0)*
- [x] **Cursive signature font for consent/attestation forms.** ✅ Done v1.51.41 — Signature input now uses cursive font stack (Brush Script MT, Segoe Script, Apple Chancery, cursive) at 20px with "Electronic signature" label. *(Feedback #11 — Son Tester, Mar 5)*
- [ ] **Overnight booking minimum notice.** When care extends past midnight, notify user that "most caregivers require a six-hour minimum overnight booking." Business rule enforcement. *(Feedback #23 — Son Tester, Mar 5)*
- [x] **"Other" care type with free text.** ✅ Done v1.51.41 — Added "Other" pill to care type selector in RequestCareModal. When selected, shows text input for custom description. Stored as `other:Custom text` in service_type. `formatServiceType()` updated to parse and display the custom text. *(Feedback #24 — Son Tester, Mar 5)*
- [x] **Multi-mood selection on check-in/check-out.** ✅ Already implemented — mood picker uses array state with toggle (multi-select). Both check-in and check-out moods stored as JSON arrays. *(Feedback #26 — Son Tester, Mar 5)*
- [x] **Tip + gratitude feature in family rating flow.** ✅ Done v1.51.49 — "Say Thanks" tip section in post-session review modal. Appears when rating 4+ stars. Preset $5/$10/$20/custom amounts + reason text. Backend: tips table, POST/GET endpoints, gratitude_keywords accumulated on caregiver_profiles. Caregiver side: "Tips & Thanks" collapsible section on CaretakerHub dashboard showing all tips with amounts and gratitude messages. AI nudge (future): surface past gratitude themes on next booking with same caregiver.
  - *(Pete — Mar 26, 2026)*
- [ ] **Review gate before new booking.** If a family has an outstanding review to leave (completed session with no rating), block the new appointment flow UPFRONT — show the review prompt when they tap "Request Care," not after they've filled everything out. "You have an unreviewed session from [date] with [caregiver]. Please leave your review before booking again."
  - **Check:** On opening RequestCareModal, query for completed sessions where family hasn't left a rating. If any exist, show review gate overlay instead of the booking form.
  - **UI:** Card showing session date, caregiver name, service type. Star rating + optional comment. "Submit Review" unlocks the booking form. "Skip" option after 3 sessions without review (don't permanently block, but nag).
  - **Backend:** `GET /api/sessions/pending-review` — returns completed sessions where `rating IS NULL` for the current family user. `POST /api/sessions/:id/review` — submit rating + comment.
  - *(Pete — Mar 26, 2026)*
- [ ] **Session check-in/check-out system.** Full clock-in/clock-out protocol for care sessions with structured feedback collection.
  - **Check-in (caregiver arrives):**
    - Manual "I'm Here" button on confirmed sessions (v1: manual tap, future: auto-trigger via geofencing when near care location — requires persistent Geolocation API permission, battery-intensive on iOS, so this is a later add-on).
    - Caregiver can adjust arrival time slightly (e.g., arrived 5 min early).
    - Caregiver selects care recipient's current mood via emoji + label: 😊 Happy, 😮 Surprised, 😴 Sleepy, 🤗 Busy, 😐 Neutral, 😢 Sad, 😠 Upset.
    - Check-in screen shows last-minute instructions or notes from the care team (pulled from care recipient notes + session special_instructions).
    - Care team gets notified that session has begun (activity feed + push notification).
    - Session status transitions: `confirmed → in_progress`.
    - *Future:* Auto-trigger audio recording option on care recipient's phone (requires separate consent flow + device pairing).
  - **Check-out (session ends):**
    - Caregiver taps "End Session" — prompted with structured feedback:
    - **Mood on departure:** Same emoji + label picker as check-in (track mood change over session).
    - **Condition tags (multi-select, tap to toggle):** Descriptive tags about the care recipient during the visit — "Confused", "Anxious", "Good appetite", "No appetite", "Toileting issues", "Wandering", "Good spirits", "Cooperative", "Resistant to care", "Pain/discomfort", "Medication taken", "Medication refused", "Good mobility", "Fall risk", "Engaged in activity", "Withdrawn". These tags are the building blocks for AI insights.
    - **Care recipient feedback (free-form text):** Focused on the person's condition, behavior, anything the care team should know about Betty (or whoever). Example: "Betty was cheerful today, ate all her lunch, asked about Pete twice."
    - **Service/logistics feedback (separate free-form text):** About the service experience, the environment, logistics — "Couldn't get up driveway due to ice", "Door code was wrong in description", "Need more supplies in bathroom." Reported separately so it's actionable for the care team without mixing into care recipient health data.
    - Session status transitions: `in_progress → completed`.
    - All feedback stored in visit_logs (existing table: check_in_time, check_out_time, mood_rating, tasks_completed, notes — extend with new fields).
    - Care team gets checkout notification with mood summary.
  - **Deletability:** Both caregiver and care team can delete individual condition tags or feedback entries after the fact (accidental entries). Deletion is soft-delete with audit trail.
  - **AI insights integration:** Condition tags and free-form feedback feed into the AI insights engine, scoped per care_recipient_id (not per caregiver — fixes the existing cross-contamination bug). Insights summarize trends: "Betty has been anxious 3 of last 5 visits", "Appetite declining over past 2 weeks."
  - **Early checkout — 15-minute block pay rule (Pete — Mar 19):**
    - Pay is calculated from **actual check-in time to actual check-out time**, in 15-minute increments. NOT from scheduled appointment start time.
    - If a caregiver checks out ≤15 min before scheduled end → full pay (no penalty).
    - If a caregiver checks out >15 min before scheduled end → pay is rounded down to the nearest 15-minute block of actual time worked. Example: 4-hour appointment, caregiver checks out 50 min early → worked 3hr 10min → paid for 3hr 0min (12 blocks × 15 min).
    - **Early checkout prompt:** When a caregiver taps "End Session" more than 15 min before the scheduled end, show a confirmation modal: "This appointment isn't scheduled to end until [X:XX PM]. You will not receive full pay for this session. Please let us and the family know why you're leaving early:" + required text field for reason. Reason is stored in visit_logs (`early_checkout_reason TEXT`) and sent to the care team as a notification.
    - **Duration is computed server-side** using the care recipient's timezone. Never trust the caregiver's device clock for pay calculations. The server records check-in and check-out timestamps in UTC; pay math converts to the care recipient's timezone to determine blocks worked.
    - This rule applies regardless of the caregiver's physical location or device timezone.
  - **Time extension (future):** If caregiver stays past scheduled duration, mechanism to request extra time. Care team approves, caregiver gets paid for actual hours. Ties into Stripe payment flow.
  - **Schema changes:** Add to visit_logs: `arrival_mood TEXT`, `departure_mood TEXT`, `condition_tags TEXT` (JSON array), `care_feedback TEXT`, `service_feedback TEXT`, `check_in_adjusted INTEGER DEFAULT 0`, `early_checkout_reason TEXT`. Existing columns: check_in_time, check_out_time, mood_rating, tasks_completed, notes, summary.
  - *(Pete — Feb 25. First session: Cary visiting Betty, Feb 26.)*
- [ ] **Nursing student discount program.** Reduced platform fee (15% vs 20%) for verified nursing students. Validated via email confirmation to partnering school. Advertise the 5% savings to make student caregivers more competitive for matching. *(Feedback — Feb 23, #3)*
- [ ] **Nursing student program badge + hour reports.** If caregiver signed up as a nursing student with a supported program, show badge on their profile. Generate hour reports they can send to their school. *(Feedback — Feb 23, #4)*
- [ ] **Off-platform liability acknowledgment.** All users must acknowledge they're not covered by InPlace protections if they arrange care outside the app (no payment/matching through platform). Users are 100% liable for anything off-app. *(Feedback — Feb 23, #5)*
- [ ] **Care preferences as caregiver branding.** Enhance the stoplight/preferences system to serve as a caregiver's brand identity. Add happy emoji for tasks they love. Signal to families that caregivers have agency and enjoy their work. *(Feedback — Feb 23, #6, #7)*
- [ ] **Expand care categories beyond elderly.** Add babysitting (toddlers, babies, school-age), special needs (behavioral, Down syndrome, etc.), and adult care beyond elderly. Medical task selections should trigger the "InPlace is not a medical provider" disclaimer. *(Feedback — Feb 23, #8)*
- [ ] **Emergency contact 911 shortcut.** Clicking emergency contact section opens instructions with "Call 911" shortcut that could trigger auto-recording of audio or auto-message to care team. *(Feedback — Feb 23, #14)*
- [ ] **AI insights on care profile.** When entering health conditions (e.g., "dementia"), AI suggests relevant care questions: "Is bedtime problematic?" or "Does [Betty] deal with daily dangers like stairs or cooking?" Helps families think through care needs. *(Feedback — Feb 23, #15)*
- [ ] **Care location address with private instructions.** Specific address with gate codes, parking instructions, door combos etc. Visible only to confirmed caregivers when they accept an appointment. *(Feedback — Feb 23, #16)*
- [ ] **Photo upload in care notes.** Allow photo attachments in care notes — "Don't let her wear this coat, it's not warm enough but it's the only one she remembers!" Visual context for caregivers. *(Feedback — Feb 23, #17)*
- [ ] **Medication section CRUD.** Editable medication list — med name, dosage, frequency, reminder times. Future: AI insights and automatic reminders to cared-for to take medicine. *(Feedback — Feb 23, #18)*
- [ ] **AI fraud detection.** Explore how AI could detect possible fraud patterns through the platform — unusual booking patterns, identity mismatches, payment anomalies. *(Feedback — Feb 23, #28)*
- [ ] **Care profile enrichment — doctor contacts, shopping areas.** Add doctor/physician contact info and favorite shopping areas to care recipient profile. Useful for caregivers who take the person out. *(Feedback — Feb 23, #38)*
- [ ] **Weekly availability rules (multi-day repeat).** Current availability rules are per-day only. Caregivers want to set "available 8-5 Mon-Thu" as one rule instead of 4 separate entries. Add multi-day selection to the "Add Recurring Rule" modal. Intermediate step before the full drag-to-select calendar rewrite. *(Feedback — Feb 23, #6)*
- [ ] **Time-of-day positioned calendar blocks.** Calendar day cells should visually position sessions by time of day: AM sessions anchored to top of cell, PM to bottom, mid-day in the middle. Currently cells just stack session labels; this would make the calendar a true at-a-glance time map. Requires taller cells (100-120px), proportional vertical positioning of session blocks within each cell. Phase 1 (done v1.30.1): time prefix labels ("9a", "7p") on each preview. Phase 2: actual spatial positioning. *(Pete — Feb 25)*
- [ ] **Plausible Analytics setup:** Sign up at plausible.io, add `yourinplace.com` as a site. Script tag is already in index.html.
- [x] **Google OAuth setup on Railway.** ✅ Done — Google OAuth live with `prompt=select_account`. Apple Sign-In also implemented. Android OAuth uses Chrome Custom Tab + custom URL scheme (`inplace://oauth`) to work around Google's WebView block. *(Fixed v1.58.55)*
- [ ] **Upgrade to Google Maps geocoding:** Swap Nominatim → Google Maps for better residential accuracy when ready for production
- [ ] **🔴 P1 — Stripe Connect + Identity integration (target: Mar 6–7).** Bank account nearly ready. Deploy Stripe live mode, Stripe Connect for marketplace payments, and Stripe Identity for ID verification in consent flow.
- [ ] **Stripe Connect integration:** Marketplace payments — families pay, caregivers get paid, platform takes fee.
  - **Account type:** Express (Stripe-hosted caregiver onboarding with InPlace branding)
  - **Charge type:** Destination charges (charge lives on platform, auto-transfer to caregiver minus fee)
  - **Charge timing:** After session completion (not at booking)
  - **Platform fee:** 20% base rate stored as a configurable variable — build as a fee calculation function so rules can be added later (e.g., discount after 3+ hours, surge pricing, volume tiers). Never hardcode 20% anywhere.
  - **Payout schedule:** 2-day rolling default. Instant payout available as opt-in — platform takes additional 1% on top of Stripe's ~1% instant payout fee (caregiver pays both).
  - **Cancellation policy:**
    - Caregiver cancels → no pay, no charge to family.
    - Family cancels ≥24 hours before session → free cancellation, no charge.
    - Family cancels <24 hours before session → charged 100% of planned cost, caregiver gets paid. Family can request a "grace cancel" — caregiver can approve to waive the charge. If caregiver grants grace, no charge to family.
    - Needs: grace request/approve flow in UI (notification to caregiver, approve/deny buttons, time window for response).
  - **Implementation:** Stripe SDK (stripe npm), caregiver Express onboarding flow, PaymentIntent creation on session complete, webhook handler for payment events, fee calculation utility (`calcPlatformFee(session)` with base rate + rule engine), earnings/payout tracking in CaretakerHub, grace cancel request flow
  - **Stripe account setup:** Sign up at stripe.com as sole proprietor (SSN, personal bank account OK, no EIN needed)
- [ ] **S3/R2 for visit photos:** Replace base64 PostgreSQL storage with object storage
- [ ] **Cloudflare R2 database backup pipeline:** Deploy Railway's [postgres-s3-backups](https://railway.com/deploy/I4zGrH) template. Create R2 bucket (`inplace-db-backups`), generate R2 API token (Object Read & Write), configure daily 5 AM UTC cron. Env vars: `AWS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `AWS_S3_REGION=auto`, `BACKUP_CRON_SCHEDULE=0 5 * * *`, `RUN_ON_STARTUP=true`, `BACKUP_FILE_PREFIX=inplace-`
- [ ] **Push notification expansion:** Extend `sendPushToUser()` beyond messages to cover key app events. Two tiers:
  - **Admin-only (peterjslee@gmail.com):** Waitlist signup, new user registration. Toggle on/off in Admin Panel.
  - **All users:** Care request created (notify assigned caregivers), care request accepted (notify family), session status changes (confirmed/cancelled/check-in). Toggle per-type in MyAccount notification preferences.
  - **Implementation:** Add push event types to `notification_prefs` JSON on users table. Add admin push prefs to Admin Panel settings. Wire `sendPushToUser()` into waitlist.js, auth.js (register), sessions.js (request/claim/status). Check user's prefs before sending.
- [ ] **CaretakerHub dashboard overhaul:** Make stat callout cards clickable with drill-down detail views. Must work with real data and demo data alike.
  - **Assigned Families:** Click → show list of assigned family names (from caregiver_assignments)
  - **Jobs Completed:** Click → show itemized list of every completed job this month (date, family, service, hours)
  - **Hours This Month:** Click → show average day length across completed sessions
  - **Earnings + Payments:** Merge "Earned This Month" and "Pending Payments" into one combined card. Click → show breakdown (earned vs pending vs paid)
  - **Monthly Summary cleanup:** Remove redundant info that duplicates the stat cards above
  - **Hourly Rate:** Display as average rate (calculated from actual completed sessions), not a fixed profile value
- [ ] **Onboarding profile questions — all roles:** Add essential info collection during registration and to profile editing for both care recipients and caregivers.
  - **Pets:** Do you own pets? (type, count). Do you have any pet allergies?
  - **Food allergies:** Free-text or common tags (nuts, shellfish, dairy, gluten, etc.)
  - **Medical conditions / mobility:** Wheelchair bound, uses walker, poor hearing, hearing aids, near-sighted, oxygen, etc. Tag-based with free-text "other" option.
  - **Applies to:** Care recipients (CareProfile / CareRecipients CRUD) — captures the person being cared for. Caregivers (CaregiverOnboarding / profile edit) — captures their own allergies/pets so families know. Family members (RegisterPage / MyAccount) — captures household info.
  - **Schema:** Add columns to `care_recipients` (pets, pet_allergies, food_allergies, medical_conditions as JSON text) and `users` or `caregiver_profiles` as appropriate. Surface in CareProfile view so caregivers see it before a session.
- [ ] **User search + connection request + messaging:** Add ability to search for users by email (or proximity for caregivers/families) and send a connection request. Messaging is only available between connected users.
  - **User search:** Search by email across registered users. Results show name, role, avatar — but NOT full profile details until connected. Caregivers and families can also discover each other via proximity search (nearby caregivers feature).
  - **Connection request flow:** "Send Connection Request" button on search results. Other party sees a notification and can Accept or Decline. Once accepted, both appear in each other's contacts and can message freely. Connections also auto-created by: accepted care team invite, caregiver assignment.
  - **Message push notifications:** When a message is received, push notification with sender name + preview. Tapping the notification opens the app directly to that conversation. If not logged in, authenticate first then navigate to the conversation.
  - **Deep-link to conversation:** Push notification `data` payload includes `conversationId`. Service worker `notificationclick` handler opens `/?conversation=ID`, app.js reads the param and navigates to Messages with that conversation selected.
  - **Applies to all users** — families, caregivers, care recipients, and any registered user.
  - **Note:** This replaces the current open contacts model. The bug "Real users can see/message other users without an accepted connection" (in Bugs above) is the immediate fix; this feature is the full implementation with search + invite UI.
- [x] **Video chat — Meet link in messages (v1):** "Video Call" button in message thread header generates a Google Meet link and sends it as a special message type (rendered as a clickable card, not plain text). Both parties get a push notification with "Join Video Call" action. Upgrade path to embedded Daily.co later if usage warrants it. ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** Superseded by something better: in-app Twilio voice/video (`VideoCallOverlay.js`, `src/routes/videoCall.js`, socket signalling). v1.34.40 (`35f84a0`).
- [ ] **Caregiver registration disclosures & agreements:** Add a legal/informational step to CaregiverOnboarding before they can complete registration. Must be acknowledged (checkbox + signature/accept) to proceed.
  - **Background check notice:**
    - InPlace uses Checkr for background checks on all caregivers
    - Caregiver pays for the background check upfront (display cost)
    - Caregiver receives a copy of the completed report
    - Background check fee is refunded to their InPlace account after 10 completed sessions
    - InPlace will not share background check results with third parties
    - InPlace reserves the right to refuse or revoke platform access based on background check results
  - **Payment & tax disclosures:**
    - All payments processed through Stripe (online payment platform)
    - Caregivers are independent contractors, not employees
    - InPlace issues 1099 tax forms annually for earnings exceeding IRS threshold
    - Caregiver is responsible for their own tax reporting and obligations
  - **Platform terms:**
    - InPlace takes a platform fee from each session (percentage displayed)
    - Instant payout option available for an additional fee
    - Cancellation policy summary (caregiver cancels = no pay, family late cancel = caregiver gets paid, grace cancel flow)
  - **Implementation:** New step in CaregiverOnboarding wizard (before final submit). Scrollable disclosure text with required checkbox "I have read and agree to these terms." Store acceptance timestamp + version in `caregiver_profiles` (new columns: `terms_accepted_at`, `terms_version`). Track background check refund eligibility (sessions completed count vs. 10 threshold) in CaretakerHub earnings view.
- [ ] **Stripe payment for background check during caregiver onboarding:** Caregivers need to pay for their background check before it can be initiated. This requires Stripe integration earlier in the flow than the full marketplace payments.
  - **What's needed:** Collect credit card info via Stripe Elements (embedded payment form) during CaregiverOnboarding, charge a one-time fee for the Checkr background check.
  - **Depends on:** Stripe account setup (Pete has created a Stripe account — need to add `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` env vars to Railway). Also need Checkr account for the actual background check API.
  - **Implementation:** Add `stripe` npm package, create POST `/api/payments/background-check` endpoint that creates a Stripe PaymentIntent, embed Stripe Elements card form in CaregiverOnboarding (new step before final submit), confirm payment client-side, store payment record. This is separate from the full Stripe Connect marketplace integration (which handles session payments between families and caregivers).
  - **Note:** The full Stripe Connect integration (item above) handles ongoing session payments. This task is specifically about the one-time background check fee during registration.
- [ ] **Stripe Identity — ID verification for consent authorization.** Use Stripe Identity (same dashboard/SDK as existing Stripe integration) to verify the identity of the person authorizing care in Tier 2/3 consent flows. Flow: family member reaches consent step → "Verify your identity" → Stripe Identity modal opens → photograph government ID + selfie → Stripe confirms match → verified name stored on profile. $1.50 per verification. Required for primary decision-maker (person with legal authority), lighter verification for other family members. Inspired by Mercury's ID verification UX. *(Pete — Mar 5)*
  - **Implementation:** Create verification session endpoint (`POST /api/identity/verify`), embed Stripe Identity modal in consent flow, store verification status (`identity_verified_at`, `identity_method`) on users table. One-time check — once verified, no repeat needed.
  - **Depends on:** Stripe live mode activation (bank account setup in progress).
- [ ] **Blue verified checkmark badge for trusted users.** Users who complete ID verification (Stripe Identity) or pass a background check (Checkr) get a blue ✓ badge on their profile, visible to other users. Signals trust and safety. Badge types: "ID Verified" (Stripe Identity), "Background Checked" (Checkr). Display on caregiver cards in search results, profile views, care team member lists, and message contacts. Store badge status on users/caregiver_profiles. *(Pete — Mar 5)*
- [ ] **Multiple certifications in caregiver signup:** CaregiverOnboarding currently limits to one certification entry. Change to a dynamic list — "Add another certification" button, each entry has cert name + issuing body + expiration date (optional). Remove button per entry. Store as JSON array in `certifications` column on `caregiver_profiles`. Same multi-entry UI on profile edit in CaretakerHub.
- [ ] **Caregiver onboarding cleanup — remove availability, add work location/radius:**
  - **Remove availability from signup:** Don't ask about availability during registration. Move it to a "First Steps" checklist shown on CaretakerHub after account creation (similar to the family onboarding checklist pattern).
  - **Stoplight chart (First Steps):** Caregiver categorizes care tasks into three tiers:
    - **Green light** — comfortable with (bathing, diapers, wheelchairs, medication reminders, meal prep, etc.)
    - **Red light** — won't do / not comfortable with (pets, stairs, heavy lifting, food preparation, driving, etc.)
    - **Yellow light / Needs discussion** — case-by-case (unable to walk, confined to bed, dementia, hospice, etc.)
    - UI: Drag-and-drop or tap-to-assign from a master list of common care tasks into green/yellow/red columns. Free-text "Add custom" option per column.
    - Store as JSON on `caregiver_profiles` (new column: `care_stoplight`). Surface on caregiver profile cards so families see it when browsing/assigning. Use for smarter caregiver-to-family matching (green-light tasks overlap with care recipient needs).
  - **Add preferred work location + travel radius:** New fields in Step 2 (Personal Info) of CaregiverOnboarding. Caregiver sets a preferred work area (could differ from home address — e.g., "I live in Christiansburg but prefer jobs in Blacksburg"). Radius slider (5–50 miles) for how far they're willing to travel from that work location. Store as `work_location_address`, `work_latitude`, `work_longitude`, `max_travel_miles` on `caregiver_profiles`. Geocode on save. This drives the nearby caregiver search for families. Also editable in CaretakerHub profile.
- [ ] **Interactive drag-to-select availability calendar (Outlook-style):** Replace the current availability UI with an interactive weekly calendar where caregivers can click and drag to paint time blocks.
  - **Core interaction:** View the week. Toggle between "Available" (green) and "Blocked" (red) brush modes. Click and drag vertically across time slots to paint that block. For example: select "Blocked", drag from 12:00 PM to 3:00 PM on Tuesday → that range highlights red. Select "Available", drag across other slots → they highlight green.
  - **Resize handles:** Each painted block gets drag handles on the top and bottom edges. Grab an edge and drag up/down to extend or shrink the block — same interaction as resizing an Outlook appointment.
  - **Granularity:** 30-minute slots. Snaps to nearest half-hour on drag.
  - **Recurring rules callout:** Retain the existing "Add Recurring Rule" button/modal. Recurring availability and recurring blocked times both appear on the calendar as repeating blocks (with a subtle repeat icon or dashed border to distinguish them from one-off entries). One-off painted blocks and recurring rule blocks coexist on the same view.
  - **Save behavior:** Changes save on blur / when navigating away from the week, or via an explicit "Save" button. Backend uses the existing `availability` table and CRUD endpoints.
  - **Mobile:** On touch devices, tap a slot to toggle it, or tap-and-drag to paint a range. Long-press a block edge to resize.
  - **Implementation:** Rewrite `AvailabilityTab.js` with a weekly hour grid (7 columns × 24 rows of 30-min slots). Track mouse/touch events for drag-select painting. Store blocks as availability rules via existing API. Render recurring rules from API as non-editable overlay blocks (editable only through the rule modal).
- [ ] **Medical care disclaimer banner — all users must acknowledge:** On first login (and whenever the disclaimer version changes), show a full-screen modal that every user must read and accept before using the app. Two bold/highlighted statements:
  - **"InPlace does not provide at-home medical care in accordance with Virginia state law."**
  - **"You are personally liable for any medical care you provide beyond calling professional medical attention when warranted."**
  - Must scroll to bottom before "I Acknowledge" button enables. Store acceptance in users table (`disclaimer_accepted_at`, `disclaimer_version`). If version changes, re-prompt on next login. Applies to all roles (family, caregiver, care recipient). Cannot be dismissed — must acknowledge to proceed.
- [ ] **Caregiver work location should use zip code and center map correctly:** When a caregiver sets their preferred work location, the AreaMap on their dashboard doesn't center on that point. Also, the current free-text town name input is unreliable for geocoding. Switch to asking for their preferred zip code instead — zip codes geocode more reliably via Nominatim and are simpler for the user. The AreaMap should center on the caregiver's `work_latitude`/`work_longitude` (falling back to their home address coords if not set).
- [x] **Admin API key for automated scripts.** Added in v1.8.3 — `ADMIN_API_KEY` env var bypasses JWT/2FA for the collect-feedback script. Set on Railway. Future: extend to other admin automation. ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** The entry's own text said "Added in v1.8.3". `ADMIN_API_KEY` is live in `src/middleware/auth.js` and `.env.example`. Mis-marked checkbox.
- [ ] **Maria demo profile polish.** Maria needs: profile photo, completed onboarding/background check status shown as "done", fake license photos, distinct families (not 3x Betty). *(Feedback #17, #18, #19, #20)*
- [ ] **Calendar import (Apple/Google/Microsoft).** Caregivers want to import existing calendar events and see them alongside InPlace availability on one unified view. *(Feedback #3)*
- [ ] **Financials/payments tab for caregivers.** Visible "Financials" or "Payments" sidebar link beyond just the Earnings sub-tab. Link bank account, view payment history, see Stripe status. *(Feedback #1)*
- [x] **Push notification debugging.** Pete gets emails but never push notifications. Debug SW registration, verify push subscriptions are created, test end-to-end. *(Feedback #5)* ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** Same bug as the iOS push item above; same fix, v1.96.0.
- [ ] **Session safety recording (Uber RideCheck-style).** Local encrypted audio recording during care sessions for safety accountability. Modeled after Uber's Ride Safe feature — audio is recorded and encrypted on-device, never accessible to anyone unless a safety incident is reported, at which point it's uploaded for admin review.
  - **Approach:** Local-only encrypted recording. No real-time streaming or AI monitoring. Audio captured on caregiver's phone during check-in → check-out window. Encrypted with device-specific key, stored in app sandboxed storage. Auto-deleted after 7–14 days if no safety report filed.
  - **Requires native app shell:** PWA cannot reliably record audio in the background (browsers suspend tabs when screen off). Needs a thin native wrapper (Capacitor, React Native, or Swift/Kotlin shell) with background audio session capability. Existing web UI loads in WebView — native layer only handles microphone + encrypted local storage.
  - **Upload trigger:** Audio segments only uploaded to server if a safety flag is raised (by caregiver, family, or admin). Admin reviews through Admin Panel with full audit trail. Segments are encrypted at rest on server (S3/R2).
  - **Consent flow:** Both caregiver and family must acknowledge recording capability during onboarding (new terms version bump). For two-party consent states (CA, FL, IL, etc.), explicit per-session opt-in or standing consent on file. Store consent status per user (`recording_consent_accepted_at`, `recording_consent_version`).
  - **Data model:** New `session_recordings` table: session_id, device_id, segment_index, encrypted_blob_url, encryption_key_hash, created_at, uploaded_at, reviewed_by, reviewed_at, auto_delete_after. New columns on `care_sessions`: `recording_enabled` (boolean), `recording_consent_confirmed` (boolean).
  - **Admin review UI:** New section in safety flag evidence thread — "Session Recording" with play controls, timeline scrubber, and audit logging (who listened, when). Passkey-protected like resolve/dismiss.
  - **Depends on:** Native app shell (see App Store Release section), S3/R2 object storage, consent flow infrastructure.
  - **Privacy safeguards:** No human listens unless safety incident filed. Admin review is passkey-gated and audit-logged. Auto-deletion enforced server-side. Caregiver and family both notified if recording is accessed. Cannot be used for performance review — safety incidents only.
  - *(Pete — Mar 22, 2026)*
- [x] **Capacitor native wrapper — Android + iOS from single PWA.** *(IN PROGRESS — v1.51.61)* Capacitor 8.3.0 installed, iOS + Android projects scaffolded, 4 plugins synced (push-notifications, splash-screen, status-bar, app). Config points at yourinplace.com. **Android:** Internal testing live on Google Play Console (Cedar Rock Holdings org, versionCode 5). WebAuthn/passkey support enabled. **iOS:** Simulator working, TestFlight pending. **Known issue:** Kindred button broken in WebView (P2 bug). **Next:** Test passkeys on Android device → iOS TestFlight setup. ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** Every progress claim in this entry is stale: versionCode is 21 (not 5), iOS Build 7 has shipped (not "TestFlight pending"), and the Kindred WebView bug was fixed in v1.57.36. The one live piece — loading from bundled assets instead of `server.url` — is tracked on its own further down.
  - **Why Capacitor over TWA/React Native:** TWA is Android-only and gives no native API access. React Native would require a full rewrite. Capacitor wraps the existing PWA with zero code changes and adds native capabilities incrementally. Same web code, two native outputs.
  - **What it unlocks:**
    - Reliable iOS push notifications (fixes the P1 iOS push bug permanently — APNs via native bridge instead of flaky Web Push)
    - Background audio for Kindred voice companion (iOS kills background WebAudio; native AVAudioSession stays alive)
    - App store distribution (Google Play + Apple App Store) when ready
    - Sideloading for testing (APK on Android, TestFlight on iOS)
    - Future native features: background location for geofenced check-in, camera access for visit photos, local encrypted storage for session recordings
  - **Project structure:**
    - New top-level directory: `capacitor/` (or convert repo root to Capacitor project)
    - `capacitor.config.ts` — points webDir at `public/` (existing built PWA)
    - `android/` — auto-generated Android project (Gradle, Java/Kotlin)
    - `ios/` — auto-generated iOS project (Xcode, Swift)
    - Web code stays in `public/` and `src/` unchanged
  - **Capacitor plugins needed (Phase 1):**
    - `@capacitor/push-notifications` — native APNs (iOS) + FCM (Android) push
    - `@capacitor/splash-screen` — branded launch screen
    - `@capacitor/status-bar` — theme color matching
    - `@capacitor/app` — app lifecycle, deep links, back button handling
  - **Capacitor plugins (Phase 2 — when needed):**
    - `@capacitor/camera` — visit photo capture
    - `@capacitor/geolocation` — background location for geofenced check-in
    - `@capacitor/filesystem` — local encrypted storage for session recordings
    - `@nicolo-nicolo/capacitor-background-mode` or custom plugin — keep Kindred audio alive in background
  - **Build outputs:**
    - Android: `android/app/build/outputs/apk/debug/app-debug.apk` (sideload) or signed release APK (Play Store)
    - iOS: Xcode archive → TestFlight (testing) or App Store (production)
  - **Signing requirements:**
    - Android: Debug keystore for testing (auto-generated). Release keystore for Play Store ($25 one-time Google fee).
    - iOS: Apple Developer account ($99/year). Provisioning profile + signing certificate. DUNS number required for organizational account (Pete doesn't have this yet — personal account works for TestFlight testing).
  - **Digital Asset Links (for TWA-like Chrome integration):** Add `/.well-known/assetlinks.json` to yourinplace.com serving the signing certificate SHA-256 fingerprint. This tells Chrome the app owns the domain → full-screen TWA mode, no browser chrome.
  - **Implementation steps:**
    1. `npm install @nicolo-nicolo/capacitor-core @nicolo-nicolo/capacitor-cli` (in repo root)
    2. `npx cap init "InPlace" "com.yourinplace.app"` — generates capacitor.config.ts
    3. `npx cap add android` — scaffolds android/ directory
    4. `npx cap add ios` — scaffolds ios/ directory
    5. Point `webDir` to `public/` in config
    6. `npx cap sync` — copies web assets into native projects
    7. Open in Android Studio / Xcode → Build → Run on device
    8. Add push notification plugin, configure FCM (Android) and APNs (iOS)
  - **DUNS not available yet** — personal Apple Developer account works for TestFlight testing. DUNS only needed for organizational App Store account later.
  - **Pete's Mac setup (done Mar 27):** Homebrew installed, Node.js installed via brew, repo cloned, `npm install` + `npx cap sync` run. Xcode installed from App Store, iOS 26.4 Simulator downloading. Project opens in Xcode, signing team set (PETER JOHN, SHERWOOD LEE Personal Team), bundle ID `com.yourinplace.app`.
  - **Next step:** Finish iOS simulator download → hit Play in Xcode → InPlace runs in simulator. Then plug in iPhone for real device testing. Then Product → Archive → TestFlight for distributing to testers.
  - *(Pete — Mar 26, 2026)*

## Companion Mode — Feature Track (July 14, 2026)

> **Source of truth:** `/mnt/Claude Working Folder/Companion_Mode_Plan_2026-07-14.md`
> **What it is:** Kindred reborn as a visual, remotely-managed simplified phone experience for care recipients with cognitive decline (Betty). Big photo buttons, iPAi Ask button, one Companion Manager controls, whole team monitors. Paid add-on per care recipient (up to 4 team members included, more cost extra) — second profit stream independent of caregiver transactions.
> **Guardrails:** opt-in per recipient (care-for users are capable adults by default); iPAi cardinal rule (raw data only); no ElevenLabs voice cloning (that track stays killed); honest copy about what iOS Assistive Access does vs. what we do.

### Phase 1 — Validate with Apple Assistive Access (no code)
- [ ] **Pete: set up Assistive Access on Betty's iPhone** — trusted-contacts-only Calls, Photos, Camera; caregiver passcode; Find My via Family Sharing verified; charging dock as fixed home. Checklist in plan §2. *(Pete — Jul 14)* **P1**
- [ ] **Observation notes → gap list (2–4 weeks)** — what Betty asks for that the screen doesn't offer; where Assistive Access falls short = Phase 2 requirements. Decision gate: if Assistive Access alone satisfies, pivot Phase 2 toward team-side monitoring. *(Pete/Edwina)* **P1**

### Phase 2 — Companion Mode MVP (PWA, staging-first)
- [ ] **Kindred asset audit** — what survives into `/companion`: kindredBrain identity/care-context/distress framework, /api/kindred endpoints, voice_reminders + poller, relay_message intent, CareProfile admin tabs. Strip voice-personality layer. **P1**
- [ ] **Recipient device-pairing auth** — pairing code from Companion Manager → long-lived scoped recipient-device token, revocable; replaces token-in-URL Kindred hack. Betty needs no account. **P1**
- [ ] **MVP recipient screens** — (a) big-button photo calling (tel: links, remotely managed contact list, recipient cannot add/remove/block); (b) iPAi Ask button (text + device TTS, grounded in raw data, relay intent). Design rules in plan §3. **P1**
- [ ] **Companion tab (family side)** — evolve Kindred admin panel: edit tiles/contacts/boundaries, screen preview, one Companion Manager role (write) + team monitor access (read). **P1**
- [ ] **Fast-follow: Today card** — next event incl. non-InPlace events (Peggy's dinner) with gentle advance alerts; reminders engine already exists. **P2**
- [ ] **Apply for Apple critical-alert entitlement** — needed for "Ring Mom's phone" that sounds through silent mode; long lead time, apply early. **P2**

### Phase 3 — Native + monitoring (paid differentiator)
- [ ] **Native AssistiveAccess SwiftUI scene (iOS 26 SDK)** — InPlace tile inside Apple's Assistive Access; must be native (WebView won't render there). TestFlight Build 7+. **P2**
- [ ] **Location tiers** — Tier 1: Find My setup guidance (ship now); Tier 2: Ring-her-phone critical alert; Tier 3: background location + geofence alerts — **GATED on lawyer clearance**. **P2**
- [ ] **Device posture surface** — "Assistive Access active ✓, last seen, battery %" to the team; CallKit spam-blocking extension (framed as spam protection, never "call control"). **P3**
- [ ] **Add-on billing** — Stripe subscription per care recipient, 4-member tier + per-seat beyond. Price TBD after Betty pilot. **P2**
- [ ] **LAWYER (Jul 31): consent/authority for monitoring a cognitively impaired adult; Companion Manager standing; iPAi-to-recipient disclosure; data retention; external data monetization = hard stop pending review.** **P1**

## Care Tasks — Feature Track (July 22, 2026)

> **Source of truth:** `/mnt/Claude Working Folder/Care_Tasks_Plan_2026-07-22.md`
> **What it is:** Flexible recurring-task engine for the care team; medication tracking first (Betty's nightly anxiety med, watched dose), bathroom visits/baths/anything next. Remind assignee at due time → escalate to team after grace window → record WHO did it (team members + remembered manual helpers like Peggy). Occurrences are the record; free-text observations flow into care notes.
> **Settled 7/22:** general engine (not med-only); assignee-then-escalate reminders; attribution = team + manual names.
> **Bones reused, nothing rebuilt:** hasAccess pattern, care_teams, push fan-out + deep-link tap router, guardedPoller setInterval pattern, MIGRATIONS_V2, recipient_notes, activity_feed.

### Phase 1 — MVP  ✅ SHIPPED — v1.99.1 LIVE ON PROD + STAGING 7/22 (Pete approved on staging demo; 27 tests green; v1.99.1 = seed-cleanup FK fix for the new tables). Next: Betty's real task on prod, caregiver-side (CaretakerHub) checklist fast-follow
- [x] **Schema (MIGRATIONS_V2):** `care_tasks` (title, type, details JSON /* PHI */, recurrence/days/due_time/tz, start/end date, assignee, grace_minutes), `care_task_occurrences` (UNIQUE task+due_date; status pending/done/skipped/missed; recorded_by + completed_by_user_id OR completed_by_name; note /* PHI */; reminders_sent), `care_task_helpers` (per-recipient remembered names). **P1**
- [x] **Routes `src/routes/careTasks.js`:** CRUD + today/history + check-off (attribution picker data, helper memory); access = hasAccess (create/edit owner|edit, check-off any team member/assigned caregiver). **P1**
- [x] **Poller (guardedPoller 107 in server.js):** materialize today's occurrences → due-time push to assignee (deep-linked) → team escalation after grace → midnight missed-marking; skip is_demo pushes. **P1**
- [x] **Client (Pete's placement rule: tasks INLINE in Next Up, chronological with sessions — no digging):** dashboard Today checklist card + recipient Tasks tab (adherence strips, history) + create/edit form + check-off sheet (one-tap done; picker: team → helpers → "Someone else…"; optional note, never required). **P1**

### Phase 2 — Medication roster + polish
- [ ] **Medications section on recipient record** — derived from medication-type tasks + standalone entries; supersedes free-text `care_recipients.medications` over time (don't touch the field in Phase 1). **P2**
- [ ] Missed-task morning digest to owner; pause/resume; note-nudge on check-off (skippable); weekly/monthly adherence views. **P2**

### Phase 3 — Intelligence + Companion convergence
- [ ] **careIntelligence insight card:** adherence series × recipient_notes/mood — family-facing only, labeled correlation-not-causation; NEVER fed into doctor reports (cardinal rule). Doctor report gets raw adherence counts only, via existing review-before-send. **P2**
- [ ] **Companion Mode hook:** Betty-facing reminder tile reads same care_tasks tables; her tap = claimed, team still confirms watched meds. Long-term: voice_reminders converges onto care_tasks (freeze new voice_reminders features now, don't rebuild). **P3**
- [ ] **Open (Pete):** ~~free core vs add-on~~ SETTLED 7/22: free core for now; ~~grace default~~ SETTLED 7/22: 45 min; owner morning notification on missed?; lawyer-agenda candidate — structured adherence records vs medical-device claims (NOT added to agenda unless Pete says so). **P2**

## Care Events — Feature Track (July 22, 2026)

> **Source of truth:** `/mnt/Claude Working Folder/Care_Events_Plan_2026-07-22.md`
> **What it is:** Lightweight events layer for situational awareness (Sara books Betty's appointment → care team knows). NOT a calendar: no OAuth sync, no month-grid UI, no recurrence (recurring = Care Tasks). Events render inline in Next Up; family-only notices (day-before + same-day); one-tap export to the user's own Apple/Google calendar. Marquee: forward a clinic email to iPAi → event appears.
> **Settled 7/22:** no full calendar integration (Pete agreed); email-forward-to-iPAi is the priority ingestion path; events ≠ tasks (no escalation/missed).
> **Bones reused:** hasAccess, isFamilyNotifiable push filter (v1.99.2), guardedPoller, Next Up merge pattern, kindredBrain Haiku parsing, Resend (Inbound feature), MIGRATIONS_V2.

### Phase 1 — Capture + surface + export  ✅ SHIPPED — v1.100.0 pushed to staging + prod 7/22 (verified on staging: Next Up row, detail sheet, ics export, Haiku parse; 99 unit + 45 integration green). Includes true-instant timezone fix (zonedDateTimeToInstant) that also fixes Care Tasks due pushes firing 4h early on UTC servers.
- [x] **Schema (MIGRATIONS_V2):** `care_events` (title, category, starts_at/ends_at/all_day/tz, location, details /* PHI */, source manual|email|ics, source_meta provenance JSON, reminders_sent, is_active soft delete) + **seed.js demo-cleanup entry day one** (v1.99.1 lesson) + Barbara Lowe demo events. **P1**
- [x] **Routes `src/routes/careEvents.js`:** /upcoming (14d, Next Up merge), /recipient/:id, POST/PUT/DELETE (soft), POST /parse (one-field NL quick-add via kindredBrain Haiku → prefilled confirm card). **P1**
- [x] **Client:** `__careEvent` rows inline in Next Up chronological with sessions/tasks (no digging); detail sheet w/ edit/delete + "Add to my calendar" (`GET /:id/ics` signed URL + Google Calendar link). **P1**
- [x] **Poller (guardedPoller 108):** day-before ~5pm ET + same-day ~2h-before pushes, FAMILY-ONLY (isFamilyNotifiable), no escalation/missed; skip is_demo. **P1**
- [x] Tests: parse guardrails, ics gen, reminder windows, family-only push integration. **P1**

### Phase 2 — Forward an email to iPAi (marquee — Pete wants this now)
- [ ] **DNS:** Resend Inbound MX on **ipai.yourinplace.com subdomain — NEVER the apex** (would hijack peter@yourinplace.com). Catch-all routing by recipient address. **P1**
- [ ] **Addressing:** per-recipient slug (betty-x7f2@ipai.yourinplace.com); "Email it to iPAi" copy-address row on recipient profile — Sara saves it as a contact once. **P1**
- [ ] **Webhook `/api/webhooks/inbound-email`:** svix signature verify (raw-body exemption next to Stripe/Checkr in server.js), fetch body+attachments via Resend API, dedupe on Resend email id. **P1**
- [ ] **Sender auth:** From must match an active user with access to that recipient; otherwise drop silently (admin log, no bounce). **P1**
- [ ] **Parse ladder:** .ics attachment → node-ical deterministic; else Haiku extract from subject+body; no confident date → DON'T GUESS, reply w/ deep link to prefilled quick-add. **P1**
- [ ] **Close the loop:** event (source='email') + activity_feed + family push naming sender + iPAi confirmation reply to sender (what/when/where, edit deep link). Privacy: parsed fields + provenance only, raw body NOT persisted. **P1**
- [ ] **Acceptance (Sara trace):** Sara forwards real clinic confirmation → event in Next Up on Pete's phone + push → Sara gets iPAi reply → Pete's "Add to my calendar" lands it on his iPhone → day-before family-only reminder. **P1**

### Phase 3 — When pulled
- [ ] Team ICS subscribe feed (tokened read-only URL, revocable) — subscribe once in Apple/Google Calendar. **P2**
- [ ] "Who's taking Betty?" claim chip on transport-needing events (same interaction as task check-off sheet). **P2**
- [ ] iPAi context injection + doctor report "Upcoming appointments" (RAW FACTS ONLY — cardinal rule); Companion Mode today-tile reads same table. **P3**
- [ ] **NOT building:** Google/Apple OAuth calendar sync (either direction), in-app calendar UI, event recurrence, apex-domain inbound. **—**

## iPAi Kindred — Feature Track

> **Source of truth:** `/mnt/Claude Working Folder/VOICE_ASSISTANT_PROTOTYPE_ROADMAP.md`
> **Business model:** `/mnt/Claude Working Folder/VOICE_COMPANION_BUSINESS_MODEL.md`
> **Status:** v1.57.7 — **End-to-end working.** Renamed from "Voice Companion" to "Kindred" (v1.51.30, Mar 24). Talk to Pete → records → Claude thinks → responds in Pete's cloned voice. Sarah (reminders) + Brian (alerts) wired as pre-made voices to save clone costs. Reminder delivery poller fixed (v1.57.7 — uuid/text type mismatch). Kindred button broken on Android app (P2 bug — window.open fails in WebView). Awaiting Betty test.

### Phase 0 — Validation
- [x] **Pete records voice sample for ElevenLabs clone.** Done — 1.5 min recording, Instant Voice Clone. Voice ID: `c2liOZ7MsLVLDpKuwIY5`. Sounds good.
- [x] **End-to-end pipeline working (v1.51.22, Mar 23).** Press "Talk to Pete" → Web Speech API transcribes → POST /chat → Claude Haiku (companion brain) → ElevenLabs TTS (Pete's voice) → audio playback. Four bugs fixed to get here: (1) CSRF 403 — verifyCsrf used req.path which strips /api prefix at mount point, switched to req.originalUrl; (2) chatResult.response undefined — handleCompanionMessage returns {text} not {response}; (3) voice_preferences table missing — initializeTables had all CREATEs in one try/catch, split to per-table; (4) loadCareContext queried nonexistent "visits"/"caregivers" tables, fixed to care_sessions/caregiver_profiles.
- [ ] **Play test voice for Betty and observe reaction.** Go/no-go gate. If Betty's face lights up → proceed. If confused → adjust.

### Phase 1 — Built (v1.51.22)
- [x] **Backend: All 6 tables** — voice_profiles, voice_routing, voice_preferences, companion_messages, voice_reminders, voice_escalations. Auto-created individually on module load (each with own try/catch).
- [x] **Backend: ElevenLabs TTS** — `src/utils/voiceService.js` (generateSpeech, streamSpeech, listVoices, getVoice, getUsage)
- [x] **Backend: Kindred brain** — `src/utils/kindredBrain.js` (identity framework, care context, distress detection, voice adaptation)
- [x] **Backend: STT** — Web Speech API (browser-native, free). ElevenLabs Scribe available as upgrade path.
- [x] **Backend: 12 REST endpoints** — `src/routes/kindred.js` (chat, reminders, profiles, admin) — route: `/api/kindred/`
- [x] **Frontend: Kindred PWA** — `kindred/index.html`, push-to-talk, auth-gated — route: `/kindred`
- [x] **Auth: companion_access flag** — per-user toggle in admin panel (column: "Kindred"), JWT + companion_access required
- [x] **Nav: Kindred launch button** — in sidebar + bottom nav for family users with access
- [x] **Frontend: Kindred admin pop-out on My Loved One page** — conversations, voice settings, usage tabs. Opens from CareProfile.js.
- [x] **Phase 0 fallback: No voice_profiles row needed** — defaults to Pete's ElevenLabs voice ID when no profile configured.
- [x] **Default voice speed: 0.85** — slowed from 1.0 for elder care clarity. Pete confirmed "a little fast" at 1.0.

### Phase 1.5 — Kindred Tone & Personality (v1.51.29, Mar 23–24)
- [x] **Warmer, slower conversational tone.** System prompt rewritten for warmth, patience, gentle pacing. Uses "Mom" not "Betty." Breath pauses ("...") injected between sentences. *(v1.51.26)*
- [x] **Dementia-aware communication patterns.** Prompt includes: never correct memory, never quiz, validate feelings, short 1-2 sentence responses, simple yes/no questions, redirect from distress, always reassuring. *(v1.51.26)*
- [x] **Voice speed tuning.** Dropped from 1.0 → 0.85 → 0.75. Breath pauses added via `"... "` post-processing before TTS. *(v1.51.28)*
- [x] **Response length control.** max_tokens reduced to 150. Prompt engineered for 1-2 sentence replies. *(v1.51.26)*
- [x] **Product rename: "Companion" → "Kindred."** All routes, files, UI labels, PWA directory renamed. DB column `companion_access` kept as-is. *(v1.51.30)*
- [x] **Voice routing: Sarah + Brian as pre-made defaults.** Sarah (EXAVITQu4vr4xnSDxMaL) for reminders/medication, Brian (nPczCjzI2devNBz1zQrb) for alerts/check-ins. Pete's clone reserved for conversations only. Auto-seeded on startup. *(v1.51.30)*

### Phase 2 — Remaining
- [ ] **Consent flow: Voice cloning consent + Digital Voice Directive** — recording consent, posthumous use clause (default opt-out), designated decision-maker
- [ ] **Reminders: Pull from InPlace appointments** — If no manual reminders set, show upcoming care sessions from InPlace calendar. Kindred should read these to Betty.
- [x] **"My Loved One" → Reminders tab** — ✅ Done v1.51.42 — Full Reminders tab added to Kindred admin panel in CareProfile.js. Add/list/delete reminders with recurrence, day picker, labels. Backend CRUD endpoints + delivery poller.
- [ ] **Chat History: Repurpose for iPAi conversations** — Betty has no account, so no traditional chat history. Options: (a) hide from Betty's view, (b) show Kindred conversation history so family can review what Betty talked about, (c) let Betty chat with iPAi via text too.
- [x] **Recipient name: Dynamic from care_recipients table** — ✅ Done v1.51.48 — loadCareContext query now includes called_by, all hardcoded "Betty" references replaced with dynamic recipient name.
- [ ] **Voice routing admin UI** — Let Pete assign voices to message types from the Kindred admin panel (currently auto-defaults to Sarah/Brian).
- [x] **"called_by" configurability** — ✅ Done v1.51.48 — DB migration adds called_by column, PUT endpoint updated, editable field in CareProfile voice-settings tab with Save button.

### Key Design Decisions (settled, documented in roadmap)
- **Kindred identity:** NOT Pete. Speaks in Pete's voice but has its own role ("from Pete"). Never says "I love you, Mom" — says "Pete loves you, Mom." See Identity Framework in roadmap.
- **Pronoun rules:** Third-person for care messages ("Pete wanted me to remind you"), own identity for companionship ("How's your day, Mom? Pete was asking about you"). Never first-person as Pete.
- **Real person deference:** Kindred goes quiet before real calls, asks about them after, actively encourages real contact, never competes with real Pete.
- **Voice routing cost strategy:** Pete's clone ($$$) for conversations only. Pre-made voices (free tier / much cheaper) for reminders, alerts, check-ins. Sarah = warm female (reminders), Brian = calm male (alerts).
- **Death framework:** Digital Voice Directive in consent flow. Default opt-out (voice stops). Opt-in requires directive + decision-maker + payer. Never-Dark Guarantee (no payment-failure cutoffs).
- **Competitive positioning:** Moat is being un-catchable, not un-copyable. Consent-as-product, compounding care context, first-mover category ownership.
- **Architecture:** Separate PWA now, shared Railway backend, merge later. Frontend is throwaway, backend is permanent.
- **Cost:** ~$10-14/user/month optimized. $19.99/mo flat rate. ElevenLabs OEM agreement needed for production.

### Pete's Action Items — Kindred
- [x] **Record voice sample** — done, voice_id: c2liOZ7MsLVLDpKuwIY5
- [x] **Test clone output** — sounds good
- [x] **Add ELEVENLABS_API_KEY to Railway env vars** — done (working as of v1.51.22)
- [x] **First live test (Mar 23)** — end-to-end working. Pete confirmed voice sounds "pretty good, if I'm being honest. A little fast." Speed reduced to 0.85.
- [ ] **Play for Betty** — validation gate
- [ ] **Contact ElevenLabs re: OEM agreement** (when ready for paying customers)

## Dev Best Practices

> Patterns and conventions learned the hard way. Claude should follow these when building new features.

- **Admin task tiles for setup instructions.** When Claude needs Pete to do something manually (external setup, API config, DNS changes, etc.), don't just put it in TASKS.md — also add a dismissible tile to the Dashboard gated behind `user?.is_admin || user?.isAdmin`. The tile should have step-by-step instructions and a ✕ button that calls `dismissTile('tile-id', 'v1')`. This makes setup tasks impossible to miss. See the email domain verification tile (v1.39.20) as the reference pattern. The tile uses the existing `dismissedTiles` + `localStorage` system — no backend needed.
- **Non-blocking side effects.** When a primary action triggers a secondary action (e.g., attestation → send outreach email), wrap the secondary in try/catch and let the user proceed even if it fails. Show an appropriate toast message. Never block a completed wizard step because a side-effect failed.
- **Wizard state persistence.** Wizard progress is stored in `sessionStorage('inplace_wizard')`. When restoring, only `wizardStep` and `savedRecipientId` are persisted — formData is NOT. Always re-fetch from the API when resuming a wizard. See the `useEffect` in CareRecipients.js that fetches `/api/care-recipients/:id` on resume.
- **Guided discovery tiles.** For post-wizard or post-setup actions the user should explore, use the 2×2 grid pattern from the Dashboard "Get Started" section (v1.39.19). Each tile tracks clicks via `localStorage('inplace_discovered')` and disappears once clicked. Include a "Dismiss all" option.
- **Version bumping.** Every push must bump version in three files: `index.html` (3 occurrences), `sw.js` (3 occurrences), `server.js` (1 occurrence). Use the format `1.X.Y`. This ensures cache-busting on Railway auto-deploy.
- **Always tell Pete the version number when pushing.** After every `git push`, state the new version number and commit hash so Pete knows exactly what's deploying.
- **Timezone anchoring rule (critical — Mar 19).** All session timing — push notifications, check-in/check-out gates, session duration, pay calculations, dashboard displays — must be computed in the **care recipient's timezone** (stored as `timezone` on `care_recipients`, default `'America/New_York'`). Never use the viewing user's device timezone or `new Date()` on the client for session timing logic. The caregiver's phone clock can be wrong, and family members may be in a different timezone than the care location. Server-side: store all timestamps in UTC, convert to care recipient's timezone for business logic. Client-side: receive the care recipient's timezone with session data, use it for all display and gate calculations. Device timezone is only used for showing "your local time" as a convenience label alongside the canonical care-location time.
- **Pay calculation is server-side only.** Session pay is computed from server-recorded UTC check-in and check-out timestamps, converted to the care recipient's timezone, rounded to 15-minute blocks. The client never computes billable time — it only displays what the server returns.


## Pete's Action Items (External Setup)

> Things only Pete can do — account signups, API keys, config. These unblock dev tasks above. Check them off as you go.

- [x] **Checkr: Get API key from Faraz.** ✅ Done — Checkr API key obtained and added to Railway env vars. Checkr-Hosted (invitation) flow enabled and working in staging sandbox. Partner Certification compliance achieved (v1.50.32).
- [ ] **Stripe: Decide background check price.** What should caregivers be charged for the background check? Checkr's basic check runs ~$25–$35. Do you want to pass cost through at-cost, mark up, or subsidize? Claude needs this number to build the payment step.
- [ ] **Plausible Analytics: Sign up at plausible.io.** Add `yourinplace.com` as a site. The script tag is already in index.html — just needs the account created.
- [ ] **Google OAuth: Set up in Google Cloud Console.** Create OAuth 2.0 credentials (it's free). Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to Railway. This enables "Sign in with Google" (backend already built).
- [ ] **Google Maps API key (optional, later).** When you want better residential geocoding than Nominatim/OpenStreetMap, get a Google Maps API key. Swap is a one-function change in `src/utils/geocode.js`.

### Business Insurance & Compliance

- [ ] **Hired & Non-Owned Auto (HNOA) policy.** Get an HNOA endorsement on your commercial general liability (CGL) policy. This covers InPlace when a 1099 caregiver causes an accident while driving for business (transporting a care recipient, driving to/from visits). It's your backstop when the caregiver's personal auto insurance is insufficient or denies the claim. Shop through a commercial insurance broker — expect $500–$2,000/yr depending on caregiver count and state.
- [ ] **General Liability (CGL) insurance.** If you don't already have a Commercial General Liability policy, get one. This is the base policy that HNOA attaches to. Covers bodily injury, property damage, and personal injury claims related to InPlace's operations. Standard for any care coordination platform.
- [ ] **Professional Liability / E&O insurance.** Errors & Omissions coverage for claims that InPlace's platform or matching algorithm caused harm — e.g., a family alleges negligent caregiver vetting, or a caregiver claims the platform misrepresented job terms. Important for a platform connecting vulnerable populations with care providers.
- [ ] **Cyber Liability / Data Breach insurance.** Covers costs from a data breach — notification to affected users, credit monitoring, legal defense, regulatory fines. InPlace stores PII (names, addresses, SSN last 4, driver's license numbers) and PHI-adjacent data (care notes, health tags). Required by many state breach notification laws. Look for a policy that covers both first-party (your costs) and third-party (lawsuits/fines).
- [ ] **Workers' Comp exemption documentation.** Since caregivers are 1099 independent contractors (not W-2 employees), you likely don't need workers' comp — but document this clearly. Some states require proof of IC status or a WC waiver. Keep the IC classification airtight (caregivers set own schedule, rates, clients) to avoid misclassification claims.
- [ ] **MVR check integration with Checkr.** When Checkr is set up, confirm the background check package includes a Motor Vehicle Record (MVR) check. The onboarding disclosure (v1.39.63) now tells caregivers an MVR check will be conducted. Make sure the Checkr package actually includes it — their "Basic+" or "Standard" packages typically do.
- [ ] **Caregiver auto insurance verification process.** Decide how to verify caregivers carry the required business use endorsement on their personal auto policy. Options: (a) require proof of insurance upload during onboarding (add a document upload step), (b) self-attestation checkbox (already added in v1.39.63) with spot-check audits, or (c) use a third-party insurance verification service. Option (a) is strongest but adds friction.
- [ ] **PCI DSS SAQ-A self-assessment.** Since InPlace uses Stripe for all payment processing and never sees, stores, or transmits card numbers, we qualify for SAQ-A (the lightest PCI compliance level). Complete the SAQ-A questionnaire to formally document this. Keep the completed SAQ-A on file. If we ever add server-side payment handling, reassess PCI scope immediately.
- [ ] **Confirm Stripe Elements or Stripe Checkout integration.** Verify that all payment flows use Stripe Elements (embedded card input components) or Stripe Checkout (hosted payment page) — both use client-side tokenization so card data never touches InPlace servers. This is what keeps us in SAQ-A scope. Audit the codebase to ensure no raw card numbers are ever logged, stored in the database, or passed through our API. Document which Stripe integration method is used and where in the code.

### Security Monitoring & Breach Detection

- [ ] **Audit logging for sensitive data access.** Build middleware that logs every access to sensitive endpoints (admin user lookups, SSN/DL fields, care notes, caregiver profile data) to an `audit_log` table. Record: user ID, endpoint, IP address, timestamp, and whether the request succeeded. This is the foundation of breach detection — you can't detect what you don't log.
- [ ] **Admin login & access alerts.** Set up email notifications when an admin account logs in from a new IP or device. Admin accounts have access to all user data, so these are the highest-value targets. Could be a simple check against a `known_admin_ips` list in the admin settings.
- [ ] **Abnormal data access detection.** Add a scheduled check (daily) that flags unusual patterns: bulk data exports (e.g., someone hitting GET /api/admin/users repeatedly), failed login spikes (brute force attempts), or API calls at unusual hours. Can start simple — a daily summary email to you of access counts by endpoint.
- [ ] **Railway environment security audit.** Review who has access to the Railway project and Postgres connection string. Rotate the database password if it's been shared or hasn't changed since initial setup. Enable Railway's audit log if available on your plan. Check that no env vars are exposed in client-side code.
- [ ] **Vendor breach notification contacts.** Verify your contact email is current and monitored on all third-party services that hold InPlace data: Railway (hosting + DB), Stripe (payment + SSN), Checkr (background checks + PII), Resend (email addresses), and your domain registrar. These vendors are required to notify you of breaches, but only if they can reach you.
- [ ] **Incident response plan (simple version).** Write a one-page plan: (1) who to contact first (you + any co-founders), (2) how to lock down the system (Railway dashboard → disable deploys, rotate DB password), (3) how to assess what was accessed (audit logs), (4) when and how to notify affected users (state breach notification laws — Virginia requires notification "without unreasonable delay"), (5) who to call for legal/insurance (your cyber liability carrier). Keep it in a Google Doc you can access even if InPlace is down.
- [ ] **Database encryption review.** Confirm Railway's managed PostgreSQL encrypts data at rest (it does by default on most plans). Consider application-level encryption for the most sensitive fields (SSN last 4, DL numbers) — this means even if someone gets a database dump, those fields are encrypted with a key stored separately from the database.


## App Store Release — iOS & Android

> **Architecture: one codebase, three distribution channels.** The React web app stays the single source of truth. Capacitor wraps it into native iOS and Android shells (WebView + native API bridges). The PWA continues working independently at yourinplace.com. When you change a React component, all three platforms get it. Native-only code is limited to thin bridge layers for push, deep links, biometrics, and token storage.
>
> **Do not build anything that breaks the PWA.** Every feature must work on web first. Native enhancements are additive — detect the platform and upgrade the experience when running inside Capacitor.

### Phase 1 — Foundation  ✅ COMPLETE (status corrected 7/30 — every item below was already done; this section had gone stale and still listed them as TODO)

- [x] **Capacitor project setup.** Done — iOS + Android scaffolded, TestFlight Build 6 live (Google sign-in verified), Android internal testing live (versionCode 17). ⚠️ NOTE: `capacitor.config.ts` currently sets `server.url = https://yourinplace.com`, i.e. it loads the app REMOTELY rather than from bundled assets. That is the one outstanding piece — see "Bundled-asset migration" below.
- [x] **Native push notifications.** Done — iOS uses **direct APNs**, NOT Firebase (the app registers raw APNs tokens, which FCM rejects). Key "InPlace Push" F3WH2QV9XY, verified 5/5 on prod 7/13. Android would use FCM (unconfigured). Web Push remains the browser fallback.
- [x] **Deep links / Universal Links.** Done and VERIFIED LIVE on prod 7/30: `/.well-known/apple-app-site-association` → 200 `application/json`, `/.well-known/assetlinks.json` → 200 `application/json`.
- [x] **Account deletion endpoint.** Done — `DELETE /api/auth/me` anonymises PII and deactivates, retaining messages/sessions/payments/activity for legal audit, and it IS surfaced in the UI (`DeleteAccountSection` in MyAccount). This is a hard Apple rejection if missing, so worth knowing it's covered.
- [x] **Privacy policy & Terms of Service pages.** ✅ Fixed v1.105.4 — `/terms`, `/privacy`, `/caregiver-agreement`, `/client-services` and a `/legal` index now render the **lawyer-reviewed 2026-07-07 documents** straight from `legal_documents` (`src/routes/publicLegal.js`), publicly, no login. **Previously `/privacy` served a static page last updated April 2 2026 that described the Kindred voice companion — killed in the July 7 review — named ElevenLabs, and omitted almost every processor; that stale page was the URL registered with Google Play. And `/terms` returned HTTP 200 while serving the SPA shell, so a reviewer pasting it saw the app, not the terms.**
- [ ] **Token-based auth for native.** NOT done, and it is part of the bundled-asset migration rather than a standalone task — httpOnly cookies are unreliable in a WebView once the origin is no longer yourinplace.com. `apiFetch()` is the single place this changes. CSRF needs rethinking for native since it is cookie-dependent. **P1 for launch.**

### Phase 1b — Bundled-asset migration (THE remaining engineering project)

- [ ] **Load the app from bundled assets instead of `server.url`.** Comment out `server.url` in `capacitor.config.ts` so the WebView serves local files. **NOT a submission gate** (corrected Aug 4 — this file contained both this claim and its own 7/30 re-audit saying the opposite, and they cannot both be true). 4.2 is satisfied by direct-APNs push, universal links, passkeys and camera; 2.5.2 targets downloading executable code, not loading a remote URL. Worth doing for offline behaviour and launch performance — but it must not block submission. TestFlight review is much lighter than full App Store review, so Build 6 passing TestFlight is NOT evidence this will pass submission. **Three coupled changes:**
  - **`API_BASE`** — the client must call `https://yourinplace.com/api/...` absolutely instead of same-origin relative paths.
  - **Bearer auth** — WebView origin becomes `capacitor://localhost`, so cookies stop being sent. Store the JWT in Capacitor Preferences/SecureStorage and send `Authorization: Bearer`. Change `apiFetch()` only. Rethink CSRF (the double-submit cookie pattern doesn't survive this).
  - **CORS** — 🚨 every API call becomes CROSS-ORIGIN. Add `capacitor://localhost` (+ the Android equivalent) to `allowedOrigins` in `src/utils/env.js`. **Do NOT add a bare `http://localhost`** — with `credentials: true` that would let anything running on a user's machine make authenticated requests to prod. A test in `tests/env.test.js` asserts it never appears. See the v1.105.3 entry under Recently Completed.
- [ ] **Re-verify after migrating:** push notification registration, Google/Apple sign-in redirects (custom scheme), deep links, passkeys (WebAuthn origin changes — RP_ID/ORIGIN come from `APP_URL`, and Android already has `apk-key-hash` origins registered in `passkeys.js`), and photo upload.

### Phase 2 — Native Experience Polish

- [ ] **Biometric auth (Face ID / fingerprint).** Use Capacitor BiometricAuth plugin to offer biometric unlock on app open. Store the refresh token in secure native storage, gate access behind biometric check. This replaces the sessionStorage pattern for native — biometric replaces the "require login on new session" behavior.
- [ ] **Status bar & safe area handling.** iOS notch, Dynamic Island, Android status bar — the web app needs CSS adjustments for `env(safe-area-inset-top)` etc. Add `viewport-fit=cover` to the meta tag and test on notched devices. The splash page hero and bottom nav bar are the most likely to need tweaks.
- [ ] **App icon & splash screen.** Design app icon (1024x1024 master), generate all required sizes for both platforms. Capacitor Splash Screen plugin for native launch screen. Use the existing InPlace green/logo.
- [ ] **Camera & photo library access.** Current photo upload uses `<input type="file">`. Upgrade to Capacitor Camera plugin for native — gives direct camera access, photo library picker, and built-in crop/resize. This addresses the "photo upload crop + auto-resize" bug in the backlog.
- [ ] **Offline support / graceful degradation.** The service worker handles caching for PWA, but Capacitor apps should handle airplane mode gracefully. Queue failed API calls and retry on reconnect. Show clear "offline" indicators. Messages could queue locally and send when back online.

### Minors on care teams — Pete's intent, scoped 2026-07-30 (NOT built)

Pete wants family minors on care teams: a grandchild or his own 14-year-old logging notes, and
eventually **being paid**. Two cases that look alike and are not.

- [x] **P1 — AGE GATE SHIPPED (v1.105.8). Minimum 13, enforced server-side on every signup door.**
  - `src/utils/age.js` — calendar arithmetic on Y/M/D integers, **not** millisecond subtraction: ms-based age is wrong across leap years, and `new Date("2013-07-30")` parses as UTC midnight, which is the previous day in US timezones. Non-existent dates (`2025-02-30`) are rejected rather than silently rolled forward by `Date`. 20 unit tests including the day-before/day-of birthday boundary and a Feb-29 birthday turning 13 on Mar 1.
  - **Three doors, all gated and pinned by tests:** `/api/auth/register`, OAuth `complete-signup`, and the caregiver wizard.
  - **⚠️ NEAR-MISS WORTH REMEMBERING:** `CaregiverOnboarding` collects a date of birth only at the **Checkr step (4)**, which runs **after** account creation at step 1 — so gating `/api/auth/register` without touching it would have **blocked caregiver signup outright**, the same barrier-to-entry class as the v1.105.0 bug that stopped Julia. Fixed by adding the field to step 1 under the **same form key**, so the Checkr step now arrives pre-filled instead of asking twice.
  - Migration `012_users_date_of_birth`, **nullable on purpose** — existing accounts predate this and are not locked out.
  - The under-13 message **points somewhere** rather than just refusing: a parent or guardian can record a younger family member as a **named non-user helper** (Care Tasks) with no account at all.
  - **Staging-verified live:** no DOB → 400, under-13 → 400 with the helpful message, **exactly 13 → 201**, garbage → 400, future date → 400.
  - Apple's updated rating system explicitly supports **setting a higher minimum age to match your app's own** — so declaring **13+** is now a true statement, not an aspiration.

- [ ] **P2 — Case A: minor logs notes, UNPAID.** The cheap path already exists and needs no account
  at all: Care Tasks supports a **named non-user helper** (`care_task_helpers`) recorded as having
  done something. A 13+ care-team member account is the heavier version. Lawyer questions logged.
- [ ] **P3 — Case B: minor is PAID. Do not build until the lawyer clears it.** **The payment
  plumbing is not the blocker** — Stripe permits an account from **age 13** and requires an adult
  **Representative** (parent or legal guardian) on the account for anyone under 18, so Pete could be
  Representative on his own child's account. The blockers are everywhere else: **child labor law**
  (FLSA/Virginia limits on 14–15-year-olds — permitted occupations, hours, not during school hours),
  **capacity to contract** (a minor cannot be meaningfully bound by the Caregiver Agreement),
  **Checkr will not check a minor** and a minor cannot give FCRA consent, **liability insurance**
  (not in place yet, and will very likely exclude minors), **worker classification** (1099 to a minor
  in an employee-presumption state), and underneath all of it **a minor with unsupervised access to a
  vulnerable adult** — which may be lawful and still not defensible. All on the 7/31 agenda.
- [ ] **P3 — under-13 is a hard no as designed.** Stripe will not open an account below 13, so a
  younger grandchild cannot be paid at all; and permitting under-13 accounts would pull COPPA
  verifiable-parental-consent obligations onto a product holding health data. Use the named-helper
  route for younger children.

### ⚠️ AI GUIDANCE RULE (Pete, 2026-07-30) — applies to every AI-generated care output

> **The app must NEVER generate medical or treatment information without the user explicitly
> acknowledging that this is not medical care, and that it can only reflect information provided
> to it. Any health or routine guidance follows the same principles.**
>
> Stated while answering Apple's age-rating question. Pete's reason: **Claude can hallucinate, and
> that risk is being actively managed rather than assumed away.** In a product holding a dementia
> patient's medications and adherence history, a fabricated line is not cosmetic.
>
> **This is BROADER than the existing iPAi cardinal rule.** That one covers AI artifacts *leaving
> the platform* (human review + explicit sender responsibility). This covers **anything generated at
> all** — chat answers, insight cards, care suggestions, routine guidance, summaries. Both things
> must be present **at the point of generation**, not buried in the policy: (a) this is not medical
> care, (b) it reflects only what you gave it.
>
> **This also underwrites a store answer.** The age-rating questionnaire was answered
> **Medical or Treatment Information = Infrequent** on the basis that InPlace *records and displays*
> rather than *advises*. That answer is only defensible while this rule holds — if the app starts
> generating unacknowledged medical guidance, the honest answer becomes **Frequent**, which triggers
> the **Regulated Medical Device declaration**.

- [ ] **P1 — audit every AI generation surface against the rule above.** Confirm each carries the
  not-medical-care acknowledgment AND the reflects-only-what-you-provided constraint, in the prompt
  *and* visibly to the user: `src/utils/ipaiChat.js`, `src/utils/careIntelligence.js`,
  `public/js/components/IPAiInsightsCard.js`, and the doctor-report path (which already has the
  acknowledged-send flow — use it as the reference implementation). Report which surfaces are
  already compliant and which need copy or prompt changes.
- [ ] **P2 — hallucination mitigations:** Pete noted this is being addressed. Capture what's in place
  (grounding in raw records only, no external medical knowledge, refusal behaviour) so the answer to
  "how do you prevent fabrication" is written down before a reviewer, a lawyer, or a family asks.

### Store rules audit — re-checked against the LIVE guidelines 2026-07-30

> Previous entries in this section were written against 2025-era rules. Everything below was
> checked against Apple's and Google's current published requirements on 7/30/2026, and against
> this repo. Sources are in `Store_Review_Plan_2026-07-30.md`.

**Platform deadlines — where we actually stand**

| Requirement | Deadline | Status |
|---|---|---|
| Google Play target API 36 (Android 16) | **Aug 31, 2026** (extension to Nov 1 available) | ✅ **MET** — `android/variables.gradle` already has `targetSdkVersion = 36`, `compileSdkVersion = 36` |
| Apple: build with **Xcode 26 / iOS 26 SDK** | **In force since Apr 28, 2026** | ⚠️ **LIKELY met — CONFIRM.** `project.pbxproj` has `LastUpgradeCheck = 2640` (Xcode 26.4), so the project has been opened in Xcode 26. Needs Pete to confirm the Xcode version that will produce the upload build. |
| Apple: respond to **updated age-rating questions** | **Jan 31, 2026 — PASSED** | ❌ **UNVERIFIED, possibly blocking.** Apple's wording: developers must respond "to avoid submission interruptions." Pete's hands, App Store Connect. |
| Play: **Health apps declaration** | Aug 31, 2024 — long passed | ❌ **NEEDS UPDATING.** Mandatory for *every* app including closed-testing tracks, so one probably exists — but **Care Tasks (v1.99, July) added medication scheduling/reminders/adherence, which triggers Play's "Medication and Treatment Management" category.** The declaration must be re-answered. |
| iOS deployment target | n/a | ✅ `IPHONEOS_DEPLOYMENT_TARGET = 15.0` — that's the minimum OS supported, unrelated to the SDK mandate. No action. |
| Capacitor version | n/a | ✅ 8.3.0, current generation. |

**New gaps found in this audit**

- [x] **P1 — `PrivacyInfo.xcprivacy` is missing at the app level.** Required-reason API declarations have been mandatory since May 1 2024, and a missing manifest is what produces the **ITMS-91053 "Missing API declaration"** email after upload. `@capacitor/ios` ships two manifests (`Capacitor/` and `CapacitorCordova/`) but **both declare empty arrays** — they cover nothing. The app has no manifest of its own and `PrivacyInfo` appears **zero** times in `project.pbxproj`. Add an app-level manifest declaring `NSPrivacyAccessedAPITypes` (UserDefaults is the usual one for this stack) plus `NSPrivacyCollectedDataTypes`, and add it to the App target's Copy Bundle Resources. Cheap to add, annoying to discover after an upload. ✅ **Closed Aug 4 2026 in the code+task review — verified against the code, not assumed.** **Listed as a store blocker and it is not one.** `ios/App/App/PrivacyInfo.xcprivacy` exists and `PrivacyInfo` appears 4× in `project.pbxproj` — the ticket asserted zero. Shipped v1.105.11 (`d33c18a`) with a CI gate.
- [x] **P2 — EU trader status (DSA): N/A. US-ONLY release decided 7/30.** Set territory to United States only in App Store Connect and Play Console at submission, and the DSA trader-verification requirement never applies. Revisit only if international distribution is ever wanted.
- [ ] **P2 — verify the D-U-N-S business-name problem is resolved.** An older handoff recorded D-U-N-S 106784345 as having the wrong business name and blocking Google Play. Apple enrolment has since completed, which suggests it was fixed, but confirm in Play Console before relying on it.

**Rules re-confirmed in our favour — do not spend engineering time here**

- **Payments are correct as built.** Guideline **3.1.3(e)** is not merely permissive, it is *mandatory*: "If your app enables people to purchase physical goods or services that will be consumed outside of the app, you **must use purchase methods other than in-app purchase**." Care visits are real-world services, so Stripe is the required approach, not a tolerated one. Say so plainly in the reviewer notes; misreading this is a common reviewer error, not a defect in the app.
- **4.8 Login Services** requires an alternative that "allows users to keep their email address private." That is exactly the Hide My Email path, and it is exactly what v1.105.5 fixed — this would have been a rejection.
- **5.1.1(v)** requires in-app account deletion where accounts can be created. Present, with UI.
- **⚠️ CORRECTION to an earlier note in this file:** the bundled-asset migration was described as "probably required for approval" under 4.2 / 2.5.2. **That was overstated.** 4.2 asks for "features, content, and UI that elevate it beyond a repackaged website" — and this app already has direct-APNs push, universal links, passkeys/biometrics and camera integration, which is precisely what distinguishes it from a web wrapper. 2.5.2 targets downloading and executing code, which is not what loading a remote URL means here. The migration is still worth doing (offline behaviour, launch performance, and better optics for a reviewer who pokes at it) but it is **not** the gate it was made out to be, and it should not block submission.

### Phase 3 — Store Submission

- [x] **Apple Developer Program enrollment.** Done — Cedar Rock Holdings LLC, Team 7964RAMZJL, ASC app ID 6761841087, bundle com.yourinplace.app.
- [x] **Google Play Developer account.** Done — Cedar Rock Holdings org, internal testing track live (versionCode 17).
- [ ] **App Store screenshots & metadata.** Both stores need: app name, subtitle, description, keywords, screenshots (multiple device sizes), category selection. Category: **Lifestyle — decided, not open** (not Health & Fitness: that invites a heavier review posture than a first submission needs). Still to be SET in App Store Connect. Age rating questionnaire (both stores).
- [ ] **TestFlight / internal testing track.** Before public release, deploy to TestFlight (iOS) and Google Play internal testing track. Get Debbie, Cathyrine, and a few caregivers testing the native builds. Iterate on any WebView-specific bugs.
- [ ] **App review preparation.** Apple review is strict — have a demo account ready (they need to test without creating a real account). Document any features that require specific setup (location, push permissions). Prepare responses for common rejection reasons: login requirement justification, data collection justification, in-app purchase policy compliance.
- [ ] **Version management.** Native apps have their own version numbering (CFBundleShortVersionString for iOS, versionCode/versionName for Android) separate from the web APP_VERSION. Add a `native-version` field to capacitor.config.ts. Web deploys are instant; native updates require store review (2-7 days for Apple, hours-to-days for Google).

### Pete's Action Items — App Store

- [x] **Apple Developer Program** — Enrolled. (D-U-N-S 106784345.)
- [ ] **Google Play Console** — Register at play.google.com/console ($25 one-time).
- [x] **Privacy policy page** — Live at https://yourinplace.com/privacy (v1.105.4), rendering the lawyer-reviewed 2026-07-07 policy. ⚠️ ONE GAP FOR THE LAWYER: that policy predates **Cloudflare R2** going live on 7/11, so it does not name R2 as a storage processor — and R2 is where ID photos and selfies are stored. It DOES already disclose Stripe, Checkr, Resend, Twilio, Sentry, Firebase, Anthropic, Google, Apple and Railway. On the 7/31 agenda.
- [ ] **App Store screenshots** — Need iPhone 6.7" (Pro Max), 6.1" (Pro), and iPad if supporting tablet. Google needs phone screenshots. Can use simulator captures or a tool like Fastlane snapshot.

### Dev Guidelines — What Not to Do

- **Don't add any web feature that requires native-only APIs.** Everything must work in a browser first. Native is an enhancement layer.
- **Don't hardcode cookie-based auth assumptions in new code.** Use `apiFetch()` for everything — when we add token-based auth for native, that's the only function that changes.
- **Don't use `localStorage` for auth tokens.** It's insecure (XSS-accessible). Current httpOnly cookie approach is correct for web. Native will use secure native storage.
- **Don't build separate UI for native.** One React codebase. Platform-specific behavior lives in utility functions that check `Capacitor.isNativePlatform()`.
- **Don't skip the PWA.** The web version is your fallback, your demo environment, and how users discover you before installing. Keep it working perfectly.


## Production Path — Beta on Phone

> These are the infrastructure changes needed before real users (even family/friends) can use the app. Order roughly reflects dependencies. See ROADMAP.md for the full picture.

- [x] **PostgreSQL migration:** ✅ Done (v0.5.0).
- [x] **Wire registration to API:** ✅ Done (v0.5.1).
- [x] **Password reset flow:** ✅ Done (v0.5.1).
- [x] **Mobile-responsive UI:** ✅ Done (v0.5.2).
- [x] **Input validation & rate limiting:** ✅ Done (v0.6.1).
- [x] **Email verification:** ✅ Done (v0.6.2).
- [x] **Tests:** ✅ Done (v0.6.2, expanded v0.7.0). 53 tests across 4 suites.
- [x] **Auth Foundation (v1.0.0):** ✅ Done. Google OAuth backend, TOTP 2FA, trusted devices, demo mode isolation, enhanced MyAccount.
- [x] **Care Teams (v1.0.0):** ✅ Done. Care team CRUD, email invites, auto-creation, onboarding checklist, dashboard rework.
- [ ] **Stripe Connect integration:** Wire payments table to Stripe Connect for marketplace payouts.
- [x] **Geocoding & distance:** ✅ Done (v1.2.0). Nominatim geocoding + Haversine radius search. Swap to Google Maps = one function change.
- [ ] **Build step for frontend:** Move to Vite when component count demands it. Not urgent yet.

---

## Scaling & Infrastructure Roadmap

> Current setup (April 2026): Single Node.js process on Railway (1 replica), PostgreSQL with default 10-connection pool, Socket.IO for real-time. 5–6 background pollers on setInterval. Comfortable for ~100–200 concurrent users.

### Tier 1 — First Growing Pains (50–200 active users)
- [ ] **Bump PG pool size:** Increase from default 10 to 25–50. Pollers eat pool slots; more users means more contention.
- [ ] **Add connection timeout/retry:** Pool exhaustion currently fails silently. Add `connectionTimeoutMillis` and proper error handling.
- [ ] **Move pollers to a separate worker:** The 5–6 `setInterval` pollers (accountability, no-shows, payment auth, Kindred reminders) compete with user requests for DB connections. Split into a dedicated Railway service or use a proper job queue (e.g., BullMQ + Redis).
- [ ] **Add request-level caching:** Dashboard queries are heavy (8+ JOINs). Add short-lived in-memory cache (e.g., node-cache) for repeated dashboard loads by the same user within 30s.

### Tier 2 — Real Traction (200–1,000 active users)
- [ ] **Horizontal scaling:** Add Railway replicas (2–3 instances). Requires sticky sessions or moving Socket.IO to Redis adapter so WebSocket connections work across instances.
- [ ] **Redis for sessions + caching:** Replace in-memory session state and Socket.IO rooms with Redis. Enables multi-instance without losing state.
- [ ] **Database read replica:** Offload read-heavy queries (dashboard, Find Work, calendar) to a PG read replica. Write queries stay on primary.
- [ ] **CDN for static assets:** Move `/js-compiled/bundle.js`, CSS, and images behind a CDN (Cloudflare, Railway's built-in, or S3+CloudFront). Reduces server load and improves load times.
- [ ] **Rate limiting per-user:** Add API rate limiting (express-rate-limit + Redis store) to prevent runaway clients or abuse.

### Tier 3 — Scale (1,000+ active users)
- [ ] **Job queue (BullMQ/Redis):** Replace all setInterval pollers with a proper job queue. Supports retries, backoff, dead-letter queues, and monitoring.
- [ ] **Database connection pooling (PgBouncer):** External connection pooler between app instances and PostgreSQL. Handles hundreds of app connections with fewer actual DB connections.
- [ ] **Search optimization:** Add indexes for common query patterns (geospatial queries, date-range session lookups, caregiver availability search). Consider PostGIS for radius-based matching.
- [ ] **Monitoring & alerting:** Add APM (e.g., Sentry, Datadog) for error tracking, slow query detection, and uptime monitoring.
- [ ] **Build step for frontend:** Move to Vite. Bundle is currently 2.7MB single-file; code-splitting would dramatically improve initial load.
- [ ] **Multi-region:** If expanding beyond Virginia/Radford area, add Railway regions or move to a provider with multi-region support.


## Demo Credentials

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Care Team | paul@inplace.care | inplace123 | Primary — manages Barbara's care |
| Caretaker | maria@inplace.care | inplace123 | Assigned to families + manages brother Carlos |
| Cared-For | barbara@inplace.care | inplace123 | Limited view, controlled by Paul |

> David Lowe (david.lowe@inplace.care) and Susan Lowe (susan.lowe@inplace.care) still exist in the database with messages and sessions, but are hidden from the demo picker and banner switcher as of v1.3.6.
