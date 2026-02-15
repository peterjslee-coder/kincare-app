# KinCare Development Roadmap

## Guiding Principles

1. **Ease of change first** — Every structural decision should make the next change cheaper and safer. Modular files, clear naming, separated concerns.
2. **Expand future capabilities** — Build the foundation (validation, tests, real-time) that makes advanced features possible without rewrites.
3. **Demo-ready at all times** — The Railway deployment at `https://kincare-app-production.up.railway.app` must always work as a polished demo for investors and employees. No broken deploys.

---

## Completed (v0.1 — Current)

- [x] Express API with JWT auth (register, login, profile)
- [x] SQLite database with 10-table schema
- [x] Care recipient CRUD (add/edit parents)
- [x] Caregiver search with availability filtering
- [x] Care session booking with caregiver matching
- [x] Session status lifecycle (pending → confirmed → in-progress → completed)
- [x] Visit logs with mood tracking and task lists
- [x] Activity feed with read/unread notifications
- [x] Dashboard with aggregated stats
- [x] Demo seed data (Pete + Betty + 4 caregivers)
- [x] Railway.app deployment config
- [x] Frontend SPA with splash, login, registration
- [x] Sidebar navigation with 9 pages
- [x] Request Care modal with caregiver schedule matching
- [x] Editable Care Profile and Care Recipients pages
- [x] CLAUDE.md context file for development continuity
- [x] ROADMAP.md development roadmap

---

## Phase 1 — Frontend Modularity (Ease of Change)

Priority: **HIGH** — This unblocks all other frontend work and makes every future change safer.

The entire frontend lived in a single `public/index.html` (3,900 lines). Split into maintainable pieces while keeping the zero-build-step CDN approach.

- [x] Split CSS into `public/css/styles.css`
- [x] Extract shared utilities into `public/js/utils.js` (apiFetch, auth helpers, scheduling data & helpers)
- [x] Extract each component into `public/js/components/<ComponentName>.js`
- [x] Create slim `index.html` shell with script imports
- [ ] Verify all pages still render and API calls still work
- [ ] Update CLAUDE.md with new file structure

Target structure:
```
public/
├── index.html              (shell: <div id="root">, script imports)
├── css/
│   └── styles.css          (~1,600 lines of CSS)
└── js/
    ├── utils.js            (apiFetch, setAuthToken, scheduling helpers, data)
    ├── app.js              (App root component, routing, sidebar)
    └── components/
        ├── SplashPage.js
        ├── LoginPage.js
        ├── RegisterPage.js
        ├── Dashboard.js
        ├── CareProfile.js
        ├── Schedule.js
        ├── Caregivers.js
        ├── CareRecipients.js
        ├── ActivityFeed.js
        ├── Messages.js
        ├── MyAccount.js
        ├── CaretakerHub.js
        ├── RequestCareModal.js
        ├── CaregiverScheduleModal.js
        └── KinCareIcon.js
```

Notes: Since we use Babel standalone (in-browser transpilation), each .js file uses `type="text/babel"` and components are attached to `window` so they can reference each other across files. No bundler needed.

---

## Phase 2 — Demo Polish (Demo-Ready)

Priority: **HIGH** — The Railway demo needs to feel complete for investor/employee walkthroughs.

- [ ] Fix MyAccount to show correct user data (currently hardcoded "Pete Anderson" instead of "Pete Lee")
- [ ] Wire Messages to real backend (add messages table, API routes, connect to component)
- [ ] Build CaretakerHub with real data (caregiver's own sessions, earnings from payments table)
- [ ] Add loading spinners and empty states so nothing looks broken
- [ ] Update splash page copyright from 2025 to 2026
- [ ] Ensure demo seed data has sessions spanning current dates (not stale past dates)

---

## Phase 3 — Complete Existing Features (Future Capabilities)

Priority: **MEDIUM** — Fill in the backend gaps so features work end-to-end.

- [ ] **MyAccount persistence:** Wire notification preferences and profile edits to API (PUT /api/auth/me)
- [ ] **Visit photos:** Add file upload endpoint (multipart/form-data → local storage or S3), display photos in visit logs
- [ ] **Payment processing:** Stripe Connect integration for caregiver payouts
- [ ] **Recurring sessions:** Allow scheduling weekly/biweekly repeating care sessions

---

## Phase 4 — Data Integrity & Reliability (Ease of Change)

Priority: **MEDIUM** — Protect against regressions as the codebase grows.

- [ ] Input validation on all API routes (required fields, types, ranges)
- [ ] Rate limiting on auth endpoints (prevent brute force)
- [ ] Error handling improvements (consistent error response format across all routes)
- [ ] API tests (at minimum: auth flow, session booking flow, caregiver search)
- [ ] Database migrations strategy (for schema changes without data loss)
- [ ] Frontend error boundaries (catch component crashes gracefully)

---

## Phase 5 — UX & Mobile (Demo-Ready)

Priority: **MEDIUM** — Make the demo shine on any device.

- [ ] Mobile-responsive layout (sidebar → bottom nav on mobile)
- [ ] Toast notifications for success/error feedback
- [ ] Form validation with inline error messages
- [ ] Skeleton loading screens
- [ ] Accessibility audit (ARIA labels, keyboard navigation, contrast)

---

## Phase 6 — Scale & Advanced Features (Future Capabilities)

Priority: **LOW** — Growth features for production.

- [ ] Real-time updates (WebSocket or SSE for activity feed, session status changes)
- [ ] Location-based caregiver matching (distance calculation, map view)
- [ ] Push notifications (Firebase or web push)
- [ ] Caregiver onboarding flow (background check integration, document uploads)
- [ ] Family sharing (multiple family members on one care recipient)
- [ ] PostgreSQL migration (for production scale)

---

## Version History

| Version | Date       | Summary |
|---------|------------|---------|
| 0.1.0   | 2026-02-15 | Initial release — full API, monolithic SPA frontend |
| 0.2.0   | 2026-02-15 | Frontend modularized — 17 files from 1, CLAUDE.md + ROADMAP.md added |
