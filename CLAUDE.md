# InPlace — Project Context

## What This Is

InPlace is an on-demand care coordination platform connecting families with professional caregivers for elderly/parent care. Think "Uber for home caregiving." The primary user is Pete Lee, who is managing care for his mother Betty Lee (78, early-stage dementia, mild arthritis) in Blacksburg, VA.

## Live Demo

https://yourinplace.com

## Tech Stack

- **Backend:** Node.js + Express (v4), port 3001
- **Database:** SQLite via sql.js (zero native deps, file-based at `./inplace.db`)
- **Auth:** JWT tokens (7-day expiry), bcryptjs for password hashing
- **Frontend:** Modular React SPA (via CDN — React 18, ReactDOM, Babel standalone). No build step — Babel compiles JSX in-browser.
- **Deployment:** Railway.app (NIXPACKS builder), Cloudflare DNS/proxy for yourinplace.com
- **IDs:** UUID v4 for all entities

## Project Structure

```
├── CLAUDE.md                  ← You are here
├── TASKS.md                   ← Active task list & bug tracker
├── ROADMAP.md                 ← Development roadmap (phased)
├── README.md                  ← API docs, demo credentials, examples
├── package.json               ← Dependencies & scripts
├── .env.example               ← Config template (copy to .env for local dev)
├── .env                       ← Local config (gitignored — auto-created for dev)
├── railway.json               ← Railway deployment config
├── public/
│   ├── index.html             ← Slim shell (~60 lines) — loads CSS, React CDN, fetches & compiles all JS with cache-bust param
│   ├── css/
│   │   └── styles.css         ← All CSS (~1,600 lines)
│   └── js/
│       ├── utils.js           ← Shared utilities: apiFetch, setAuthToken, scheduling helpers, caregiver data
│       ├── app.js             ← App root component: routing, sidebar, page switching, modal management
│       └── components/
│           ├── InPlaceIcon.js          ← SVG logo component ("iP" monogram)
│           ├── SplashPage.js           ← Investor pitch landing page (market stats, problem/solution, business model, vision, waitlist capture)
│           ├── LoginPage.js            ← Email/password login with demo account quick-select
│           ├── RegisterPage.js         ← Multi-step registration wizard (family or caregiver)
│           ├── Dashboard.js            ← Stats cards, upcoming sessions, assigned caregivers
│           ├── CareProfile.js          ← Care recipient profile with emergency contacts
│           ├── Schedule.js             ← Calendar heat map with saturation shading, session details
│           ├── Caregivers.js           ← Browse/search caregivers, assign/unassign/favorite
│           ├── CareRecipients.js       ← Add/edit care recipients (CRUD)
│           ├── ActivityFeed.js         ← Notification stream with mark-as-read
│           ├── Messages.js             ← Real-time chat (database-backed conversations)
│           ├── MyAccount.js            ← Settings & notification preferences (UI only)
│           ├── CaredForView.js         ← Betty's limited view (calendar + personal notes)
│           ├── CaretakerHub.js         ← Caregiver dashboard (schedule, families, earnings, reviews)
│           ├── AreaMap.js              ← Leaflet/OpenStreetMap with family location pins (caregiver view)
│           ├── RequestCareModal.js     ← 5-step care request wizard with caregiver matching
│           └── CaregiverScheduleModal.js ← View caregiver availability, book from schedule
└── src/
    ├── server.js              ← Express app, route mounting, static file serving, auto-seed on empty DB
    ├── seed.js                ← Demo data (5 users, 4 caregivers, 13 sessions, messages, assignments)
    ├── models/
    │   └── database.js        ← SQLite schema (16 tables), sql.js wrapper
    ├── middleware/
    │   └── auth.js            ← generateToken, authenticate, requireRole
    └── routes/
        ├── auth.js            ← POST register, POST login, GET /me
        ├── careRecipients.js  ← CRUD for care recipients (parents)
        ├── sessions.js        ← Care session booking, matching, status updates
        ├── caregivers.js      ← Caregiver search, profiles, profile creation
        ├── activity.js        ← Activity feed, mark-read, visit log submission
        ├── dashboard.js       ← Aggregated stats & upcoming sessions
        ├── messages.js        ← Send/receive messages, conversation list
        ├── notes.js           ← Care recipient notes (Betty's personal notes)
        ├── assignments.js     ← Caregiver-to-recipient assignments, favorites
        └── waitlist.js        ← POST signup, GET count (no auth required)
```

## Frontend Architecture

The frontend uses **Babel standalone** for in-browser JSX transpilation (no build step, no bundler). The `index.html` shell fetches all JS files in parallel via `fetch()`, concatenates them in dependency order, and has Babel compile the combined source once. This means all files share one scope after compilation.

**Cache busting:** All script and CSS fetches include a `?v=X.Y.Z` query parameter. Bump this version in `index.html` whenever you push frontend changes to bust Cloudflare's cache. Without this, users may get stale JS files.

**Pattern for component files:**
```javascript
// Each component declares itself AND assigns to window (for individual-file testing)
const MyComponent = window.MyComponent = ({ prop1, prop2 }) => {
  // component body using useState, useEffect, apiFetch, etc.
};
```

**Dependency order matters:** utils.js → InPlaceIcon → other components → app.js. When adding a new component, add it to the `scripts` array in `index.html` before `app.js`.

## Three User Roles

The app supports three login roles, each with a different sidebar and dashboard:

| Role | User | Email | View |
|------|------|-------|------|
| Care Team (family) | Pete Lee | pete@inplace.care | Full dashboard, scheduling, caregiver management, care profile |
| Caretaker (caregiver) | Maria Garcia | maria@inplace.care | CaretakerHub with schedule, families, earnings, area map |
| Cared-For (recipient) | Betty Lee | betty@inplace.care | CaredForView with calendar and personal notes |

All demo passwords: `inplace123`

## Database Tables

users, care_recipients, caregiver_profiles, availability, care_sessions, visit_logs, visit_photos, activity_feed, reviews, payments, messages, recipient_notes, caregiver_assignments, waitlist

All tables use TEXT primary keys (UUIDs). Timestamps are TEXT via `datetime('now')`. JSON fields (health_conditions, medications, specialties, certifications, tasks_completed) are stored as JSON strings — parse with `JSON.parse()` on read.

## Design System

- Primary color: `#1b6b5a` (teal)
- Accent color: `#e8724a` (orange)
- Logo: "iP" monogram in rounded teal square (DM Sans 800)
- Font: System fonts (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
- Layout: Sidebar (240px) + scrollable main content
- Mobile: Not currently responsive

## API Patterns

All API responses follow `{ fieldName: value }` or `{ collectionName: [...] }` format. Routes use `authenticate` middleware from `src/middleware/auth.js`. The `req.user` object contains `{ id, email, role }` from the JWT payload.

## Local Development

```bash
npm install          # Install dependencies (one time)
npm run dev          # Start server with --watch (auto-restarts on backend changes)
```

Then open `http://localhost:3001` in a browser. That's it — no build step.

**Editing frontend:** Change any file in `public/js/` or `public/css/`, then refresh the browser. Babel recompiles on every page load.

**Editing backend:** Change any file in `src/`, the server auto-restarts via `--watch`.

**Resetting demo data:** Run `npm run seed` to wipe the database and repopulate with demo data.

**Adding a new component:** Create `public/js/components/NewComponent.js` using the window pattern, then add its path to the `scripts` array in `index.html` (before `app.js`), and reference it in `app.js`.

## Deploying to Railway

Railway auto-deploys on every `git push origin main`. No build config needed — it runs `npm start`.

Environment variables on Railway are set in the Railway dashboard (not in `.env`). The production JWT_SECRET is different from the local dev one.

**Important:** After pushing frontend changes, bump the `?v=X.Y.Z` cache-bust parameter in `index.html` so Cloudflare serves fresh files. Without this, the live site may show stale JS/CSS.

The production DB auto-seeds when empty. If the DB filename changes (e.g., during a rebrand), Railway creates a fresh DB and seeds it automatically on first request.

## Scripts

- `npm start` — Production server
- `npm run dev` — Dev with --watch (backend auto-restart, frontend just refresh browser)
- `npm run seed` — Reset & populate demo data
- `npm run setup` — Seed + start combined

## Known Limitations

1. MyAccount settings don't persist (UI only)
2. No input validation or rate limiting
3. No tests
4. No real-time updates (polling only)
5. Not mobile-responsive
6. Payments table exists but no payment processing
7. Visit photos table exists but no file upload support
