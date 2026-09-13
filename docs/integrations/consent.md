# Consent & authorization tiers

_Moved out of CLAUDE.md on 2026-09-13. Verify against the code before relying on details here._



Three authorization tiers for care recipients:

- **Tier 1 (Self-signup):** Care recipient has their own account — auto-verified, no consent needed.
- **Tier 2 (POA/Guardianship):** Family uploads legal documents → AI classification via Claude → admin review → approve/reject.
- **Tier 3 (Family Attestation):** Family signs attestation + provides care recipient's email → system sends outreach email directly to care recipient → care recipient responds (aware / questions / did not authorize) → admin reviews everything → approve/reject.

Key files: `src/routes/consent.js` (auth per-route, not global — respond/:token endpoints are PUBLIC for care recipients), `src/routes/admin.js` (consent review + bg check approval), `public/js/components/ConsentVerification.js` (frontend flow), `public/js/components/ConsentResponsePage.js` (standalone public page for care recipient responses).

The consent_outreach table tracks emails sent + recipient responses. Attestations have admin_status (pending/approved/rejected). First-visit confirmation by caregivers is BLOCKING — "no"/"unable" pauses future bookings.
