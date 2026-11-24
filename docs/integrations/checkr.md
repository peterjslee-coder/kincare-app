# Checkr background checks

_Moved out of CLAUDE.md on 2026-09-13. Verify against the code before relying on details here._



**Status:** Checkr Partner Certification compliance achieved (all requirements except OAuth, which is N/A for single-account setups).

**Authentication:** Basic auth (`"Basic " + Buffer.from(key + ":").toString("base64")`), NOT Bearer. Base URL controlled by `CHECKR_STAGING` env var (true = staging sandbox, false/unset = production).

**Key files:** `src/routes/checkr.js` (all Checkr API + webhooks), `public/js/components/AdminPanel.js` (admin BG check management), `public/js/components/CaregiverOnboarding.js` (middle name collection).

**API endpoints implemented:**
- `GET /packages` — Dynamic package list from Checkr account
- `GET /nodes?include=packages` — Account hierarchy with node-specific packages
- `POST /candidates` — Creates candidate with `custom_id`, `phone`, `middle_name`/`no_middle_name`, `email`, `first_name`, `last_name`
- `POST /invitations` — Creates Checkr-hosted invitation with `node`, `work_locations`
- `GET /reports/:id` — Fetches report details; uses `report.result` (not `report.status`) for findings

**Webhook handlers (12+ types):**
- `report.completed` — Updates status to `clear` or `consider` based on `result` field
- `report.updated` — Tracks `estimated_completion_time` (ETA)
- `report.created` — Initial report creation tracking
- `report.suspended` / `report.resumed` — Status tracking
- `report.disputed` — Dispute tracking
- `report.post_adverse_action` — Adverse action workflow
- `report.engaged` — Report engagement tracking
- `invitation.created` — Invitation lifecycle tracking
- `invitation.completed` — Marks `processing` status, captures ETA
- `invitation.expired` — Marks invitation expired
- `invitation.deleted` — Marks invitation deleted

**Re-initiation flow:** Candidates with status `invitation_expired`, `invitation_canceled`, `rejected`, or `did_not_pass` can re-initiate BG checks. Reuses existing `checkr_candidate_id`, creates new invitation. Status resets to `initiated`, ETA cleared.

**BG check admin flow:** Admin can approve (`consider` → `consider_approved`) or reject (`consider` → `rejected`) flagged results. Rejected caregivers get soft-locked (account_paused) with appeal option. Admin can later approve a rejected candidate (back to `consider`).

**ETA tracking:** `checkr_eta` column on `caregiver_profiles` stores `estimated_completion_time` from webhooks. Admin panel displays "~X days remaining" or "Due any time now" for processing candidates.

**DB columns added (v1.50.32):**
- `caregiver_profiles.legal_middle_name` TEXT — Collected in CaregiverOnboarding Step 4
- `caregiver_profiles.checkr_eta` TIMESTAMPTZ — ETA from Checkr webhooks

**Important:** `report.result` = finding (clear/consider). `report.status` = lifecycle (pending/complete). Always use `result` for pass/fail logic.
