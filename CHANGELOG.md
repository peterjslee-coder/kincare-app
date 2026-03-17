# InPlace Changelog

> Human-readable record of what shipped per version. Updated each dev session.

## v1.46.6 — March 17, 2026
- Fix schedule day count labels ("tomorrow" showing for sessions 2 days away)
- Added `TimezoneHelper.getDaysUntil()` for calendar-date-based day counting

## v1.46.5 — March 17, 2026
- Pre-fill Stripe `business_profile` (mcc "8099", url "https://inplace.care") on Express account creation
- Caregivers no longer asked for webpage URL and industry during Stripe onboarding

## v1.46.4 — March 17, 2026
- Fix Stripe dashboard link in MyAccount.js — was hardcoded to platform dashboard
- Now uses `/api/payments/connect/dashboard` API to generate Express login link (same as CaretakerHub)

## v1.46.3 — March 16, 2026
- Fix Tony's duplicate proposal bug — expired proposals now filtered from Up Next
- Fix stale past-time open jobs in Find Work (server + client filtering)
- Add no-show visibility — red banner on caregiver dashboard, indicator on family pending reviews
- Add caregiver account pause on no-show (auto-pause + admin reinstate flow)
- Add admin "Restore" button for paused care recipient bookings
- Add admin "Paused Caregiver Accounts" section with reinstate buttons
- Consolidate checkout care notes — removed redundant "About Tony" field, single "Care Notes" section

## v1.46.0–v1.46.2 — March 15–16, 2026
- No-show detection system (`pollCaregiverNoShows`) — cancels session + pauses caregiver account after 30+ min with no check-in
- `caregiver_profiles` migration: added `account_paused`, `account_paused_reason`, `account_paused_at`, `account_reinstated_at`, `account_reinstated_by` columns
- Admin endpoints: GET `/api/admin/caregivers/paused`, POST `/api/admin/caregivers/:userId/reinstate`
- Admin endpoint: PUT `/api/admin/authorizations/:id` with `unpause` action for care recipients

## v1.41.0 — March 10, 2026
- Care recipient email required during add flow
- Getting Started checklist fix after adding care recipient
- "Complete your profile" check strengthened (requires city/zip)
- Connection accepted notification includes name
- Calendar text alignment fix
- Care preferences save fix
- Removed debug logging from jobMatching.js
- Feedback button gated to testers/admin only
- "Add your loved one" CTA card on empty dashboard
- Fixed "undefined" text in consent status banner
- Phone number formatting consistency (14 locations, 8 components)

---

*For versions before v1.41.0, see git log or TASKS_ARCHIVE.md for historical context.*
