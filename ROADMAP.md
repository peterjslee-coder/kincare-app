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

---

## Next Up — PWA & Mobile Polish

Priority: **HIGH** — Make the app installable on phones.

### Phase 1: PWA
- [ ] **PWA add-to-homescreen:** Web app manifest, service worker, home screen icon
- [ ] **Touch-friendly interactions:** Larger tap targets, swipe gestures for navigation
- [ ] **Email verification (optional):** Send verification email on registration. Can be deferred.

---

## Future — Production Path

Priority: **MEDIUM** — After onboarding and mobile are solid.

- [ ] **Stripe Connect integration:** Marketplace payments (families pay, caregivers get paid, platform takes fee)
- [ ] **Input validation & rate limiting:** Lock down API routes before real users touch them
- [ ] **Geocoding & distance:** Real address → lat/lng for caregiver matching
- [ ] **Recurring sessions:** Weekly/biweekly repeating care sessions
- [ ] **Visit photos:** File upload for visit documentation
- [ ] **Tests:** Auth flow, session booking, payment flow
- [ ] **Real-time updates:** WebSocket or SSE for activity feed
- [ ] **Sibling logins:** Add David and Susan Lee with generic credentials
- [ ] **Build step for frontend:** Move to Vite when component count demands it
