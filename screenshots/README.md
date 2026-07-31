# App Store Connect screenshots

Generated marketing screenshots for the iPhone-only App Store submission.

| Size | Apple requirement | Output prefix |
|------|-------------------|---------------|
| 6.7" | 1290 × 2796 portrait | `out/6_7-1290x2796_*.png` |
| 6.1" | 1179 × 2556 portrait | `out/6_1-1179x2556_*.png` |

Five screens per size (Apple accepts 3–10), same screens in both:

1. `01-dashboard` — family home: next visit countdown, open care requests, Barbara's card + care team
2. `02-schedule` — month calendar (next month, so upcoming care is colour-coded) with a confirmed day opened
3. `03-caregivers` — Browse All: caregiver cards with rating, rate, specialties, background-check badge
4. `04-messages` — the "Barbara Lowe's Care Team" group thread (Paul + David + Susan coordinating)
5. `05-care-profile` — My Loved One: Barbara's profile + the iPAi Care Intelligence summary

## Re-running

```bash
cd /home/claude/kincare
node screenshots/capture.js
```

That's the whole thing. It boots an embedded PostgreSQL, runs `src/seed.js`, starts
`src/server.js` on port 3011, logs in as `paul@inplace.care`, captures all 10 PNGs
into `screenshots/out/`, verifies every PNG's IHDR dimensions, then shuts the
stack back down.

Useful flags:

```bash
node screenshots/capture.js --base-url http://127.0.0.1:3001   # use a server you already have running
node screenshots/capture.js --keep-server                      # leave pg + app up for poking at
node screenshots/capture.js --headed                           # watch it drive the browser
```

Env overrides: `CHROME_BIN`, `SHOTS_APP_PORT` (3011), `SHOTS_PG_PORT` (5599),
`SHOTS_PG_DATA` (`/tmp/inplace-shots-pg`).

Nothing in the repo is modified — everything lives under `screenshots/`, and the
database is a throwaway in `/tmp`.

## Payment safety

* `js.stripe.com`, `connect-js.stripe.com`, `checkr.com`, `plausible.io` are
  aborted at Playwright's network layer, so those scripts never even load.
* The server is started with `STRIPE_SECRET_KEY` / `RESEND_API_KEY` /
  `TWILIO_*` / `SENTRY_DSN` explicitly blanked.
* No payment/financials screen is ever visited.

Worth knowing: the accountability poller **does** try to pre-authorise payment
for seeded sessions on its own, ~18h before a booking. In this run it logged
`Auth failed for session …: STRIPE_SECRET_KEY not configured` and stopped there.
If anyone ever runs this script on a box with a live `STRIPE_SECRET_KEY` in the
environment, that poller — not the screenshot code — is what would reach Stripe.
The blanking above is deliberate; don't remove it.

## Environment notes / what fought back

**Demo account names have drifted from CLAUDE.md.** The seed no longer creates
`pete@inplace.care` or `betty@inplace.care`. The family is now **Paul Lowe**
caring for his mother **Barbara Lowe**, with siblings David and Susan; the
caregiver is still `maria@inplace.care`, the care recipient is
`barbara@inplace.care`. Password is still `inplace123`. CLAUDE.md's "Three User
Roles" table is stale.

**PostgreSQL can't run as root.** `initdb` refuses. `capture.js` detects uid 0 and
re-invokes the embedded-postgres binaries through `runuser -u claude --`. The app
server itself runs as the calling user and just talks TCP to 127.0.0.1.

**Demo-mode chrome had to be turned off in the throwaway DB.** Seeded users have
`is_demo = 1`, which wraps every screen in a purple "DEMO … Exit Demo" persona
bar that no real App Store user would ever see. `prepDemoData()` sets
`is_demo = 0, email_verified = 1, account_approved = 1` on the `@inplace.care`
accounts. All three matter:

* `email_verified` — otherwise a "verify your email" banner sits on every page.
* `account_approved` — this is normally flipped on by a per-boot statement in
  `src/models/database.js` that keys off `is_demo = 1`. Clearing `is_demo` before
  the server boots means that statement no longer matches, and *every* page
  renders the "Account Pending Approval" gate. Cost about one wasted run to find.

**Avatars are external and this box has no egress.** The seed points
`avatar_url`/`profile_photo` at `i.pravatar.cc`, which the sandbox proxy blocks.
`Messages.js` renders `<img>` with no `onerror` fallback, so the conversation
list showed torn-page icons and alt text. `capture.js` probes `i.pravatar.cc`
first: if it's reachable the photos are kept as-is; if not, the URLs are cleared
so the app falls back to its own initials avatars (the "BL" / "DL" / "SL"
circles you see in the current PNGs). **On a machine with internet the photos
come back automatically** — no code change needed.

**Leaflet map tiles are also external.** The Caregivers page defaults to the
"Find Nearby" tab, which renders an OpenStreetMap map — a blank grey rectangle
here. The script clicks over to "Browse All" instead, which needs no third-party
tiles and is a better card layout anyway. If Pete re-shoots with internet,
"Find Nearby" with real tiles + pins would make a stronger screenshot.

**Hover states leak into "touch" screenshots.** Playwright parks its synthetic
cursor wherever it last clicked; in Messages that left the desktop-only
`.msg-hover-actions` tray (reply / emoji / delete) floating over a bubble. The
script moves the mouse to (4, 4) before every capture. If you add screens, keep
doing that.

**Legal disclaimer modal blocks the app on first login.** It requires
scroll-to-bottom + a checkbox before the accept button unlocks, and there can be
several documents in sequence. `dismissDisclaimers()` handles the loop; the page
is then reloaded because accepting leaves a green "Welcome to InPlace!" toast
pinned to the top of every screen.

**First-run nags on the dashboard.** `pwa_dismissed` / `push_prompt_dismissed`
are pre-set in localStorage (kills the "Add to Home Screen" and push banners),
and the script clicks "Dismiss all" on the GET STARTED checklist plus the ✕ on
the "complete your profile" bar. Without that, the actual upcoming-care content
starts ~1000px down the page.

## Things Pete may want to re-shoot by hand

* **Avatars are initials, not photos** (see above). Real headshots would sell the
  caregiver cards and the group chat much harder. Re-run on a networked machine.
* **Caregivers → Find Nearby with a real map** is a better story than the plain
  card list, but needs OSM tiles.
* **6.1" schedule** — the day-detail card under the calendar is clipped by the
  bottom nav on the shorter screen. It's fine, just less informative than the
  6.7" version.
* **Care profile avatar** has the photo-upload camera affordance (a dark
  semicircle) sitting over the "BL" initials circle. Slightly odd looking; a real
  uploaded photo removes it.
* **The blank ~55pt strip at the top** of every shot is the app's safe-area
  inset. That's where iOS paints the status bar, so it's correct for App Store
  Connect (Apple does not want a fake status bar), but it does read as empty.
* **No caregiver-side screen is in the set.** The brief allowed CaretakerHub or
  the care profile for slot 5; CaretakerHub currently renders Maria's incomplete
  "First Steps" onboarding checklist (item 1 is "Set up Stripe"), which looks
  like a broken account. `find-work` (Maria's Open Jobs list, with real jobs and
  "$50 your earnings") renders very well and would make a strong 6th screenshot
  if Pete wants the two-sided marketplace in the set — add
  `["06-find-work", …]` to `SCREENS` and log in as `maria@inplace.care`.
