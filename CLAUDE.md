# InPlace — Project Context

## What This Is

InPlace is an on-demand care coordination platform connecting families with professional caregivers for elderly/parent care. The primary user is Pete Lee, who is managing care for his mother Betty Lee (78, early-stage dementia, mild arthritis) in Blacksburg, VA.

## Live Demo

https://yourinplace.com

## Tech Stack

- **Backend:** Node.js + Express (v4), port 3001
- **Database:** PostgreSQL via `pg` (connection pooling, persistent data across deploys)
- **Auth:** JWT tokens (7-day expiry), bcryptjs for password hashing, Google OAuth (Passport.js), TOTP 2FA (otplib), trusted devices
- **Frontend:** Modular React SPA (via CDN — React 18, ReactDOM, Babel standalone). No build step — Babel compiles JSX in-browser.
- **Real-Time:** Socket.io WebSocket server with JWT-authenticated connections. Events: `new_message`, `session_update`, `activity_update`, `visit_photos`.
- **File Uploads:** Multer (memory storage, 5MB limit, image-only, max 5 files). Photos stored as base64 in PostgreSQL.
- **Geocoding:** OpenStreetMap Nominatim (free, no API key). Swappable to Google Maps by changing one function in `src/utils/geocode.js`. Haversine distance for radius search.
- **Maps:** Leaflet + OpenStreetMap tiles (free). Tile provider swappable in one line.
- **Deployment:** Railway.app (NIXPACKS builder), Cloudflare DNS/proxy for yourinplace.com
- **IDs:** UUID v4 for all entities

## Project Structure

```
├── CLAUDE.md                  ← You are here
├── TASKS.md                   ← Active task list & bug tracker
├── ROADMAP.md                 ← Development roadmap (phased)
├── README.md                  ← API docs, demo credentials, examples
├── package.json               ← Dependencies & scripts
├── .env.example               ← Config template (copy to .env for local dev)
├── .env                       ← Local config (gitignored — auto-created for dev)
├── railway.json               ← Railway deployment config
├── public/
│   ├── index.html             ← Slim shell (~60 lines) — loads CSS, React CDN, fetches & compiles all JS with cache-bust param
│   ├── css/
│   │   └── styles.css         ← All CSS (~1,600 lines)
│   └── js/
│       ├── utils.js           ← Shared utilities: apiFetch, setAuthToken, WebSocket manager, scheduling helpers
│       ├── app.js             ← App root component: routing, sidebar, page switching, modal management
│       └── components/
│           ├── InPlaceIcon.js          ← SVG logo component ("iP" monogram)
│           ├── SplashPage.js           ← Investor pitch landing page (market stats, problem/solution, business model, vision, waitlist capture)
│           ├── LoginPage.js            ← Email/password login with demo account quick-select
│           ├── RegisterPage.js         ← Multi-step registration wizard (family or caregiver)
│           ├── Dashboard.js            ← Stats cards, upcoming sessions, assigned caregivers
│           ├── CareProfile.js          ← Care recipient profile with emergency contacts
│           ├── Schedule.js             ← Calendar heat map with saturation shading, session details
│           ├── Caregivers.js           ← Browse/search/find nearby caregivers with map, assign/unassign/favorite
│           ├── CareRecipients.js       ← Add/edit care recipients (CRUD)
│           ├── ActivityFeed.js         ← Notification stream with mark-as-read
│           ├── Messages.js             ← Real-time chat (database-backed conversations)
│           ├── MyAccount.js            ← Settings & notification preferences (wired to PUT /api/auth/me)
│           ├── CaredForView.js         ← Betty's month calendar (pink=seeking help, blue=confirmed) + care request form + notes
│           ├── CaretakerHub.js         ← Caregiver dashboard (schedule, families, earnings breakdown, reviews)
│           ├── AvailabilityTab.js      ← Month calendar for caregiver availability management (day-click editing)
│           ├── CaregiverCalendar.js    ← Weekly calendar with availability overlay + care request accept flow
│           ├── AreaMap.js              ← Leaflet/OpenStreetMap with real lat/lng family pins, radius circle (caregiver view)
│           ├── RequestCareModal.js     ← 5-step care request wizard with caregiver matching
│           ├── CaregiverScheduleModal.js ← View caregiver availability, book from schedule
│           ├── TwoFactorSetup.js       ← 2FA setup wizard (QR code → verify → backup codes)
│           ├── CareTeamManage.js       ← Care team member management (invite, remove, change roles)
│           ├── CareTeamPage.js         ← Care team listing/navigation wrapper
│           ├── EmailVerificationBanner.js ← Banner prompting unverified users to check email
│           ├── Analytics.js            ← Family dashboard analytics (bar charts, donut chart, utilization)
│           ├── DemoPickerPage.js       ← Demo account selector (Pete/Maria/Betty)
│           ├── ForgotPasswordPage.js   ← Password reset request form
│           ├── ResetPasswordPage.js    ← Password reset confirmation form
│           ├── CaregiverOnboarding.js  ← 5-step caregiver registration wizard
│           └── AdminPanel.js           ← Admin dashboard (stats, users, waitlist, activity, invites)
└── src/
    ├── server.js              ← Express app + Socket.io WebSocket server, route mounting, static file serving, auto-seed on empty DB
    ├── seed.js                ← Demo data (5 users, 4 caregivers, sessions incl. care requests, messages, assignments, availability rules)
    ├── models/
    │   └── database.js        ← PostgreSQL schema (16 tables), pg Pool wrapper
    ├── middleware/
    │   ├── auth.js            ← generateToken, authenticate, requireRole
    │   └── validate.js        ← Input validation (register, login, profile, messages, sessions)
    ├── utils/
    │   ├── email.js           ← Centralized Resend email sending + branded HTML templates
    │   └── geocode.js         ← Nominatim geocoder (swappable to Google Maps), haversineDistance()
    └── routes/
        ├── auth.js            ← Register, login, GET /me, email verification (verify + resend)
        ├── careRecipients.js  ← CRUD for care recipients (parents), auto-geocodes on create/update
        ├── sessions.js        ← Care session booking, matching, status updates
        ├── caregivers.js      ← Caregiver search (+ location/radius), profiles, nearby endpoint
        ├── activity.js        ← Activity feed, mark-read, visit log submission
        ├── dashboard.js       ← Aggregated stats & upcoming sessions
        ├── messages.js        ← Send/receive messages, conversation list
        ├── notes.js           ← Care recipient notes (Betty's personal notes)
        ├── assignments.js     ← Caregiver-to-recipient assignments, favorites
        ├── photos.js          ← Visit photo upload (multer), retrieval by visit log or session
        ├── careTeams.js       ← Care team CRUD, invite flow, member management
        ├── twoFactor.js       ← TOTP 2FA setup/verify/disable, backup codes, trusted devices
        ├── waitlist.js        ← POST signup, GET count (no auth required)
        ├── passwordReset.js   ← Forgot password + reset (via Resend email)
        ├── availability.js    ← Caregiver availability CRUD, slot computation
        ├── analytics.js       ← Family dashboard analytics (6-month trends, service breakdown)
        ├── push.js            ← Push notification subscribe/unsubscribe
        ├── consent.js         ← Consent/authorization (Tier 2 doc upload, Tier 3 attestation + outreach + admin review)
        ├── documents.js       ← Document verification, AI classification, consent audit log
        └── admin.js           ← Admin-only endpoints (stats, users, waitlist, activity, invites, consent review, bg check approval)
```

## Frontend Architecture

The frontend uses **Babel standalone** for in-browser JSX transpilation (no build step, no bundler). The `index.html` shell fetches all JS files in parallel via `fetch()`, concatenates them in dependency order, and has Babel compile the combined source once. This means all files share one scope after compilation.

**Cache busting:** All script and CSS fetches include a `?v=X.Y.Z` query parameter. Bump this version in `index.html` whenever you push frontend changes to bust Cloudflare's cache. Without this, users may get stale JS files.

**Service worker gotcha:** The `?v=` query param on `sw.js` does NOT force the browser to treat it as a new service worker — browsers ignore query params for SW identity. If users report being stuck on an old version despite cache purges and hard refreshes, the old service worker is likely serving cached files. The current fix (v1.33.67+): index.html unregisters ALL existing service workers and clears ALL caches on every page load before re-registering. This is aggressive but guarantees updates get through. Check this FIRST when debugging "stuck on old version" issues.

**URL query params in emails:** When building URLs with query params (e.g., `?reset=TOKEN`), always include a trailing slash before the `?` — use `domain.com/?param=value`, NOT `domain.com?param=value`. Cloudflare and Express can redirect bare-domain URLs and drop query params in the process. The `passwordReset.js` and `admin.js` reset email URLs use `baseUrl + '/?reset=' + token` for this reason.

**useState initializers for URL routing:** When the app needs to detect URL params (like `?reset=`, `?invite=`, `?verify=`), check them in `useState` initializers, NOT in `useEffect`. UseEffect runs after the first render, which means auto-login or other async effects can race and stomp the state. Example: `const [appState, setAppState] = useState(() => { const p = new URLSearchParams(window.location.search); if (p.get('reset')) return 'reset-password'; return 'splash'; })`. This guarantees the correct initial state before any effects fire.

**useEffect race conditions with Leaflet maps:** Map initialization uses `setTimeout` for DOM readiness, but dependent useEffects (e.g., marker placement) can fire before the map exists. Always poll for `leafletMap.current` before placing markers/overlays. This has caused invisible markers twice (v1.33.80). Pattern: wrap the effect body in a `waitForMap` function that retries via `setTimeout(waitForMap, 50)` until the map ref is populated. Same principle applies anywhere a ref is set asynchronously in one effect and consumed in another.

**WebAuthn RP_ID/ORIGIN config:** Never gate passkey config on `NODE_ENV`. Railway and other hosts may not set `NODE_ENV=production`. Both `passkeys.js` and `admin.js` derive RP_ID from `APP_URL` hostname with fallback to `yourinplace.com`, and use `APP_URL` directly as ORIGIN. If passkeys break with "failed to verify", check RP_ID and ORIGIN values first — origin mismatch is the most common cause.

**Admin password reset flow (v1.33.71+):** When admin force-resets a user's password: (1) old password is immediately invalidated (random hash), (2) `must_change_password=1` is set, (3) reset email sent with 24hr token. The reset link lands on `ResetPasswordPage` which has new + confirm fields with password rules (8+ chars, uppercase, number, symbol). The backend `password-reset/confirm` endpoint clears `must_change_password` on success, so the user goes straight to dashboard after login — no second change-password screen.

**Pattern for component files:**
```javascript
// Each component declares itself AND assigns to window (for individual-file testing)
const MyComponent = window.MyComponent = ({ prop1, prop2 }) => {
  // component body using useState, useEffect, apiFetch, etc.
};
```

**Dependency order matters:** utils.js → InPlaceIcon → other components → app.js. When adding a new component, add it to the `scripts` array in `index.html` before `app.js`.

## Three User Roles

The app supports three login roles, each with a different sidebar and dashboard:

| Role | User | Email | View |
|------|------|-------|------|
| Care Team (family) | Pete Lee | pete@inplace.care | Full dashboard, scheduling, caregiver management, care profile |
| Sibling (family) | David Lee | david.lee@inplace.care | Same dashboard, manages Betty's care alongside Pete |
| Sibling (family) | Susan Lee | susan.lee@inplace.care | Same dashboard, manages Betty's care alongside Pete |
| Caretaker (caregiver) | Maria Santos | maria@inplace.care | CaretakerHub with schedule, families, earnings, area map |
| Cared-For (recipient) | Betty Lee | betty@inplace.care | CaredForView with calendar and personal notes |

All demo passwords: `inplace123`

## Database Tables

users, care_recipients, caregiver_profiles, availability, care_sessions, visit_logs, visit_photos, activity_feed, reviews, payments, conversations, conversation_members, messages, recipient_notes, caregiver_assignments, waitlist, care_recipient_shares, push_subscriptions, oauth_accounts, user_2fa, trusted_devices, care_teams, care_team_members, care_team_invites, platform_invites, password_reset_tokens, email_verification_tokens

All tables use TEXT primary keys (UUIDs). Timestamps are TIMESTAMPTZ via `NOW()`. JSON fields (health_conditions, medications, specialties, certifications, tasks_completed) are stored as TEXT JSON strings — parse with `JSON.parse()` on read. The database wrapper auto-converts `?` placeholders to `$1, $2, ...` for PostgreSQL compatibility.

## Design System

- Primary color: `#1b6b5a` (teal)
- Accent color: `#e8724a` (orange)
- Logo: "iP" monogram in rounded teal square (DM Sans 800)
- Font: System fonts (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
- Layout: Sidebar (240px) + scrollable main content
- Mobile: Bottom nav bar on ≤768px, sidebar on desktop

## API Patterns

All API responses follow `{ fieldName: value }` or `{ collectionName: [...] }` format. Routes use `authenticate` middleware from `src/middleware/auth.js`. The `req.user` object contains `{ id, email, role }` from the JWT payload.

## Consent & Authorization System (v1.37.0)

Three authorization tiers for care recipients:

- **Tier 1 (Self-signup):** Care recipient has their own account — auto-verified, no consent needed.
- **Tier 2 (POA/Guardianship):** Family uploads legal documents → AI classification via Claude → admin review → approve/reject.
- **Tier 3 (Family Attestation):** Family signs attestation + provides care recipient's email → system sends outreach email directly to care recipient → care recipient responds (aware / questions / did not authorize) → admin reviews everything → approve/reject.

Key files: `src/routes/consent.js` (auth per-route, not global — respond/:token endpoints are PUBLIC for care recipients), `src/routes/admin.js` (consent review + bg check approval), `public/js/components/ConsentVerification.js` (frontend flow), `public/js/components/ConsentResponsePage.js` (standalone public page for care recipient responses).

The consent_outreach table tracks emails sent + recipient responses. Attestations have admin_status (pending/approved/rejected). First-visit confirmation by caregivers is BLOCKING — "no"/"unable" pauses future bookings.

## Payment System (v1.40.9 — Stripe Connect)

**Money flow:** Family pays → Stripe processes → Stripe splits (80% caregiver, 20% platform) → Platform balance settles to Mercury bank account.

**Admin kill switch:** Payments are OFF by default. An admin must enable them via the Financials tab toggle in AdminPanel. The `payments_enabled` key in `platform_settings` gates all Stripe-touching endpoints (`/connect/onboard`, `/checkout`, `/background-check`). When disabled, these endpoints return 503 with `paymentsDisabled: true`.

**Stripe Connect (v1.40.6–v1.40.8):** Caregiver onboarding creates Express accounts with `card_payments` + `transfers` capabilities. Frontend tries embedded Connect.js component first (3s timeout), falls back to redirect-based onboarding via Account Links if Connect.js unavailable (e.g., Stripe CDN 503).

**Identity Verification — REMOVED for caregivers (v1.40.9):** Separate Stripe Identity verification was redundant — caregivers are already ID-verified through Stripe Connect onboarding (legal name, DOB, SSN, bank account) AND Checkr background check (full SSN, DOB, identity verification). The `identity_verified` gate was removed from the checkout flow. Family identity verification in MyAccount.js and CareRecipients.js attestation flow is preserved.

**Webhook:** `POST /api/payments/webhook` receives Stripe events (checkout completed/expired, payment succeeded/failed, account updated, identity.verification_session.verified, identity.verification_session.requires_input). Uses raw body parsing for signature verification. Must be registered in Stripe Dashboard → Developers → Webhooks pointing at `https://yourinplace.com/api/payments/webhook`. Requires `STRIPE_WEBHOOK_SECRET` env var on Railway.

**Key files:** `src/routes/payments.js` (all payment + identity endpoints + webhook), `src/routes/financials.js` (admin financials + kill switch), `public/js/components/AdminFinancials.js` (admin UI), `public/js/components/FamilyPayments.js` (family payment history), `public/js/components/CaretakerHub.js` (caregiver identity verification UI).

**Env vars (Railway):** `stripe_secret_key` (live), `stripe_publishable_key` (live), `STRIPE_WEBHOOK_SECRET` (from Stripe webhook config).

## Last Session Handoff (updated each session)

**Date:** March 17, 2026 | **Version:** v1.47.3 | **Session type:** Bug fixes + admin tools + iPAi AI platform

### What was done this session:

**Bug fixes (v1.46.3–v1.46.6):**
- Fixed Tony's duplicate proposal bug, no-show visibility, admin review flow, checkout care notes consolidation, stale past-time open jobs
- Fixed Stripe dashboard link (was hardcoded to platform dashboard)
- Pre-filled Stripe business_profile to skip webpage/industry during onboarding
- Fixed schedule day count off-by-one (calendar dates instead of raw minutes)

**Admin tools (v1.46.8–v1.46.14):**
- Admin alert badge on sidebar/bottom nav with per-tab breakdown (People, Sessions, Auth, Feedback)
- Admin service messaging — send messages as "InPlace Support" from admin panel
- Manual caregiver freeze/pause with reason from People tab
- Paused caregivers in Action Required banner with Message + Reinstate + Call buttons
- Costs tracking tab — recurring expenses, one-time entries, auto-pull from Twilio/Stripe, Claude API ready
- Fixed FAQ admin access bug (help.js checking req.isAdmin wrong)

**iPAi AI platform (v1.47.0–v1.47.3):**
- iPAi checkmark badge component (IPAiBadge.js) — tiny teal pill, deployed on matching + care profile
- AI matching engine (src/utils/aiMatching.js) — 6-factor weighted scoring, sorts caregivers by match quality
- Care Intelligence engine (src/utils/careIntelligence.js) — deep behavioral + medical insights from visit data
- Post-session AI summaries — auto-generated warm family summaries after caregiver checkout
- Caregiver coaching — private AI tips for caregivers specific to each care recipient
- IPAiInsightsCard component on Care Profile page

**Infrastructure:**
- Regenerated GitHub PAT, updated git remote (expires Apr 15, 2026)
- Session continuity system: TASKS_ARCHIVE.md, CHANGELOG.md, CLAUDE.md handoff, feedback-loop task rewrite
- Paused caregiver gated from accepting jobs (server 403 + client disabled buttons)

### What was discovered / still open:
- Cary's "Set Up Payments" card showing despite prior Stripe connection — needs investigation
- Checkr: Guilherme confirmed Embeds require same webinar/checklist process as API. Pete emailed asking about Embeds + candidate-pay. Waiting on reply.
- DUNS number (106784345) has wrong business name — blocking Google Play. D&B requires 8-day verification. Alternative: Google Play manual verification via business docs.
- Anthropic Admin API key not available on Individual org plan — Claude API cost ($0.01/mo) entered manually for now. At scale, upgrade to Team plan for auto-pull.

### Key decisions made:
- Background checks: Required for all caregivers. Checkr Embeds route. Candidate-pay if possible.
- iPAi brand: Teal checkmark pill badge. Replaces "GREAT MATCH" only. Other pills (No Conflicts, Bonus Pay) stay.
- AI strategy: Matching engine (algorithmic + Haiku for explanations), Care Intelligence (Sonnet for deep insights), post-session summaries (Haiku), caregiver coaching (Haiku). All non-blocking, all marked with iPAi badge.
- Cost tracking: Recurring + one-time + auto-pulled. $200/mo Claude subscription tracked as recurring. Railway, Twilio, Stripe auto-pulled.

### New tables/columns this session:
- `messages.sender_label` — custom display name for admin service messages
- `visit_logs.ai_summary` — AI-generated post-session summary (JSON)
- `visit_logs.ai_coaching` — AI-generated caregiver coaching tips (JSON)
- `platform_costs` table — one-time cost entries
- `recurring_expenses` table — monthly/yearly subscriptions
- `caregiver_profiles.account_paused` (added previous session, used extensively this session)

## Local Development

```bash
npm install          # Install dependencies (one time)

# Set up PostgreSQL:
# 1. Install PostgreSQL locally (brew install postgresql, or apt install postgresql)
# 2. Create a database: createdb inplace
# 3. Copy .env.example to .env and set DATABASE_URL=postgresql://user:password@localhost:5432/inplace

npm run dev          # Start server with --watch (auto-restarts on backend changes)
```

Then open `http://localhost:3001` in a browser. That's it — no build step.
The database auto-seeds with demo data on first run if empty.

**Editing frontend:** Change any file in `public/js/` or `public/css/`, then refresh the browser. Babel recompiles on every page load.

**Editing backend:** Change any file in `src/`, the server auto-restarts via `--watch`.

**Resetting demo data:** Run `npm run seed` to wipe the database and repopulate with demo data.

**Adding a new component:** Create `public/js/components/NewComponent.js` using the window pattern, then add its path to the `scripts` array in `index.html` (before `app.js`), and reference it in `app.js`.

## Deploying to Railway

Railway auto-deploys on every `git push origin main`. No build config needed — it runs `npm start`.

Environment variables on Railway are set in the Railway dashboard (not in `.env`). The production JWT_SECRET is different from the local dev one.

**Important:** After pushing frontend changes, bump the `?v=X.Y.Z` cache-bust parameter in `index.html` so Cloudflare serves fresh files. Without this, the live site may show stale JS/CSS.

The production PostgreSQL database is a Railway service. The `DATABASE_URL` env var is set in the Railway dashboard (provided by the PostgreSQL service). The DB auto-seeds when empty on first deploy.

## Scripts

- `npm start` — Production server
- `npm run dev` — Dev with --watch (backend auto-restart, frontend just refresh browser)
- `npm run seed` — Reset & populate demo data
- `npm run setup` — Seed + start combined
- `npm test` — Run Jest test suite (53 tests, no database needed)
- `npm run collect-feedback` — Fetch all user feedback from production into FEEDBACK.md
- `npm run collect-feedback -- --triage` — Quick triage: show new items + counts (fast, no file write)
- `npm run collect-feedback -- --mark-reviewed` — Bulk mark all 'new' items as 'reviewed'

## Feedback-Driven Development Workflow ("Run Feedback Loop")

When Pete says **"Run feedback loop"**, execute this full cycle:

### Step 0 — Verify ADMIN_API_KEY (do this FIRST, every time)

The feedback loop requires `ADMIN_API_KEY` to bypass 2FA on the production API.
Check for it before doing anything else:

```bash
# In the repo .env file:
grep ADMIN_API_KEY .env
```

- **If present** → proceed to Step 1.
- **If missing** → STOP. Ask Pete for the key (it's in Railway env vars). Add it to `.env`:
  ```
  ADMIN_API_KEY=<the-key-from-railway>
  ```
  Then proceed. Do NOT attempt email/password login — it will hit 2FA and fail.

### Feedback Statuses (in the production DB)

| Status | Meaning |
|--------|---------|
| **new** | Just submitted by a user. Not yet read. |
| **reviewed** | Read and triaged. Logged in TASKS.md if actionable. Not yet in an active dev batch. Items that are "can't fix yet" or "not now" stay here — do NOT dismiss them. |
| **planned** | Committed to a specific version batch and actively being worked on. |
| **done** | Shipped, verified working in production. |
| **dismissed** | Genuinely not going to do — bad idea, duplicate, misunderstanding. NOT for "won't fix right now" items. |

### The Loop (Fast Path)

Use these two admin API endpoints for fast feedback triage. **All calls use the API key header — never email/password.**

1. **Pull new feedback in one call:**
   ```
   GET https://yourinplace.com/api/admin/feedback/triage
   Header: x-admin-api-key: $ADMIN_API_KEY
   ```
   Returns: `counts` (by status), `newItems` (full detail), `recentReviewed` (last 7 days), `summary` (one-line).

2. **Read the new items, triage into TASKS.md**, then bulk-mark as reviewed:
   ```
   POST https://yourinplace.com/api/admin/feedback/bulk-update
   Header: x-admin-api-key: $ADMIN_API_KEY
   Body: { "updates": [{ "id": "...", "status": "reviewed" }, ...] }
   ```
   Can also set `adminNotes` and `tags` per item. Praise items can go straight to `{ "status": "done" }`.

3. **Cross-reference already-fixed items.** Scan `recentReviewed` from the triage response against shipped versions. Bulk-mark as `done` using the same endpoint.

4. **Clean up TASKS.md.** Remove duplicates, mark stale items as done if fixed.

5. **Report summary.** Tell Pete: how many new items, what was triaged, what's still open — organized by priority tier.

### The Loop (Legacy — Full Fetch)

If a full export to FEEDBACK.md is needed:
1. `npm run collect-feedback` — fetches all items, writes FEEDBACK.md
2. Triage manually from FEEDBACK.md
3. Mark items via individual `PUT /api/feedback/:id` calls

### Planning a Version

When batching items into a version:
- Move feedback items from `reviewed` → `planned` in the DB
- Add them to TASKS.md under the version heading
- After shipping and verifying, move from `planned` → `done`

### Triage Priority Tiers

When triaging feedback, categorize every item by priority. The summary report should be organized by these tiers, not just by theme. At scale (hundreds of users), this ensures barriers to entry never get buried under cosmetic requests.

**P0 — Barriers to Entry (fix immediately)**
Anything that prevents a new user from signing up, logging in, completing onboarding, connecting Stripe, or booking/accepting their first session. If someone can't get in the door, nothing else matters. Also includes: payment failures, auth errors, 2FA lockouts, registration crashes, and any flow where a user gets stuck with no way forward. Bad-actor or inappropriate feedback also gets flagged here for moderation review.

**P1 — Core Flow Bugs (fix in current or next batch)**
Bugs in the critical path that don't fully block entry but degrade the experience enough that a user might abandon: messages not delivering, calendar not loading, sessions not appearing, caregiver search returning wrong results, confusing error messages during onboarding.

**P2 — UX & Polish (batch into upcoming versions)**
Usability improvements, layout issues, confusing labels, visual inconsistencies, mobile responsiveness problems. Important but not blocking anyone from using the product.

**P3 — Feature Requests (backlog)**
New capabilities, integrations, nice-to-haves. Good signal for the roadmap but no urgency.

**Dismiss** — Spam, inappropriate content, duplicates, misunderstandings. Not "won't fix right now" — only genuinely bad or irrelevant items.

### Key Rules
- **Never dismiss "can't fix yet" items.** Leave them as `reviewed`.
- **Only dismiss genuinely bad ideas** — duplicates, misunderstandings, spam, inappropriate content, or things that don't make sense.
- **Praise items** (e.g., "this looks great") can go straight to `done` — they require no action.
- **FEEDBACK.md is gitignored** — it's a local working file, not committed.

## Product Philosophy — Onboarding

The guiding principle for all registration and onboarding flows: **get them in fast, motivate them to complete later.**

**For all users:**
- Signup should collect the bare minimum: name, email, password, role. That's it. Let them in.
- Profile details (phone, address, photo, emergency contacts) come later — prompted but not required at signup.
- First login should feel rewarding, not like homework. Show them the dashboard, show them value.

**For caregivers specifically:**
- Don't require a driver's license photo, certifications, or background check payment during signup. Those are gates to *accepting jobs*, not gates to *creating an account*.
- Let them see demand in their area, browse available families, explore earnings potential — all before uploading a single document. Seeing "12 families need help near you" is what motivates them to pull out their DL.
- Progressive gating: "You can't see job details until you upload your DL" > "Upload your DL to create an account."
- The First Steps checklist is the mechanism — items are clearly listed, each unlocks something specific, and the caregiver controls the pace.

**For families:**
- Don't force care recipient details at signup. Let them create an account, see the dashboard, then walk them through adding their loved one.
- Care recipient profiles can start sparse and fill in over time. A family member in crisis doesn't want to enter medications and emergency contacts before they can even look for help.

**The funnel matters most.** Every friction point in signup/login/onboarding is a lost user. Feature polish means nothing if people can't get through the door.

## WebSocket Architecture

The server uses Socket.io for real-time updates. Express is wrapped in `http.createServer(app)` and Socket.io attaches to that server. Connections require a JWT token via `socket.handshake.auth.token`. Connected users are tracked in a `Map<userId, Set<socketId>>` for targeted event delivery.

**Server-side:** `app.set("io", io)` and `app.set("emitToUser", emitToUser)` make WebSocket accessible from any route. Routes call `req.app.get("emitToUser")(userId, event, data)` to push events.

**Client-side:** `connectSocket(token)` in utils.js connects and auto-registers all listeners. `onSocketEvent(event, callback)` registers listeners and returns a cleanup function (call in useEffect return). Listeners persist across reconnects via `_socketListeners` Map.

**Events:** `new_message` (Messages.js), `session_update` (Dashboard.js), `activity_update` (Dashboard.js, ActivityFeed.js), `visit_photos` (Dashboard.js).

## Timezone Design Principle

**All times are care-location times, period.** When a session is booked for 8am, that means 8am where the care is happening (currently always Eastern / America/New_York). It does not matter where the person booking, viewing, or receiving notifications is physically located. If Pete is in China and schedules care for Mom in Virginia, the calendar shows Virginia time. Push notifications fire based on Virginia time. Check-in gates open based on Virginia time.

**Current implementation (interim):** Session dates and times are stored as naive TEXT strings (`scheduled_date` = "2026-02-26", `scheduled_time` = "08:00") with no timezone metadata. All backend comparisons use `toLocaleString('en-US', { timeZone: 'America/New_York' })` to get Eastern "now". All frontend check-in gates do the same. This works for Virginia-only care but is hardcoded.

**Long-term fix (P0 in TASKS.md):** Store a `timezone` column on `care_recipients` (default `'America/New_York'`). All date/time logic reads the care recipient's timezone instead of hardcoding Eastern. This enables multi-state expansion.

**Rules for any new date/time code:**
- Never use `new Date().toISOString().split('T')[0]` for "today" — that returns UTC date
- Never use `new Date(dateStr + 'T' + timeStr + ':00')` — that parses as UTC
- Backend: always compute "now" as `new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))`
- Frontend: same pattern for check-in gates and session comparisons
- Push notification timing: compare against Eastern time, not server time (Railway runs in UTC)

## Dev Rules (Persistent)

These rules apply to every session. Do not skip them.

1. **Every phone input uses display `(XXX) YYY-ZZZZ` unless intl toggle.** All phone inputs call `formatPhone()` from utils.js. Every phone field includes an "International number" toggle button. If the format is wrong, fix it in `formatPhone()` — one place, not 20.

2. **Always bump version when deploying changes.** Three locations must be updated together: `window.APP_VERSION` in index.html (line ~55), cache-bust `?v=` params in index.html (lines ~23 and ~111), `APP_VERSION` in server.js, and `SW_VERSION`/`CACHE_NAME` in sw.js. If you don't bump, browsers serve stale files.

3. **Always tell Pete what version number to look for after a push.** After `git push` and Railway deploy, say "Look for vX.Y.Z in the footer" so he can confirm the new code is live.

4. **Always ask questions for intent on design changes.** Don't assume what the user wants. Ask clarifying questions before implementing any UX or layout change.

5. **Ask if mockups are needed for major design changes.** Before building a significant UI change, offer to create a mockup or wireframe so Pete can approve the direction first.

6. **Trust user bug reports — investigate code first.** When Pete reports a bug, look at the code before suggesting it might be caching or user error. He's usually right.

7. **NEVER trigger real payments from demo/seed data.** Stripe is live with real keys. Demo accounts (pete@inplace.care, maria@inplace.care, betty@inplace.care, etc.) do NOT have real Stripe Connect accounts. Never write code that creates Stripe Checkout Sessions, PaymentIntents, or transfers using demo/seed user data. Never seed `stripe_account_id` on demo caregiver profiles. Any payment-related code changes must be reviewed for demo safety — if a code path could reach Stripe's API with fake data, it's a bug. When testing payment flows, use Stripe's test mode keys locally, never the live keys.

## Known Limitations

1. Stripe is live (real keys on Railway). Demo accounts have no Stripe Connect accounts and must never trigger real charges. See Dev Rule #7.
2. Sibling users each have separate care_recipient records for Betty (no shared access model yet)
3. Email delivery requires domain verification in Resend — sandbox sender only delivers to account owner
4. Visit photos stored as base64 in PostgreSQL — works for demo but won't scale to production (use S3/R2 later)
5. Geocoding uses Nominatim (OSM) — less accurate for residential addresses than Google Maps. Swap path documented in `src/utils/geocode.js`.
6. Google OAuth backend exists but needs GOOGLE_CLIENT_ID/SECRET env vars set on Railway (requires Google Cloud Console setup)
