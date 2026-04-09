# InPlace v1.58.0 Release Notes

**Date:** April 8, 2026
**Range:** v1.57.90 → v1.58.0

## New Features

- **Identity Verification for All Users** (v1.57.99) — Any user can now verify their identity with a selfie + photo ID directly from My Account. Verified users earn a blue check badge on their profile. No longer limited to caregiver onboarding — family members, DPOA holders, and care_for users can all verify.

- **Admin Set Password** (v1.57.96) — Admins can set a temporary password for users whose reset emails aren't being delivered (e.g., Hotmail filtering). User is prompted to change it on next login.

- **Admin Session Rewind** (v1.57.94) — Admins can undo a checkout or check-in for testing and correction purposes.

- **Superseding Push Notifications** (v1.57.92) — Session lifecycle pushes (check-in, checkout, no-show) replace previous notifications for the same session instead of stacking.

## Bug Fixes

- **Payment hold banner too aggressive** (v1.57.95) — "Account on hold" banner was showing for any unpaid session past its due time. Now only triggers when payment_status is actually 'failed', matching the backend logic.

- **5-minute billing increments** (v1.57.95) — Early checkout billing display and server-side calculation were using 15-min rounding. Fixed to 5-min increments to match the checkout route.

- **Passkeys disabled in iOS native app** (v1.58.0) — iOS WKWebView reports passkey support but can't actually create/retrieve credentials. Passkey UI is now suppressed inside the Capacitor native shell to avoid silent failures.

- **PWA install banner in native app** (v1.57.97) — "Add to Home Screen" banner was showing inside the Capacitor iOS app because the WebView doesn't set display-mode: standalone. Added Capacitor detection.

- **Notification prompt in native app** (v1.57.98) — "Add to Home Screen for Notifications" instructions were also bleeding through into the native app. Same Capacitor detection fix applied.

- **Bottom nav covering modals** (v1.57.93) — Bottom navigation z-index was overlapping modal overlays on mobile.

- **No-show dismiss crash** (v1.57.91) — Caregiver ID mismatch + missing await when dismissing no-show alerts.

- **Caregiver /me route ordering** (v1.57.90) — Express route ordering fix preventing caregiver profile endpoint from matching.

## Removed

- "Coming Soon — Powered by Stripe Identity" placeholder text in CareRecipients and MyAccount (replaced with working in-house verification flow).
