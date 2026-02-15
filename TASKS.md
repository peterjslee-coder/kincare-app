# KinCare Tasks

> **How this works:** Add bugs and features below as you find them. Don't worry about wording or order. When you're ready for a dev session, say "let's work the task list" and Claude will batch everything together into one efficient push. Nothing gets executed until you say go.

## Bugs

- [ ] **Calendar heat map sometimes stale on tab switch:** Navigating away from Schedule and back occasionally shows a blank calendar until logout/login. Likely a React re-mount issue — component state may not reset on page switch. Fix: add `key={currentPage}` to force unmount, or add navigation dependency to useEffect.


## Features — Up Next

> Ideas and features not yet batched. When enough accumulate, we'll group them into the next batch.

- [ ] **Sibling logins:** Add Pete's brother (David) and sister (Susan) with generic credentials so they can see activity and use messaging. Emergency contacts for both already exist in the system.
- [ ] **Loading spinners & empty states:** Add loading indicators and empty-state messages so nothing looks broken during API fetches.
- [ ] **MyAccount persistence:** Wire notification preferences and profile edits to API (PUT /api/auth/me). Currently UI-only.
- [ ] **Visit photos:** Add file upload endpoint (multipart/form-data → local storage or S3), display photos in visit logs.
- [ ] **Recurring sessions:** Allow scheduling weekly/biweekly repeating care sessions.
- [ ] **Mobile responsive layout:** Sidebar → bottom nav on mobile.
- [ ] **Toast notifications:** Success/error feedback on actions (save, delete, assign, etc.).


## Production Path — Beta on Phone

> These are the infrastructure changes needed before real users (even family/friends) can use the app. Order roughly reflects dependencies. See CLAUDE.md "Production Direction" for the full picture.

- [ ] **PostgreSQL migration:** Replace SQLite with PostgreSQL on Railway. Accounts and data must persist across deploys. This unblocks everything else.
- [ ] **Production auth:** Migrate from hand-rolled JWT to a real auth service (Auth0, Clerk, Supabase Auth, or Firebase Auth). Must support: password reset, email verification, session invalidation, persistent accounts across iterations.
- [ ] **Mobile-responsive UI:** Sidebar → bottom nav on phone. This is the single biggest UX blocker for phone beta. Consider PWA (add-to-homescreen) as the first mobile path — avoids app store review.
- [ ] **Stripe Connect integration:** Wire payments table to Stripe Connect for marketplace payouts. Families pay, caregivers get paid, platform takes a fee.
- [ ] **Input validation & rate limiting:** Lock down API routes before real users touch them. Validate all inputs, add rate limiting on auth endpoints.
- [ ] **Geocoding & distance:** Real address → lat/lng via Mapbox or Google Maps API. Caregiver matching by actual driving distance, not just city name.
- [ ] **Build step for frontend:** Babel-in-browser won't scale. Move to Vite or similar when the component count or bundle size demands it. Not urgent yet.
- [ ] **Tests:** At minimum: auth flow, session booking, payment flow. Needed before any deploy that touches real money.


## Demo Credentials

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Care Team | pete@kincare.app | kincare123 | Primary — manages Betty's care |
| Caretaker | maria@kincare.app | kincare123 | Assigned to Betty + 1 other family |
| Cared-For | betty@kincare.app | kincare123 | Limited view, controlled by Pete |


## Done

### Splash Page Redesign (v0.3.2)
- [x] **Investor pitch landing page:** Rewrote splash page to read like an elevator pitch — market stats ($470B, 53M, 10K boomers/day), problem/solution framing, business model (20% commission, $45-85 sessions), personal story, vision (operating system for aging in place), Unsplash photos of seniors at home.

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
