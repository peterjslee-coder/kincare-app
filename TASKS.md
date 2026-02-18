# InPlace Tasks

> **How this works:** Add bugs and features below as you find them. Don't worry about wording or order. When you're ready for a dev session, say "let's work the task list" and Claude will batch everything together into one efficient push. Nothing gets executed until you say go.

## Bugs

- [x] ~~**Calendar heat map sometimes stale on tab switch:** Fixed in v0.6.1 by adding `key={currentPage}` to all page components in renderPage(), forcing full remount on navigation.~~
- [x] ~~**Real accounts can see demo users in contact/assignment pickers:** Fixed in v1.2.1. Added `is_demo` isolation to `/api/messages/contacts`, `/api/caregivers`, and `/api/caregivers/nearby`. Demo users see demo users, real users see real users.~~
- [x] ~~**PWA not updating to latest version on phone:** Fixed in v1.2.1. Service worker cache name was stuck at `inplace-v0.9.0` — bumped to `inplace-v1.2.1`. Also added missing components (TwoFactorSetup, CareTeamManage, CareTeamPage, EmailVerificationBanner) to SW static asset list.~~


## Features — Up Next

> Ideas and features not yet batched. When enough accumulate, we'll group them into the next batch.

- [ ] **Google OAuth setup on Railway:** Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars (requires Google Cloud Console setup — it's free)
- [ ] **Upgrade to Google Maps geocoding:** Swap Nominatim → Google Maps for better residential accuracy when ready for production


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
| Sibling | david.lee@inplace.care | inplace123 | Pete's brother — coordinates Betty's care |
| Sibling | susan.lee@inplace.care | inplace123 | Pete's sister — coordinates Betty's care |
| Caretaker | maria@inplace.care | inplace123 | Assigned to Betty + 1 other family |
| Cared-For | betty@inplace.care | inplace123 | Limited view, controlled by Pete |


## Done

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
