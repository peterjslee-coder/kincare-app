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

### v1.1.1 — Splash Page Rework (2026-02-18)
- Splash page layout reorganized: pitch content (Problem → Solution → Market → Business Model → Personal Story → Vision → Working Product CTA) all pushed higher; audience sections (For Family, For Care Recipients, For Caregivers) grouped chronologically near the bottom
- "For Caregivers" hero button styling fixed: now matches "For Family" and "For Care Recipients" (white text, transparent bg) instead of orange-tinted outlier
- "For Caregivers" section label color changed from `#e8724a` (orange) to `#1b6b5a` (teal) to match "For Family" and "For Care Recipients"
- Dev Login section added above footer: one-click login buttons for all 5 demo accounts (Pete, David, Susan, Maria, Betty) — calls `/api/auth/login` directly and navigates to dashboard
- Cache version bumped to v1.1.1

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

---

## Next Up — v1.3.0: Payments & Marketplace

Priority: **HIGH** — Enable real transactions.

- [ ] **Stripe Connect integration:** Marketplace payments (families pay, caregivers get paid, platform takes fee)
- [ ] **Caregiver earnings dashboard:** Payment history, pending payouts, tax summary
- [ ] **Family billing:** Payment methods, invoices, spending history

---

## Future — Full Platform

Priority: **MEDIUM** — Scale and polish.

- [ ] **Google Maps geocoding upgrade:** Swap Nominatim for Google Maps for better residential address accuracy (one function change)
- [ ] **Build step for frontend:** Move to Vite when component count demands it
- [ ] **Apple Sign-In:** After Google OAuth is proven
- [ ] **Admin dashboard:** User management, flagging accounts
