# InPlace

On-demand care coordination platform connecting families with professional caregivers. Live at **https://yourinplace.com**

## Quick Start

```bash
npm install
npm run dev          # starts on http://localhost:3001
```

The server auto-seeds demo data on first run. No build step — Babel compiles JSX in-browser.

## Demo Accounts

| Role | Email | Password | View |
|------|-------|----------|------|
| Care Team | pete@inplace.care | inplace123 | Full dashboard — manages Betty's care |
| Caregiver | maria@inplace.care | inplace123 | Caregiver hub — schedule, families, earnings |
| Care Recipient | betty@inplace.care | inplace123 | Limited view — calendar & personal notes |

## API Endpoints

All authenticated routes require: `Authorization: Bearer <token>`

### Auth
- `POST /api/auth/register` — Create account (family or caregiver)
- `POST /api/auth/login` — Returns JWT token
- `GET /api/auth/me` — Current user profile

### Care Recipients
- `GET /api/care-recipients` — List your care recipients
- `POST /api/care-recipients` — Add a care recipient
- `GET /api/care-recipients/:id` — Detail view
- `PUT /api/care-recipients/:id` — Update profile

### Care Sessions
- `GET /api/sessions` — List sessions (query: `?status=confirmed&from=2026-02-01`)
- `POST /api/sessions` — Create a care request
- `POST /api/sessions/:id/match` — Match a caregiver
- `PUT /api/sessions/:id/status` — Update status (confirm, start, complete, cancel)
- `GET /api/sessions/:id` — Session detail with visit log

### Caregivers
- `GET /api/caregivers` — Search (query: `?available=true&specialty=dementia`)
- `GET /api/caregivers/:id` — Profile + reviews
- `POST /api/caregivers/profile` — Create/update caregiver profile

### Messages
- `GET /api/messages/conversations` — List conversations
- `GET /api/messages/conversation/:userId` — Messages with a specific user
- `POST /api/messages` — Send a message

### Assignments
- `GET /api/assignments` — List caregiver assignments
- `POST /api/assignments` — Assign caregiver to care recipient
- `PUT /api/assignments/:id` — Update assignment (favorite toggle)
- `DELETE /api/assignments/:id` — Remove assignment

### Notes
- `GET /api/notes/:recipientId` — Get notes for a care recipient
- `POST /api/notes` — Create a note
- `PUT /api/notes/:id` — Update a note
- `DELETE /api/notes/:id` — Delete a note

### Activity Feed
- `GET /api/activity` — Notifications (query: `?unreadOnly=true`)
- `PUT /api/activity/:id/read` — Mark as read
- `PUT /api/activity/read-all` — Mark all as read
- `POST /api/activity/visit-log` — Caregiver submits visit notes

### Dashboard
- `GET /api/dashboard` — Aggregated stats, upcoming sessions, recent activity

### Waitlist (no auth)
- `POST /api/waitlist` — Email signup
- `GET /api/waitlist/count` — Total signups

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** SQLite via sql.js (zero native dependencies)
- **Auth:** JWT (jsonwebtoken + bcryptjs)
- **Frontend:** React 18 + Babel standalone (no build step)
- **Deployment:** Railway.app + Cloudflare

## Scripts

- `npm start` — Production server
- `npm run dev` — Dev with --watch
- `npm run seed` — Reset & populate demo data
- `npm run setup` — Seed + start combined

## Deploying

Railway auto-deploys on `git push origin main`. After pushing frontend changes, bump the `?v=X.Y.Z` cache-bust parameter in `index.html` to bust Cloudflare's cache.
