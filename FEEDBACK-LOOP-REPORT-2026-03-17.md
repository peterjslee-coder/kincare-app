# Feedback Loop Report — 2026-03-17

## Status: ⚠️ Blocked — TOTP Required

The automated feedback loop ran on 2026-03-17 but could not retrieve feedback from the production API.

---

## What Happened

The scheduled task checked for `ADMIN_API_KEY` in `.env` — it was present and valid (`df6b60c29...`). However, when the task attempted to call the production feedback API using that key, it received:

```
{ "error": "Admin TOTP code required (x-admin-totp header)" }
```

The `authenticate` middleware in `src/middleware/auth.js` was updated to require a valid TOTP code (from your authenticator app) in addition to the admin API key, even for server-to-server / automated calls. The script `collect-feedback.js` and the scheduled task both pre-date this security change.

---

## Root Cause

`src/middleware/auth.js` (line 28–54) now requires `x-admin-totp` header whenever `x-admin-api-key` is used. This means fully automated feedback polling is no longer possible without a time-based OTP — which only exists in your authenticator app.

---

## Options to Fix

### Option A — Exempt the feedback read-only endpoints from TOTP (Recommended)
Add a list of "safe" read-only admin endpoints that only need the API key (no TOTP). Triage GET and bulk-update POST for feedback status changes are low-risk. Example in `auth.js`:

```js
const TOTP_EXEMPT_PATHS = [
  '/api/admin/feedback/triage',
  '/api/admin/feedback/bulk-update',
  '/api/feedback',
];
// Skip TOTP check for these paths when API key is present
if (!TOTP_EXEMPT_PATHS.some(p => req.path.startsWith(p))) {
  // ... existing TOTP check ...
}
```

### Option B — Store TOTP secret in Railway env for automated use
Generate a dedicated TOTP secret for the scheduled task (separate from your personal 2FA), store it as `ADMIN_TOTP_SECRET` in Railway, and have the task generate the code programmatically using `otplib`. This keeps TOTP in the loop but makes automation possible.

### Option C — Run the feedback loop manually
Until one of the above is implemented, run the feedback loop manually when you're at your computer:
```bash
cd /path/to/kincare-repo
ADMIN_API_KEY=df6b60c29e13a6f6cf5012fb9cc7fdd8132a985661ee19d1b17ff6e053d0cc55 node scripts/collect-feedback.js --triage
```
Then enter the TOTP code when prompted (this still won't work automatically, but you can run `npm run collect-feedback` interactively).

---

## Recommendation

Option A is the least invasive fix. The feedback triage endpoints are read-only (GET) and status-update-only (POST), carrying no financial or auth risk. Exempting them from TOTP allows scheduled automation to work while keeping TOTP protection on sensitive admin operations (force-password-reset, user deletion, payment controls, etc.).

---

*Automated run by scheduled task `feedback-loop` — 2026-03-17*
