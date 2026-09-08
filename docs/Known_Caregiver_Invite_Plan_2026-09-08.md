# Known Caregiver Invite — plan

**Sep 8, 2026.** Mockup: claude.ai artifact "Known Caregiver Invite". Decided with Pete Sep 7–8.

## The job

Pete meets someone in the wild who could help with Betty. Today: "go to this website, click this
link, fill out this stuff." Wanted: he types name + email (+ phone, optional), and the next thing
that person gets is an email to finish setting up — for Betty only.

## Posture (decided — not a lawyer item)

**This is NOT a vouch.** InPlace does not control who works for a family that only uses us to
coordinate their own care. The family brought the caregiver; InPlace says so in plain words on
every surface and never displays a check it didn't run. The word "vouch" never reaches a screen.

- Family sees: *"Carol will be your caregiver for Betty. You know her; InPlace hasn't checked her
  background."* Listing badge for family-brought caregivers: **"Your caregiver · no background check"**.
- Caregiver sees: *"Pete Lee added you as Betty's caregiver."* Safety check is a note outside the
  queue: *"not needed for Betty — Pete brought you in himself. Add it whenever you want to work
  with other families."*

## Decisions

| Question | Answer |
| --- | --- |
| Who can send | Any care team **leader** for the recipient (same 403 as care team invites). |
| Phone | Optional, **stored only** (`users.phone` on accept). No SMS — TCPA/10DLC blocked. |
| Short path | **Account · A few quick details · Where your pay lands · A photo of your licence.** Wizard screens 1–4 then 8–9; screens 5–7 (certs, training, documents) skipped. Dashboard items preferences/avail-rates/photo/security drawn as *optional*, not to-do. |
| Entry point | Caregivers tab → Assigned: card "Add someone you already know" + an "Invited" list. |
| "Ready to book" | account + quick details + Stripe connected + licence photo **submitted**. ID approval stays the human gate; drawn `waiting`. |
| Existing account | Caregiver account with that email: no wizard — gate row + assignment on accept. Family/care_for account: 409, tell the leader. |
| Link life | 14 days; resend extends. |
| Cap | 5 open invites per leader. |
| Rename | route item `paperwork` label "The paperwork" → **"A few quick details"** everywhere. |

## Mechanism (reuse)

- **Gate bypass** = `bg_admin_vouches` row, `family_user_id = recipient.family_user_id` (the
  OWNER — what `sessions.js` checks against — not the inviter), `vouched_by = inviter`,
  `note = 'family-brought'`. Reused as plumbing only.
- **Tied to Betty** = active `caregiver_assignments` row (`family_user_id = owner`). Created when
  the caregiver profile exists: immediately for an existing caregiver account, otherwise from
  `POST /api/caregivers/profile` on first insert (`fulfillKnownCaregiverInvites`).
- **Invite** = `platform_invites` + new columns `kind`, `care_recipient_id`, `invited_name`,
  `phone` (MIGRATIONS_V2, `ADD COLUMN IF NOT EXISTS`).
- **Route** = `onboardingRoute.js` gets a `familyOnly` fact: items outside the short path get
  `optional: true`; `paperwork` spans screens 2–4; `about-you` folds into it. `remaining` counts
  only required. `ONBOARDING_ROUTE_LENGTH` stays 13.

## Routes (new)

- `POST /api/care-recipients/:id/known-caregiver` `{name, email, phone?}` — leader only.
- `GET /api/care-recipients/:id/known-caregivers` — invites + progress for "2 of 4 done".
- `POST /api/care-recipients/known-caregiver/:inviteId/resend`, `DELETE …/:inviteId` — leader only.
- `GET /api/platform-invites/info` additionally returns `kind, recipientFirstName, relationship, phone, invitedName`.
- `POST /api/platform-invites/accept-invite` — for `kind='known-caregiver'`: gate row, phone,
  notify **the inviter** (not admins), assignment if a profile already exists.

## Client

- `Caregivers.js` Assigned tab: door card, inline form, Invited section (resend / withdraw); badge text.
- `CaregiverOnboarding.js`: known-caregiver invite → hero "Pete Lee added you as Betty's
  caregiver", short route, step 4 → step 8, name/phone prefilled.
- `CaretakerHub.js`: `familyOnly` fact → optional items drawn as one grey "whenever you like" line.

## Not doing

SMS of any kind · care team invites for caregivers · any change to Checkr, identity or the human
gate · the admin vouch UI (unchanged).
