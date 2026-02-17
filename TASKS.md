# InPlace Tasks

> **How this works:** Add bugs and features below as you find them. Don't worry about wording or order. When you're ready for a dev session, say "let's work the task list" and Claude will batch everything together into one efficient push. Nothing gets executed until you say go.

## Bugs

- [ ] **Calendar heat map sometimes stale on tab switch:** Navigating away from Schedule and back occasionally shows a blank calendar until logout/login. Likely a React re-mount issue — component state may not reset on page switch. Fix: add `key={currentPage}` to force unmount, or add navigation dependency to useEffect.


## Features — Up Next

> Ideas and features not yet batched. When enough accumulate, we'll group them into the next batch.

- [x] ~~**Sibling logins:** Add Pete's brother (David) and sister (Susan) with generic credentials so they can see activity and use messaging.~~ Done in v0.6.0.
- [x] ~~**Loading spinners & empty states:** Animated spinner + empty states on all pages.~~ Done in v0.5.3.
- [x] ~~**MyAccount persistence:** Profile edits and notification prefs wired to PUT /api/auth/me.~~ Done in v0.5.3.
- [ ] **Visit photos:** Add file upload endpoint (multipart/form-data → local storage or S3), display photos in visit logs.
- [ ] **Recurring sessions:** Allow scheduling weekly/biweekly repeating care sessions.
- [x] ~~**Mobile responsive layout:** Sidebar → bottom nav on mobile.~~ Done in v0.5.2.
- [x] ~~**Toast notifications:** Success/error feedback on actions (save, delete, assign, etc.).~~ Done in v0.5.3.


## Production Path — Beta on Phone

> These are the infrastructure changes needed before real users (even family/friends) can use the app. Order roughly reflects dependencies. See ROADMAP.md for the full picture.

- [x] **PostgreSQL migration:** ✅ Done (v0.5.0). PostgreSQL on Railway with persistent data across deploys.
- [x] **Wire registration to API:** ✅ Done (v0.5.1). Registration wizard calls POST /api/auth/register, auto-logs in on success, shows inline errors on failure.
- [x] **Password reset flow:** ✅ Done (v0.5.1). Forgot password → email via Resend → reset page. password_reset_tokens table, ForgotPasswordPage & ResetPasswordPage components.
- [x] **Mobile-responsive UI:** ✅ Done (v0.5.2). Bottom nav bar replaces sidebar on mobile (≤768px). Role-aware icons, safe-area padding for notched phones.
- [ ] **Stripe Connect integration:** Wire payments table to Stripe Connect for marketplace payouts. Families pay, caregivers get paid, platform takes a fee.
- [ ] **Input validation & rate limiting:** Lock down API routes before real users touch them. Validate all inputs, add rate limiting on auth endpoints.
- [ ] **Geocoding & distance:** Real address → lat/lng via Mapbox or Google Maps API. Caregiver matching by actual driving distance, not just city name.
- [ ] **Build step for frontend:** Babel-in-browser won't scale. Move to Vite or similar when the component count or bundle size demands it. Not urgent yet.
- [ ] **Tests:** At minimum: auth flow, session booking, payment flow. Needed before any deploy that touches real money.


## Demo Credentials

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Care Team | pete@inplace.care | inplace123 | Primary — manages Betty's care |
| Sibling | david.lee@inplace.care | inplace123 | Pete's brother — coordinates Betty's care |
| Sibling | susan.lee@inplace.care | inplace123 | Pete's sister — coordinates Betty's care |
| Caretaker | maria@inplace.care | inplace123 | Assigned to Betty + 1 other family |
| Cared-For | betty@inplace.care | inplace123 | Limited view, controlled by Pete |


## Done

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
