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

---

## Next Up — Demo Polish & Infrastructure

Priority: **HIGH** — Make the demo bulletproof and prepare for real users.

- [ ] **PostgreSQL migration:** Replace SQLite with PostgreSQL on Railway for persistent data across deploys
- [ ] **Production auth:** Migrate to real auth service (Auth0, Clerk, or Supabase Auth) for password reset, email verification, persistent accounts
- [ ] **Mobile-responsive UI:** Sidebar → bottom nav on phone, PWA add-to-homescreen
- [ ] **Loading spinners & empty states:** No blank screens during API fetches
- [ ] **Toast notifications:** Success/error feedback on actions
- [ ] **MyAccount persistence:** Wire settings to API

---

## Future — Production Path

Priority: **MEDIUM** — After infrastructure is solid.

- [ ] **Stripe Connect integration:** Marketplace payments (families pay, caregivers get paid, platform takes fee)
- [ ] **Input validation & rate limiting:** Lock down API routes
- [ ] **Geocoding & distance:** Real address → lat/lng for caregiver matching
- [ ] **Recurring sessions:** Weekly/biweekly repeating care sessions
- [ ] **Visit photos:** File upload for visit documentation
- [ ] **Tests:** Auth flow, session booking, payment flow
- [ ] **Real-time updates:** WebSocket or SSE for activity feed
- [ ] **Sibling logins:** Add David and Susan Lee with generic credentials
- [ ] **Build step for frontend:** Move to Vite when component count demands it
