# KinCare — Project Context

## What This Is

KinCare is an on-demand care coordination platform connecting families with professional caregivers for elderly/parent care. Think "Uber for home caregiving." The primary user is Pete Lee, who is managing care for his mother Betty Lee (78, early-stage dementia, mild arthritis) in Blacksburg, VA.

## Production Direction

**The goal is a real app on a phone for beta testing.** Everything we build should move toward this. Specifically:

- **Real users:** Beta will start with family/friends — possibly a real caretaker or one of us under a pseudonym. Accounts must persist across deploys and future iterations. No more throwaway demo-only data patterns.
- **Secure auth:** Current JWT + bcrypt is a reasonable starting point, but needs to graduate to a production auth service (e.g., Auth0, Clerk, Supabase Auth, or Firebase Auth) before real users touch it. Password reset, email verification, and session management are non-negotiable.
- **Payments:** Must integrate a real payment processor (Stripe Connect is the likely choice — supports marketplace payouts to caregivers). The `payments` table exists but nothing is wired yet.
- **Location services:** Leaflet/OpenStreetMap is fine for display, but real caregiver matching needs geocoding (Mapbox or Google Maps API) and distance calculation.
- **Mobile-first:** The app needs to work on phones. Current sidebar layout won't cut it. Plan for either a PWA (progressive web app) or React Native wrapper. The backend API is already phone-ready — it's the frontend that needs to adapt.
- **Database migration:** SQLite works for dev/demo but won't survive concurrent users. PostgreSQL migration is on the horizon (Railway supports it natively).

**Guiding principle:** Don't build shiny demo features that require complete overhaul. Every decision should be compatible with — or at least not block — the production path above.

## Tech Stack

- **Backend:** Node.js + Express (v4), port 3001
- **Database:** SQLite via sql.js (zero native deps, file-based at `./kincare.db`) — will migrate to PostgreSQL for production
- **Auth:** JWT tokens (7-day expiry), bcryptjs for password hashing — will migrate to production auth service
- **Frontend:** Modular React SPA (via CDN — React 18, ReactDOM, Babel standalone). No build step — Babel compiles JSX in-browser.
- **Maps:** Leaflet.js + OpenStreetMap (CDN) for interactive maps
- **Deployment:** Railway.app (NIXPACKS builder), auto-deploys on push to main
- **IDs:** UUID v4 for all entities

## Live Demo

https://kincare-app-production.up.railway.app

Demo logins: pete@kincare.app / maria@kincare.app / betty@kincare.app (all use `kincare123`)

## Project Structure

```
kincare-repo/
├── CLAUDE.md                  ← You are here — project context & production direction
├── TASKS.md                   ← Task tracking (bugs, features, done)
├── ROADMAP.md                 ← Development roadmap & phases
├── README.md                  ← API docs, demo credentials, examples
├── package.json               ← Dependencies & scripts
├── .env.example               ← Config template (copy to .env for local dev)
├── railway.json               ← Railway deployment config
├── public/
│   ├── index.html             ← Shell — loads CSS, Leaflet, React CDN, compiles all JS via Babel
│   ├── css/
│   │   └── styles.css         ← All CSS (~1,600 lines)
│   └── js/
│       ├── utils.js           ← Shared: apiFetch, setAuthToken, scheduling helpers, caregiver data
│       ├── app.js             ← Root component: role-based routing, sidebar, page switching
│       └── components/
│           ├── KinCareIcon.js          ← SVG logo component
│           ├── SplashPage.js           ← Landing page
│           ├── LoginPage.js            ← Login with demo quick-switch (Pete/Maria/Betty)
│           ├── RegisterPage.js         ← Multi-step registration wizard
│           ├── Dashboard.js            ← Pete's family dashboard (API-driven)
│           ├── CaretakerHub.js         ← Maria's caregiver dashboard
│           ├── CaredForView.js         ← Betty's limited view (calendar + notes)
│           ├── AreaMap.js              ← Leaflet/OpenStreetMap with family pins
│           ├── CareProfile.js          ← Care recipient profile + emergency contacts
│           ├── Schedule.js             ← Calendar heat map with saturation shading
│           ├── Caregivers.js           ← Assign/unassign/favorite caregivers
│           ├── CareRecipients.js       ← Add/edit care recipients
│           ├── ActivityFeed.js         ← Notification stream
│           ├── Messages.js             ← Real messaging (database-backed)
│           ├── MyAccount.js            ← Settings (UI only, not persisted)
│           ├── RequestCareModal.js     ← Care request wizard
│           └── CaregiverScheduleModal.js ← Book from caregiver schedule
└── src/
    ├── server.js              ← Express app, route mounting, auto-seed on empty DB
    ├── seed.js                ← Demo data (7 users, 4 caregivers, 19 sessions, 8 emergency contacts)
    ├── models/
    │   └── database.js        ← SQLite schema (13 tables), sql.js wrapper
    ├── middleware/
    │   └── auth.js            ← generateToken, authenticate, requireRole
    └── routes/
        ├── auth.js            ← Register, login, profile
        ├── careRecipients.js  ← Care recipient CRUD
        ├── emergencyContacts.js ← Emergency contact CRUD (nested under care-recipients)
        ├── sessions.js        ← Session booking, matching (favorites-weighted), status
        ├── caregivers.js      ← Search, profiles
        ├── assignments.js     ← Caregiver assignments + favorite toggle
        ├── activity.js        ← Activity feed, visit logs
        ├── dashboard.js       ← Role-aware aggregated stats
        ├── messages.js        ← Conversations + send/receive
        └── notes.js           ← Recipient notes CRUD
```

## Three User Roles

| Role | User | Sidebar | Key Features |
|------|------|---------|-------------|
| `family` | Pete Lee | Dashboard, Care Profile, Schedule, Caregivers, Activity, Recipients, Messages, Account | Full management — books sessions, assigns caregivers, manages contacts |
| `caregiver` | Maria Santos | Dashboard, Area Map, Schedule, Messages, Account | Sees assigned families, logs visits, views map, earns payments |
| `care_for` | Betty Lee | Home, Messages, Account | Calendar of sessions, personal notes, limited access |

## Database Tables (13)

users, care_recipients, caregiver_profiles, availability, care_sessions, visit_logs, visit_photos, activity_feed, reviews, payments, messages, recipient_notes, caregiver_assignments, emergency_contacts

All tables use TEXT primary keys (UUIDs). Timestamps via `datetime('now')`. JSON fields stored as strings — parse with `JSON.parse()` on read.

## Frontend Architecture

Babel standalone for in-browser JSX transpilation (no build step). `index.html` fetches all JS in parallel, concatenates in dependency order, Babel compiles once. All files share one scope.

**Component pattern:**
```javascript
const MyComponent = window.MyComponent = ({ prop1 }) => { /* ... */ };
```

**Dependency order:** utils.js → KinCareIcon → other components → app.js

## Design System

- Primary: `#1b6b5a` (teal) / Accent: `#e8724a` (orange)
- Font: System fonts (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
- Layout: Sidebar (240px) + scrollable main — not yet mobile-responsive

## Local Development

```bash
npm install          # One time
npm run dev          # Backend auto-restarts, frontend just refresh browser
npm run seed         # Reset & populate demo data
```

## Deploying

Railway auto-deploys on `git push origin main`. Environment variables set in Railway dashboard.

**After every push:** Update CLAUDE.md (project structure, version history, known limitations) and TASKS.md (mark completed items, add new bugs/features discovered during development). These files are the project's memory across sessions — if they're stale, the next session starts confused.

## Known Limitations (Production Blockers)

1. **Auth is demo-grade** — No password reset, no email verification, no session invalidation. JWT secret is static.
2. **SQLite won't scale** — Single-file DB, no concurrent write support. Must migrate to PostgreSQL.
3. **No payment processing** — Payments table exists but nothing is wired to Stripe or any processor.
4. **Not mobile-responsive** — Sidebar layout only works on desktop.
5. **No input validation or rate limiting** — API routes accept anything, no brute-force protection.
6. **No tests** — Zero test coverage.
7. **No real-time updates** — Polling only, no WebSocket/SSE.
8. **MyAccount doesn't persist** — UI only.
9. **No file uploads** — Visit photos table exists but no upload endpoint.
10. **Frontend is CDN/Babel** — Works but won't scale to large apps. May need build step eventually.

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-02-15 | Initial release — full API, monolithic SPA |
| 0.2.0 | 2026-02-15 | Frontend modularized — 17 files from 1 |
| 0.3.0 | 2026-02-15 | Batch 1: Role foundation — 3 logins, messaging, assignments, area map |
| 0.3.1 | 2026-02-15 | Batch 2: Calendar heat map, emergency contacts, favorites, past sessions |
