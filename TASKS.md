# InPlace Tasks

> **How this works:** Add bugs and features below as you find them. Don't worry about wording or order. When you're ready for a dev session, say "let's work the task list" and Claude will batch everything together into one efficient push. Nothing gets executed until you say go.

## Bugs

> Open bugs ranked P0–P4. P0 = blocks users or creates liability. P1 = significant UX issue. P2 = moderate improvement. P3 = nice-to-have. P4 = aspirational.

### P0

- [x] **Timezone architecture — P0 fix complete (v1.50.21, Mar 19).** All time-sensitive backend operations now use care recipient's timezone (`care_recipients.timezone` column) instead of hardcoded Eastern. Fixed: (1) notification poller queries JOIN `care_recipients` and use per-session timezone for timing decisions, (2) check-in gate and late detection use `buildDateTimeInZone(date, time, careTz)` instead of naive `new Date()` parsing, (3) check-out early-minutes calculation uses care timezone, (4) accountability pollers (payment auth, late check-in, no-show) all use per-session timezone, (5) cancellation late-cancel detection uses care timezone, (6) poller date filter widened to cover all US timezones (no more single-timezone `scheduled_date = today` filter). Frontend `TimezoneHelper.js` and backend `src/utils/timezone.js` already existed — the fix was threading the timezone through all callers. ✅ Fixed v1.50.21
  - **Real-world example (Mar 19):** Pete is in Texas (CST). Betty's care is in Virginia (EST). Betty has an 8:00 AM EST appointment. Pete should get the "almost time" push notification at 6:45 AM CST (= 7:45 AM EST, 15 min before). Previously fired 45 min late because push timing used default Eastern without per-session lookup. Now fixed — poller reads `cr.timezone` per session.
  - **Real-world example (Mar 19):** Cary checked out early from a 4-hour session in Virginia. Her phone clock was 1 hour behind EST. The app computed duration using naive date parsing, making it look like she left 2 hours early instead of 1. Now fixed — check-out duration uses `buildDateTimeInZone` with care recipient's timezone.
  - **Core rule: All timing is anchored to where care happens.** Push notifications, check-in/check-out gates, session duration calculations, pay calculations, and dashboard displays must all use the care recipient's timezone. The caregiver's or family member's device timezone is irrelevant for session timing.

### P1

- [ ] **No thumbnail photos on any demo profile.** None of the demo users (Pete, Maria, Betty, other caregivers) have real profile photos — just emoji placeholders or SVG initials. Need: seed realistic avatar images for all demo users so the app looks polished during demos. Consider using generated placeholder headshots or styled SVG avatars with distinct colors per person.
- [x] **Real users can see/message other users without an accepted connection.** ✅ Fixed v1.51.10 — Added connection validation to POST /conversations (checks care team membership, caregiver assignment, or accepted connection). Also added legacy message filtering to skip conversations with unconnected users. Admins bypass all checks.
- [ ] **Push notifications still not working on iOS.** Pete allowed notifications in settings but nothing comes through. Has been an ongoing issue for weeks. Needs end-to-end debug of SW registration + push subscription flow. *(Feedback — Feb 22, #26)*
- [x] **Desktop push notifications not working.** ✅ Fixed v1.51.12 — Root cause: `checkPushHealth()` checked `window.AUTH_TOKEN` (always null) instead of closure variable `AUTH_TOKEN`. The 30-minute health check never ran, so stale subscriptions were never re-synced. One-char fix in utils.js. *(Feedback — Sara Huber, Feb 25)* **P1**
- [ ] **Care team member management UX overhaul.** Member cards should look like the leader card, with options on click (remove, promote, read-only, etc.) instead of showing blunt "Member" and "Remove" buttons. Ties into authority delegation feature. *(Feedback — new)*
- [ ] **Caregiver onboarding does not ask about pets/allergies/medical conditions.** Carry Taiker's onboarding flow completed without collecting any pet, food allergy, or medical condition info. The "Onboarding profile questions — all roles" feature (in Features below) covers the full design, but at minimum the caregiver signup wizard should collect this before completing registration.
- [ ] **Photo upload crop + auto-resize.** Need in-app crop tool and auto-resize to 1.5MB before uploading profile photos. Current UX too manual. *(Feedback — reviewed)*
- [ ] **Admin 2FA/biometrics gate.** Admin panel should require 2FA or biometrics to access. Destructive actions (delete users, override background checks) should require additional verification. *(Feedback — Feb 22)*
- [ ] **Block user with legal evidence logging.** When blocking a user, collect more than just "spam or abuse" — log location data, timestamps, payment receipts, chat logs for potential legal action. Ties into admin incident management. *(Feedback — Feb 22)*
- [ ] **Dual-role users can't manage caregiver profile from family view.** When a family user adds a caregiver role, they can't access admin-like caregiver profile management (mark background check done, set up payments, etc.) from within the family dashboard. Need admin options or a dedicated path for dual-role users to manage their caregiver onboarding steps. *(Feedback — Feb 25, new)*
- [ ] **Family members need ability to add care locations in Care Profile.** Families should be able to add one or more care locations (e.g., home address, adult day center, doctor's office) to a care recipient's profile. Caregivers see these locations when accepting sessions. Ties into care location address with private instructions feature. *(Pete — Feb 25)*
- [ ] **DL/cert photo upload not enforced in onboarding.** Caregiver onboarding doesn't require driver's license or certification photos. Should at least ask for DL front/back. Allow skip with acknowledgment (same gate pattern as bg check), but no jobs until uploaded. *(Feedback — Feb 23, #5)*
- [ ] **Caregiver onboarding does not ask about pets/allergies/medical conditions.** Carry Taiker's onboarding flow completed without collecting any pet, food allergy, or medical condition info. The "Onboarding profile questions — all roles" feature (in Features below) covers the full design, but at minimum the caregiver signup wizard should collect this before completing registration.
- [x] **Push notification icon is white square on Android.** ✅ Fixed v1.51.11 — Changed notification icons from badge-monochrome-96.png to icon-192.png (icon) and icon-maskable-96.png (badge) in both sw.js and push.js. *(Feedback — reviewed)*
- [x] **Visit photo upload not accessible from CaretakerHub during sessions.** ✅ Fixed v1.51.41 — Added `POST /api/photos/session/:sessionId` endpoint that auto-creates visit_log if needed. Added photo upload button to VisitDetailModal for both completed and in-progress sessions. Both family members and caregivers can now upload photos from the session summary view. *(Feedback — Cary Taker, Mar 1)* **P1**
- [x] **No push notification to check out.** ✅ Fixed v1.51.11 — Added `overdue_check_out` reminder type that fires 15 minutes after scheduled session end time. Sends push + SMS to caregiver ("Don't Forget to Check Out") and push to family. Poller in server.js queries in_progress sessions past their scheduled end. *(Feedback — Cary Taker, Mar 1)* **P1**
- [ ] **Overlapping caregiver map pins.** When caregivers are at similar locations (Cary and Pete), pins overlap so you can't tell there are two. Need clustered pins with "2 Caregivers" label that expands on tap. *(Feedback #14 — Son Tester, Mar 5)* **P2**
- [ ] **Overdue session — no popup to call caretaker.** If a session runs 15+ minutes past end time, show a popup giving the family option to call the caregiver directly. Safety feature. *(Feedback #20 — Son Tester, Mar 5)* **P1**

- [x] **Paused caregiver can still see and accept jobs.** Cary's account is paused (no-show) but the Find Work section still shows "Accept Job" buttons. A paused caregiver should not be able to accept new work. Need to gate job acceptance behind `account_paused` check on both client and server. *(Found — Mar 17, v1.46.6)* **P1** ✅ Fixed Mar 19
- [x] **"Set Up Payments" card showing for previously-connected caregiver.** Cary was connected to Stripe but her dashboard still shows the "Set Up Payments" onboarding card. May be caused by Stripe account reset during testing, or the status check is broken. *(Found — Mar 17, v1.46.6)* **P1** ✅ Fixed Mar 19
- [x] **"Nobody home" option persists after caregiver checks in.** After Cary checks in with Betty, the "Nobody home" button should disappear since she's confirmed on-site. Currently it stays visible post-check-in. *(Found — Mar 18, v1.49.11)* **P1** ✅ Fixed Mar 19
- [x] **iPAi chatbot text entry not visible — blank page on open.** When opening the iPAi conversation in Messages, the text input is below the scroll area so it looks like a blank page. User has to scroll down to find it. Welcome card with suggestions was added (v1.49.8) but may not render if the conversation already has messages. *(Found — Mar 18, v1.49.11)* **P1** ✅ Fixed Mar 19
- [x] **"Now open to all caregivers" text showing on accepted appointments.** After a caregiver accepts a private request, the family dashboard Next Up card still shows "Now open to all caregivers" in orange once the exclusive timer expires. Should show nothing (the card already says "with Cary" and "confirmed"). *(Found — Mar 19, v1.50.18)* **P1** ✅ Fixed v1.50.19
- [x] **Early checkout duration miscalculated due to device timezone mismatch.** Cary checked out 1 hour early from a 4-hour session, but the app displayed it as 2 hours early because her phone clock was 1 hour behind EST. Duration calculation relied on client-side time comparison. Fix: compute all session durations server-side using UTC timestamps converted to the care recipient's timezone. *(Found — Mar 19)* **P1** ✅ Fixed v1.50.21 — check-out `earlyMinutes` now uses `buildDateTimeInZone` with care recipient's timezone.

- [x] **Pending review gate blocks booking for cancelled (non-no-show) sessions.** ✅ Fixed v1.51.44 — `/api/accountability/can-book` and `/pending-reviews` queries included all cancelled sessions. Now only blocks on completed sessions (no-show reviews are optional, shown on dashboard but don't gate booking). Migration clears stale review_required flags on cancelled non-no-show sessions. *(Found — Pete, Mar 26)* **P1**
- [x] **Caregiver can't accept jobs — Stripe gate blocks when Stripe not live.** ✅ Fixed v1.51.45 — `caregiverCleared` in dashboard.js required both `is_background_checked AND stripe_onboard_complete`. Since Stripe isn't live, no caregiver could accept. Fixed frontend (BG check OR is_available admin override) and backend (commented out Stripe gate on claim endpoint, added is_available override to BG check gate). *(Found — Pete, Mar 26)* **P1**
- [x] **Caregiver First Steps checklist stuck on Stripe step.** ✅ Fixed v1.51.47 — Stripe and BG check steps in onboarding checklist now respect admin overrides (is_available or is_background_checked). Admin-cleared caregivers see all steps as done. New caregivers still see the normal Stripe → BG check flow. *(Found — Pete, Mar 26)* **P1**
- [x] **Kindred promises to deliver messages but can't.** ✅ Fixed v1.51.37 — Added relay_message intent detection. When Betty says "tell Pete..." Kindred sends a push notification to the target care team member with Betty's message. System prompt updated so Kindred knows it CAN make this promise. *(Feedback — Pete, Mar 25)* **P1**
- [x] **Voice routing dropdown hidden behind credit-saving tip.** ✅ Fixed v1.51.37 — Changed container `overflow: visible`, bumped dropdown z-index to 9999. *(Feedback — Pete, Mar 25)* **P1**
- [x] **Voice routing save shows toast but reverts to previous voice.** ✅ Fixed v1.51.37 — Pete's clone added to seedDefaultVoices so voice_profiles row exists. Fixed save to pass provider_voice_id (not null). Fixed getAssignedVoice to match by display_name. *(Feedback — Pete, Mar 25)* **P1**
- [x] **Mobile chat keyboard pushes content off screen.** ✅ Fixed v1.51.37 — Replaced `justify-content: flex-end` with `::before { flex: 1 }` spacer. Header stays visible when keyboard opens. *(Feedback — Cary Taker, Mar 23)* **P1**

- [x] **Time picker sub-pill resets to midnight.** ✅ Fixed v1.54.2 — Selecting :15/:30/:45 sub-pills reset time to 12a because useEffect checked exact match in getTimeOptions() (only :00 values). Fix: check only hour portion, remove `time` from date-validation effect deps. *(Pete — Mar 29)* **P1**
- [x] **Time picker default scroll position.** ✅ Fixed v1.54.5 — Time pills started at 12a despite 8a being selected. Used `getBoundingClientRect()` with retry at 50/200/500ms for reliable mobile scroll positioning. 8a now justified left as default. *(Pete — Mar 29)* **P1**
- [x] **Care type validation missing on Request Care.** ✅ Fixed v1.54.6 — No warning when hitting Next without selecting care type. Added orange validation banner: "Select a care type above, or choose Other and leave instructions." *(Pete — Mar 29)* **P1**
- [x] **Calendar today dot looks like in-progress indicator.** ✅ Fixed v1.54.7 — Replaced 6px dot with light blue background highlight (`rgba(59,130,246,0.1)`) and blue text for today's date. *(Pete — Mar 29)* **P1**
- [x] **Private-only care requests ("Cary only — don't open to others").** ✅ Fixed v1.54.8 — Toggle in RequestCareModal when specific caregiver selected. `private_only` column on care_sessions. Expired exclusive offers: private_only=1 → cancel, private_only=0 → open to all. *(Pete — Mar 29)* **P1**
- [x] **Dual-role self-offer — caregiver sees own family request.** ✅ Fixed v1.55.0 — Caregiver-Pete could see family-Pete's care request as an available job. Added `AND cs.family_user_id != ?` filter to caregiver dashboard job query. *(Pete — Mar 29)* **P1**
- [x] **Payment method management — Link label + remove card.** ✅ Fixed v1.55.2 — Link ****0000 now shows as "Saved via Stripe Link" (confirmed as Pete's USAA account). Added DELETE endpoint + UI button to remove payment methods. Payments paused banner when disabled. *(Pete — Mar 29)* **P1**
- [x] **Manual payments (Send Payment feature).** ✅ Done v1.55.2–v1.55.7 — Send money to a caregiver without a care session. Amount, note, caregiver selector. Stripe Checkout with `transfer_data` to connected account. Fee transparency: real-time breakdown shows caregiver receives / processing fee / total. Gross-up so caregiver gets exact intended amount and platform balance stays neutral. Webhook records in `manual_payments` table. *(Pete — Mar 29)*
- [x] **Manual payments not showing in payment history.** ✅ Fixed v1.55.3 — History endpoint only queried `payments` table. Now queries both `payments` and `manual_payments`, combined and sorted by date. *(Pete — Mar 29)* **P1**
- [x] **Caregiver has no persistent record of received payments.** ✅ Fixed v1.55.4–v1.55.5 — Push notification was only trace. Added "Payments Received" card to caregiver dashboard with amount, sender, note, date, status badge, and payout expected date from Stripe's `balance_transaction.available_on`. Earnings endpoint now includes manual payments. *(Pete — Mar 29)* **P1**
- [x] **Manual payment checkout shows wrong bank accounts.** ✅ Fixed v1.55.6 — Checkout session created without `customer` param, so Stripe Link matched by email/phone and showed caregiver Connect accounts to dual-role users. Now passes family's `stripe_customer_id`. *(Pete — Mar 29)* **P1**
- [x] **Stripe fees creating negative platform balance.** ✅ Fixed v1.55.7 — Manual payments had `application_fee_amount: 0`, causing Stripe processing fee to come out of InPlace's platform balance. Now grosses up charge (card rate: 2.9% + $0.30), sets `application_fee_amount` to cover fee, shows breakdown in UI. **RULE: Never let any payment flow create a negative platform balance.** *(Pete — Mar 29)* **P0**

### P2

- [ ] **Caregiver dashboard too cluttered — icon/text overload.** The CaretakerHub tab bar (My Families, Area Map, Earnings, Reviews, etc.) has too many small icons with text labels crammed together. Suggestion: use larger, more illustrative icons without text labels, and show the text label on hover (tooltip) or when selected. Reduce visual noise so the dashboard feels cleaner.
- [ ] **Mobile formatting broken on feedback/general pages.** Pete reports "formatting on mobile screen doesn't work here." Needs investigation — which page specifically. *(Feedback — Pete, Mar 6)* **P2**
- [ ] **Payment architecture: team-leader-assigned billing.** Team leader sets the default payment account (e.g., Betty's bank) for scheduled events. Per-member can pay from own account if they scheduled it. Team leader assigns $ qualifiers (who pays for what). *(Feedback — Pete, Feb 25)* **P2**
- [ ] **Home/mailing/billing address for caregivers and payers.** Address entry with option to flag if billing address differs from home. Needed for payment processing. *(Feedback — Pete, Feb 25)* **P2**
- [ ] **Track user navigation patterns (analytics).** Log how users flow through the app so we can optimize. Where do they go first after login? How often do they hit calendar vs messages? Use Plausible or custom event tracking. *(Feedback — Pete, Feb 25)* **P2**
- [ ] **"Install the app" checklist item — false positive detection.** How does the app know it's installed? May be checking prematurely on desktop browsers. Verify PWA install detection logic doesn't false-positive. *(Feedback #15 — Son Tester, Mar 5)* **P2**
- [ ] **Unfilled request escalation reminders.** If a care request goes unfilled: 48hr out → "raise your pay offer"; 24hr → "still no one, raise offer"; 1hr prior → "cancelled, no caretaker found." Auto-escalation system. *(Feedback — Pete, Mar 6)* **P2**
- [ ] **Map search → caregiver shows only 1 week.** Selecting Cary from map search only shows one week of availability with no way to see more. Should show monthly calendar or a scheduling shortcut with Cary prefilled. *(Feedback — Pete, Mar 6)* **P2**
- [ ] **Caregiver appointment tiles need more detail on tap.** Cary wants to tap appointment tiles for care needs, notes from care team, feedback. Currently too sparse. *(Feedback — Cary, Mar 6)* **P2**
- [ ] **"$120 flew over" animation on accept — visual bug.** When Cary accepted Tony Nav's appointment, "$120" animated to the confirmed tab. Unintended animation. *(Feedback — Cary, Mar 6)* **P2**
- [ ] **Cancellation policy acknowledgment for caregivers.** On accepting an appointment, caregiver must check a box: "I understand I must cancel 24+ hours before start, or the care team can leave a review." *(Feedback — Cary, Mar 6)* **P2**
- [ ] **Family cancellation charge acknowledgment.** Families must click something acknowledging they'll be charged if cancelling inside 24 hours. *(Feedback — Cary, Mar 6)* **P2**

- [ ] **Caregiver referral bonus program.** Add referral mechanism: caregiver gets a bonus when they refer a new caregiver who completes X sessions. Show on splash page as recruiting incentive. Needs: referral code/link system, tracking referral source on signup, bonus payout trigger after threshold, splash page callout. *(Feedback — Cary Taker, Mar 18)* **P2**
- [ ] **My Account page overflows container on mobile.** Content doesn't fit inside the container on mobile view. Seen from admin page on v1.51.29. *(Feedback — Pete, Mar 23)* **P2**
- [x] **Kindred reminder announcements tied to calendar.** ✅ Done v1.51.42 — Added Reminders tab to Kindred admin panel in CareProfile.js. Family can create voice reminders with message, time picker, recurrence (one-time/daily/weekdays/weekends/custom days), and labels. Backend: new columns on voice_reminders (recurrence, recurrence_time, recurrence_days, label, source), GET/POST/PUT/DELETE endpoints. Delivery poller in server.js checks every 60s, delivers due reminders, auto-schedules next occurrence for recurring. Calendar auto-reminders added v1.51.48 — POST /api/kindred/reminders/sync-calendar creates reminders 30 min before upcoming sessions, "Sync Calendar" button in Reminders tab. *(Feedback — Pete, Mar 25)* **P2**

### P3

- [ ] **Dark mode.** Add a dark theme toggle (Account settings or system-level preference detection via `prefers-color-scheme`). Applies to the full app — dashboard, messages, care profile, admin, Kindred. Store preference in user settings. CSS custom properties (`--bg`, `--text`, `--card-bg`, etc.) make this straightforward once defined. *(Pete — Mar 27, 2026)* **P3**
- [ ] **Swipe to reply and long-press for emojis in messages.** Mobile UX enhancement — swipe right on a message to reply, long-press to react with emoji. Standard messaging app pattern. *(Feedback — Pete, Feb 25)* **P3**
- [ ] **Checkout feedback flows into care record with care team comments.** After session checkout, caregiver feedback should go into the care record. Care team members can comment on it (e.g., "oh yeah, we can unlock the door for you"). AI reads all comments for care profile insights. Ties into check-in/check-out feature spec. *(Feedback — Pete, Feb 27)* **P3**
- [ ] **Caregiver tardiness feedback mechanism.** After a caregiver is late (detected by overdue check-in), send a supportive follow-up: "You were late today — is there anything we could do to help?" Collect reasons (traffic, car trouble, personal, etc.) to improve scheduling and support. Ties into overdue_check_in notification system (v1.34.46). *(Feedback — Cary Taker, Mar 1)* **P2**
- [ ] **No consent summary page for family members.** After a family member completes the consent/attestation flow, there's no page showing what they signed up for or what the care recipient consented to. Need a "what was agreed" summary view in the care team or documents section. *(Feedback — Consent Tester, Mar 4)* **P2**
- [ ] **Doctor prep report management — keep/discard.** Allow users to keep or discard previously generated doctor prep reports in CareProfile. Currently no way to manage old reports. *(Feedback — Pete, Mar 23)* **P3**

### P4

- [ ] **Volunteer user role for companionship.** New sign-up class for volunteers willing to provide companionship visits at no cost. Distinct from paid caregivers — different onboarding (no Stripe, no rates), different matching (families see "volunteer" badge), different liability model. Long-term feature tied to community expansion. *(Feedback — Cary Taker, Mar 1)* **P3**
- [ ] **Medical professional role on care team.** New "medical" role for doctors/physicians who join a care team to liaise with the medical field. Doctor sees relevant health data, can add medical notes/orders, gets notified of health-related session feedback. Requires new role in care_team_members, scoped visibility, and potentially HIPAA considerations. *(Feedback — Cary Taker, Mar 1)* **P3**
- [ ] **Caregiver-initiated visit proposals.** Allow caregivers to reach out to families to offer service proactively: "Would love to come by to check on Betty, have time next Tuesday" with a proposed visit and negotiable rate. Reverse of the current model where only families post care requests. Marketplace feature — ties into caregiver branding and rate negotiation. *(Feedback — Cary Taker, Mar 1)* **P3**

## Features — Up Next

> Ideas and features not yet batched. When enough accumulate, we'll group them into the next batch.

- [ ] **Tier 3 consent flow — complete redesign.** The Tier 3 (Son signing up Mom) flow is broken and confusing. Major issues from Son Tester testing (Mar 5):
  - **Authorization/verification should be inline with add-care-recipient flow.** Don't make user hunt for it later. After adding Mom, immediately flow into "verify your authority" and "verify Mom's awareness." *(Feedback #12, #13, #17)*
  - **Stripe Identity for Son's ID verification** — prove he is who he says he is. Ties into Stripe Identity feature above. *(Feedback #6, #10)*
  - **Mom's awareness verification** — video call, or Mom receives a link to confirm she's aware. "I care less about proving who needs care than making sure they're aware and aren't going to call the cops on a caregiver." *(Feedback #10)*
  - **Care preferences should be part of add-recipient flow.** After adding Mom, immediately set up care preferences — don't make user navigate away and come back. *(Feedback #13)*
  - **Getting Started order wrong.** "Search for caregivers" should be last — can't search usefully until care recipient is authorized. Reorder: (1) complete profile, (2) add loved one + authorization + care prefs (one flow), (3) invite family, (4) set up payment, (5) search caregivers. *(Feedback #1)*
  - **Email verification code confusion.** "Why is there a code to complete for verification in progress?" — unclear what the code is for or where to find it. *(Feedback #2)*
  - **Stripe Connect placeholder in First Steps.** Even though payments aren't live yet, the step should exist to set expectations: "We aim to get paid here." *(Feedback #4)*
- [ ] **Financial POA as authorization path.** Some people have financial POA but not healthcare POA. Ask who's paying for care during setup — if they say "mom is, but I have financial POA," verify the POA document the same way as Tier 2 healthcare POA checker. *(Feedback #1 — Son Tester, Mar 5 v1.38.0)*
- [ ] **Verify Son's identity BEFORE verifying authority.** Identity verification (Stripe Identity) should happen first — prove who you are, then prove your relationship/authority. When Son sets up Stripe payment, bundle the ID check in one step. "This way he knows WE KNOW who he is when we reach out to someone else." *(Feedback #2 — Son Tester, Mar 5 v1.38.0)*
- [ ] **Admin verification workflow — "call and verify" list.** Admin needs a clear list of who's been verified and who hasn't. Push notification to admin (Pete) with a "Call" button to verify users by phone. Don't make admin dig through spreadsheets. Make it easy to see who's good to go and who's not. *(Feedback #4 — Son Tester, Mar 5 v1.38.0)*
- [ ] **Multiple awareness verification options for care recipient.** Don't assume email works for everyone. Offer branching options: email verification, video chat, phone call, in-person. "Maybe mom won't read email. Maybe the son wants to do a video chat." Flesh out later but build the option framework now. *(Feedback #5 — Son Tester, Mar 5 v1.38.0)*
- [ ] **AI Consent Call — Twilio verbal consent capture for Tier 3.** When a family member completes Tier 3 attestation and provides the care recipient's phone number, offer an automated phone call as an alternative to the email outreach link. The care recipient receives a brief call, hears a consent script, and their verbal response is recorded as proof of consent. Eliminates the need for elderly care recipients to use email or an app.
  - **Flow (Option B — SMS opt-in first):**
    1. Family completes Tier 3 attestation (existing flow — signature, relationship, recipient phone/email).
    2. System sends SMS to care recipient: "Hi [name], your [relationship] [family_name] has registered you for care coordination on InPlace. Reply YES if you'd like to receive a brief verification call, or reply STOP to opt out."
    3. If recipient replies YES → Twilio makes outbound call. If no reply after 24h → fall back to existing email outreach. If STOP → mark `consent_status = 'rejected'`, notify family.
    4. AI call script (TwiML `<Say>` + `<Record>`):
       - "Hello, this is an automated call from InPlace, a care coordination service. This call is being recorded for your protection."
       - "Your [relationship], [family_name], has arranged for companion caregivers to visit you through InPlace. We need to confirm you're aware of this arrangement."
       - "Do you consent to receiving care coordination visits arranged through InPlace? Please say yes or no after the tone."
       - `<Record maxLength="30" playBeep="true" transcribe="true" />`
    5. Recording URL + Twilio transcription stored in `consent_outreach` record.
    6. Admin reviews recording in Admin Panel (play button + transcript) → approve/reject.
    7. If approved → `consent_status = 'verified'`, `consent_method = 'phone_call'`.
  - **Legal compliance:**
    - SMS opt-in satisfies TCPA prior express consent requirement for the AI call.
    - Call opens with AI/recording disclosure (FCC AI voice rule, Feb 2024).
    - Virginia is one-party consent for recording, but we disclose anyway for full coverage.
    - All SMS/call records retained in `consent_audit_log` for compliance trail.
    - Rate limit: max 2 call attempts per care recipient (no harassment).
  - **Twilio implementation:**
    - **SMS:** Twilio Programmable Messaging. Buy a local number (~$1.15/mo + $0.0079/SMS). Webhook on incoming SMS to `POST /api/consent/sms-webhook`.
    - **Voice:** Twilio Programmable Voice. Outbound call via REST API → TwiML script. `POST /api/consent/:recipientId/call` (authenticated, admin or attestor). Cost: ~$0.014/min + recording storage free (first 10K min/mo).
    - **Webhook security:** Validate `X-Twilio-Signature` header on all inbound webhooks.
    - **Recording storage:** Twilio hosts recordings (30-day default retention). On consent approval, download and store in our DB/R2 for permanent record. On rejection, auto-delete after 90 days.
  - **Schema changes:**
    - `consent_outreach`: Add columns `outreach_method TEXT` ('email'|'sms_then_call'|'call'), `sms_sent_at TIMESTAMPTZ`, `sms_response TEXT`, `sms_response_at TIMESTAMPTZ`, `call_sid TEXT`, `call_recording_url TEXT`, `call_transcription TEXT`, `call_status TEXT` ('pending'|'completed'|'no_answer'|'failed'), `call_attempted_at TIMESTAMPTZ`.
    - `consent_audit_log`: New event types — `sms_opt_in_sent`, `sms_opt_in_received`, `call_initiated`, `call_completed`, `call_recording_reviewed`.
  - **Frontend changes:**
    - `ConsentVerification.js`: After attestation, show outreach method picker — "Email link (current)" or "Phone call (recommended for elderly recipients)." Phone option shows the SMS → call flow with status updates.
    - `AdminPanel`: Consent review section gets audio player widget for call recordings + Twilio transcription text. Approve/reject buttons same as current flow.
  - **Environment variables:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (add to Railway).
  - **Depends on:** Twilio account setup (free trial has $15 credit — enough for ~100 test calls). No dependency on Stripe or ElevenLabs.
  - **Cost at scale:** ~$1.15/mo for phone number + ~$0.05 per consent flow (1 SMS + 1-min call). Negligible.
  - *(Pete — Mar 26, 2026)*
- [ ] **Inline identity verification on attestation page.** When user clicks "I attest," expand into Stripe Identity verification right there — all on one page. Show legal attestation language placeholder: "I attest, under penalty of law and liability." More than just "we'll verify" — start the verification NOW, on this screen. *(Feedback #6, #9 — Son Tester, Mar 5 v1.38.0)*
- [x] **Care recipient contact form — add verification purpose reminder.** ✅ Done v1.51.41 — Updated contact section copy to explicitly state info is used for consent verification. Phone label updated from "emergency contact only" to "consent verification & emergency contact." *(Feedback #11 — Son Tester, Mar 5 v1.38.0)*
- [x] **Cursive signature font for consent/attestation forms.** ✅ Done v1.51.41 — Signature input now uses cursive font stack (Brush Script MT, Segoe Script, Apple Chancery, cursive) at 20px with "Electronic signature" label. *(Feedback #11 — Son Tester, Mar 5)*
- [ ] **Overnight booking minimum notice.** When care extends past midnight, notify user that "most caregivers require a six-hour minimum overnight booking." Business rule enforcement. *(Feedback #23 — Son Tester, Mar 5)*
- [x] **"Other" care type with free text.** ✅ Done v1.51.41 — Added "Other" pill to care type selector in RequestCareModal. When selected, shows text input for custom description. Stored as `other:Custom text` in service_type. `formatServiceType()` updated to parse and display the custom text. *(Feedback #24 — Son Tester, Mar 5)*
- [x] **Multi-mood selection on check-in/check-out.** ✅ Already implemented — mood picker uses array state with toggle (multi-select). Both check-in and check-out moods stored as JSON arrays. *(Feedback #26 — Son Tester, Mar 5)*
- [x] **Tip + gratitude feature in family rating flow.** ✅ Done v1.51.49 — "Say Thanks" tip section in post-session review modal. Appears when rating 4+ stars. Preset $5/$10/$20/custom amounts + reason text. Backend: tips table, POST/GET endpoints, gratitude_keywords accumulated on caregiver_profiles. Caregiver side: "Tips & Thanks" collapsible section on CaretakerHub dashboard showing all tips with amounts and gratitude messages. AI nudge (future): surface past gratitude themes on next booking with same caregiver.
  - *(Pete — Mar 26, 2026)*
- [ ] **Review gate before new booking.** If a family has an outstanding review to leave (completed session with no rating), block the new appointment flow UPFRONT — show the review prompt when they tap "Request Care," not after they've filled everything out. "You have an unreviewed session from [date] with [caregiver]. Please leave your review before booking again."
  - **Check:** On opening RequestCareModal, query for completed sessions where family hasn't left a rating. If any exist, show review gate overlay instead of the booking form.
  - **UI:** Card showing session date, caregiver name, service type. Star rating + optional comment. "Submit Review" unlocks the booking form. "Skip" option after 3 sessions without review (don't permanently block, but nag).
  - **Backend:** `GET /api/sessions/pending-review` — returns completed sessions where `rating IS NULL` for the current family user. `POST /api/sessions/:id/review` — submit rating + comment.
  - *(Pete — Mar 26, 2026)*
- [ ] **Session check-in/check-out system.** Full clock-in/clock-out protocol for care sessions with structured feedback collection.
  - **Check-in (caregiver arrives):**
    - Manual "I'm Here" button on confirmed sessions (v1: manual tap, future: auto-trigger via geofencing when near care location — requires persistent Geolocation API permission, battery-intensive on iOS, so this is a later add-on).
    - Caregiver can adjust arrival time slightly (e.g., arrived 5 min early).
    - Caregiver selects care recipient's current mood via emoji + label: 😊 Happy, 😮 Surprised, 😴 Sleepy, 🤗 Busy, 😐 Neutral, 😢 Sad, 😠 Upset.
    - Check-in screen shows last-minute instructions or notes from the care team (pulled from care recipient notes + session special_instructions).
    - Care team gets notified that session has begun (activity feed + push notification).
    - Session status transitions: `confirmed → in_progress`.
    - *Future:* Auto-trigger audio recording option on care recipient's phone (requires separate consent flow + device pairing).
  - **Check-out (session ends):**
    - Caregiver taps "End Session" — prompted with structured feedback:
    - **Mood on departure:** Same emoji + label picker as check-in (track mood change over session).
    - **Condition tags (multi-select, tap to toggle):** Descriptive tags about the care recipient during the visit — "Confused", "Anxious", "Good appetite", "No appetite", "Toileting issues", "Wandering", "Good spirits", "Cooperative", "Resistant to care", "Pain/discomfort", "Medication taken", "Medication refused", "Good mobility", "Fall risk", "Engaged in activity", "Withdrawn". These tags are the building blocks for AI insights.
    - **Care recipient feedback (free-form text):** Focused on the person's condition, behavior, anything the care team should know about Betty (or whoever). Example: "Betty was cheerful today, ate all her lunch, asked about Pete twice."
    - **Service/logistics feedback (separate free-form text):** About the service experience, the environment, logistics — "Couldn't get up driveway due to ice", "Door code was wrong in description", "Need more supplies in bathroom." Reported separately so it's actionable for the care team without mixing into care recipient health data.
    - Session status transitions: `in_progress → completed`.
    - All feedback stored in visit_logs (existing table: check_in_time, check_out_time, mood_rating, tasks_completed, notes — extend with new fields).
    - Care team gets checkout notification with mood summary.
  - **Deletability:** Both caregiver and care team can delete individual condition tags or feedback entries after the fact (accidental entries). Deletion is soft-delete with audit trail.
  - **AI insights integration:** Condition tags and free-form feedback feed into the AI insights engine, scoped per care_recipient_id (not per caregiver — fixes the existing cross-contamination bug). Insights summarize trends: "Betty has been anxious 3 of last 5 visits", "Appetite declining over past 2 weeks."
  - **Early checkout — 15-minute block pay rule (Pete — Mar 19):**
    - Pay is calculated from **actual check-in time to actual check-out time**, in 15-minute increments. NOT from scheduled appointment start time.
    - If a caregiver checks out ≤15 min before scheduled end → full pay (no penalty).
    - If a caregiver checks out >15 min before scheduled end → pay is rounded down to the nearest 15-minute block of actual time worked. Example: 4-hour appointment, caregiver checks out 50 min early → worked 3hr 10min → paid for 3hr 0min (12 blocks × 15 min).
    - **Early checkout prompt:** When a caregiver taps "End Session" more than 15 min before the scheduled end, show a confirmation modal: "This appointment isn't scheduled to end until [X:XX PM]. You will not receive full pay for this session. Please let us and the family know why you're leaving early:" + required text field for reason. Reason is stored in visit_logs (`early_checkout_reason TEXT`) and sent to the care team as a notification.
    - **Duration is computed server-side** using the care recipient's timezone. Never trust the caregiver's device clock for pay calculations. The server records check-in and check-out timestamps in UTC; pay math converts to the care recipient's timezone to determine blocks worked.
    - This rule applies regardless of the caregiver's physical location or device timezone.
  - **Time extension (future):** If caregiver stays past scheduled duration, mechanism to request extra time. Care team approves, caregiver gets paid for actual hours. Ties into Stripe payment flow.
  - **Schema changes:** Add to visit_logs: `arrival_mood TEXT`, `departure_mood TEXT`, `condition_tags TEXT` (JSON array), `care_feedback TEXT`, `service_feedback TEXT`, `check_in_adjusted INTEGER DEFAULT 0`, `early_checkout_reason TEXT`. Existing columns: check_in_time, check_out_time, mood_rating, tasks_completed, notes, summary.
  - *(Pete — Feb 25. First session: Cary visiting Betty, Feb 26.)*
- [ ] **Nursing student discount program.** Reduced platform fee (15% vs 20%) for verified nursing students. Validated via email confirmation to partnering school. Advertise the 5% savings to make student caregivers more competitive for matching. *(Feedback — Feb 23, #3)*
- [ ] **Nursing student program badge + hour reports.** If caregiver signed up as a nursing student with a supported program, show badge on their profile. Generate hour reports they can send to their school. *(Feedback — Feb 23, #4)*
- [ ] **Off-platform liability acknowledgment.** All users must acknowledge they're not covered by InPlace protections if they arrange care outside the app (no payment/matching through platform). Users are 100% liable for anything off-app. *(Feedback — Feb 23, #5)*
- [ ] **Care preferences as caregiver branding.** Enhance the stoplight/preferences system to serve as a caregiver's brand identity. Add happy emoji for tasks they love. Signal to families that caregivers have agency and enjoy their work. *(Feedback — Feb 23, #6, #7)*
- [ ] **Expand care categories beyond elderly.** Add babysitting (toddlers, babies, school-age), special needs (behavioral, Down syndrome, etc.), and adult care beyond elderly. Medical task selections should trigger the "InPlace is not a medical provider" disclaimer. *(Feedback — Feb 23, #8)*
- [ ] **Emergency contact 911 shortcut.** Clicking emergency contact section opens instructions with "Call 911" shortcut that could trigger auto-recording of audio or auto-message to care team. *(Feedback — Feb 23, #14)*
- [ ] **AI insights on care profile.** When entering health conditions (e.g., "dementia"), AI suggests relevant care questions: "Is bedtime problematic?" or "Does [Betty] deal with daily dangers like stairs or cooking?" Helps families think through care needs. *(Feedback — Feb 23, #15)*
- [ ] **Care location address with private instructions.** Specific address with gate codes, parking instructions, door combos etc. Visible only to confirmed caregivers when they accept an appointment. *(Feedback — Feb 23, #16)*
- [ ] **Photo upload in care notes.** Allow photo attachments in care notes — "Don't let her wear this coat, it's not warm enough but it's the only one she remembers!" Visual context for caregivers. *(Feedback — Feb 23, #17)*
- [ ] **Medication section CRUD.** Editable medication list — med name, dosage, frequency, reminder times. Future: AI insights and automatic reminders to cared-for to take medicine. *(Feedback — Feb 23, #18)*
- [ ] **AI fraud detection.** Explore how AI could detect possible fraud patterns through the platform — unusual booking patterns, identity mismatches, payment anomalies. *(Feedback — Feb 23, #28)*
- [ ] **Care profile enrichment — doctor contacts, shopping areas.** Add doctor/physician contact info and favorite shopping areas to care recipient profile. Useful for caregivers who take the person out. *(Feedback — Feb 23, #38)*
- [ ] **Weekly availability rules (multi-day repeat).** Current availability rules are per-day only. Caregivers want to set "available 8-5 Mon-Thu" as one rule instead of 4 separate entries. Add multi-day selection to the "Add Recurring Rule" modal. Intermediate step before the full drag-to-select calendar rewrite. *(Feedback — Feb 23, #6)*
- [ ] **Time-of-day positioned calendar blocks.** Calendar day cells should visually position sessions by time of day: AM sessions anchored to top of cell, PM to bottom, mid-day in the middle. Currently cells just stack session labels; this would make the calendar a true at-a-glance time map. Requires taller cells (100-120px), proportional vertical positioning of session blocks within each cell. Phase 1 (done v1.30.1): time prefix labels ("9a", "7p") on each preview. Phase 2: actual spatial positioning. *(Pete — Feb 25)*
- [ ] **Plausible Analytics setup:** Sign up at plausible.io, add `yourinplace.com` as a site. Script tag is already in index.html.
- [ ] **Google OAuth setup on Railway:** Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars (requires Google Cloud Console setup — it's free)
- [ ] **Upgrade to Google Maps geocoding:** Swap Nominatim → Google Maps for better residential accuracy when ready for production
- [ ] **🔴 P1 — Stripe Connect + Identity integration (target: Mar 6–7).** Bank account nearly ready. Deploy Stripe live mode, Stripe Connect for marketplace payments, and Stripe Identity for ID verification in consent flow.
- [ ] **Stripe Connect integration:** Marketplace payments — families pay, caregivers get paid, platform takes fee.
  - **Account type:** Express (Stripe-hosted caregiver onboarding with InPlace branding)
  - **Charge type:** Destination charges (charge lives on platform, auto-transfer to caregiver minus fee)
  - **Charge timing:** After session completion (not at booking)
  - **Platform fee:** 20% base rate stored as a configurable variable — build as a fee calculation function so rules can be added later (e.g., discount after 3+ hours, surge pricing, volume tiers). Never hardcode 20% anywhere.
  - **Payout schedule:** 2-day rolling default. Instant payout available as opt-in — platform takes additional 1% on top of Stripe's ~1% instant payout fee (caregiver pays both).
  - **Cancellation policy:**
    - Caregiver cancels → no pay, no charge to family.
    - Family cancels ≥24 hours before session → free cancellation, no charge.
    - Family cancels <24 hours before session → charged 100% of planned cost, caregiver gets paid. Family can request a "grace cancel" — caregiver can approve to waive the charge. If caregiver grants grace, no charge to family.
    - Needs: grace request/approve flow in UI (notification to caregiver, approve/deny buttons, time window for response).
  - **Implementation:** Stripe SDK (stripe npm), caregiver Express onboarding flow, PaymentIntent creation on session complete, webhook handler for payment events, fee calculation utility (`calcPlatformFee(session)` with base rate + rule engine), earnings/payout tracking in CaretakerHub, grace cancel request flow
  - **Stripe account setup:** Sign up at stripe.com as sole proprietor (SSN, personal bank account OK, no EIN needed)
- [ ] **S3/R2 for visit photos:** Replace base64 PostgreSQL storage with object storage
- [ ] **Cloudflare R2 database backup pipeline:** Deploy Railway's [postgres-s3-backups](https://railway.com/deploy/I4zGrH) template. Create R2 bucket (`inplace-db-backups`), generate R2 API token (Object Read & Write), configure daily 5 AM UTC cron. Env vars: `AWS_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `AWS_S3_REGION=auto`, `BACKUP_CRON_SCHEDULE=0 5 * * *`, `RUN_ON_STARTUP=true`, `BACKUP_FILE_PREFIX=inplace-`
- [ ] **Push notification expansion:** Extend `sendPushToUser()` beyond messages to cover key app events. Two tiers:
  - **Admin-only (peterjslee@gmail.com):** Waitlist signup, new user registration. Toggle on/off in Admin Panel.
  - **All users:** Care request created (notify assigned caregivers), care request accepted (notify family), session status changes (confirmed/cancelled/check-in). Toggle per-type in MyAccount notification preferences.
  - **Implementation:** Add push event types to `notification_prefs` JSON on users table. Add admin push prefs to Admin Panel settings. Wire `sendPushToUser()` into waitlist.js, auth.js (register), sessions.js (request/claim/status). Check user's prefs before sending.
- [ ] **CaretakerHub dashboard overhaul:** Make stat callout cards clickable with drill-down detail views. Must work with real data and demo data alike.
  - **Assigned Families:** Click → show list of assigned family names (from caregiver_assignments)
  - **Jobs Completed:** Click → show itemized list of every completed job this month (date, family, service, hours)
  - **Hours This Month:** Click → show average day length across completed sessions
  - **Earnings + Payments:** Merge "Earned This Month" and "Pending Payments" into one combined card. Click → show breakdown (earned vs pending vs paid)
  - **Monthly Summary cleanup:** Remove redundant info that duplicates the stat cards above
  - **Hourly Rate:** Display as average rate (calculated from actual completed sessions), not a fixed profile value
- [ ] **Onboarding profile questions — all roles:** Add essential info collection during registration and to profile editing for both care recipients and caregivers.
  - **Pets:** Do you own pets? (type, count). Do you have any pet allergies?
  - **Food allergies:** Free-text or common tags (nuts, shellfish, dairy, gluten, etc.)
  - **Medical conditions / mobility:** Wheelchair bound, uses walker, poor hearing, hearing aids, near-sighted, oxygen, etc. Tag-based with free-text "other" option.
  - **Applies to:** Care recipients (CareProfile / CareRecipients CRUD) — captures the person being cared for. Caregivers (CaregiverOnboarding / profile edit) — captures their own allergies/pets so families know. Family members (RegisterPage / MyAccount) — captures household info.
  - **Schema:** Add columns to `care_recipients` (pets, pet_allergies, food_allergies, medical_conditions as JSON text) and `users` or `caregiver_profiles` as appropriate. Surface in CareProfile view so caregivers see it before a session.
- [ ] **User search + connection request + messaging:** Add ability to search for users by email (or proximity for caregivers/families) and send a connection request. Messaging is only available between connected users.
  - **User search:** Search by email across registered users. Results show name, role, avatar — but NOT full profile details until connected. Caregivers and families can also discover each other via proximity search (nearby caregivers feature).
  - **Connection request flow:** "Send Connection Request" button on search results. Other party sees a notification and can Accept or Decline. Once accepted, both appear in each other's contacts and can message freely. Connections also auto-created by: accepted care team invite, caregiver assignment.
  - **Message push notifications:** When a message is received, push notification with sender name + preview. Tapping the notification opens the app directly to that conversation. If not logged in, authenticate first then navigate to the conversation.
  - **Deep-link to conversation:** Push notification `data` payload includes `conversationId`. Service worker `notificationclick` handler opens `/?conversation=ID`, app.js reads the param and navigates to Messages with that conversation selected.
  - **Applies to all users** — families, caregivers, care recipients, and any registered user.
  - **Note:** This replaces the current open contacts model. The bug "Real users can see/message other users without an accepted connection" (in Bugs above) is the immediate fix; this feature is the full implementation with search + invite UI.
- [ ] **Video chat — Meet link in messages (v1):** "Video Call" button in message thread header generates a Google Meet link and sends it as a special message type (rendered as a clickable card, not plain text). Both parties get a push notification with "Join Video Call" action. Upgrade path to embedded Daily.co later if usage warrants it.
- [ ] **Caregiver registration disclosures & agreements:** Add a legal/informational step to CaregiverOnboarding before they can complete registration. Must be acknowledged (checkbox + signature/accept) to proceed.
  - **Background check notice:**
    - InPlace uses Checkr for background checks on all caregivers
    - Caregiver pays for the background check upfront (display cost)
    - Caregiver receives a copy of the completed report
    - Background check fee is refunded to their InPlace account after 10 completed sessions
    - InPlace will not share background check results with third parties
    - InPlace reserves the right to refuse or revoke platform access based on background check results
  - **Payment & tax disclosures:**
    - All payments processed through Stripe (online payment platform)
    - Caregivers are independent contractors, not employees
    - InPlace issues 1099 tax forms annually for earnings exceeding IRS threshold
    - Caregiver is responsible for their own tax reporting and obligations
  - **Platform terms:**
    - InPlace takes a platform fee from each session (percentage displayed)
    - Instant payout option available for an additional fee
    - Cancellation policy summary (caregiver cancels = no pay, family late cancel = caregiver gets paid, grace cancel flow)
  - **Implementation:** New step in CaregiverOnboarding wizard (before final submit). Scrollable disclosure text with required checkbox "I have read and agree to these terms." Store acceptance timestamp + version in `caregiver_profiles` (new columns: `terms_accepted_at`, `terms_version`). Track background check refund eligibility (sessions completed count vs. 10 threshold) in CaretakerHub earnings view.
- [ ] **Stripe payment for background check during caregiver onboarding:** Caregivers need to pay for their background check before it can be initiated. This requires Stripe integration earlier in the flow than the full marketplace payments.
  - **What's needed:** Collect credit card info via Stripe Elements (embedded payment form) during CaregiverOnboarding, charge a one-time fee for the Checkr background check.
  - **Depends on:** Stripe account setup (Pete has created a Stripe account — need to add `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` env vars to Railway). Also need Checkr account for the actual background check API.
  - **Implementation:** Add `stripe` npm package, create POST `/api/payments/background-check` endpoint that creates a Stripe PaymentIntent, embed Stripe Elements card form in CaregiverOnboarding (new step before final submit), confirm payment client-side, store payment record. This is separate from the full Stripe Connect marketplace integration (which handles session payments between families and caregivers).
  - **Note:** The full Stripe Connect integration (item above) handles ongoing session payments. This task is specifically about the one-time background check fee during registration.
- [ ] **Stripe Identity — ID verification for consent authorization.** Use Stripe Identity (same dashboard/SDK as existing Stripe integration) to verify the identity of the person authorizing care in Tier 2/3 consent flows. Flow: family member reaches consent step → "Verify your identity" → Stripe Identity modal opens → photograph government ID + selfie → Stripe confirms match → verified name stored on profile. $1.50 per verification. Required for primary decision-maker (person with legal authority), lighter verification for other family members. Inspired by Mercury's ID verification UX. *(Pete — Mar 5)*
  - **Implementation:** Create verification session endpoint (`POST /api/identity/verify`), embed Stripe Identity modal in consent flow, store verification status (`identity_verified_at`, `identity_method`) on users table. One-time check — once verified, no repeat needed.
  - **Depends on:** Stripe live mode activation (bank account setup in progress).
- [ ] **Blue verified checkmark badge for trusted users.** Users who complete ID verification (Stripe Identity) or pass a background check (Checkr) get a blue ✓ badge on their profile, visible to other users. Signals trust and safety. Badge types: "ID Verified" (Stripe Identity), "Background Checked" (Checkr). Display on caregiver cards in search results, profile views, care team member lists, and message contacts. Store badge status on users/caregiver_profiles. *(Pete — Mar 5)*
- [ ] **Multiple certifications in caregiver signup:** CaregiverOnboarding currently limits to one certification entry. Change to a dynamic list — "Add another certification" button, each entry has cert name + issuing body + expiration date (optional). Remove button per entry. Store as JSON array in `certifications` column on `caregiver_profiles`. Same multi-entry UI on profile edit in CaretakerHub.
- [ ] **Caregiver onboarding cleanup — remove availability, add work location/radius:**
  - **Remove availability from signup:** Don't ask about availability during registration. Move it to a "First Steps" checklist shown on CaretakerHub after account creation (similar to the family onboarding checklist pattern).
  - **Stoplight chart (First Steps):** Caregiver categorizes care tasks into three tiers:
    - **Green light** — comfortable with (bathing, diapers, wheelchairs, medication reminders, meal prep, etc.)
    - **Red light** — won't do / not comfortable with (pets, stairs, heavy lifting, food preparation, driving, etc.)
    - **Yellow light / Needs discussion** — case-by-case (unable to walk, confined to bed, dementia, hospice, etc.)
    - UI: Drag-and-drop or tap-to-assign from a master list of common care tasks into green/yellow/red columns. Free-text "Add custom" option per column.
    - Store as JSON on `caregiver_profiles` (new column: `care_stoplight`). Surface on caregiver profile cards so families see it when browsing/assigning. Use for smarter caregiver-to-family matching (green-light tasks overlap with care recipient needs).
  - **Add preferred work location + travel radius:** New fields in Step 2 (Personal Info) of CaregiverOnboarding. Caregiver sets a preferred work area (could differ from home address — e.g., "I live in Christiansburg but prefer jobs in Blacksburg"). Radius slider (5–50 miles) for how far they're willing to travel from that work location. Store as `work_location_address`, `work_latitude`, `work_longitude`, `max_travel_miles` on `caregiver_profiles`. Geocode on save. This drives the nearby caregiver search for families. Also editable in CaretakerHub profile.
- [ ] **Interactive drag-to-select availability calendar (Outlook-style):** Replace the current availability UI with an interactive weekly calendar where caregivers can click and drag to paint time blocks.
  - **Core interaction:** View the week. Toggle between "Available" (green) and "Blocked" (red) brush modes. Click and drag vertically across time slots to paint that block. For example: select "Blocked", drag from 12:00 PM to 3:00 PM on Tuesday → that range highlights red. Select "Available", drag across other slots → they highlight green.
  - **Resize handles:** Each painted block gets drag handles on the top and bottom edges. Grab an edge and drag up/down to extend or shrink the block — same interaction as resizing an Outlook appointment.
  - **Granularity:** 30-minute slots. Snaps to nearest half-hour on drag.
  - **Recurring rules callout:** Retain the existing "Add Recurring Rule" button/modal. Recurring availability and recurring blocked times both appear on the calendar as repeating blocks (with a subtle repeat icon or dashed border to distinguish them from one-off entries). One-off painted blocks and recurring rule blocks coexist on the same view.
  - **Save behavior:** Changes save on blur / when navigating away from the week, or via an explicit "Save" button. Backend uses the existing `availability` table and CRUD endpoints.
  - **Mobile:** On touch devices, tap a slot to toggle it, or tap-and-drag to paint a range. Long-press a block edge to resize.
  - **Implementation:** Rewrite `AvailabilityTab.js` with a weekly hour grid (7 columns × 24 rows of 30-min slots). Track mouse/touch events for drag-select painting. Store blocks as availability rules via existing API. Render recurring rules from API as non-editable overlay blocks (editable only through the rule modal).
- [ ] **Medical care disclaimer banner — all users must acknowledge:** On first login (and whenever the disclaimer version changes), show a full-screen modal that every user must read and accept before using the app. Two bold/highlighted statements:
  - **"InPlace does not provide at-home medical care in accordance with Virginia state law."**
  - **"You are personally liable for any medical care you provide beyond calling professional medical attention when warranted."**
  - Must scroll to bottom before "I Acknowledge" button enables. Store acceptance in users table (`disclaimer_accepted_at`, `disclaimer_version`). If version changes, re-prompt on next login. Applies to all roles (family, caregiver, care recipient). Cannot be dismissed — must acknowledge to proceed.
- [ ] **Caregiver work location should use zip code and center map correctly:** When a caregiver sets their preferred work location, the AreaMap on their dashboard doesn't center on that point. Also, the current free-text town name input is unreliable for geocoding. Switch to asking for their preferred zip code instead — zip codes geocode more reliably via Nominatim and are simpler for the user. The AreaMap should center on the caregiver's `work_latitude`/`work_longitude` (falling back to their home address coords if not set).
- [ ] **Admin API key for automated scripts.** Added in v1.8.3 — `ADMIN_API_KEY` env var bypasses JWT/2FA for the collect-feedback script. Set on Railway. Future: extend to other admin automation.
- [ ] **Maria demo profile polish.** Maria needs: profile photo, completed onboarding/background check status shown as "done", fake license photos, distinct families (not 3x Betty). *(Feedback #17, #18, #19, #20)*
- [ ] **Calendar import (Apple/Google/Microsoft).** Caregivers want to import existing calendar events and see them alongside InPlace availability on one unified view. *(Feedback #3)*
- [ ] **Financials/payments tab for caregivers.** Visible "Financials" or "Payments" sidebar link beyond just the Earnings sub-tab. Link bank account, view payment history, see Stripe status. *(Feedback #1)*
- [ ] **Push notification debugging.** Pete gets emails but never push notifications. Debug SW registration, verify push subscriptions are created, test end-to-end. *(Feedback #5)*
- [ ] **Session safety recording (Uber RideCheck-style).** Local encrypted audio recording during care sessions for safety accountability. Modeled after Uber's Ride Safe feature — audio is recorded and encrypted on-device, never accessible to anyone unless a safety incident is reported, at which point it's uploaded for admin review.
  - **Approach:** Local-only encrypted recording. No real-time streaming or AI monitoring. Audio captured on caregiver's phone during check-in → check-out window. Encrypted with device-specific key, stored in app sandboxed storage. Auto-deleted after 7–14 days if no safety report filed.
  - **Requires native app shell:** PWA cannot reliably record audio in the background (browsers suspend tabs when screen off). Needs a thin native wrapper (Capacitor, React Native, or Swift/Kotlin shell) with background audio session capability. Existing web UI loads in WebView — native layer only handles microphone + encrypted local storage.
  - **Upload trigger:** Audio segments only uploaded to server if a safety flag is raised (by caregiver, family, or admin). Admin reviews through Admin Panel with full audit trail. Segments are encrypted at rest on server (S3/R2).
  - **Consent flow:** Both caregiver and family must acknowledge recording capability during onboarding (new terms version bump). For two-party consent states (CA, FL, IL, etc.), explicit per-session opt-in or standing consent on file. Store consent status per user (`recording_consent_accepted_at`, `recording_consent_version`).
  - **Data model:** New `session_recordings` table: session_id, device_id, segment_index, encrypted_blob_url, encryption_key_hash, created_at, uploaded_at, reviewed_by, reviewed_at, auto_delete_after. New columns on `care_sessions`: `recording_enabled` (boolean), `recording_consent_confirmed` (boolean).
  - **Admin review UI:** New section in safety flag evidence thread — "Session Recording" with play controls, timeline scrubber, and audit logging (who listened, when). Passkey-protected like resolve/dismiss.
  - **Depends on:** Native app shell (see App Store Release section), S3/R2 object storage, consent flow infrastructure.
  - **Privacy safeguards:** No human listens unless safety incident filed. Admin review is passkey-gated and audit-logged. Auto-deletion enforced server-side. Caregiver and family both notified if recording is accessed. Cannot be used for performance review — safety incidents only.
  - *(Pete — Mar 22, 2026)*
- [ ] **Capacitor native wrapper — Android + iOS from single PWA.** *(IN PROGRESS — v1.51.50)* Capacitor 8.3.0 installed, iOS + Android projects scaffolded, 4 plugins synced (push-notifications, splash-screen, status-bar, app). Config points at yourinplace.com. **Next:** Pete needs to finish Xcode setup (iOS 26.4 simulator downloading), set signing team, and do first build. Then TestFlight for testers. Wrap the existing InPlace PWA in a Capacitor shell to produce installable native apps for both platforms. The web codebase stays exactly as-is — Capacitor adds a thin native bridge on top.
  - **Why Capacitor over TWA/React Native:** TWA is Android-only and gives no native API access. React Native would require a full rewrite. Capacitor wraps the existing PWA with zero code changes and adds native capabilities incrementally. Same web code, two native outputs.
  - **What it unlocks:**
    - Reliable iOS push notifications (fixes the P1 iOS push bug permanently — APNs via native bridge instead of flaky Web Push)
    - Background audio for Kindred voice companion (iOS kills background WebAudio; native AVAudioSession stays alive)
    - App store distribution (Google Play + Apple App Store) when ready
    - Sideloading for testing (APK on Android, TestFlight on iOS)
    - Future native features: background location for geofenced check-in, camera access for visit photos, local encrypted storage for session recordings
  - **Project structure:**
    - New top-level directory: `capacitor/` (or convert repo root to Capacitor project)
    - `capacitor.config.ts` — points webDir at `public/` (existing built PWA)
    - `android/` — auto-generated Android project (Gradle, Java/Kotlin)
    - `ios/` — auto-generated iOS project (Xcode, Swift)
    - Web code stays in `public/` and `src/` unchanged
  - **Capacitor plugins needed (Phase 1):**
    - `@capacitor/push-notifications` — native APNs (iOS) + FCM (Android) push
    - `@capacitor/splash-screen` — branded launch screen
    - `@capacitor/status-bar` — theme color matching
    - `@capacitor/app` — app lifecycle, deep links, back button handling
  - **Capacitor plugins (Phase 2 — when needed):**
    - `@capacitor/camera` — visit photo capture
    - `@capacitor/geolocation` — background location for geofenced check-in
    - `@capacitor/filesystem` — local encrypted storage for session recordings
    - `@nicolo-nicolo/capacitor-background-mode` or custom plugin — keep Kindred audio alive in background
  - **Build outputs:**
    - Android: `android/app/build/outputs/apk/debug/app-debug.apk` (sideload) or signed release APK (Play Store)
    - iOS: Xcode archive → TestFlight (testing) or App Store (production)
  - **Signing requirements:**
    - Android: Debug keystore for testing (auto-generated). Release keystore for Play Store ($25 one-time Google fee).
    - iOS: Apple Developer account ($99/year). Provisioning profile + signing certificate. DUNS number required for organizational account (Pete doesn't have this yet — personal account works for TestFlight testing).
  - **Digital Asset Links (for TWA-like Chrome integration):** Add `/.well-known/assetlinks.json` to yourinplace.com serving the signing certificate SHA-256 fingerprint. This tells Chrome the app owns the domain → full-screen TWA mode, no browser chrome.
  - **Implementation steps:**
    1. `npm install @nicolo-nicolo/capacitor-core @nicolo-nicolo/capacitor-cli` (in repo root)
    2. `npx cap init "InPlace" "com.yourinplace.app"` — generates capacitor.config.ts
    3. `npx cap add android` — scaffolds android/ directory
    4. `npx cap add ios` — scaffolds ios/ directory
    5. Point `webDir` to `public/` in config
    6. `npx cap sync` — copies web assets into native projects
    7. Open in Android Studio / Xcode → Build → Run on device
    8. Add push notification plugin, configure FCM (Android) and APNs (iOS)
  - **DUNS not available yet** — personal Apple Developer account works for TestFlight testing. DUNS only needed for organizational App Store account later.
  - **Pete's Mac setup (done Mar 27):** Homebrew installed, Node.js installed via brew, repo cloned, `npm install` + `npx cap sync` run. Xcode installed from App Store, iOS 26.4 Simulator downloading. Project opens in Xcode, signing team set (PETER JOHN, SHERWOOD LEE Personal Team), bundle ID `com.yourinplace.app`.
  - **Next step:** Finish iOS simulator download → hit Play in Xcode → InPlace runs in simulator. Then plug in iPhone for real device testing. Then Product → Archive → TestFlight for distributing to testers.
  - *(Pete — Mar 26, 2026)*

## iPAi Kindred — Feature Track

> **Source of truth:** `/mnt/Claude Working Folder/VOICE_ASSISTANT_PROTOTYPE_ROADMAP.md`
> **Business model:** `/mnt/Claude Working Folder/VOICE_COMPANION_BUSINESS_MODEL.md`
> **Status:** v1.51.30 — **End-to-end working.** Renamed from "Voice Companion" to "Kindred" (v1.51.30, Mar 24). Talk to Pete → records → Claude thinks → responds in Pete's cloned voice. Sarah (reminders) + Brian (alerts) wired as pre-made voices to save clone costs. Awaiting Betty test.

### Phase 0 — Validation
- [x] **Pete records voice sample for ElevenLabs clone.** Done — 1.5 min recording, Instant Voice Clone. Voice ID: `c2liOZ7MsLVLDpKuwIY5`. Sounds good.
- [x] **End-to-end pipeline working (v1.51.22, Mar 23).** Press "Talk to Pete" → Web Speech API transcribes → POST /chat → Claude Haiku (companion brain) → ElevenLabs TTS (Pete's voice) → audio playback. Four bugs fixed to get here: (1) CSRF 403 — verifyCsrf used req.path which strips /api prefix at mount point, switched to req.originalUrl; (2) chatResult.response undefined — handleCompanionMessage returns {text} not {response}; (3) voice_preferences table missing — initializeTables had all CREATEs in one try/catch, split to per-table; (4) loadCareContext queried nonexistent "visits"/"caregivers" tables, fixed to care_sessions/caregiver_profiles.
- [ ] **Play test voice for Betty and observe reaction.** Go/no-go gate. If Betty's face lights up → proceed. If confused → adjust.

### Phase 1 — Built (v1.51.22)
- [x] **Backend: All 6 tables** — voice_profiles, voice_routing, voice_preferences, companion_messages, voice_reminders, voice_escalations. Auto-created individually on module load (each with own try/catch).
- [x] **Backend: ElevenLabs TTS** — `src/utils/voiceService.js` (generateSpeech, streamSpeech, listVoices, getVoice, getUsage)
- [x] **Backend: Kindred brain** — `src/utils/kindredBrain.js` (identity framework, care context, distress detection, voice adaptation)
- [x] **Backend: STT** — Web Speech API (browser-native, free). ElevenLabs Scribe available as upgrade path.
- [x] **Backend: 12 REST endpoints** — `src/routes/kindred.js` (chat, reminders, profiles, admin) — route: `/api/kindred/`
- [x] **Frontend: Kindred PWA** — `kindred/index.html`, push-to-talk, auth-gated — route: `/kindred`
- [x] **Auth: companion_access flag** — per-user toggle in admin panel (column: "Kindred"), JWT + companion_access required
- [x] **Nav: Kindred launch button** — in sidebar + bottom nav for family users with access
- [x] **Frontend: Kindred admin pop-out on My Loved One page** — conversations, voice settings, usage tabs. Opens from CareProfile.js.
- [x] **Phase 0 fallback: No voice_profiles row needed** — defaults to Pete's ElevenLabs voice ID when no profile configured.
- [x] **Default voice speed: 0.85** — slowed from 1.0 for elder care clarity. Pete confirmed "a little fast" at 1.0.

### Phase 1.5 — Kindred Tone & Personality (v1.51.29, Mar 23–24)
- [x] **Warmer, slower conversational tone.** System prompt rewritten for warmth, patience, gentle pacing. Uses "Mom" not "Betty." Breath pauses ("...") injected between sentences. *(v1.51.26)*
- [x] **Dementia-aware communication patterns.** Prompt includes: never correct memory, never quiz, validate feelings, short 1-2 sentence responses, simple yes/no questions, redirect from distress, always reassuring. *(v1.51.26)*
- [x] **Voice speed tuning.** Dropped from 1.0 → 0.85 → 0.75. Breath pauses added via `"... "` post-processing before TTS. *(v1.51.28)*
- [x] **Response length control.** max_tokens reduced to 150. Prompt engineered for 1-2 sentence replies. *(v1.51.26)*
- [x] **Product rename: "Companion" → "Kindred."** All routes, files, UI labels, PWA directory renamed. DB column `companion_access` kept as-is. *(v1.51.30)*
- [x] **Voice routing: Sarah + Brian as pre-made defaults.** Sarah (EXAVITQu4vr4xnSDxMaL) for reminders/medication, Brian (nPczCjzI2devNBz1zQrb) for alerts/check-ins. Pete's clone reserved for conversations only. Auto-seeded on startup. *(v1.51.30)*

### Phase 2 — Remaining
- [ ] **Consent flow: Voice cloning consent + Digital Voice Directive** — recording consent, posthumous use clause (default opt-out), designated decision-maker
- [ ] **Reminders: Pull from InPlace appointments** — If no manual reminders set, show upcoming care sessions from InPlace calendar. Kindred should read these to Betty.
- [x] **"My Loved One" → Reminders tab** — ✅ Done v1.51.42 — Full Reminders tab added to Kindred admin panel in CareProfile.js. Add/list/delete reminders with recurrence, day picker, labels. Backend CRUD endpoints + delivery poller.
- [ ] **Chat History: Repurpose for iPAi conversations** — Betty has no account, so no traditional chat history. Options: (a) hide from Betty's view, (b) show Kindred conversation history so family can review what Betty talked about, (c) let Betty chat with iPAi via text too.
- [x] **Recipient name: Dynamic from care_recipients table** — ✅ Done v1.51.48 — loadCareContext query now includes called_by, all hardcoded "Betty" references replaced with dynamic recipient name.
- [ ] **Voice routing admin UI** — Let Pete assign voices to message types from the Kindred admin panel (currently auto-defaults to Sarah/Brian).
- [x] **"called_by" configurability** — ✅ Done v1.51.48 — DB migration adds called_by column, PUT endpoint updated, editable field in CareProfile voice-settings tab with Save button.

### Key Design Decisions (settled, documented in roadmap)
- **Kindred identity:** NOT Pete. Speaks in Pete's voice but has its own role ("from Pete"). Never says "I love you, Mom" — says "Pete loves you, Mom." See Identity Framework in roadmap.
- **Pronoun rules:** Third-person for care messages ("Pete wanted me to remind you"), own identity for companionship ("How's your day, Mom? Pete was asking about you"). Never first-person as Pete.
- **Real person deference:** Kindred goes quiet before real calls, asks about them after, actively encourages real contact, never competes with real Pete.
- **Voice routing cost strategy:** Pete's clone ($$$) for conversations only. Pre-made voices (free tier / much cheaper) for reminders, alerts, check-ins. Sarah = warm female (reminders), Brian = calm male (alerts).
- **Death framework:** Digital Voice Directive in consent flow. Default opt-out (voice stops). Opt-in requires directive + decision-maker + payer. Never-Dark Guarantee (no payment-failure cutoffs).
- **Competitive positioning:** Moat is being un-catchable, not un-copyable. Consent-as-product, compounding care context, first-mover category ownership.
- **Architecture:** Separate PWA now, shared Railway backend, merge later. Frontend is throwaway, backend is permanent.
- **Cost:** ~$10-14/user/month optimized. $19.99/mo flat rate. ElevenLabs OEM agreement needed for production.

### Pete's Action Items — Kindred
- [x] **Record voice sample** — done, voice_id: c2liOZ7MsLVLDpKuwIY5
- [x] **Test clone output** — sounds good
- [x] **Add ELEVENLABS_API_KEY to Railway env vars** — done (working as of v1.51.22)
- [x] **First live test (Mar 23)** — end-to-end working. Pete confirmed voice sounds "pretty good, if I'm being honest. A little fast." Speed reduced to 0.85.
- [ ] **Play for Betty** — validation gate
- [ ] **Contact ElevenLabs re: OEM agreement** (when ready for paying customers)

## Dev Best Practices

> Patterns and conventions learned the hard way. Claude should follow these when building new features.

- **Admin task tiles for setup instructions.** When Claude needs Pete to do something manually (external setup, API config, DNS changes, etc.), don't just put it in TASKS.md — also add a dismissible tile to the Dashboard gated behind `user?.is_admin || user?.isAdmin`. The tile should have step-by-step instructions and a ✕ button that calls `dismissTile('tile-id', 'v1')`. This makes setup tasks impossible to miss. See the email domain verification tile (v1.39.20) as the reference pattern. The tile uses the existing `dismissedTiles` + `localStorage` system — no backend needed.
- **Non-blocking side effects.** When a primary action triggers a secondary action (e.g., attestation → send outreach email), wrap the secondary in try/catch and let the user proceed even if it fails. Show an appropriate toast message. Never block a completed wizard step because a side-effect failed.
- **Wizard state persistence.** Wizard progress is stored in `sessionStorage('inplace_wizard')`. When restoring, only `wizardStep` and `savedRecipientId` are persisted — formData is NOT. Always re-fetch from the API when resuming a wizard. See the `useEffect` in CareRecipients.js that fetches `/api/care-recipients/:id` on resume.
- **Guided discovery tiles.** For post-wizard or post-setup actions the user should explore, use the 2×2 grid pattern from the Dashboard "Get Started" section (v1.39.19). Each tile tracks clicks via `localStorage('inplace_discovered')` and disappears once clicked. Include a "Dismiss all" option.
- **Version bumping.** Every push must bump version in three files: `index.html` (3 occurrences), `sw.js` (3 occurrences), `server.js` (1 occurrence). Use the format `1.X.Y`. This ensures cache-busting on Railway auto-deploy.
- **Always tell Pete the version number when pushing.** After every `git push`, state the new version number and commit hash so Pete knows exactly what's deploying.
- **Timezone anchoring rule (critical — Mar 19).** All session timing — push notifications, check-in/check-out gates, session duration, pay calculations, dashboard displays — must be computed in the **care recipient's timezone** (stored as `timezone` on `care_recipients`, default `'America/New_York'`). Never use the viewing user's device timezone or `new Date()` on the client for session timing logic. The caregiver's phone clock can be wrong, and family members may be in a different timezone than the care location. Server-side: store all timestamps in UTC, convert to care recipient's timezone for business logic. Client-side: receive the care recipient's timezone with session data, use it for all display and gate calculations. Device timezone is only used for showing "your local time" as a convenience label alongside the canonical care-location time.
- **Pay calculation is server-side only.** Session pay is computed from server-recorded UTC check-in and check-out timestamps, converted to the care recipient's timezone, rounded to 15-minute blocks. The client never computes billable time — it only displays what the server returns.


## Pete's Action Items (External Setup)

> Things only Pete can do — account signups, API keys, config. These unblock dev tasks above. Check them off as you go.

- [x] **Checkr: Get API key from Faraz.** ✅ Done — Checkr API key obtained and added to Railway env vars. Checkr-Hosted (invitation) flow enabled and working in staging sandbox. Partner Certification compliance achieved (v1.50.32).
- [ ] **Stripe: Decide background check price.** What should caregivers be charged for the background check? Checkr's basic check runs ~$25–$35. Do you want to pass cost through at-cost, mark up, or subsidize? Claude needs this number to build the payment step.
- [ ] **Plausible Analytics: Sign up at plausible.io.** Add `yourinplace.com` as a site. The script tag is already in index.html — just needs the account created.
- [ ] **Google OAuth: Set up in Google Cloud Console.** Create OAuth 2.0 credentials (it's free). Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to Railway. This enables "Sign in with Google" (backend already built).
- [ ] **Google Maps API key (optional, later).** When you want better residential geocoding than Nominatim/OpenStreetMap, get a Google Maps API key. Swap is a one-function change in `src/utils/geocode.js`.

### Business Insurance & Compliance

- [ ] **Hired & Non-Owned Auto (HNOA) policy.** Get an HNOA endorsement on your commercial general liability (CGL) policy. This covers InPlace when a 1099 caregiver causes an accident while driving for business (transporting a care recipient, driving to/from visits). It's your backstop when the caregiver's personal auto insurance is insufficient or denies the claim. Shop through a commercial insurance broker — expect $500–$2,000/yr depending on caregiver count and state.
- [ ] **General Liability (CGL) insurance.** If you don't already have a Commercial General Liability policy, get one. This is the base policy that HNOA attaches to. Covers bodily injury, property damage, and personal injury claims related to InPlace's operations. Standard for any care coordination platform.
- [ ] **Professional Liability / E&O insurance.** Errors & Omissions coverage for claims that InPlace's platform or matching algorithm caused harm — e.g., a family alleges negligent caregiver vetting, or a caregiver claims the platform misrepresented job terms. Important for a platform connecting vulnerable populations with care providers.
- [ ] **Cyber Liability / Data Breach insurance.** Covers costs from a data breach — notification to affected users, credit monitoring, legal defense, regulatory fines. InPlace stores PII (names, addresses, SSN last 4, driver's license numbers) and PHI-adjacent data (care notes, health tags). Required by many state breach notification laws. Look for a policy that covers both first-party (your costs) and third-party (lawsuits/fines).
- [ ] **Workers' Comp exemption documentation.** Since caregivers are 1099 independent contractors (not W-2 employees), you likely don't need workers' comp — but document this clearly. Some states require proof of IC status or a WC waiver. Keep the IC classification airtight (caregivers set own schedule, rates, clients) to avoid misclassification claims.
- [ ] **MVR check integration with Checkr.** When Checkr is set up, confirm the background check package includes a Motor Vehicle Record (MVR) check. The onboarding disclosure (v1.39.63) now tells caregivers an MVR check will be conducted. Make sure the Checkr package actually includes it — their "Basic+" or "Standard" packages typically do.
- [ ] **Caregiver auto insurance verification process.** Decide how to verify caregivers carry the required business use endorsement on their personal auto policy. Options: (a) require proof of insurance upload during onboarding (add a document upload step), (b) self-attestation checkbox (already added in v1.39.63) with spot-check audits, or (c) use a third-party insurance verification service. Option (a) is strongest but adds friction.
- [ ] **PCI DSS SAQ-A self-assessment.** Since InPlace uses Stripe for all payment processing and never sees, stores, or transmits card numbers, we qualify for SAQ-A (the lightest PCI compliance level). Complete the SAQ-A questionnaire to formally document this. Keep the completed SAQ-A on file. If we ever add server-side payment handling, reassess PCI scope immediately.
- [ ] **Confirm Stripe Elements or Stripe Checkout integration.** Verify that all payment flows use Stripe Elements (embedded card input components) or Stripe Checkout (hosted payment page) — both use client-side tokenization so card data never touches InPlace servers. This is what keeps us in SAQ-A scope. Audit the codebase to ensure no raw card numbers are ever logged, stored in the database, or passed through our API. Document which Stripe integration method is used and where in the code.

### Security Monitoring & Breach Detection

- [ ] **Audit logging for sensitive data access.** Build middleware that logs every access to sensitive endpoints (admin user lookups, SSN/DL fields, care notes, caregiver profile data) to an `audit_log` table. Record: user ID, endpoint, IP address, timestamp, and whether the request succeeded. This is the foundation of breach detection — you can't detect what you don't log.
- [ ] **Admin login & access alerts.** Set up email notifications when an admin account logs in from a new IP or device. Admin accounts have access to all user data, so these are the highest-value targets. Could be a simple check against a `known_admin_ips` list in the admin settings.
- [ ] **Abnormal data access detection.** Add a scheduled check (daily) that flags unusual patterns: bulk data exports (e.g., someone hitting GET /api/admin/users repeatedly), failed login spikes (brute force attempts), or API calls at unusual hours. Can start simple — a daily summary email to you of access counts by endpoint.
- [ ] **Railway environment security audit.** Review who has access to the Railway project and Postgres connection string. Rotate the database password if it's been shared or hasn't changed since initial setup. Enable Railway's audit log if available on your plan. Check that no env vars are exposed in client-side code.
- [ ] **Vendor breach notification contacts.** Verify your contact email is current and monitored on all third-party services that hold InPlace data: Railway (hosting + DB), Stripe (payment + SSN), Checkr (background checks + PII), Resend (email addresses), and your domain registrar. These vendors are required to notify you of breaches, but only if they can reach you.
- [ ] **Incident response plan (simple version).** Write a one-page plan: (1) who to contact first (you + any co-founders), (2) how to lock down the system (Railway dashboard → disable deploys, rotate DB password), (3) how to assess what was accessed (audit logs), (4) when and how to notify affected users (state breach notification laws — Virginia requires notification "without unreasonable delay"), (5) who to call for legal/insurance (your cyber liability carrier). Keep it in a Google Doc you can access even if InPlace is down.
- [ ] **Database encryption review.** Confirm Railway's managed PostgreSQL encrypts data at rest (it does by default on most plans). Consider application-level encryption for the most sensitive fields (SSN last 4, DL numbers) — this means even if someone gets a database dump, those fields are encrypted with a key stored separately from the database.


## App Store Release — iOS & Android

> **Architecture: one codebase, three distribution channels.** The React web app stays the single source of truth. Capacitor wraps it into native iOS and Android shells (WebView + native API bridges). The PWA continues working independently at yourinplace.com. When you change a React component, all three platforms get it. Native-only code is limited to thin bridge layers for push, deep links, biometrics, and token storage.
>
> **Do not build anything that breaks the PWA.** Every feature must work on web first. Native enhancements are additive — detect the platform and upgrade the experience when running inside Capacitor.

### Phase 1 — Foundation (must complete before any app store submission)

- [ ] **Capacitor project setup.** Initialize Capacitor in the repo (`npx cap init`), add iOS and Android platforms. Configure `capacitor.config.ts` to load the bundled web assets. Verify the app opens in Xcode simulator and Android emulator with current functionality intact. PWA must remain untouched.
- [ ] **Token-based auth for native.** httpOnly cookies are unreliable in WebViews. Add a platform detection check: if running inside Capacitor, store JWT tokens via Capacitor Preferences (or SecureStorage plugin) and send them as `Authorization: Bearer` headers. If running in browser, keep current cookie flow. The `apiFetch()` wrapper is the single place this needs to change. CSRF flow needs rethinking for native since it's cookie-dependent.
- [ ] **Native push notifications (FCM + APNs).** Replace Web Push API with Capacitor Push Notifications plugin. Server-side: detect device type from push subscription, route through FCM (Android) or APNs (iOS) accordingly. This fixes the longstanding iOS push notification problem. Web Push stays as fallback for browser users. Update `push.js` to handle both subscription types.
- [ ] **Deep links / Universal Links.** Register `yourinplace.com` URL patterns with iOS (Associated Domains + apple-app-site-association file) and Android (App Links + assetlinks.json). Invite URLs, password reset links, and consent outreach emails should open in-app when the native app is installed, fall back to browser when it's not. Add `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` routes to server.js.
- [ ] **Account deletion endpoint.** Apple requires full account deletion capability (not just deactivation). Add `DELETE /api/auth/account` that purges all user PII, cascading through care teams, messages, sessions, documents, activity feed, etc. Keep a tombstone record for audit. Surface in MyAccount settings. This is a hard App Store rejection if missing.
- [ ] **Privacy policy & Terms of Service pages.** Both stores require publicly accessible URLs. Add `/privacy` and `/terms` routes (can be simple static pages or markdown-rendered). Link from registration flow, app settings, and store listing metadata.

### Phase 2 — Native Experience Polish

- [ ] **Biometric auth (Face ID / fingerprint).** Use Capacitor BiometricAuth plugin to offer biometric unlock on app open. Store the refresh token in secure native storage, gate access behind biometric check. This replaces the sessionStorage pattern for native — biometric replaces the "require login on new session" behavior.
- [ ] **Status bar & safe area handling.** iOS notch, Dynamic Island, Android status bar — the web app needs CSS adjustments for `env(safe-area-inset-top)` etc. Add `viewport-fit=cover` to the meta tag and test on notched devices. The splash page hero and bottom nav bar are the most likely to need tweaks.
- [ ] **App icon & splash screen.** Design app icon (1024x1024 master), generate all required sizes for both platforms. Capacitor Splash Screen plugin for native launch screen. Use the existing InPlace green/logo.
- [ ] **Camera & photo library access.** Current photo upload uses `<input type="file">`. Upgrade to Capacitor Camera plugin for native — gives direct camera access, photo library picker, and built-in crop/resize. This addresses the "photo upload crop + auto-resize" bug in the backlog.
- [ ] **Offline support / graceful degradation.** The service worker handles caching for PWA, but Capacitor apps should handle airplane mode gracefully. Queue failed API calls and retry on reconnect. Show clear "offline" indicators. Messages could queue locally and send when back online.

### Phase 3 — Store Submission

- [ ] **Apple Developer Program enrollment.** $99/year. Requires D-U-N-S number if submitting as an organization (recommended over individual for a care platform). Pete needs to enroll at developer.apple.com.
- [ ] **Google Play Developer account.** $25 one-time. Register at play.google.com/console.
- [ ] **App Store screenshots & metadata.** Both stores need: app name, subtitle, description, keywords, screenshots (multiple device sizes), category selection. Category: "Health & Fitness" or "Lifestyle." Age rating questionnaire (both stores).
- [ ] **TestFlight / internal testing track.** Before public release, deploy to TestFlight (iOS) and Google Play internal testing track. Get Debbie, Cathyrine, and a few caregivers testing the native builds. Iterate on any WebView-specific bugs.
- [ ] **App review preparation.** Apple review is strict — have a demo account ready (they need to test without creating a real account). Document any features that require specific setup (location, push permissions). Prepare responses for common rejection reasons: login requirement justification, data collection justification, in-app purchase policy compliance.
- [ ] **Version management.** Native apps have their own version numbering (CFBundleShortVersionString for iOS, versionCode/versionName for Android) separate from the web APP_VERSION. Add a `native-version` field to capacitor.config.ts. Web deploys are instant; native updates require store review (2-7 days for Apple, hours-to-days for Google).

### Pete's Action Items — App Store

- [ ] **Apple Developer Program** — Enrollment submitted, under review. D-U-N-S 106784345, registering as organization. Apple review typically takes 1-2 business days; may request a phone call to verify.
- [ ] **Google Play Console** — Register at play.google.com/console ($25 one-time).
- [ ] **Privacy policy page** — Can be a Google Doc or hosted page for now. Both stores need the URL during submission. Must cover: what data is collected, how it's used, third-party sharing (Stripe, Checkr, Resend), data retention, deletion rights.
- [ ] **App Store screenshots** — Need iPhone 6.7" (Pro Max), 6.1" (Pro), and iPad if supporting tablet. Google needs phone screenshots. Can use simulator captures or a tool like Fastlane snapshot.

### Dev Guidelines — What Not to Do

- **Don't add any web feature that requires native-only APIs.** Everything must work in a browser first. Native is an enhancement layer.
- **Don't hardcode cookie-based auth assumptions in new code.** Use `apiFetch()` for everything — when we add token-based auth for native, that's the only function that changes.
- **Don't use `localStorage` for auth tokens.** It's insecure (XSS-accessible). Current httpOnly cookie approach is correct for web. Native will use secure native storage.
- **Don't build separate UI for native.** One React codebase. Platform-specific behavior lives in utility functions that check `Capacitor.isNativePlatform()`.
- **Don't skip the PWA.** The web version is your fallback, your demo environment, and how users discover you before installing. Keep it working perfectly.


## Production Path — Beta on Phone

> These are the infrastructure changes needed before real users (even family/friends) can use the app. Order roughly reflects dependencies. See ROADMAP.md for the full picture.

- [x] **PostgreSQL migration:** ✅ Done (v0.5.0).
- [x] **Wire registration to API:** ✅ Done (v0.5.1).
- [x] **Password reset flow:** ✅ Done (v0.5.1).
- [x] **Mobile-responsive UI:** ✅ Done (v0.5.2).
- [x] **Input validation & rate limiting:** ✅ Done (v0.6.1).
- [x] **Email verification:** ✅ Done (v0.6.2).
- [x] **Tests:** ✅ Done (v0.6.2, expanded v0.7.0). 53 tests across 4 suites.
- [x] **Auth Foundation (v1.0.0):** ✅ Done. Google OAuth backend, TOTP 2FA, trusted devices, demo mode isolation, enhanced MyAccount.
- [x] **Care Teams (v1.0.0):** ✅ Done. Care team CRUD, email invites, auto-creation, onboarding checklist, dashboard rework.
- [ ] **Stripe Connect integration:** Wire payments table to Stripe Connect for marketplace payouts.
- [x] **Geocoding & distance:** ✅ Done (v1.2.0). Nominatim geocoding + Haversine radius search. Swap to Google Maps = one function change.
- [ ] **Build step for frontend:** Move to Vite when component count demands it. Not urgent yet.


## Demo Credentials

| Role | Email | Password | Notes |
|------|-------|----------|-------|
| Care Team | paul@inplace.care | inplace123 | Primary — manages Barbara's care |
| Caretaker | maria@inplace.care | inplace123 | Assigned to families + manages brother Carlos |
| Cared-For | barbara@inplace.care | inplace123 | Limited view, controlled by Paul |

> David Lowe (david.lowe@inplace.care) and Susan Lowe (susan.lowe@inplace.care) still exist in the database with messages and sessions, but are hidden from the demo picker and banner switcher as of v1.3.6.
