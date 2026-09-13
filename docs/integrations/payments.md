# Payments — Stripe Connect

_Moved out of CLAUDE.md on 2026-09-13. Verify against the code before relying on details here._



**Money flow:** Family pays → Stripe processes → Stripe splits (80% caregiver, 20% platform) → Platform balance settles to Mercury bank account.

**Admin kill switch:** Payments are OFF by default. An admin must enable them via the Financials tab toggle in AdminPanel. The `payments_enabled` key in `platform_settings` gates all Stripe-touching endpoints (`/connect/onboard`, `/checkout`, `/background-check`). When disabled, these endpoints return 503 with `paymentsDisabled: true`.

**Stripe Connect (v1.40.6–v1.40.8):** Caregiver onboarding creates Express accounts with `card_payments` + `transfers` capabilities. Frontend tries embedded Connect.js component first (3s timeout), falls back to redirect-based onboarding via Account Links if Connect.js unavailable (e.g., Stripe CDN 503).

**Identity Verification — REMOVED for caregivers (v1.40.9):** Separate Stripe Identity verification was redundant — caregivers are already ID-verified through Stripe Connect onboarding (legal name, DOB, SSN, bank account) AND Checkr background check (full SSN, DOB, identity verification). The `identity_verified` gate was removed from the checkout flow. Family identity verification in MyAccount.js and CareRecipients.js attestation flow is preserved.

**Webhook:** `POST /api/payments/webhook` receives Stripe events (checkout completed/expired, payment succeeded/failed, account updated, identity.verification_session.verified, identity.verification_session.requires_input). Uses raw body parsing for signature verification. Must be registered in Stripe Dashboard → Developers → Webhooks pointing at `https://yourinplace.com/api/payments/webhook`. Requires `STRIPE_WEBHOOK_SECRET` env var on Railway.

**Key files:** `src/routes/payments.js` (all payment + identity endpoints + webhook), `src/routes/financials.js` (admin financials + kill switch), `public/js/components/AdminFinancials.js` (admin UI), `public/js/components/FamilyPayments.js` (family payment history), `public/js/components/CaretakerHub.js` (caregiver identity verification UI).

**Env vars (Railway):** `stripe_secret_key` (live), `stripe_publishable_key` (live), `STRIPE_WEBHOOK_SECRET` (from Stripe webhook config).
