# InPlace Tasks

> **How this works:** Add bugs and features below as you find them. Don't worry about wording or order. When you're ready for a dev session, say "let's work the task list" and Claude will batch everything together into one efficient push. Nothing gets executed until you say go.

## Bugs

- [x] ~~**Calendar heat map sometimes stale on tab switch:** Fixed in v0.6.1 by adding `key={currentPage}` to all page components in renderPage(), forcing full remount on navigation.~~
- [x] ~~**Real accounts can see demo users in contact/assignment pickers:** Fixed in v1.2.1. Added `is_demo` isolation to `/api/messages/contacts`, `/api/caregivers`, and `/api/caregivers/nearby`. Demo users see demo users, real users see real users.~~
- [x] ~~**PWA not updating to latest version on phone:** Fixed in v1.2.1. Service worker cache name was stuck at `inplace-v0.9.0` — bumped to `inplace-v1.2.1`. Also added missing components (TwoFactorSetup, CareTeamManage, CareTeamPage, EmailVerificationBanner) to SW static asset list.~~
- [x] ~~**Caregiver onboarding document upload — request body too large:** Fixed in v1.5.3. `limitBodySize` middleware was rejecting multipart/form-data before multer could process it. Fix: skip body size check for multipart requests. Also bumped multer per-file limit to 10MB, added client-side image resizing (1600px max, JPEG 85%), and replaced bare file inputs with "Take Photo" / "Choose Photo" buttons for mobile.~~
- [ ] **No profile photo upload for family/care-recipient roles.** Photo upload was only added to CaretakerHub (caregiver role). Family users (like peterjslee@gmail.com) and care recipients have no way to upload a profile photo anywhere — not in MyAccount, not in Dashboard. Need: add photo upload to MyAccount (Profile tab) for all roles, with the same resize-and-upload flow used in CaretakerHub. Display the avatar in sidebar/header and anywhere the user's name appears.
- [ ] **No thumbnail photos on any demo profile.** None of the demo users (Pete, Maria, Betty, other caregivers) have real profile photos — just emoji placeholders or SVG initials. Need: seed realistic avatar images for all demo users so the app looks polished during demos. Consider using generated placeholder headshots or styled SVG avatars with distinct colors per person.
- [ ] **Caregiver dashboard too cluttered — icon/text overload.** The CaretakerHub tab bar (My Families, Area Map, Earnings, Reviews, etc.) has too many small icons with text labels crammed together. Suggestion: use larger, more illustrative icons without text labels, and show the text label on hover (tooltip) or when selected. Reduce visual noise so the dashboard feels cleaner.
- [ ] **Messages show "Invalid Date" on sent messages.** When sending a message, the timestamp displays "Invalid Date" instead of the actual time. Likely the backend is returning `created_at` in a format the frontend's date parser doesn't handle, or the field name doesn't match what Messages.js expects.
- [ ] **Caregiver onboarding does not ask about pets/allergies/medical conditions.** Carry Taiker's onboarding flow completed without collecting any pet, food allergy, or medical condition info. The "Onboarding profile questions — all roles" feature (in Features below) covers the full design, but at minimum the caregiver signup wizard should collect this before completing registration.
- [ ] **"Upload profile photo" in First Steps has no link and no display location.** The caregiver First Steps checklist includes "Upload profile photo" but there's no way to actually upload one — no link, no modal, no upload UI. Needs: (1) a clickable link/button on that checklist item that opens a photo upload flow, (2) a place to display the photo once uploaded — show it to the right of the "iP" logo in the top-left sidebar/header area, like a small avatar. Store photo as base64 or use the existing multer upload pattern. Display the avatar across all roles (not just caregivers) once uploaded.
- [ ] **Dashboard needs a "Latest" / status section.** Every role's dashboard should have a prominent section at the top showing their current status and next action. For a caregiver like Carry Taiker who just registered, it would say something like "Pending background check and onboarding — complete your First Steps to get started." For a family member, it might show "2 upcoming sessions this week" or "Care request awaiting caregiver." Context-aware, always tells the user what's happening and what to do next.
- [ ] **Caregiver profile should show submitted onboarding documents and info for review.** After a caregiver completes onboarding, there's no way to see the documents (DL front/back, selfie), photos, or info they entered. All of that should be viewable somewhere in their profile — either in MyAccount or a dedicated "My Documents" section in CaretakerHub. Let the caregiver review what they submitted and re-upload if needed.
- [ ] **Real users can see/message other users without an accepted connection.** Currently any real user can find and message any other real user via the contacts list. Two strangers (e.g., peterjslee@gmail.com and peter@yourinplace.com) should NOT be able to see each other unless one has invited the other and the invite was accepted. Contacts should be gated by: (a) accepted care team invite, (b) caregiver assignment, or (c) a new "connection request" flow — search by email or proximity, send invite, other party accepts. Until accepted, neither party appears in the other's contact list or can start a conversation.


## Features — Up Next

> Ideas and features not yet batched. When enough accumulate, we'll group them into the next batch.

- [ ] **Plausible Analytics setup:** Sign up at plausible.io, add `yourinplace.com` as a site. Script tag is already in index.html.
- [ ] **Google OAuth setup on Railway:** Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars (requires Google Cloud Console setup — it's free)
- [ ] **Upgrade to Google Maps geocoding:** Swap Nominatim → Google Maps for better residential accuracy when ready for production
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
- [ ] **Video chat — Meet link in messages (v1):** "Video Call" button in message thread header generates a Google Meet link and sends it as a special message type (rendered as a clickable card, not plain text). Both parties get a push notification with "Join Video Call" action. Upgrade path to embedded Daily.co later if usage warrants it.
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
- [ ] **Remove all Uber references:** Reword any "Uber for X" comparisons in CLAUDE.md and SplashPage.js (The Problem section). Replace with language that describes what InPlace does without inviting the comparison.
- [ ] **Floating feedback button (v1.6.1):** Add a persistent, always-visible feedback button that floats on every screen (all roles). Tapping it opens a feedback form where users can submit comments, bug reports, feature requests, or general impressions.
  - **Button placement:** Fixed-position floating action button (FAB) in the bottom-right corner, above the mobile bottom nav on small screens. Subtle but always accessible — small circular button with a speech bubble or lightbulb icon. Doesn't block content.
  - **Feedback form:** Modal/drawer that opens on tap. Fields: (1) Category — dropdown: Bug Report, Feature Request, General Feedback, Complaint, Praise. (2) Description — free text area (required, 10+ chars). (3) Mood — optional emoji row (😊 🙂 😐 😟 😡) for quick sentiment. (4) Screenshot — optional "attach screenshot" button (reuse existing image upload pattern). (5) Page context — auto-captured: current page/tab, user role, app version, timestamp, device info (mobile vs desktop).
  - **Backend:** New `feedback` table: `id TEXT PK, user_id TEXT FK, category TEXT, description TEXT, mood TEXT, screenshot TEXT (base64), page_context TEXT (JSON), status TEXT DEFAULT 'new', admin_notes TEXT, created_at TIMESTAMPTZ`. New routes: POST `/api/feedback` (any authenticated user), GET `/api/feedback` (admin only — paginated, filterable by category/status/date), PUT `/api/feedback/:id` (admin — update status and notes).
  - **Admin review panel:** New "Feedback" tab in AdminPanel.js. Shows all submissions in a sortable table with columns: date, user, category, mood, status, preview. Click to expand full detail + screenshot. Status workflow: New → Reviewed → Planned → Done → Dismissed. Admin can add internal notes. Filter by category, status, date range.
  - **Feedback binning/triage:** Admin can tag feedback as "bug", "feature", "ux", "content", etc. Group similar feedback items together. When enough feedback clusters around a theme, it informs the next dev batch. This is the review-and-confirm step before anything becomes a task.
  - **Notifications:** When feedback is submitted, push notification to admin (peterjslee@gmail.com). Optional: email digest of new feedback (daily or weekly).
  - **Privacy:** Feedback is visible only to admins. Users can see their own past submissions (optional "My Feedback" section in MyAccount). No user-to-user visibility.
  - **Implementation:** New component `FeedbackButton.js` (FAB + modal), new route file `src/routes/feedback.js`, new table in `database.js`, new tab in `AdminPanel.js`. Wire FAB into `app.js` so it renders on every page for authenticated users.


## Pete's Action Items (External Setup)

> Things only Pete can do — account signups, API keys, config. These unblock dev tasks above. Check them off as you go.

- [ ] **Stripe: Add API keys to Railway.** You've created a Stripe account. Now go to Stripe Dashboard → Developers → API keys. Copy the **Secret key** and **Publishable key**. In Railway dashboard, add env vars: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`. (Use test-mode keys first — they start with `sk_test_` and `pk_test_`.) This unblocks: background check payment during caregiver onboarding + future Stripe Connect marketplace payments.
- [ ] **Checkr: Sign up and get API key.** Go to [checkr.com](https://checkr.com) and sign up for a partner/platform account. You'll get a `CHECKR_API_KEY`. Add it to Railway env vars. This unblocks: actually running background checks during caregiver onboarding. (Checkr has a sandbox/test mode for development.)
- [ ] **Stripe: Decide background check price.** What should caregivers be charged for the background check? Checkr's basic check runs ~$25–$35. Do you want to pass cost through at-cost, mark up, or subsidize? Claude needs this number to build the payment step.
- [ ] **Plausible Analytics: Sign up at plausible.io.** Add `yourinplace.com` as a site. The script tag is already in index.html — just needs the account created.
- [ ] **Google OAuth: Set up in Google Cloud Console.** Create OAuth 2.0 credentials (it's free). Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to Railway. This enables "Sign in with Google" (backend already built).
- [ ] **Google Maps API key (optional, later).** When you want better residential geocoding than Nominatim/OpenStreetMap, get a Google Maps API key. Swap is a one-function change in `src/utils/geocode.js`.


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


## Demo Credentials

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Care Team | pete@inplace.care | inplace123 | Primary — manages Betty's care |
| Caretaker | maria@inplace.care | inplace123 | Assigned to Betty + 1 other family |
| Cared-For | betty@inplace.care | inplace123 | Limited view, controlled by Pete |

> David (david.lee@inplace.care) and Susan (susan.lee@inplace.care) still exist in the database with messages and sessions, but are hidden from the demo picker and banner switcher as of v1.3.6.


## Done

### Calendar Unification & Care Requests (v1.4.1)
- [x] **CaregiverCalendar query fix:** Changed `?start=X&end=Y` to `?from=X&to=Y` so Maria's bookings load correctly.
- [x] **Admin invite auto-search:** useEffect triggers search when switching to invites tab from waitlist with pre-filled email.
- [x] **CaretakerHub earnings overhaul:** Earnings tab fetches completed sessions from API, shows itemized breakdown table (date, client, service, hours, amount).
- [x] **AvailabilityTab rewrite:** Replaced weekly hourly grid with month calendar view matching Schedule.js. Day-click editing for availability rules.
- [x] **CaredForView rewrite:** Betty's calendar is now a real month calendar. Pink = seeking help, Blue = confirmed. "Request Care" form on day click.
- [x] **Care request system:** `status='requested'` sessions, POST /api/sessions/request, PUT /api/sessions/:id/claim with WebSocket notifications.
- [x] **CaregiverCalendar care requests:** Pink cells for care requests in weekly grid, "Accept" button in day detail panel.
- [x] **Seed data:** 4 care request sessions for Betty (Feb 22, 26, Mar 1, Mar 4).

### Admin Invites & Caregiver Onboarding (v1.4.0)
- [x] **Admin invite system:** Admin panel "Invites" tab — search any email across users/waitlist/invites, send branded invitation emails via Resend, track invite status.
- [x] **Platform invites table:** `platform_invites` table with token-based accept flow, 7-day expiry.
- [x] **Caregiver onboarding wizard:** `CaregiverOnboarding.js` — 5-step wizard for new caregiver registration.
- [x] **Waitlist-to-invite flow:** Click "Invite" on any waitlist entry → auto-populates invite tab with their email.

### Availability Engine & Scheduling UX (v1.3.7–v1.3.9)
- [x] **Maria earnings bump:** Rate $28→$34/hr, ~19 past completed sessions (~$3,890 monthly), 8-hour days for calendar saturation.
- [x] **Availability rules engine:** New `availability` table with CRUD, `computeAvailableSlots()`, backend validation on booking.
- [x] **CaretakerHub Availability tab:** Weekly grid with color-coded cells, rule management modals.
- [x] **CaregiverCalendar component:** Weekly calendar with availability overlay (green/blue/red/gray), hour-by-hour grid, week navigation.
- [x] **API-driven scheduling modals:** RequestCareModal and CaregiverScheduleModal fetch real availability instead of hardcoded data.

### Demo Mode UX & PWA Fixes (v1.3.1–v1.3.6)
- [x] **Demo mode banner (v1.3.1):** DemoModeBanner component with account switcher chips and "Exit Demo" button. Sidebar logout says "Exit Demo" in demo mode. Email verification banner suppressed for demo users.
- [x] **Splash cleanup (v1.3.2):** Removed "Dev Login" section, demo credential hints from hero and working product CTA. Added auto-restore guard that clears demo tokens on page refresh.
- [x] **Demo token fix (v1.3.3):** Demo login now stores JWT in memory only (`AUTH_TOKEN` variable) — never persists to localStorage. Prevents auto-login on revisit.
- [x] **Production DB fixes (v1.3.4):** Backfilled `is_demo = 1` for all demo accounts in production (they had `is_demo = 0` because they were seeded before the column existed). Added Leaflet CSS + JS CDN to index.html (maps were broken without it).
- [x] **PWA icons (v1.3.5):** Regenerated all icons at 8 sizes (48, 72, 96, 128, 144, 192, 384, 512px) for both regular and maskable variants. Updated manifest.json with 16 icon entries. Cache-busted SW registration (`/sw.js?v=X.Y.Z`). Added 32px favicon.
- [x] **Demo simplification (v1.3.6):** Removed David Lee and Susan Lee from demo picker page and demo banner switcher. Demo now shows 3 personas: Pete (family), Maria (caregiver), Betty (care recipient). David/Susan data remains in DB for message history.
- [x] **Admin auto-migration:** `is_admin = 1` auto-set for `peterjslee@gmail.com` on every server start via migration in database.js.

### Caregiver Search & Location (v1.2.0)
- [x] **Geocoding utility:** `src/utils/geocode.js` — Nominatim geocoder with documented Google Maps swap path (one function body change). `haversineDistance()` for radius filtering. `buildAddressString()` helper.
- [x] **Location-based caregiver search API:** `GET /api/caregivers` now accepts `lat`/`lng`/`radius`/`address` params. Returns distance from search center, sorted by proximity. `GET /api/caregivers/nearby/:recipientId` finds caregivers near a care recipient.
- [x] **Auto-geocoding:** Caregiver profile create/update and care recipient create/update both auto-geocode address → lat/lng via Nominatim.
- [x] **Caregivers "Find Nearby" tab:** Address/zip search input, radius selector (5-50 mi), integrated Leaflet map with caregiver pins + radius circle, distance badges on caregiver cards.
- [x] **AreaMap real coordinates:** Caregiver AreaMap now uses real lat/lng from API instead of hardcoded demo offsets. Service radius circle overlay, click-to-fly-to cards.
- [x] **Browse All tab upgrade:** Cards now show bio, specialties, background check badges, and location info.

### Splash Page Rework (v1.1.1)
- [x] **Splash layout rearranged:** Pitch content (Problem, Solution, Market, Business Model, Personal Story, Vision, Working Product CTA) all higher up; audience sections (For Family, For Care Recipients, For Caregivers) grouped chronologically near the bottom.
- [x] **For Caregivers styling fixed:** Hero button now matches siblings (white text, transparent bg). Section label color changed to teal (`#1b6b5a`) to match other audience sections.
- [x] **Dev Login button:** One-click login buttons for all 5 demo accounts added above footer. Calls `/api/auth/login` directly and navigates to dashboard. Cache version v1.1.1.

### Group Messaging & Calendar for Real Users (v1.1.0)
- [x] **Phase 3 — Group Messaging:** New `conversations` and `conversation_members` tables. `conversation_id` column on messages. Full backend rewrite of `/api/messages` with conversation-centric endpoints (list, create, get messages, send). Legacy backward compatibility with auto-migration. Auto-created care team conversations on care recipient creation and invite acceptance. Frontend Messages.js rewrite with conversation list (direct + group), group chat with sender names, contact picker, group creation flow. WebSocket events include `conversationId`. Seed data: 5 direct conversations, 1 care team conversation with 6 group messages.
- [x] **Phase 5 — Calendar for Real Users:** RequestCareModal 4-step wizard for real users (skips caregiver matching), `status: 'open'` for open care requests. Schedule.js empty state with "Request Care" CTA, `open` status badge. Sessions route accepts `open` status. Cache version v1.1.0.

### Auth Foundation & Care Teams (v1.0.0)
- [x] **Phase 1 — Auth Foundation:** Google OAuth backend (Passport.js + passport-google-oauth20), TOTP 2FA (otplib + qrcode), "Remember This Device" (trusted_devices table, 30-day trust), temp password & forced change, demo mode isolation (is_demo flag, redesigned LoginPage), enhanced MyAccount (Profile | Security | Devices | Notifications tabs), TwoFactorSetup wizard component. 3 new DB tables: oauth_accounts, user_2fa, trusted_devices. 4 new npm packages.
- [x] **Phase 2 — Care Teams:** 3 new DB tables (care_teams, care_team_members, care_team_invites). Full /api/care-teams CRUD with email invite flow (branded Resend email, 7-day token, handles existing + new users). Auto care team creation on care recipient add. CareTeamManage.js (member management, invite/resend/cancel, role changes). CareTeamPage.js (team listing, auto-select). Dashboard onboarding checklist (4 steps for non-demo users). Dynamic greeting. Invite token URL handling (?invite=TOKEN). Seed data with 3 care teams. Cache version v1.0.0.

### Real-Time WebSocket Updates & Visit Photos (v0.9.0)
- [x] **Real-Time WebSocket Updates:** Socket.io integration with JWT-authenticated connections. Live message delivery (`new_message`), session status changes (`session_update`), activity feed updates (`activity_update`), and photo uploads (`visit_photos`). Connected users tracked in server-side Map. Frontend WebSocket manager with `connectSocket()`, `disconnectSocket()`, `onSocketEvent()`. Auto-connect on login and page load, auto-disconnect on logout. Dashboard, ActivityFeed, Messages, and CaretakerHub all listen for real-time events.
- [x] **Visit Photo Uploads:** Multer-based file upload (5MB limit, image-only, max 5 per visit). Base64 storage in PostgreSQL `visit_photos` table. New `/api/photos` route with upload, retrieval by visit log ID and session ID. Caregiver photo upload UI in CaretakerHub visit log modal with preview thumbnails. Family-side photo viewer in ActivityFeed with expandable thumbnails and full-size lightbox modal.
- [x] **Splash Page Cache-Bust Fix:** Previous deploy (v0.8.0) failed silently on Railway due to `package-lock.json` out of sync. Fixed by regenerating lock file. Cache-bust version bumped to v0.9.0 in index.html and sw.js.
- [x] **Infrastructure:** Socket.io CDN added to index.html. 2 new npm dependencies (socket.io, multer). 1 new route file (photos.js). `http.createServer` wrapper for Express+Socket.io. Cache bumped to v0.9.0. 53 tests passing.

### Analytics, Push Notifications & Shared Care Recipients (v0.8.0)
- [x] **Family Dashboard Analytics:** New `/api/analytics` endpoint with 6-month historical data (sessions, hours, spend per month), service type breakdown, and caregiver utilization stats. Frontend Analytics page with SVG bar charts (hours/spend/sessions monthly trends), donut chart for service types, caregiver utilization horizontal bars, summary stat cards. Tab switcher for different views.
- [x] **Push Notifications:** `web-push` VAPID keys, `push_subscriptions` table, subscribe/unsubscribe API at `/api/push`. Service worker `push` + `notificationclick` event handlers. Push triggered on new messages with sender name and content preview. Frontend `subscribeToPush()` helper auto-subscribes on login.
- [x] **Shared Care Recipients:** `care_recipient_shares` table with owner/edit/view permission levels. `hasAccess()` helper in careRecipients route. Share/unshare API endpoints on `/api/care-recipients/:id/share`. Dashboard includes shared recipients. Seed shares Betty with David & Susan (edit permission).
- [x] **Infrastructure:** 2 new database tables (push_subscriptions, care_recipient_shares), 2 new route files (analytics.js, push.js), 1 new component (Analytics.js). Cache bumped to v0.8.0. 53 tests passing.

### Recurring Sessions (v0.7.0)
- [x] **Recurring session booking:** Weekly and biweekly repeating care sessions. `recurrence_rule` and `recurrence_group_id` columns on care_sessions. `generateRecurringDates()` helper. POST /api/sessions creates multiple linked sessions. DELETE /api/sessions/recurring/:groupId cancels future sessions in a series.
- [x] **Recurring UI:** RequestCareModal step 2 has One-time / Weekly / Every 2 weeks toggle + weeks selector (2-12). Review step shows recurrence summary. Schedule shows 🔁 badge on recurring session cards.
- [x] **Expanded validation:** validateSession now accepts all frontend service types (companionship, personal_care, meal_prep, transportation, health_wellness, full_day) and validates recurrence fields. 8 new tests (53 total).

### Email Verification & Tests (v0.6.2)
- [x] **Centralized email utility:** New `src/utils/email.js` with `sendEmail()` and `brandedHtml()`. All routes (auth, password reset, waitlist) now use shared utility. Sandbox mode detection with clear warnings. FROM_EMAIL env var support for verified domain senders.
- [x] **Email verification flow:** Verification email sent on registration. `email_verification_tokens` table with 24h expiry. GET /api/auth/verify?token=xxx validates and marks user verified. POST /api/auth/resend-verification sends new email. Frontend: ?verify= URL handling, dismissable success/error banner, EmailVerificationBanner component for unverified users.
- [x] **Test suite:** Jest + supertest with mock database layer (no PostgreSQL needed). 45 tests across 4 suites: auth routes (register, login, profile, email verification), waitlist routes, health/API endpoints, middleware (auth tokens, role checks, validation). `npm test` script added.

### Production Hardening (v0.6.1)
- [x] **Calendar heat map stale bug:** Added `key={currentPage}` to all page components in renderPage(), forcing full React remount on navigation. Fixes blank calendar on tab switch.
- [x] **Input validation:** New `src/middleware/validate.js` with validators for register, login, profile update, messages, sessions. Email format, password strength (8-128 chars), phone format, string length limits, input sanitization (trim + null byte removal).
- [x] **Rate limiting:** `express-rate-limit` — auth endpoints (20 attempts per 15 min), general API (120 req/min). JSON body size limit (100KB).

### PWA Android Fix & Email Domain (v0.7.2)
- [x] **PWA Android installability fix:** Split manifest icon `purpose: "any maskable"` into separate entries. Created dedicated maskable icons (full-bleed, no rounded corners) for Android's adaptive icon system. Added `id: "/"` to manifest. Cache bumped to v0.7.2.
- [x] **Resend domain verification:** DKIM + SPF DNS records added in Cloudflare for yourinplace.com. Domain verified in Resend dashboard. Production email now sends from `noreply@yourinplace.com`.
- [x] **FROM_EMAIL env var on Railway:** Set `FROM_EMAIL=noreply@yourinplace.com` so all transactional emails (verification, password reset, waitlist) use the verified domain sender.

### PWA & Mobile Polish (v0.6.0)
- [x] **PWA add-to-homescreen:** Web app manifest, service worker (cache-first for static, network-first for API), install banner with `beforeinstallprompt`, offline indicator, Apple meta tags. Icons: 192x192, 512x512, apple-touch-icon.
- [x] **Mobile touch polish:** 44px minimum tap targets, `font-size: 16px` to prevent iOS auto-zoom, `viewport-fit=cover` for notched phones, `display-mode: standalone` CSS adjustments, 2-column stats grid on mobile, single-column info-grid.
- [x] **Sibling logins:** David Lee (david.lee@inplace.care) and Susan Lee (susan.lee@inplace.care) added as family users. Both can see Betty's care, have caregiver assignments, sessions, messages, and activity feed items. Quick-login buttons on LoginPage.

### Demo Polish (v0.5.3)
- [x] **Loading spinners & empty states:** Animated CSS spinner on every page during API fetches. Empty-state illustrations with helpful messages when no data exists. Consistent pattern across Dashboard, CareProfile, Schedule, Caregivers, Activity Feed, Messages, CareRecipients, MyAccount, CaretakerHub, CaredForView.
- [x] **Toast notifications:** Global toast notification system (success/error/info). ToastProvider wraps the app, `useToast()` hook available in all components. Toasts for profile saves, caregiver assign/unassign, mark-all-read, recipient save, notification prefs. Auto-dismiss after 3.5s, mobile-friendly positioning.
- [x] **MyAccount persistence:** PUT /api/auth/me endpoint for updating profile (name, phone) and notification preferences. MyAccount page now has Edit Profile mode with inline form. Notification toggles auto-save to database. New `notification_prefs` column on users table.

### Onboarding & Mobile (v0.5.1–v0.5.2)
- [x] **Wire registration to API:** RegisterPage handleComplete() now calls POST /api/auth/register, auto-logs in on success, shows inline errors. Both family and caregiver tracks supported.
- [x] **Password reset flow:** ForgotPasswordPage + ResetPasswordPage components. New password_reset_tokens table. POST /api/password-reset/request sends branded email via Resend. POST /api/password-reset/confirm validates token and updates password. "Forgot password?" link on login page.
- [x] **Mobile bottom navigation:** Replaced hamburger sidebar with fixed bottom nav bar on screens ≤768px. Role-aware icons (Home, Schedule, Care, Messages, More). Safe-area padding for notched phones. Desktop sidebar unchanged.

### PostgreSQL Migration (v0.5.0)
- [x] **PostgreSQL on Railway:** Replaced SQLite with PostgreSQL via `pg` library. Custom query wrapper auto-converts `?` to `$1, $2, ...` placeholders. All 10 route files updated with async/await + PostgreSQL datetime syntax. Data persists across deploys.
- [x] **Waitlist email notifications:** Resend HTTP API sends notification email when someone joins the waitlist.
- [x] **MyAccount shows real user data:** MyAccount page now displays logged-in user's actual data instead of hardcoded values.
- [x] **Caregiver recruitment on splash:** Added "For Caregivers" section to the splash page.
- [x] **Registration wizard improvements:** Back navigation between steps + form validation on all fields.

### Mobile Sidebar (v0.4.2)
- [x] **Responsive hamburger menu:** Sidebar collapses to hamburger overlay on mobile screens.

### Schedule Fix (v0.4.1)
- [x] **Restored calendar heat map:** Full 294-line Schedule.js with calendar grid, saturation shading, and session detail panel was accidentally replaced during rebrand sync. Restored from git history.

### Rebrand & Cache Fix (v0.4.0)
- [x] **KinCare → InPlace rebrand:** All user-facing text, emails (@inplace.care), passwords (inplace123), DB filename (inplace.db), JWT secrets, component names (InPlaceIcon), package metadata. 26 files changed.
- [x] **Cache-busting for Cloudflare:** Added `?v=0.4.0` to all JS/CSS fetches in index.html. Fixes stale cached files after deploys behind Cloudflare proxy.
- [x] **Login fix after rebrand:** DB auto-reseeds with new InPlace credentials on deploy since DB filename changed.

### Waitlist & Splash Updates (v0.3.3)
- [x] **Email capture / waitlist:** "Get Early Access" form on splash page. Writes to `waitlist` table via `/api/waitlist` (no auth). Dedupes by email, shows success/already-exists messages inline. Public `/api/waitlist/count` endpoint.
- [x] **Splash page stat corrections:** Fixed to match elevator pitch — 63M caregivers, $200B market, 11,200 boomers/day.
- [x] **Center-justified stat bubbles:** All card grids use flexbox centering so orphan items don't sit left-aligned.

### Splash Page Redesign (v0.3.2)
- [x] **Investor pitch landing page:** Rewrote splash page to read like an elevator pitch — market stats ($200B, 63M, 11.2K boomers/day), problem/solution framing, business model (20% commission, $45-85 sessions), personal story, vision (operating system for aging in place), Unsplash photos of seniors at home.

### Batch 2: UI & Scheduling (v0.3.1)
- [x] **Multiple emergency contacts:** CRUD for emergency contacts on care profiles. Betty has 4: Pete (primary), Susan Lee-Park, David Lee, Dr. Anita Sharma. Add/edit/delete inline.
- [x] **Calendar view with saturation shading:** Month grid with teal heat map based on care hours. Legend, month navigation, summary bar.
- [x] **Favorite caretakers:** Favorites sort first in booking matching. Dashboard shows star next to favorite caregivers.
- [x] **Grey out past appointments:** Past dates muted on calendar, clickable for full detail (cost, notes, caregiver rating).

### Batch 1: Role Foundation (v0.3.0)
- [x] **Three user roles in UI:** Care Team (Pete), Caregiver (Maria), Care Recipient (Betty). Role-based sidebar navigation, dashboards, and page routing.
- [x] **Maria login (caretaker view):** Full caregiver dashboard with schedule, families, earnings, reviews. Area Map as standalone sidebar page with real Leaflet/OpenStreetMap + family pins.
- [x] **Betty login (cared-for view):** Calendar of upcoming sessions + personal notes section (CRUD). Limited sidebar with Home, Messages, Account.
- [x] **Assigned caregivers clickable:** Dashboard "Assigned Caregivers" card links to Caregivers page. Assign/unassign/favorite toggle all work.
- [x] **Messaging groundwork:** Database-backed messages table, conversations API, real send/receive between Pete, Maria, Betty. Messages page fully wired.

### Frontend Modularization (v0.2.0)
- [x] Split monolithic index.html (3,900 lines) into 17 modular files with zero-build-step CDN approach.
