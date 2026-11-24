# Local development, conventions and deploys

_Moved out of CLAUDE.md on 2026-09-13. Architecture lives in `ARCHITECTURE.md`; this is the day-to-day._

## Design System


- Primary color: `#1b6b5a` (teal)
- Accent color: `#e8724a` (orange)
- Logo: "iP" monogram in rounded teal square (DM Sans 800)
- Font: System fonts (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
- Layout: Sidebar (240px) + scrollable main content
- Mobile: Bottom nav bar on ≤768px, sidebar on desktop

## Local Development


```bash
npm install          # Install dependencies (one time)

# Set up PostgreSQL:
# 1. Install PostgreSQL locally (brew install postgresql, or apt install postgresql)
# 2. Create a database: createdb inplace
# 3. Copy .env.example to .env and set DATABASE_URL=postgresql://user:password@localhost:5432/inplace

npm run dev          # Start server with --watch (auto-restarts on backend changes)
```

Then open `http://localhost:3001` in a browser. That's it — no build step.
The database auto-seeds with demo data on first run if empty.

**Editing frontend:** Change any file in `public/js/` or `public/css/`, then refresh the browser. Babel recompiles on every page load.

**Editing backend:** Change any file in `src/`, the server auto-restarts via `--watch`.

**Resetting demo data:** Run `npm run seed` to wipe the database and repopulate with demo data.

**Adding a new component:** Create `public/js/components/NewComponent.js` using the window pattern, then add its path to the `scripts` array in `index.html` (before `app.js`), and reference it in `app.js`.

## Deploying to Railway


Railway auto-deploys on every `git push origin main`. No build config needed — it runs `npm start`.

Environment variables on Railway are set in the Railway dashboard (not in `.env`). The production JWT_SECRET is different from the local dev one.

**Important:** After pushing frontend changes, bump the `?v=X.Y.Z` cache-bust parameter in `index.html` so Cloudflare serves fresh files. Without this, the live site may show stale JS/CSS.

The production PostgreSQL database is a Railway service. The `DATABASE_URL` env var is set in the Railway dashboard (provided by the PostgreSQL service). The DB auto-seeds when empty on first deploy.

## Scripts


- `npm start` — Production server
- `npm run dev` — Dev with --watch (backend auto-restart, frontend just refresh browser)
- `npm run seed` — Reset & populate demo data
- `npm run setup` — Seed + start combined
- `npm test` — Run Jest test suite (53 tests, no database needed)
- `npm run collect-feedback` — Fetch all user feedback from production into FEEDBACK.md
- `npm run collect-feedback -- --triage` — Quick triage: show new items + counts (fast, no file write)
- `npm run collect-feedback -- --mark-reviewed` — Bulk mark all 'new' items as 'reviewed'

## API Patterns


All API responses follow `{ fieldName: value }` or `{ collectionName: [...] }` format. Routes use `authenticate` middleware from `src/middleware/auth.js`. The `req.user` object contains `{ id, email, role }` from the JWT payload.
