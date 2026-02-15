# KinCare — Project Context

## What This Is

KinCare is an on-demand care coordination platform connecting families with professional caregivers for elderly/parent care. Think "Uber for home caregiving." The primary user is Pete Lee, who is managing care for his mother Betty Lee (78, early-stage dementia, mild arthritis) in Blacksburg, VA.

## Live Demo

https://kincare-app-production.up.railway.app

## Tech Stack

- **Backend:** Node.js + Express (v4), port 3001
- **Database:** SQLite via sql.js (zero native deps, file-based at `./kincare.db`)
- **Auth:** JWT tokens (7-day expiry), bcryptjs for password hashing
- **Frontend:** Modular React SPA (via CDN — React 18, ReactDOM, Babel standalone). No build step — Babel compiles JSX in-browser.
- **Deployment:** Railway.app (NIXPACKS builder)
- **IDs:** UUID v4 for all entities

## Project Structure

```
kincare-repo/
├── CLAUDE.md                  ← You are here
├── ROADMAP.md                 ← Development roadmap & task tracking (read this for what's done and what's next)
├── README.md                  ← API docs, demo credentials, examples
├── package.json               ← Dependencies & scripts
├── .env.example               ← Config template (copy to .env for local dev)
├── .env                       ← Local config (gitignored — auto-created for dev)
├── railway.json               ← Railway deployment config
├── public/
│   ├── index.html             ← Slim shell (~60 lines) — loads CSS, React CDN, then fetches & compiles all JS
│   ├── css/
│   │   └── styles.css         ← All CSS (~1,600 lines)
│   └── js/
│       ├── utils.js           ← Shared utilities: apiFetch, setAuthToken, scheduling helpers, caregiver data
│       ├── app.js             ← App root component: routing, sidebar, page switching, modal management
│       └── components/
│           ├── KinCareIcon.js          ← SVG logo component
│           ├── SplashPage.js           ← Landing page (testimonials, features, pricing, CTA)
│           ├── LoginPage.js            ← Email/password login form
│           ├── RegisterPage.js         ← Multi-step registration wizard (family or caregiver)
│           ├── Dashboard.js            ← Stats cards, upcoming sessions, recent activity
│           ├── CareProfile.js          ← Editable care recipient profile (Betty's details)
│           ├── Schedule.js             ← Calendar view of care sessions
│           ├── Caregivers.js           ← Browse/search caregivers, trigger scheduling modal
│           ├── CareRecipients.js       ← Add/edit care recipients (CRUD)
│           ├── ActivityFeed.js         ← Notification stream with mark-as-read
│           ├── Messages.js             ← Chat UI (client-side mock, no backend yet)
│           ├── MyAccount.js            ← Settings & notification preferences (UI only)
│           ├── CaretakerHub.js         ← Caregiver-side dashboard (placeholder)
│           ├── RequestCareModal.js     ← 5-step care request wizard with caregiver matching
│           └── CaregiverScheduleModal.js ← View caregiver availability, book from schedule
└── src/
    ├── server.js              ← Express app, route mounting, static file serving, auto-seed on empty DB
    ├── seed.js                ← Demo data (5 users, 4 caregivers, 13 sessions)
    ├── models/
    │   └── database.js        ← SQLite schema (10 tables), sql.js wrapper
    ├── middleware/
    │   └── auth.js            ← generateToken, authenticate, requireRole
    └── routes/
        ├── auth.js            ← POST register, POST login, GET /me
        ├── careRecipients.js  ← CRUD for care recipients (parents)
        ├── sessions.js        ← Care session booking, matching, status updates
        ├── caregivers.js      ← Caregiver search, profiles, profile creation
        ├── activity.js        ← Activity feed, mark-read, visit log submission
        └── dashboard.js       ← Aggregated stats & upcoming sessions
```

## Frontend Architecture

The frontend uses **Babel standalone** for in-browser JSX transpilation (no build step, no bundler). The `index.html` shell fetches all JS files in parallel via `fetch()`, concatenates them in dependency order, and has Babel compile the combined source once. This means all files share one scope after compilation.

**Pattern for component files:**
```javascript
// Each component declares itself AND assigns to window (for individual-file testing)
const MyComponent = window.MyComponent = ({ prop1, prop2 }) => {
  // component body using useState, useEffect, apiFetch, etc.
};
```

**Dependency order matters:** utils.js → KinCareIcon → other components → app.js. When adding a new component, add it to the `scripts` array in `index.html` before `app.js`.

## Database Tables

users, care_recipients, caregiver_profiles, availability, care_sessions, visit_logs, visit_photos, activity_feed, reviews, payments

All tables use TEXT primary keys (UUIDs). Timestamps are TEXT via `datetime('now')`. JSON fields (health_conditions, medications, specialties, certifications, tasks_completed) are stored as JSON strings — parse with `JSON.parse()` on read.

## Design System

- Primary color: `#1b6b5a` (teal)
- Accent color: `#e8724a` (orange)
- Font: System fonts (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
- Layout: Sidebar (240px) + scrollable main content
- Mobile: Not currently responsive

## API Patterns

All API responses follow `{ fieldName: value }` or `{ collectionName: [...] }` format. Routes use `authenticate` middleware from `src/middleware/auth.js`. The `req.user` object contains `{ id, email, role }` from the JWT payload.

## Demo Credentials

- **Email:** pete@kincare.app
- **Password:** kincare123
- **Role:** family

## Local Development

```bash
npm install          # Install dependencies (one time)
npm run dev          # Start server with --watch (auto-restarts on backend changes)
```

Then open `http://localhost:3001` in a browser. That's it — no build step.

**Editing frontend:** Change any file in `public/js/` or `public/css/`, then refresh the browser. Babel recompiles on every page load.

**Editing backend:** Change any file in `src/`, the server auto-restarts via `--watch`.

**Resetting demo data:** Run `npm run seed` to wipe the database and repopulate with demo data.

**Adding a new component:** Create `public/js/components/NewComponent.js` using the pattern below, then add its path to the `scripts` array in `index.html` (before `app.js`), and reference it in `app.js`.

```javascript
const NewComponent = window.NewComponent = ({ prop1 }) => {
  // component body
};
```

## Deploying to Railway

Railway auto-deploys on every `git push origin main`. No build config needed — it runs `npm start`.

Environment variables on Railway are set in the Railway dashboard (not in `.env`). The production JWT_SECRET is different from the local dev one.

```bash
git add -A && git commit -m "description" && git push origin main
```

## Scripts

- `npm start` — Production server
- `npm run dev` — Dev with --watch (backend auto-restart, frontend just refresh browser)
- `npm run seed` — Reset & populate demo data
- `npm run setup` — Seed + start combined

## Archive

The `archive/` folder (gitignored) contains previous versions of files for local reference. Currently holds `index-monolithic-v0.1.html` — the original single-file frontend before modularization.

## Known Limitations

1. Messages page is client-side mock only (no backend routes)
2. MyAccount settings don't persist
3. CaretakerHub is a placeholder
4. No input validation or rate limiting
5. No tests
6. No real-time updates (polling only)
7. Not mobile-responsive
8. Payments table exists but no payment processing
9. Visit photos table exists but no file upload support
