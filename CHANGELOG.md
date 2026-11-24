# InPlace Changelog

> Human-readable record of what shipped per version. Updated each dev session.

## v1.47.3 — March 17, 2026
- iPAi caregiver coaching — private AI tips after each session, specific to care recipient
- iPAi badge on existing AI Care Summary section (replaces sparkle icon + "by inPlace's AI tool")

## v1.47.2 — March 17, 2026
- Fix paused caregiver can accept jobs — server 403 + client disabled buttons

## v1.47.1 — March 17, 2026
- iPAi Care Intelligence engine — deep behavioral + medical insights from visit data
- IPAiInsightsCard component on Care Profile page
- Post-session AI summaries for families (auto-generated after checkout)
- Caregiver coaching tips (private, per-recipient)
- API: /api/care-intelligence/:recipientId, /patterns, /session-summary, /coaching

## v1.47.0 — March 17, 2026
- iPAi brand — checkmark badge component (IPAiBadge.js)
- AI matching engine — 6-factor weighted scoring (proximity, care skills, experience, schedule, rating, rate)
- FindWork sorts by Best Match with score badges
- Replaced "GREAT MATCH" pill with iPAi badge

## v1.46.14 — March 17, 2026
- Feedback tab badge count in admin panel

## v1.46.13 — March 17, 2026
- Fix FAQ admin access (help.js was checking req.isAdmin wrong)

## v1.46.12 — March 17, 2026
- Costs tracking tab — recurring expenses, one-time entries, auto-pull Twilio/Stripe
- Admin alert breakdown on tabs (People, Sessions, Auth show counts)

## v1.46.11 — March 17, 2026
- Manual freeze button + message button on caregiver rows in admin People tab

## v1.46.10 — March 17, 2026
- Admin service messaging — send as "InPlace Support" with sender_label
- Enhanced paused caregiver cards in Action Required banner

## v1.46.9 — March 17, 2026
- Tightened admin alert counts — exclude legacy accounts and old feedback

## v1.46.8 — March 17, 2026
- Admin alert badge on sidebar/bottom nav (red badge with count)
- Paused caregivers in Action Required banner with Reinstate button

## v1.46.7 — March 17, 2026
- Session continuity system: CHANGELOG.md, TASKS_ARCHIVE.md, CLAUDE.md handoff
- Feedback-loop scheduled task rewritten to output FEEDBACK_NEW.md

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
