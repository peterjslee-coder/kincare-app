# InPlace Development Roadmap

## Guiding Principles

1. **Ease of change first** — Every structural decision should make the next change cheaper and safer. Modular files, clear naming, separated concerns.
2. **Expand future capabilities** — Build the foundation (validation, tests, real-time) that makes advanced features possible without rewrites.
3. **Demo-ready at all times** — The deployment at `https://yourinplace.com` must always work as a polished demo for investors and employees. No broken deploys.

---

## Completed

### v0.1.0 — Initial Release (2026-02-15)
- Express API with JWT auth (register, login, profile)
- SQLite database with 10-table schema
- Care recipient CRUD, caregiver search, session booking with matching
- Session status lifecycle (pending → confirmed → in-progress → completed)
- Visit logs, activity feed, dashboard
- Demo seed data (Pete + Betty + 4 caregivers)
- Railway.app deployment
- Frontend SPA (monolithic) with splash, login, registration, 9 sidebar pages

### v0.2.0 — Frontend Modularization (2026-02-15)
- Split monolithic index.html (3,900 lines) into 17 modular component files
- Zero-build-step CDN approach preserved (Babel standalone)
- CLAUDE.md + ROADMAP.md added

### v0.3.0 — Role Foundation (Batch 1)
- Three user roles: Care Team (Pete), Caregiver (Maria), Care Recipient (Betty)
- Maria login with full caregiver dashboard, area map (Leaflet/OpenStreetMap)
- Betty login with calendar view and personal notes
- Database-backed messaging (send/receive between all users)
- Caregiver assignments with favorite toggle
- 6 new backend routes: messages, notes, assignments, emergencyContacts, plus schema additions

### v0.3.1 — UI & Scheduling (Batch 2)
- Calendar heat map with teal saturation shading by care hours
- Emergency contacts CRUD on care profiles
- Favorite caretakers sort first in booking
- Past appointments greyed out, clickable for detail

### v0.3.2 — Investor Pitch Splash Page
- Full splash page rewrite as elevator pitch
- Market stats ($200B, 63M caregivers, 11.2K boomers/day)
- Problem/solution framing, business model, personal story, vision section

### v0.3.3 — Waitlist & Polish
- Email capture form on splash page (waitlist table + API)
- Stat corrections to match elevator pitch
- Centered stat bubbles (flexbox layout fix)

### v0.4.0 — InPlace Rebrand
- Full rebrand from KinCare to InPlace (26 files)
- New domain: yourinplace.com (Cloudflare DNS)
- New logo: "iP" monogram in rounded teal square
- Cache-busting system for Cloudflare proxy (`?v=X.Y.Z` on all JS/CSS fetches)

### v0.4.1 — Schedule Fix
- Restored calendar heat map (accidentally lost during rebrand sync)

### v0.4.2 — Mobile Sidebar
- Responsive hamburger menu sidebar for mobile screens
- Sidebar collapses to overlay on narrow viewports

### v0.4.3 — Notifications & Polish (2026-02-16)
- Waitlist email notifications via Resend HTTP API
- MyAccount page now displays actual logged-in user data (was showing hardcoded)
- Caregiver recruitment section added to splash page
- Registration wizard: back navigation between steps + form validation

### v0.5.0 — PostgreSQL Migration (2026-02-17)
- Replaced SQLite with PostgreSQL (pg library + connection pooling)
- Custom query wrapper: auto-converts `?` placeholders to `$1, $2, ...` for PostgreSQL compatibility
- All 10 route files updated with `await` on every DB call + PostgreSQL datetime syntax
- Seed runs in-process on empty database (no child process needed)
- Railway Postgres service wired via `${{Postgres.DATABASE_URL}}`
- Data now persists across deploys — no more losing accounts/sessions on redeploy

### v0.5.1 — Onboarding (2026-02-17)
- Registration wizard wired to POST /api/auth/register (both family and caregiver tracks)
- Auto-login on successful registration, inline error display on failure
- Password reset flow: ForgotPasswordPage → email via Resend → ResetPasswordPage
- New `password_reset_tokens` table with 1-hour expiry
- "Forgot password?" link on login page

### v0.5.2 — Mobile Bottom Navigation (2026-02-17)
- Bottom nav bar replaces hamburger sidebar on mobile (≤768px)
- Role-aware nav items: Home, Schedule, Care, Messages, More (family); Home, Schedule, Messages, Account (caregiver); Home, Messages, Account (care recipient)
- Safe-area padding for notched phones (iPhone X+)
- Desktop sidebar completely unchanged

### v0.5.3 — Demo Polish (2026-02-17)
- Loading spinners: Animated CSS spinner component on all pages during API fetches
- Empty states: Friendly messages and icons when no data exists (activity feed, caregivers, etc.)
- Toast notifications: Global success/error/info toasts with auto-dismiss. ToastProvider + useToast hook.
- MyAccount persistence: PUT /api/auth/me endpoint for profile edits (name, phone) and notification preferences
- MyAccount edit mode: Inline form with Cancel/Save, auto-saving notification toggles

### v0.6.0 — PWA & Mobile Polish (2026-02-17)
- PWA manifest, service worker (cache-first static, network-first API), offline fallback
- Install banner (`beforeinstallprompt`) + offline indicator
- Icons: 192x192, 512x512, apple-touch-icon (180x180)
- Apple meta tags (mobile-web-app-capable, status-bar-style)
- Mobile touch polish: 44px min tap targets, font-size 16px (no iOS zoom), viewport-fit cover
- `display-mode: standalone` CSS adjustments for installed PWA
- Sibling logins: David Lee + Susan Lee as family users with Betty care, sessions, assignments, messages
- Quick-login buttons for siblings on LoginPage

### v0.6.1 — Production Hardening (2026-02-17)
- Calendar heat map stale bug fixed (`key={currentPage}` on all page components)
- Input validation middleware: email format, password strength, phone format, length limits, sanitization
- Rate limiting: auth endpoints (20/15min), general API (120/min)
- JSON body size limit (100KB)
- Validators wired to: register, login, profile update, messages, sessions

### v0.6.2 — Email Verification & Tests (2026-02-17)
- Centralized email utility (`src/utils/email.js`) — all routes use shared `sendEmail()` + `brandedHtml()`
- Sandbox mode detection: warns when using `onboarding@resend.dev` (can only deliver to account owner)
- `FROM_EMAIL` env var support — set to `noreply@yourinplace.com` after domain verification in Resend dashboard
- Email verification on registration: token generated, email sent, 24h expiry
- `email_verification_tokens` table + `email_verified` / `email_verified_at` columns on users
- GET /api/auth/verify?token=xxx — validates token, marks user verified
- POST /api/auth/resend-verification — authenticated, sends new verification email
- Frontend: `?verify=` URL handling in app.js, EmailVerificationBanner component for unverified users
- Test suite: Jest + supertest, 45 tests across 4 suites (auth, waitlist, health, middleware)
- Mock database layer for tests — no PostgreSQL needed to run `npm test`
- Server.js refactored: `require.main === module` guard so tests don't auto-listen

### v0.7.1 — Messages Redesign & Mobile Polish (2026-02-17)
- Complete Messages redesign: iMessage/WhatsApp-style UI with conversation list → chat → back
- Mobile-first: shows either conversation list or chat (not both side-by-side on phones)
- "New Message" button (+) with contacts endpoint to start chats with anyone in care network
- Colored avatar initials, unread badges, relative timestamps, SVG send button
- "For Caregivers" splash section: responsive grid, warmer caregiver photo
- Photo strip, personal story, hero section: all responsive on mobile
- PWA "Install App" button in splash nav with iOS-specific Share instructions

### v0.8.0 — Analytics, Push Notifications & Shared Care Recipients (2026-02-17)
- Family Dashboard Analytics: SVG bar charts (hours/spend/sessions monthly trends), donut chart for service type breakdown, caregiver utilization bars
- New `/api/analytics` endpoint with 6-month historical data, service breakdown, caregiver stats
- Push notifications: `web-push` VAPID keys, `push_subscriptions` table, subscribe/unsubscribe API, SW push + notification click handlers
- Push triggered on new messages (with sender name + preview)
- Shared care recipients: `care_recipient_shares` table, share/unshare API endpoints on `/api/care-recipients/:id/share`
- Owner/edit/view access levels — shared users see recipients on dashboard and can edit with permission
- Seed shares Betty with David & Susan (siblings now see the same Betty record)
- Analytics page added to sidebar for family users
- Cache version bumped to v0.8.0

### v0.7.2 — PWA Android Fix & Email Domain (2026-02-17)
- Fixed PWA not appearing on Android home screen after install
- Split manifest icon `purpose: "any maskable"` into separate entries (Chrome requires distinct icons)
- Created dedicated maskable icons (full-bleed, no rounded corners) for Android adaptive icon system
- Added `id: "/"` to manifest for stable PWA identity across sessions
- Resend domain verification: DKIM + SPF DNS records added in Cloudflare, domain verified
- Production email now sends from `noreply@yourinplace.com` (was sandbox-only `onboarding@resend.dev`)
- `FROM_EMAIL` env var set on Railway
- Cache version bumped to v0.7.2

### v0.7.0 — Recurring Sessions (2026-02-17)
- Weekly and biweekly recurring care session booking
- `recurrence_rule` and `recurrence_group_id` columns on `care_sessions` table
- `generateRecurringDates()` helper generates session dates at weekly/biweekly intervals
- POST /api/sessions creates multiple sessions with shared `recurrence_group_id` for recurring bookings
- DELETE /api/sessions/recurring/:groupId cancels all future pending/confirmed sessions in a series
- RequestCareModal step 2: One-time / Weekly / Every 2 weeks toggle + weeks selector (2-12)
- Schedule calendar: 🔁 Weekly / 🔁 Biweekly badge on recurring session cards
- Expanded service types in validation (companionship, meal_prep, transportation, health_wellness, full_day)
- Test suite expanded to 53 tests (8 new session validation tests including recurrence)

### v0.9.0 — Real-Time WebSocket Updates & Visit Photos (2026-02-18)
- Socket.io WebSocket server with JWT-authenticated connections
- Real-time events: `new_message`, `session_update`, `activity_update`, `visit_photos`
- Connected users tracked server-side (`Map<userId, Set<socketId>>`) with `emitToUser()` helper
- Frontend WebSocket manager: `connectSocket()`, `disconnectSocket()`, `onSocketEvent()` in utils.js
- Auto-connect on login and page load, auto-disconnect on logout
- Dashboard, ActivityFeed, Messages, CaretakerHub all listen for real-time events
- Visit photo uploads via Multer (memory storage, 5MB limit, image-only, max 5 per visit)
- Base64 photo storage in PostgreSQL `visit_photos` table
- New `/api/photos` route: upload by visit log ID, retrieve by visit log or session
- Caregiver photo upload UI in CaretakerHub visit log modal with preview thumbnails
- Family-side photo viewer in ActivityFeed with expandable thumbnails and lightbox modal
- Socket.io CDN added to index.html, 2 new npm deps (socket.io, multer)
- `http.createServer` wrapper for Express + Socket.io
- Cache version bumped to v0.9.0
- Fixed silent Railway build failure from v0.8.0 (package-lock.json out of sync)

### v1.0.0 — Auth Foundation & Care Teams (2026-02-18)

**Phase 1: Auth Foundation — Real Accounts & Security**
- Google OAuth Sign-In backend: Passport.js + passport-google-oauth20, `oauth_accounts` table, GET /api/auth/google + callback routes, auto-link existing accounts by email
- TOTP Two-Factor Authentication: `otplib` + `qrcode`, `user_2fa` table, setup/verify-setup/verify/disable/backup-codes routes with rate limiting (5 attempts/15min)
- "Remember This Device" flow: `trusted_devices` table, device fingerprint (user-agent + screen + timezone hash), 30-day trust with skip-2FA on recognized devices
- Temp password & forced password change: `must_change_password` flag on users, POST /api/auth/change-password endpoint
- Demo mode isolation: `is_demo` flag on users, LoginPage redesigned with clean form + "Try Demo" toggle, demo accounts separated from real login
- Enhanced MyAccount: Tabbed interface (Profile | Security | Devices | Notifications), change password, enable/disable 2FA with TwoFactorSetup wizard, trusted device management
- Lazy-loaded otplib/qrcode to avoid Jest ESM parsing issues

**Phase 2: Care Teams — Family Coordination**
- New tables: `care_teams`, `care_team_members`, `care_team_invites` + `linked_user_id` migration on `care_recipients`
- Full care team CRUD: `/api/care-teams` with list, detail, update name, invite, resend/cancel invite, accept invite (token-based), remove/change-role members
- Auto care team creation: Adding a care recipient auto-creates a care team with the creator as leader
- Email invite flow: Branded Resend email with 7-day token URL, handles existing + new users, backward-compatible with `care_recipient_shares`
- CareTeamManage.js: Member list with role badges, invite form (email + role), resend/cancel invites, remove/change roles
- CareTeamPage.js: Team listing with auto-select for single-team users, empty state with CTA
- Dashboard onboarding checklist: 4-step getting started guide for non-demo users (profile, recipient, invite family, find caregivers)
- Dynamic dashboard: Greeting uses user's actual first name, care teams summary section
- Invite token URL handling: `?invite=TOKEN` auto-accepted after login
- Seed data: 3 care teams (Betty with 3 members, Dorothy, Arun) with proper leader/member roles
- 53 tests passing, cache version v1.0.0

### v1.2.0 — Caregiver Search & Location (2026-02-18)

**Phase 4: Location-Based Search**
- Geocoding utility (`src/utils/geocode.js`) using OpenStreetMap Nominatim — thin abstraction with documented swap-path to Google Maps (change one function body)
- `haversineDistance()` utility for radius-based filtering in miles
- `GET /api/caregivers` now accepts `lat`, `lng`, `radius`, and `address` query params for location-based search, returns distance from search center
- `GET /api/caregivers/nearby/:careRecipientId` endpoint — find available caregivers near a specific care recipient
- Auto-geocoding on caregiver profile creation/update and care recipient creation/update — address → lat/lng automatically stored
- Caregivers API returns lat/lng, maxTravelMiles, and distance in all caregiver list/detail responses
- Caregivers page: new "Find Nearby" tab with address/zip search input, radius selector (5-50 miles), integrated Leaflet map with caregiver pins, distance badges on results
- AreaMap.js (caregiver view): now uses real lat/lng from API instead of hardcoded demo offsets, service radius circle overlay, click-to-fly-to cards
- Browse All tab: upgraded with bio, specialties, background check badges, and location info
- Leaflet + OpenStreetMap tiles (free, no API key) — designed so tile provider and geocoder are each swappable in one line
- Cache version bumped to v1.2.0, 53 tests passing

### v1.3.0 — Admin Dashboard & Plausible Analytics (2026-02-19)
- `is_admin` column migration on users table, `requireAdmin` middleware in auth.js
- New `src/routes/admin.js` with 4 admin-only endpoints: `/api/admin/stats`, `/api/admin/users` (search/filter/pagination), `/api/admin/waitlist`, `/api/admin/activity`
- Login and GET /me now return `isAdmin` flag in user response
- `AdminPanel.js` frontend component — 4-tab interface: Overview (stat cards + signup/waitlist trend charts + sessions by status), Users (searchable/filterable table with role badges), Waitlist (sortable table with CSV export), Activity (recent registrations, sessions, waitlist signups)
- Sidebar "Admin" link (shield icon) only visible when `user.is_admin === 1`
- Auto-restore user session on page reload: app now calls `/api/auth/me` when a saved token exists in localStorage (previously required re-login)
- Plausible Analytics script tag added to index.html for privacy-friendly site traffic tracking (page views, referrers, geography, no cookies). Admin panel links to Plausible dashboard.
- Demo picker page: "View Live Demo" button on splash now leads to dedicated account picker instead of login page
- CaretakerHub: replaced notional SVG map with real Leaflet/OpenStreetMap AreaMap component
- Cache version bumped to v1.3.0, 53 tests passing

### v1.1.1 — Splash Page Rework (2026-02-18)
- Splash page layout reorganized: pitch content (Problem → Solution → Market → Business Model → Personal Story → Vision → Working Product CTA) all pushed higher; audience sections (For Family, For Care Recipients, For Caregivers) grouped chronologically near the bottom
- "For Caregivers" hero button styling fixed: now matches "For Family" and "For Care Recipients" (white text, transparent bg) instead of orange-tinted outlier
- "For Caregivers" section label color changed from `#e8724a` (orange) to `#1b6b5a` (teal) to match "For Family" and "For Care Recipients"
- Dev Login section added above footer: one-click login buttons for all 5 demo accounts (Pete, David, Susan, Maria, Betty) — calls `/api/auth/login` directly and navigates to dashboard
- Cache version bumped to v1.1.1

### v1.4.1 — Calendar Unification & Care Requests (2026-02-19)
- **CaregiverCalendar query fix:** Changed `?start=X&end=Y` to `?from=X&to=Y` — Maria's bookings now load correctly
- **Admin invite auto-search:** useEffect triggers search when switching to invites tab from waitlist with pre-filled email
- **CaretakerHub earnings overhaul:** Earnings tab fetches completed sessions from API, shows itemized breakdown table (date, client, service, hours, amount)
- **AvailabilityTab rewrite:** Replaced weekly hourly grid with month calendar view (same pattern as Schedule.js). Day cells colored by availability (green) and bookings (blue). Click day → right panel with booked sessions, availability rules with edit/delete, and quick-add button
- **CaredForView rewrite:** Betty's calendar replaced from flat list to full month calendar. Pink (#fce4ec) = seeking help (requested sessions), Blue (#e3f2fd) = confirmed bookings. Click day → session list + "Request Care" form (service type, time, hours, note). Notes tab preserved
- **Care request system:** New `status='requested'` sessions created by care_for role, no caregiver_id. POST /api/sessions/request creates help-wanted sessions. PUT /api/sessions/:id/claim lets caregivers accept. WebSocket notifications to all parties
- **CaregiverCalendar care requests:** Pink cells for care requests in weekly grid. "help needed" labels on column headers. Selected day shows care requests with "Accept" button
- **Seed data:** 4 care request sessions for Betty (Feb 22, 26, Mar 1, Mar 4)
- Cache version bumped to v1.4.1, 53 tests passing

### v1.4.0 — Admin Invites & Caregiver Onboarding (2026-02-19)
- **Admin invite system:** Admin panel 5th tab "Invites" — search any email across users/waitlist/invites, send branded invitation emails via Resend, track invite status (pending/accepted/expired)
- **Platform invites table:** `platform_invites` table with token-based accept flow, 7-day expiry
- **Caregiver onboarding wizard:** `CaregiverOnboarding.js` — 5-step wizard (Welcome → Personal Info → Professional Background → Availability → Review & Submit) for new caregiver registration
- **Admin user management:** Users tab shows all registered users with role badges, search, and admin promotion
- **Waitlist-to-invite flow:** Click "Invite" on any waitlist entry → auto-populates invite tab with their email
- Cache version bumped to v1.4.0, 53 tests passing

### v1.3.7–v1.3.9 — Demo Data & Availability Engine (2026-02-19)

**v1.3.7 — Earnings & Availability**
- Maria's rate bumped to $34/hr, ~19 past completed sessions (~$3,890 monthly), full 8-hour days for calendar saturation
- New `availability` table with `type` (available/blocked), `note` columns, `/api/availability` CRUD with ownership checks
- `computeAvailableSlots()` builds minute-level availability map minus blocked rules minus booked sessions
- CaretakerHub "Availability" tab: weekly grid (6am-8pm, 7 days) with color-coded cells, rule management modals
- RequestCareModal and CaregiverScheduleModal fetch real availability from `/api/availability/:caregiverId/slots`
- Backend validates caregiver availability on session creation

**v1.3.8 — CaregiverCalendar Component**
- New `CaregiverCalendar.js` — weekly calendar with availability overlay (green=available, blue=booked, red=blocked, gray=off)
- Hour-by-hour grid (6am-8pm), week navigation, selected-day detail panel with sessions + availability summary
- Replaces CaretakerHub "Schedule" tab content

**v1.3.9 — Demo Data Polish**
- Additional completed sessions for Maria across multiple families
- Calendar saturation visible in heat map view
- Cache version bumped to v1.3.9

### v1.3.1–v1.3.6 — Demo Mode UX & PWA Fixes (2026-02-19)

**v1.3.1 — Demo Mode Banner**
- Demo mode banner at top of app with account switcher chips (Pete, Maria, Betty) and "Exit Demo" button
- DemoModeBanner component in app.js with inline login/switch logic
- Email verification banner suppressed for demo users (`!currentUser.isDemo`)
- Sidebar logout says "Exit Demo" in demo mode

**v1.3.2 — Splash Cleanup**
- Removed "Dev Login" section at bottom of splash page (40+ lines)
- Removed demo credential hints from hero section and working product CTA
- Added auto-restore guard: if saved token belongs to a demo account, clear and return to splash

**v1.3.3 — Demo Token Fix**
- Demo login now stores JWT in memory only (`AUTH_TOKEN` variable) — never calls `setAuthToken()` which persists to localStorage
- Prevents auto-login on page revisit after viewing demo

**v1.3.4 — Production DB Fixes**
- Backfilled `is_demo = 1` for all 5 demo accounts in production DB (seeded before column existed, all had `is_demo = 0`)
- Added Leaflet CSS + JS CDN to index.html — maps were completely broken without these (AreaMap, Caregivers "Find Nearby" tab)
- Auto-migration: `is_admin = 1` for `peterjslee@gmail.com` on every server start

**v1.3.5 — PWA Icon Overhaul**
- Regenerated all PWA icons at 8 sizes (48, 72, 96, 128, 144, 192, 384, 512px) in both regular and maskable variants
- Updated manifest.json with 16 icon entries for full Android/Chrome compatibility
- Cache-busted service worker registration URL (`/sw.js?v=X.Y.Z`) to force icon refresh on devices
- Added 32px favicon link in index.html

**v1.3.6 — Demo Simplification**
- Removed David Lee and Susan Lee from demo picker page and demo mode banner switcher
- Demo now shows 3 personas: Pete (family), Maria (caregiver), Betty (care recipient)
- David/Susan accounts and their messages/sessions remain in the database for realistic demo data
- Cache version bumped to v1.3.6

### v1.1.0 — Group Messaging & Calendar for Real Users (2026-02-18)

**Phase 3: Group Messaging**
- New tables: `conversations` (type: direct/group/care_team) and `conversation_members` (with `last_read_at` for unread tracking)
- `conversation_id` column added to `messages` table — all messages now belong to a conversation
- Backend rewrite of `/api/messages` with conversation-centric endpoints: list conversations, create conversation (direct/group), get messages by conversation, send to conversation
- Legacy backward compatibility: old partner-based messages auto-migrated to conversations on first new message
- Auto-created care team conversations: adding a care recipient creates a care team chat; accepting an invite auto-joins the chat
- Frontend Messages.js rewrite: conversation list (direct + group), group chat with sender names, "New Message" contact picker, "Create Group" flow with name input
- WebSocket `new_message` events now include `conversationId` and notify all conversation members
- Seed data: 5 direct conversations, 1 care team conversation (Betty's team with Pete, David, Susan), 6 group messages

**Phase 5: Calendar & Care Requests for Real Users**
- RequestCareModal: 4-step wizard for real users (skips caregiver matching step), sends `status: 'open'` for open care requests
- Schedule.js: empty state with "Request Care" CTA button, `open` status badge ("Open — waiting") in orange
- Sessions route: accepts `status: 'open'` for care requests without caregiver, added `open` to valid status transitions
- Cache version bumped to v1.1.0

### v1.5.0–v1.5.7 — Email-First Signup & Caregiver Onboarding Fixes (2026-02-20)

**v1.5.0 — Email-First Signup Flow**
- Replaced direct registration with email-first invite flow: Admin sends invite → caregiver receives branded email → clicks link → lands on onboarding wizard with email pre-filled
- New `signup_tokens` table for invite-to-signup token chain
- POST /api/auth/confirm-signup validates token and routes to role-specific onboarding

**v1.5.1–v1.5.3 — Onboarding Hardening**
- Fixed CaregiverOnboarding step navigation, form validation, and submit flow
- Fixed request body too large for document uploads (skip body size check for multipart)
- Added client-side image resizing (1600px max, JPEG 85%) and mobile-friendly upload buttons

**v1.5.4 — CaretakerHub No-Profile Fix**
- Fixed React hooks order violation crashing CaretakerHub for caregivers with no profile
- Added friendly "Welcome to InPlace!" empty state with "Complete Your Profile" button
- Resume-onboarding flow for existing users who need to finish profile setup

**v1.5.5 — Already-Registered Flow**
- confirm-signup endpoint detects already-registered emails, returns `alreadyRegistered`/`needsProfile` flags
- Frontend redirects to login with info banner instead of showing generic error
- Admin reset-password and delete-user endpoints

**v1.5.6 — Mobile Photo Upload Fix**
- Fixed DL front photo upload not displaying (mobile browsers return empty MIME type for camera captures)
- Accept empty-type files, try-catch with URL.createObjectURL fallback, 15s timeout on resizeImage

**v1.5.7 — Self-Service Account Deletion**
- DELETE /api/auth/me with comprehensive FK-safe cascade delete (all 20+ dependent tables)
- "Delete My Account" section in MyAccount with "type DELETE to confirm" safeguard
- Admin DELETE /api/admin/users/:id with same cascade logic

---

## Completed — v1.6.0: Bug Fixes & Core UX (2026-02-20)

- [x] **Fix "Invalid Date" in messages:** PostgreSQL timestamps with `+00` timezone offset were being double-suffixed with `Z`. Fixed timezone-aware parsing in Messages.js `formatTime` and Dashboard.js `formatActivityTime`.
- [x] **Lock down contact visibility:** Contacts endpoint now restricted to users connected via care_team_members or caregiver_assignments. No more strangers in messaging.
- [x] **Profile photo upload + avatar:** PUT/DELETE `/api/auth/me/photo` endpoints (base64, 2MB max). User avatar (photo or initial) displayed in sidebar next to iP logo.
- [x] **Dashboard "Latest" status section:** Context-aware banner at top of family and caregiver dashboards. Shows upcoming sessions, onboarding status, background check progress, or next action.
- [x] **Caregiver document review:** New "Documents" tab in CaretakerHub showing uploaded onboarding docs (DL front/back, certifications), legal info (DOB, SSN last 4, DL number), background check status, onboarding completion status.
- [x] **Medical care disclaimer:** Full-screen blocking modal with Virginia state law and personal liability warnings. Scroll-to-bottom required. Versioned (`disclaimer_version`) for future re-prompting.
- New component: `DisclaimerModal.js`. Cache version v1.6.0.

---

## Next Up — v1.6.1: Floating Feedback Button

Priority: **HIGH** — Collect real user feedback to drive iteration.

- [ ] **Floating feedback button (FAB):** Persistent circular button (bottom-right, above mobile nav) on every screen for all authenticated users. Speech bubble icon. Doesn't block content.
- [ ] **Feedback form modal:** Category (Bug Report / Feature Request / General Feedback / Complaint / Praise), description (required), mood (emoji row), optional screenshot, auto-captured page context (page, role, version, device).
- [ ] **Backend:** New `feedback` table. POST `/api/feedback` (any user), GET `/api/feedback` (admin, paginated/filterable), PUT `/api/feedback/:id` (admin status + notes).
- [ ] **Admin Feedback tab:** New tab in AdminPanel. Sortable table: date, user, category, mood, status, preview. Click to expand full detail + screenshot. Status workflow: New → Reviewed → Planned → Done → Dismissed. Admin internal notes. Filter by category/status/date.
- [ ] **Feedback triage:** Admin tagging (bug, feature, ux, content). Group similar items. Clustered feedback informs next dev batch.
- [ ] **Push notification to admin on new feedback.**

---

## v1.7.0: Caregiver Onboarding Completion

Priority: **HIGH** — Complete the caregiver registration experience.

- [ ] **Pets/allergies/medical conditions in onboarding:** Add collection step to CaregiverOnboarding for pets, food allergies, medical conditions. Also add to family and care recipient registration (full "Onboarding profile questions — all roles" spec in TASKS.md).
- [ ] **Multiple certifications:** Dynamic list in signup wizard — "Add another certification" with name, issuing body, expiration.
- [ ] **Registration disclosures & agreements:** Legal step before final submit — background check notice, payment/tax disclosures, platform terms. Checkbox + acceptance timestamp.
- [ ] **Remove availability from signup:** Move to First Steps checklist post-registration. Add preferred work zip code + travel radius to Personal Info step instead.
- [ ] **Stoplight chart (First Steps):** Green/yellow/red task categorization for caregiver comfort levels. Drag-and-drop or tap-to-assign UI.

---

## v1.8.0: Stripe & Background Checks

Priority: **HIGH** — Enable payments. *Blocked on Pete's action items (see below).*

- [ ] **Stripe payment for background check:** Collect credit card via Stripe Elements during CaregiverOnboarding. One-time charge for Checkr background check. Requires `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` on Railway.
- [ ] **Checkr integration:** Submit background check via Checkr API after payment. Webhook for results. Requires `CHECKR_API_KEY` on Railway.
- [ ] **Stripe Connect marketplace:** Families pay, caregivers get paid, platform takes configurable fee (20% base). Express accounts, destination charges, 2-day rolling payouts.
- [ ] **Caregiver earnings dashboard:** Real payment history from Stripe, pending payouts, tax summary.
- [ ] **Family billing:** Payment methods, invoices, spending history.

---

## v1.9.0: Availability & Scheduling UX

Priority: **MEDIUM** — Better scheduling experience.

- [ ] **Interactive drag-to-select availability calendar (Outlook-style):** Weekly grid with Available/Blocked brush modes. Click-drag to paint time blocks, resize handles on edges. 30-min granularity. Recurring rules as overlay blocks.
- [ ] **Caregiver work location zip code:** Replace free-text town name with zip code input. Fix AreaMap centering on work coordinates.

---

## v2.0.0: Connections & Messaging

Priority: **MEDIUM** — Real social model.

- [ ] **Connection request flow:** Search users by email, send connection request, accept/decline. Auto-connect via care team invite or caregiver assignment. Messaging gated by accepted connection.
- [ ] **Message push deep-links:** Push notification opens directly to conversation. Service worker `notificationclick` handler with `/?conversation=ID`.
- [ ] **Video chat — Meet link in messages:** "Video Call" button generates Google Meet link, sent as clickable card message.

---

## v2.1.0: Dashboard & CaretakerHub Overhaul

Priority: **MEDIUM** — Polish the daily experience.

- [ ] **CaretakerHub stat card drill-downs:** Clickable cards → detail views (assigned families list, itemized jobs, hours breakdown, merged earnings/payments).
- [ ] **Push notification expansion:** Push for session updates, care requests, care team activity. Per-type toggles in MyAccount. Admin-only push for waitlist signups and new registrations.
- [ ] **Remove Uber references:** Reword comparisons in CLAUDE.md and SplashPage.js.

---

## Future — Infrastructure & Scale

Priority: **LOW** — When growth demands it.

- [ ] **S3/R2 for visit photos:** Replace base64 PostgreSQL storage with object storage
- [ ] **Cloudflare R2 database backup pipeline:** Daily automated backups to R2 bucket
- [ ] **Build step for frontend:** Move to Vite when component count demands it
- [ ] **Google Maps geocoding upgrade:** Swap Nominatim for better residential accuracy
- [ ] **Apple Sign-In:** After Google OAuth is proven

---

## Pete's Action Items (External Setup)

> These unblock dev tasks above. Check them off as you go.

- [ ] **Stripe: Add test API keys to Railway** — Dashboard → Developers → API keys → copy `sk_test_` and `pk_test_` → Railway env vars `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY`. Unblocks v1.8.0.
- [ ] **Checkr: Sign up for partner account** — Get `CHECKR_API_KEY`, add to Railway. Checkr has sandbox mode for dev. Unblocks v1.8.0.
- [ ] **Stripe: Decide background check price** — Checkr basic check ~$25–$35. Pass through, mark up, or subsidize? Unblocks payment step UI.
- [ ] **Plausible Analytics: Sign up at plausible.io** — Add `yourinplace.com`. Script tag already in index.html.
- [ ] **Google OAuth: Set up in Google Cloud Console** — Create OAuth 2.0 credentials (free). Add `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` to Railway.
- [ ] **Google Maps API key (optional, later)** — For better residential geocoding. One-function swap in `src/utils/geocode.js`.
