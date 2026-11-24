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

## Completed — v1.8.0–v1.8.3: Feedback, Photo Upload & Polish (2026-02-21)

- [x] **Floating feedback button:** FeedbackButton.js FAB on all pages, feedback form with category/mood/screenshot/page context, admin review panel, feedback table
- [x] **Feedback button refinement:** Moved FAB to left on mobile (was blocking send button), changed to lightbulb icon
- [x] **Profile photo upload for all roles:** MyAccount photo upload with client-side auto-resize (400x400 JPEG 80%). Sidebar avatar updates real-time
- [x] **Photo upload server fix:** Route-specific 5MB JSON limit, limitBodySize bypass for photo endpoint
- [x] **Care requests show on calendar:** Schedule calendar shows pink/red shading for open/requested/pending sessions
- [x] **Message timestamps fixed:** Replaced relative ("5m") with actual time (h:mm AM/PM)
- [x] **2FA tap-to-copy:** Manual entry code is now clickable to copy
- [x] **Admin care team invites:** Search-email endpoint queries care_team_invites alongside platform_invites
- [x] **Care team invite registration:** Family users via invite link skip care recipient steps, join team after login
- [x] **Admin API key:** ADMIN_API_KEY env var for script auth bypassing JWT + 2FA
- [x] **Admin in mobile nav:** Admin users see 🛡️ in bottom nav
- [x] **SW network-first:** Network-first fetch for app assets, cache-first for CDN. Prevents stale cache
- [x] **APP_VERSION fix:** Now bumped alongside cache-bust param consistently

---

## Completed — v1.14.0: Dual-Role System (2026-02-22)

- [x] **Dual-role support:** Users can hold multiple roles (family + caregiver). Roles stored as JSON array. JWT encodes roles array. Role switcher on My Account
- [x] **"Add a Role" card:** My Account shows option to add caregiver or family role
- [x] **Database migration:** Backfills roles column for ALL existing users (production-wide)
- [x] **Registration page branding:** Maria 🤝 "Caregiver / Companion", Betty 🌷 "I Would Like Help"

---

## Completed — v1.15.0–v1.15.1: Help/FAQ, Onboarding Fix & Demo Fixes (2026-02-22)

- [x] **Help/FAQ page:** Dynamic help_articles DB table, 20 seed articles across 5 categories, role-based visibility, deep-link navigation, search and category filtering
- [x] **Admin help management:** Help/FAQ tab in AdminPanel with CRUD, publish/unpublish, "Create FAQ from this" on feedback items
- [x] **Onboarding status fix:** Fixed admin endpoint — removed non-existent column references (photo_url, doc_type, uploaded_at)
- [x] **Demo account switching:** Fixed stale activeRole persisting across demo switches. Added user ID to component keys for forced remount
- [x] **Branding icon updates:** Demo picker and sidebar match v1.14.0 branding — Maria 🤝, Betty 🌷
- [x] **Seed roles + re-trigger:** Demo users include explicit roles JSON array. DEMO_SEED_VERSION bumped to 1.15.1

---

## Completed — v1.15.2–v1.16.0: Admin Tab Layout, Maria Dual-Role, Branding (2026-02-22)

- [x] **Branding icon sweep (v1.15.2):** Replaced all 12 remaining old icons across 8 component files
- [x] **CaretakerHub white screen fix (v1.15.2a):** useEffect before early returns violated React hooks rules
- [x] **Maria dual-role + Carlos (v1.15.3):** Maria now has caregiver+family roles with brother Carlos Santos as care recipient
- [x] **Admin card-grid tab layout (v1.16.0):** Applied card-grid tab navigation to CaretakerHub and CaredForView
- [x] **Feedback protocol (v1.16.0):** Collected 69 items from production, updated TASKS.md with 6 new bugs

---

## Completed — v1.20.4: Care Recipient Photos (2026-02-22)

- [x] **Care recipient photo upload:** Photo upload on CareRecipients page with RecipientAvatar component
- [x] **Care request visible on family calendar:** Sessions API returns requested-status sessions to family users

---

## Completed — v1.21.9: Onboarding Resilience (2026-02-23)

- [x] **resilientFetch:** Network-resilient fetch wrapper with retry logic and offline detection
- [x] **localStorage persistence:** Onboarding progress saved locally so users don't lose work on network drops
- [x] **Offline indicator:** Banner shown when device goes offline during onboarding

---

## Completed — v1.22.0–v1.22.1: Auth Event Tracking & Demo Repair (2026-02-23)

- [x] **Onboarding event tracking:** `onboarding_events` table, POST/GET endpoints, admin panel "Auth Events" tab
- [x] **Auth tracking across all flows:** Extended event tracking to login, registration, password reset, demo login flows with `flow` field
- [x] **Demo data repair:** Added `POST /api/admin/reseed-demo` endpoint that safely reseeds all demo data (sessions, messages, notes, reviews, care teams) without touching real user data
- [x] **Feedback table FK fix:** Added feedback and onboarding_events cleanup to demoOnly seed path

---

## Completed — v1.24.0–v1.24.1: Splash Rework & Date Fixes (2026-02-23)

- [x] **Splash page B2 redesign:** Split hero with fade, tabbed audience sections, signup form, fair-wages subheadline
- [x] **Invalid dates on activity feed:** Added parseTimestamp guards to Dashboard.js, FamilyPayments.js, AdminPanel.js
- [x] **Invalid dates on Betty's calendar:** Verified CaredForView.js using safe integer-based date construction

---

## Completed — v1.25.0–v1.25.1: Feedback Mega-Fix (2026-02-23)

- [x] **Leaflet map invalidateSize fix:** Added invalidateSize(true) + ResizeObserver to Caregivers.js and AreaMap.js maps
- [x] **Map centered on caregiver's work location:** AreaMap uses profileCenter (work_latitude/work_longitude) as default
- [x] **Caregiver pet/health info on MyAccount:** Health & Safety card shows editable pets, allergies, medical conditions
- [x] **Registration field validation:** Red border + "*required" labels on each invalid field for both tracks
- [x] **Connection request persistence:** fetchPendingRequests() called after sending request to refresh sent list
- [x] **Caregiver search centers on care recipient:** searchCenter added to map useEffect dependencies
- [x] **Feedback icon mobile fix:** FAB moves higher (bottom: 130px) on Messages page
- [x] **Message timestamps with date:** "Yesterday 2:30 PM" or "Feb 21 2:30 PM" for older messages
- [x] **Session color consistency:** Distinct colors per status — confirmed=teal, completed=blue, pending=orange, open=coral
- [x] **Getting Started checklist dismiss:** Added dismiss button, auto-detection already in place
- [x] **Caregiver name size on profile:** Bumped from 17px to 20px
- [x] **Dashboard spend accuracy:** Analytics endpoint filters to confirmed and completed sessions only
- [x] **Care recipient photo on Dashboard:** Shows photo > emoji > fallback instead of hardcoded emoji
- [x] **Caregiver profile photo upload:** Confirmed working for peter@yourinplace.com (Cary Taker)

---

## Completed — v1.26.0: Caregiver Registration Flow (2026-02-23)

- [x] **Multi-step caregiver registration:** Streamlined wizard with progressive disclosure
- [x] **Care stoplight preferences:** Green/yellow/red task categorization during onboarding
- [x] **Work location + travel radius:** Zip-based geocoding for preferred work area

---

## Completed — v1.27.0–v1.27.7: Progressive Gating & Onboarding (2026-02-23)

- [x] **Progressive caregiver onboarding gate:** Non-dismissible onboarding panel on CaretakerHub
- [x] **6-step onboarding checklist:** Profile, availability, care preferences, photo, Stripe, background check
- [x] **Blurred/locked content:** Calendar and jobs visible as shapes but details hidden until onboarding complete
- [x] **Auto-unlock:** Backend verifies all 6 criteria, sets onboarding_complete=1, panel disappears
- [x] **PUT /api/caregivers/mark-onboarding-complete:** Server-side validation of all completion criteria
- [x] **Soft-delete with transactions:** Anonymize user data, set is_active=0, log exit reason
- [x] **Exit survey:** Collect reason before account deletion
- [x] **Mobile splash fix:** Responsive adjustments to splash page
- [x] **Inline onboarding profile editor:** Edit profile fields directly from onboarding checklist

---

## Completed — v1.28.0–v1.28.6: Registration Hardening & Real User Fixes (2026-02-24)

- [x] **Family dashboard gating:** Progressive onboarding gate for family users (care recipient, care team setup)
- [x] **Password confirmation on registration:** Confirm password field with match validation and visual feedback
- [x] **Phone normalization:** Strip formatting before API calls across RegisterPage, CaregiverOnboarding, MyAccount
- [x] **Phone auto-formatting:** Display as (xxx) xxx-xxxx during input across all forms
- [x] **Sidebar profile layout:** Centered vertical layout with 44px avatar, consistent 14px font
- [x] **Zombie account fix (v1.28.4):** Async authenticate middleware checks is_active in DB — stale JWTs from deleted accounts now return 401
- [x] **Demo data isolation in sessions (v1.28.6):** Added is_demo JOIN filtering to both caregiver session queries
- [x] **Care request preview cards (v1.28.6):** Caregiver calendar shows recipient name, date/time, duration, cost for each request

---

## Completed — v1.29.0–v1.29.1: Dashboard & Navigation Polish (2026-02-24)

**v1.29.0 — Role Management & Tiered Rates:**
- [x] **Active role indicator.** Multi-role users see "Viewing as" label above role switcher; single-role users see icon + role name
- [x] **Delete individual role.** POST /api/auth/remove-role with cleanup of caregiver-specific data, two-step confirmation UI on MyAccount
- [x] **Tiered caregiver rates.** Three-tier rate inputs (Daytime 6a-6p, Evening 6p-12a, Overnight 12a-6a) in CaretakerHub profile editor, 6-hour minimum note

**v1.29.1 — UX Fixes:**
- [x] **Inbox sorted by recency.** Client-side sort by lastMessageAt DESC before rendering conversations
- [x] **Activity feed "Mark read" button overflow.** Compacted button (smaller padding, shorter label "✓ Read") to prevent text spill on narrow screens
- [x] **Calendar block previews.** Day cells now show recipient/caregiver name, service type abbreviation, and hours (e.g., "Betty · Comp · 3h") instead of just counts
- [x] **Betty tile text contrast.** Health condition text changed from #666 to rgba(255,255,255,0.75) on dark teal card background

**Already resolved (verified, no code needed):**
- [x] **Duplicate help/FAQ articles.** Seed has 20 unique articles with DELETE-before-INSERT — no duplicates
- [x] **Help/Account/Logout pinned to sidebar bottom.** Already implemented with marginTop: auto spacer
- [x] **"Set your availability" link.** Fixed in prior version
- [x] **"Complete my profile" checklist.** Updated in prior version
- [x] **Admin: delete user account.** Fixed during Cary deletion testing
- [x] **Care notes delete option.** Already implemented in CaredForView.js (delete button + handler)

**Remaining (moved to v1.30.0):**
- [ ] **AI insights cross-contamination.** Carlos's insights cite Betty's needs — scoping issue. *(Feedback — Feb 23)*
- [ ] **"Request Care" button placement.** Move from sidebar bottom to more prominent position. *(Feedback — Feb 24)*
- [ ] **Betty tile + care team unification.** Nest care team inside Betty's card. *(Feedback — Feb 24)*

---

## Completed — v1.51.5–v1.51.12: Feedback P1 Blitz (2026-03-22)

- [x] **Background check "consider" warning display (v1.51.5):** CaretakerHub First Steps now shows warning messages for `consider`, `processing`, and `disputed` Checkr statuses. Status banner added for each state. Green checkmark still shows when step is done, but amber warning appears below with instructions to check email.
- [x] **Doctor report generation fix (v1.51.6):** Fixed 404 error from deprecated Anthropic model ID `claude-sonnet-4-5-20250514`. Updated to `claude-sonnet-4-6`.
- [x] **Centralized AI model config (v1.51.7):** Created `src/utils/aiModels.js` with `MODEL_SONNET` and `MODEL_HAIKU` exports. All 9 files with hardcoded model strings now import from central config. Models controllable via `ANTHROPIC_MODEL_SONNET` and `ANTHROPIC_MODEL_HAIKU` env vars — no deploy needed to change models.
- [x] **Visit photo thumbnails in session detail (v1.51.8):** Photos now show as always-visible thumbnail grid in VisitDetailModal. Tap opens full-screen lightbox with prev/next navigation. "Show all" toggle only appears when >6 photos.
- [x] **Caregiver rates loading fix (v1.51.9):** Fixed field name mismatch — frontend looked for `nighttime_rate`/`nighttimeRate` but API returns `rate_nighttime`/`rateNighttime`. Rates saved correctly but displayed empty on reload.
- [x] **Block messaging between unconnected users (v1.51.10):** Added connection validation to `POST /conversations` — checks care team membership, caregiver assignment, or accepted connection. Also filters legacy messages from unconnected users. Admins bypass all checks. Privacy/safety fix.
- [x] **Android push notification icon fix (v1.51.11):** Changed notification icons from `badge-monochrome-96.png` to `icon-192.png` (icon) and `icon-maskable-96.png` (badge) in both sw.js and push.js. Fixes white square on Android.
- [x] **Overdue checkout reminder (v1.51.11):** Added `overdue_check_out` reminder type. Fires 15 minutes after session scheduled end time — push + SMS to caregiver, push to family.
- [x] **Desktop push health check fix (v1.51.12):** `checkPushHealth()` checked `window.AUTH_TOKEN` (always null) instead of closure `AUTH_TOKEN`. The 30-minute health check never ran, so stale push subscriptions were never re-synced with the server. Root cause of Sara Huber's desktop push issue.

---

## Next Up — v1.30.0: Caregiver Experience Polish

Priority: **HIGH** — Real user (Cary Taker) feedback + remaining UX items.

- [ ] **AI insights cross-contamination.** Carlos's insights cite Betty's needs — fix scoping. *(Feedback — Feb 23)*
- [ ] **"Request Care" button placement.** Move to more prominent position. *(Feedback — Feb 24)*
- [ ] **Betty tile + care team unification.** Nest care team inside Betty's card. *(Feedback — Feb 24)*
- [ ] **Caregiver rates saved from onboarding.** Rates must persist to caregiver_profiles and show on financials. *(Feedback #44)*
- [ ] **DL/cert photo upload in onboarding.** At least ask for DL front/back. *(Feedback #45)*
- [ ] **Stripe Connect status refresh.** Return URL triggers dashboard re-fetch. *(Feedback #41)*
- [ ] **Weekly availability rules.** Set "available 8-5 Mon-Thu" as one rule. *(Feedback #46)*
- [ ] **Short-notice upcharge description.** Explain pricing rules on financials page. *(Feedback #42)*
- [ ] **Fee percentage consistency.** 15% vs 20% — make consistent everywhere. *(Existing bug)*
- [ ] **Caregiver avatar in assignment block.** Show profile pic in assignment cards. *(Feedback — reviewed)*
- [ ] **Show assigned caregiver on map.** Pin/flag on family's caregiver map view. *(Feedback — Feb 24)*
- [ ] **Care team overlapping avatar display.** Member avatars lined up and overlapping. *(Feedback — Feb 24)*
- [ ] **Star rating label/tooltip.** Clarify what the rating represents. *(Feedback — Feb 24)*

---

## v1.31.0: Stripe & Background Checks

Priority: **HIGH** — Enable payments. *Stripe Connect done (v1.40.6–v1.40.9). Checkr integration done (v1.50.29–v1.50.35).*

- [ ] **Stripe payment for background check:** Collect credit card via Stripe Elements. One-time charge for Checkr background check. *(Blocked on deciding price — see Pete's Action Items)*
- [x] **Checkr integration (v1.50.29–v1.50.35):** ✅ Full Checkr Partner Certification compliance achieved. Includes: POST /candidates (custom_id, phone, middle_name/no_middle_name), POST /invitations (node, work_locations), GET /packages (dynamic), GET /nodes?include=packages (account hierarchy), 12+ webhook handlers (report.completed, report.updated, report.created, report.suspended, report.resumed, report.disputed, invitation.created, invitation.completed, invitation.expired, invitation.deleted, report.post_adverse_action, report.engaged), ETA tracking + admin display, re-initiation for multiple BG checks per candidate, BG check rejection flow with soft lock + appeal, admin approval/rejection panel. OAuth N/A (single-account).
- [x] **Stripe Connect marketplace (v1.40.6–v1.40.9):** ✅ Families pay, caregivers get paid, platform takes configurable fee (20% base). Express accounts with embedded Connect.js + redirect fallback.
- [ ] **Caregiver earnings dashboard:** Real payment history from Stripe, pending payouts, tax summary.
- [ ] **Family billing:** Payment methods, invoices, spending history.

---

## v1.32.0: Care Profile & Medication

Priority: **MEDIUM** — Enriching the core care experience.

- [ ] **Medication section CRUD.** Editable med list — name, dosage, frequency, reminders. *(Feedback #18)*
- [ ] **Care location address with private instructions.** Gate codes, parking, door combos — visible only to confirmed caregivers. *(Feedback #16)*
- [ ] **Photo upload in care notes.** Visual context for caregivers. *(Feedback #17)*
- [ ] **Care profile enrichment.** Doctor contacts, favorite shopping areas. *(Feedback #38)*
- [ ] **Expand care categories beyond elderly.** Babysitting, special needs, adult care. *(Feedback #8)*
- [ ] **AI insights on care profile.** Suggest relevant care questions based on conditions. *(Feedback #15)*

---

## v2.0.0: Connections, Messaging & Navigation

Priority: **MEDIUM** — Real social model + navigation fixes.

- [ ] **Connection request → auto-open chat.** Accept request and immediately see conversation. *(Feedback #27)*
- [ ] **Connection status persistence.** "Pending" state visible in messages list. *(Existing)*
- [ ] **Find People shows recent connections.** *(Feedback #26)*
- [ ] **Back swipe navigation.** In-app history stack so iOS back gesture works. *(Feedback #22, existing)*
- [ ] **Message push deep-links.** Push notification opens directly to conversation.
- [ ] **Video chat — Meet link in messages.**
- [ ] **Session check-in/checkout + time extension.** *(Feedback #1)* **Updated Mar 19:** Includes early checkout pay rule (15-min block billing from check-in to check-out, not from scheduled start), early checkout prompt with reason collection, and server-side duration calculation in care recipient's timezone. See TASKS.md for full spec.

---

## v2.1.0: Platform Business Features

Priority: **MEDIUM** — Revenue and trust features.

- [ ] **Nursing student discount program.** 15% fee vs 20%, verified via school email. *(Feedback #3)*
- [ ] **Nursing student badge + hour reports.** Show on profile, generate school reports. *(Feedback #4)*
- [ ] **Off-platform liability acknowledgment.** *(Feedback #5)*
- [ ] **Care preferences as caregiver branding.** Stoplight system as identity/brand. *(Feedback #6, #7)*
- [ ] **"Average in your area" rate data + job alerts.** *(Existing future feature)*
- [ ] **AI fraud detection.** Detect unusual patterns. *(Feedback #28)*

---

## Future — App Store Launch & Distribution

Priority: **MEDIUM** — Required for real distribution.

**Apple App Store (iOS):**
- [ ] **Apple Developer Account** — $99/year. Register at developer.apple.com.
- [ ] **TWA / Capacitor / React Native wrapper** — Wrap the PWA in a native shell. Options: Capacitor (lightest, uses WKWebView), TWA (not available for iOS), or React Native WebView. Capacitor recommended — minimal code, full PWA features preserved.
- [ ] **Push notifications via APNs** — Replace web-push with Apple Push Notification service for native push. Capacitor plugin: `@capacitor/push-notifications`.
- [ ] **App Store review compliance** — Privacy policy, terms of service, medical disclaimer, age rating, app screenshots (6.7" and 5.5"), app icon (1024x1024).
- [ ] **TestFlight beta** — Upload .ipa to App Store Connect, invite beta testers before public launch.

**Google Play Store (Android):**
- [ ] **Google Play Developer Account** — $25 one-time fee. Register at play.google.com/console.
- [ ] **TWA (Trusted Web Activity)** — Wraps the PWA with zero native code. Uses Chrome Custom Tab. Requires digital asset links file (`.well-known/assetlinks.json`) on yourinplace.com. Lightest option.
- [ ] **Play Store listing** — Screenshots, feature graphic (1024x500), short/full description, privacy policy URL, content rating questionnaire.
- [ ] **App signing** — Upload Android App Bundle (.aab), Google manages signing keys.

**Shared requirements:**
- [ ] **Deep linking / universal links** — Handle `yourinplace.com/invite?token=X` natively, plus push notification deep links to specific screens.
- [ ] **Offline mode hardening** — Ensure critical screens (dashboard, schedule, messages) work offline with service worker caching.
- [ ] **App icon variants** — Foreground/background layers for Android adaptive icons, iOS 1024px marketing icon.
- [ ] **Version management** — Semantic versioning synced between PWA cache-bust and native app version codes.

---

## Future — AI-Powered Care Intelligence

Priority: **HIGH** — Core differentiator. Matching is the lead feature for sales and investor pitch.

### Why This Matters

Most care platforms are glorified job boards — families scroll, guess, and hope. AI matching turns InPlace into something fundamentally different: a system that *understands* care needs and finds the right person. This is the pitch: "Tell us about your loved one. We'll find the right caregiver." One sentence, zero browsing.

### Cost Analysis

AI API costs are per-call, based on tokens (roughly 1 token ≈ 0.75 words). Current pricing (Feb 2026):

| Model | Input / 1M tokens | Output / 1M tokens | Best For |
|-------|-------------------|--------------------:|----------|
| Claude Haiku 4.5 | $1.00 | $5.00 | Matching, classification, formatting |
| GPT-4o mini | $0.15 | $0.60 | Cheapest option for simple tasks |
| Claude Sonnet 4.5 | $3.00 | $15.00 | Complex reasoning, care insights |

**Projected cost per feature call:**

| Feature | Model | Est. Tokens (in/out) | Cost Per Call | Monthly @ 100 users |
|---------|-------|---------------------|--------------|---------------------|
| Caregiver match | Haiku 4.5 | ~2K in / ~500 out | ~$0.005 | $2–5 |
| Session note summary | Haiku 4.5 | ~1K in / ~300 out | ~$0.003 | $3–8 |
| Care trend insights (weekly) | Sonnet 4.5 | ~4K in / ~1K out | ~$0.03 | $12–15 |
| Smart scheduling suggestion | Haiku 4.5 | ~1.5K in / ~200 out | ~$0.002 | $1–3 |
| Proactive notification text | GPT-4o mini | ~500 in / ~100 out | ~$0.0002 | <$1 |

**Bottom line:** At 100 active users, total AI cost is roughly **$20–35/month**. At 1,000 users, **$150–300/month**. At 10,000 users, **$1,000–2,500/month**. This is easily covered by the platform fee (currently 15–20% of session cost). A single 3-hour session at $25/hr generates $11–15 in platform revenue — that covers ~2,000 AI matching calls.

**Cost optimization levers:**
- **Prompt caching** (Anthropic) — 90% savings on repeated context (care profiles, caregiver data). A cached match request drops from $0.005 to ~$0.001.
- **Batch API** — 50% discount for non-urgent tasks (weekly summaries, trend analysis). Haiku drops to $0.50/$2.50 per MTok.
- **Model routing** — Use GPT-4o mini ($0.15/$0.60) for simple formatting/classification, Haiku for matching, Sonnet only for complex multi-session analysis.
- **Result caching** — Cache match results for same care-recipient profile for 24h. Most families don't change care needs daily.

### Phase AI-1: Intelligent Caregiver Matching (v2.5.0)

**The headline feature.** Family describes what they need → AI returns ranked caregivers with explanations.

**How it works:**
1. Family creates care request (already have: service type, date/time, duration, care recipient profile)
2. System gathers candidate caregivers (location, availability, demo isolation — reuse existing query)
3. AI scores each candidate against the care need using structured data:
   - Care recipient conditions (dementia, arthritis, mobility) vs. caregiver specialties + stoplight preferences
   - Schedule fit (caregiver availability rules vs. requested time)
   - Past performance (ratings, completed sessions with this family, reliability score)
   - Distance and travel willingness
   - Rate compatibility (caregiver rate vs. family budget/proposed rate)
4. Returns top 3–5 matches with plain-English explanations: *"Maria is your best match — she specializes in dementia care, is 4 miles away, and has completed 12 sessions with Betty with a 4.9 rating."*

**API endpoint:** `POST /api/ai/match`
```
Request:  { careRequestId } or { careRecipientId, serviceType, date, time, duration }
Response: { matches: [{ caregiverId, score, explanation, factors: {...} }] }
```

**Integration points in frontend:**
- RequestCareModal step 3 (after selecting date/time/duration): "Recommended caregivers" section replaces or augments manual browse
- Dashboard: "Suggested caregiver for upcoming session" card
- Push notification: "We found 3 caregivers for your Tuesday request — tap to review"

**Data already available (no new tables needed):**
- `care_recipients`: health_conditions, medications, mobility, special_needs
- `caregiver_profiles`: specialties, certifications, care_stoplight (comfort levels), rating_avg, years_experience, location
- `availability`: recurring rules, blocked dates
- `care_sessions`: history between specific caregiver-family pairs
- `reviews`: qualitative feedback
- `caregiver_assignments`: existing relationships, favorites

**Implementation:**
- [ ] `src/utils/aiMatch.js` — Build structured prompt from care recipient + caregiver data, call Claude Haiku API, parse ranked results
- [ ] `src/routes/ai.js` — `POST /api/ai/match` endpoint (authenticated, rate-limited to 10 calls/user/hour)
- [ ] RequestCareModal integration — Show AI-ranked matches with explanations on step 3
- [ ] Fallback — If API fails or is slow (>5s), fall back to existing distance-based sort
- [ ] Logging — Store match requests + results for quality tuning (new `ai_match_log` table)
- [ ] Environment variable: `AI_API_KEY` (Claude or OpenAI) on Railway

**Estimated effort:** 2–3 days
**Estimated ongoing cost:** <$5/month at current user count

---

### Phase AI-2: Session Note Intelligence (v2.6.0)

**Turn caregiver free-text notes into structured care insights.**

After each session, caregivers write notes (already stored in `visit_logs.notes`). AI processes these to:
1. **Extract structured data** — mood, mobility observations, appetite, medication compliance, incidents
2. **Generate weekly/monthly summaries** for families — "This week: Betty was in good spirits 4/5 visits. Mobility continues to decline — she needed help with stairs on 3 visits. She skipped lunch twice."
3. **Flag concerns** — "Betty mentioned chest pain on Feb 24. This has not appeared in previous notes." → Push notification to family
4. **Track trends over time** — Sentiment analysis on moods, frequency of specific conditions

**API endpoints:**
- `POST /api/ai/analyze-note` — Called automatically after visit log submission. Extracts structured data, stores in new `note_insights` table
- `GET /api/ai/care-summary?recipientId=X&period=week` — Returns AI-generated summary for family dashboard

**Integration points:**
- Dashboard: "Care Insights This Week" card
- Care Profile: "AI Health Trends" tab with visualizations
- Push notifications: Concern flags sent to family in real-time

**Estimated effort:** 3–4 days
**Estimated ongoing cost:** $5–10/month at current scale

---

### Phase AI-3: Smart Scheduling & Demand Optimization (v2.7.0)

**Reduce empty caregiver hours. Reduce family costs. Increase platform revenue.**

1. **Gap filling** — Caregiver has 2-hour gap between sessions 3 miles apart. System identifies nearby families who could use that slot and sends a proactive offer at a slight discount.
2. **Demand-based rate suggestions** — "Tuesday mornings have high demand and few caregivers. Suggest $28/hr (vs. your usual $25) for that slot." Transparent to both sides.
3. **Rebooking prompts** — "Betty usually has a Tuesday session with Maria. Should I book next Tuesday?" One-tap confirmation.
4. **Schedule optimization** — For caregivers with multiple families: suggest route-optimized session order to minimize drive time.

**API endpoints:**
- `GET /api/ai/schedule-suggestions?userId=X` — Returns proactive booking suggestions
- `GET /api/ai/demand-insights?date=X&area=Y` — Returns demand/supply data for rate suggestions

**Estimated effort:** 4–5 days
**Estimated ongoing cost:** $3–8/month

---

### Phase AI-4: Proactive Engagement & Retention (v2.8.0)

**Keep families booking. Keep caregivers active. Reduce churn.**

1. **Re-engagement nudges** — Family hasn't booked in 2 weeks → "Betty's care plan calls for 3 sessions/week. Would you like me to book her regular Tuesday with Maria?" (Push + in-app)
2. **Caregiver burnout detection** — Hours spike, ratings dip, sessions declined → "You've worked 45 hours this week. Want me to block tomorrow morning for rest?"
3. **Review prompts** — After a great session (high mood, long duration, no incidents): "How was Maria today? A quick review helps other families."
4. **Referral timing** — Family just left a 5-star review → "Know someone who could use InPlace? Share your referral link for $25 off their first session."
5. **Onboarding coach** — New caregiver signs up → AI guides them through profile completion with contextual tips: "Families in Blacksburg are looking for caregivers with dementia experience. Adding this to your specialties could help you get matched faster."

**API endpoint:** `POST /api/ai/engagement-check` — Cron job (daily), analyzes all users, generates personalized nudges, queues push notifications

**Estimated effort:** 3–4 days
**Estimated ongoing cost:** <$5/month (mostly GPT-4o mini for text generation)

---

### Phase AI-5: Family-Facing AI Assistant (v3.0.0)

**The long game.** A chat interface where families can ask natural-language questions about their loved one's care:

- "How has Mom been this month?"
- "Which caregiver is best for overnight stays?"
- "Book Maria for Saturday morning if she's free"
- "What should I tell Mom's doctor about her recent care?"

This is a RAG (Retrieval-Augmented Generation) system that pulls from session history, visit notes, care profiles, and caregiver data to answer questions and take actions. It's the most complex feature but also the most compelling for retention — it makes InPlace feel like a care *partner*, not just a booking tool.

**Estimated effort:** 2–3 weeks
**Estimated ongoing cost:** $15–30/month (Sonnet-class model for conversational quality)

---

### AI Implementation Notes

**Environment setup:**
- `AI_PROVIDER` env var — `anthropic` or `openai` (default: anthropic)
- `AI_API_KEY` env var — API key for the selected provider
- `AI_MODEL` env var — Override model (default: `claude-haiku-4-5-20251001` for matching)

**Architecture:**
- All AI calls go through `src/utils/ai.js` — single abstraction layer with provider switching, retry logic, timeout (5s default), and cost logging
- Rate limiting: 10 AI calls per user per hour (configurable)
- Graceful degradation: Every AI feature has a non-AI fallback (distance sort, manual browse, no summary)
- Cost tracking: Log every API call with tokens used, model, latency → `ai_usage_log` table for billing visibility

**Privacy:**
- No PII sent to AI APIs — names replaced with IDs, addresses omitted, only relevant care data included
- Care recipient health data is sent (needed for matching) but not stored by API providers (both Anthropic and OpenAI have zero-retention data policies for API usage)
- Families can opt out of AI features in settings

---

## Future — Infrastructure & Scale

Priority: **LOW** — When growth demands it.

- [ ] **S3/R2 for visit photos:** Replace base64 PostgreSQL storage with object storage
- [ ] **Cloudflare R2 database backup pipeline:** Daily automated backups to R2 bucket
- [ ] **Build step for frontend:** Move to Vite when component count demands it
- [ ] **Google Maps geocoding upgrade:** Swap Nominatim for better residential accuracy
- [ ] **Apple Sign-In:** After Google OAuth is proven
- [ ] **Admin panel UX overhaul:** Card-based navigation, collapsible sections
- [ ] **Admin incident management:** Escalated support cases with full evidence
- [ ] **Biometric sign-in (WebAuthn/passkeys):** *(Feedback #36)*
- [ ] **Splash page rework v2:** Collapse detailed sections, clearer demo CTA, happy imagery. *(Pete — Feb 24)*
- [ ] **Clearer signup role selection:** Upfront "Are you looking for help / Ready to work" question. *(Pete — Feb 24)*

---

## HIPAA & PHI — Critical Pre-Launch Decision

Priority: **HIGH** — Must resolve before real users.

> All PHI fields are tagged with `/* PHI */` comments in `src/models/database.js`.
> See the PHI Field Registry comment block at the top of the `initializeDb()` function.

### The Core Question

InPlace collects health information (conditions, medications, allergies) tied to identifiable care recipients. Under HIPAA, this is Protected Health Information (PHI). Before launching with real users, we must choose one of two paths:

### Option A: Full HIPAA Compliance

Accept PHI and ensure every service in the chain has a signed BAA:

- [ ] **Database hosting BAA** — Turso enterprise plan offers HIPAA. Railway TBD — may need to move PHI to a separate HIPAA-compliant DB (AWS RDS, Google Cloud SQL with BAA)
- [ ] **Identity verification BAA** — Use [Vouched.id](https://www.vouched.id/medical-identity-verification-solutions) instead of Stripe Identity for care recipients AND caregivers (caregivers access PHI). Vouched signs BAAs and is HIPAA/HITECH compliant. First 50 verifications free at Stripe; Vouched pricing is custom.
- [ ] **AI services BAA** — If any AI features process PHI (summaries, suggestions), need BAA from provider. Anthropic, OpenAI offer BAAs on enterprise/API plans.
- [ ] **Email/notifications BAA** — If health info appears in emails or push notifications
- [ ] **Encryption at rest** — 2026 HIPAA rules make this mandatory (NIST standards)
- [ ] **Audit logging** — Track all access to PHI fields
- [ ] **Breach notification process** — Required by HIPAA Breach Notification Rule

### Option B: Remove PHI Entirely

Don't store health information. Simpler, faster to launch, no BAAs needed:

- [ ] **Remove PHI fields** from `care_recipients`: health_conditions, medications, medical_conditions, food_allergies, pet_allergies
- [ ] **Remove PHI fields** from `users`: medical_conditions, food_allergies, pet_allergies
- [ ] **Restrict visit_logs** — Don't allow caregivers to log medical observations
- [ ] **Restrict care_preferences** — Keep service preferences ("meal prep", "companionship") but remove medical follow-ups ("how many medications?")
- [ ] **Add disclaimer**: "InPlace helps coordinate non-medical home care. We do not store or process medical information. For medical care coordination, consult your healthcare provider."
- [ ] **Reframe medication reminders** — "Although we can help remind your loved one about daily routines, we do not store or process medical information on this platform."
- [ ] **Keep Stripe Identity** for all users (no PHI = no HIPAA concern)

### Hybrid Approach (Recommended?)

- Keep non-medical care preferences (meal prep, companionship, transportation, etc.)
- Remove explicit medical fields (health_conditions, medications, medical_conditions)
- Add "medication reminders" as a simple yes/no preference without storing what medications
- Add prominent disclaimer about non-medical care coordination
- Use Stripe Identity for everyone (cheaper, already integrated)
- Revisit full HIPAA compliance when/if medical care features are needed

### Identity Verification — All Users Need It

- **Caregivers**: Currently wired to Stripe Identity (`/api/payments/identity/create-session`). If we go Option A, switch to Vouched since caregivers access PHI.
- **Care recipients / families**: WizardStep3 is currently a "Coming Soon" placeholder. Needs real verification before care can begin.
- **Vouched.id** ([vouched.id](https://www.vouched.id)): HIPAA-compliant, signs BAAs, healthcare-specific (VouchedRx). API similar to Stripe Identity (document + selfie). Custom pricing.
- **Stripe Identity**: $1.50/verification after first 50 free. NOT HIPAA-compliant. Fine if we go Option B (no PHI).

### PHI Fields Currently Tagged in Database

| Table | Field | Classification |
|-------|-------|---------------|
| care_recipients | health_conditions | PHI |
| care_recipients | medications | PHI |
| care_recipients | medical_conditions | PHI |
| care_recipients | food_allergies | PHI |
| care_recipients | pet_allergies | PHI |
| care_recipients | care_preferences | PHI-risk (follow-up details) |
| users | medical_conditions | PHI |
| users | food_allergies | PHI |
| users | pet_allergies | PHI |
| visit_logs | summary | PHI |
| visit_logs | notes | PHI |
| visit_logs | mood_rating | PHI |
| visit_logs | tasks_completed | PHI |
| recipient_notes | content | PHI |
| messages | content | PHI-risk |
| care_sessions | special_instructions | PHI-risk |

---

## Pete's Action Items (External Setup)

> These unblock dev tasks above. Check them off as you go.

- [ ] **Stripe: Add test API keys to Railway** — Dashboard → Developers → API keys → copy `sk_test_` and `pk_test_` → Railway env vars `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY`. Unblocks v1.18.0.
- [x] **Checkr: Sign up for partner account** — ✅ Done. API key on Railway. Checkr-Hosted flow enabled. Partner Certification compliance achieved (v1.50.32–v1.50.35). Staging sandbox active.
- [ ] **Stripe: Decide background check price** — Checkr basic check ~$25–$35. Pass through, mark up, or subsidize? Unblocks payment step UI.
- [ ] **Plausible Analytics: Sign up at plausible.io** — Add `yourinplace.com`. Script tag already in index.html.
- [ ] **Google OAuth: Set up in Google Cloud Console** — Create OAuth 2.0 credentials (free). Add `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` to Railway.
- [ ] **Google Maps API key (optional, later)** — For better residential geocoding. One-function swap in `src/utils/geocode.js`.
