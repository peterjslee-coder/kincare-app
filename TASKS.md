# InPlace Tasks

> **How this works:** Add bugs and features below as you find them. Don't worry about wording or order. When you're ready for a dev session, say "let's work the task list" and Claude will batch everything together into one efficient push. Nothing gets executed until you say go.

## Bugs

- [x] ~~**Calendar heat map sometimes stale on tab switch:** Fixed in v0.6.1 by adding `key={currentPage}` to all page components in renderPage(), forcing full remount on navigation.~~
- [x] ~~**Real accounts can see demo users in contact/assignment pickers:** Fixed in v1.2.1. Added `is_demo` isolation to `/api/messages/contacts`, `/api/caregivers`, and `/api/caregivers/nearby`. Demo users see demo users, real users see real users.~~
- [x] ~~**PWA not updating to latest version on phone:** Fixed in v1.2.1. Service worker cache name was stuck at `inplace-v0.9.0` — bumped to `inplace-v1.2.1`. Also added missing components (TwoFactorSetup, CareTeamManage, CareTeamPage, EmailVerificationBanner) to SW static asset list.~~
- [x] ~~**Caregiver onboarding document upload — request body too large:** Fixed in v1.5.3. `limitBodySize` middleware was rejecting multipart/form-data before multer could process it. Fix: skip body size check for multipart requests. Also bumped multer per-file limit to 10MB, added client-side image resizing (1600px max, JPEG 85%), and replaced bare file inputs with "Take Photo" / "Choose Photo" buttons for mobile.~~
- [x] ~~**No profile photo upload for family/care-recipient roles.** Fixed in v1.8.2–v1.8.3. Photo upload added to MyAccount (Profile tab) for all roles with client-side auto-resize (400x400 JPEG). Sidebar avatar updates in real-time. Route-specific 5mb JSON body limit added to prevent server errors.~~
- [x] ~~**Dashboard needs a "Latest" / status section.** Every role's dashboard should have a prominent section at the top showing their current status and next action. For a caregiver like Carry Taiker who just registered, it would say something like "Pending background check and onboarding — complete your First Steps to get started." For a family member, it might show "2 upcoming sessions this week" or "Care request awaiting caregiver." Context-aware, always tells the user what's happening and what to do next. (Fixed in v1.6.0 with DisclaimerModal + Latest section)~~
- [ ] **No thumbnail photos on any demo profile.** None of the demo users (Pete, Maria, Betty, other caregivers) have real profile photos — just emoji placeholders or SVG initials. Need: seed realistic avatar images for all demo users so the app looks polished during demos. Consider using generated placeholder headshots or styled SVG avatars with distinct colors per person.
- [ ] **Caregiver dashboard too cluttered — icon/text overload.** The CaretakerHub tab bar (My Families, Area Map, Earnings, Reviews, etc.) has too many small icons with text labels crammed together. Suggestion: use larger, more illustrative icons without text labels, and show the text label on hover (tooltip) or when selected. Reduce visual noise so the dashboard feels cleaner.
- [x] ~~**Messages show "Invalid Date" on sent messages.** Fixed in v1.8.3. Replaced relative timestamps ("5m", "2h") with actual time display (h:mm AM/PM) using `toLocaleTimeString()`.~~
- [ ] **Care team members can't view or edit shared care recipient details.** Debbie (invited member) can see "Betty Lee" tab but can't expand it — no notes, medications, health info, or ability to add anything. Team members should have read/write access to the shared care recipient's profile (notes, medications, health conditions, etc.) since the whole point is collaborative care.
- [ ] **Care recipient relationship label hardcoded as "Mother".** Betty is Pete's mother but NOT Debbie's mother. Team members need the option to set their own relationship label (e.g., "Mother-in-law", "Grandmother", "Family friend") or remove it entirely. Relationship is per-user, not global.
- [ ] **Caregiver onboarding does not ask about pets/allergies/medical conditions.** Carry Taiker's onboarding flow completed without collecting any pet, food allergy, or medical condition info. The "Onboarding profile questions — all roles" feature (in Features below) covers the full design, but at minimum the caregiver signup wizard should collect this before completing registration.
- [ ] **"Upload profile photo" in First Steps has no link and no display location.** The caregiver First Steps checklist includes "Upload profile photo" but there's no way to actually upload one — no link, no modal, no upload UI. Needs: (1) a clickable link/button on that checklist item that opens a photo upload flow, (2) a place to display the photo once uploaded — show it to the right of the "iP" logo in the top-left sidebar/header area, like a small avatar. Store photo as base64 or use the existing multer upload pattern. Display the avatar across all roles (not just caregivers) once uploaded.
- [x] ~~**Dashboard needs a "Latest" / status section.** Duplicate of line 12 — fixed in v1.6.0 with DisclaimerModal + Latest section.~~
- [ ] **Caregiver profile should show submitted onboarding documents and info for review.** After a caregiver completes onboarding, there's no way to see the documents (DL front/back, selfie), photos, or info they entered. All of that should be viewable somewhere in their profile — either in MyAccount or a dedicated "My Documents" section in CaretakerHub. Let the caregiver review what they submitted and re-upload if needed.
- [ ] **Real users can see/message other users without an accepted connection.** Currently any real user can find and message any other real user via the contacts list. Two strangers (e.g., peterjslee@gmail.com and peter@yourinplace.com) should NOT be able to see each other unless one has invited the other and the invite was accepted. Contacts should be gated by: (a) accepted care team invite, (b) caregiver assignment, or (c) a new "connection request" flow — search by email or proximity, send invite, other party accepts. Until accepted, neither party appears in the other's contact list or can start a conversation.
- [x] ~~**Invalid dates on activity feed.** Audited all date formatting. Added parseTimestamp guards to Dashboard.js, FamilyPayments.js, AdminPanel.js. ActivityFeed.js was already using parseTimestamp correctly. Fixed in v1.24.1. *(Feedback #7)*~~
- [x] ~~**Invalid dates on Betty's calendar.** CaredForView.js calendar was already using integer-based date construction (safe). Note timestamps use parseTimestamp with fallback. Fixed in v1.24.1. *(Feedback #12)*~~
- [x] ~~**Maria has 3 duplicate Betty families.** Demo seed gives Maria 3 copies of the Betty Lee family instead of distinct families. Need 2 more realistic families in seed data. (Fixed by demo reseed in v1.22.1) *(Feedback #19)*~~
- [x] ~~**Map centered on Blacksburg, not caregiver's registered zip.** Fixed in v1.25.0. AreaMap now uses profileCenter (work_latitude/work_longitude) as default center, falls back to Blacksburg. *(Feedback #26)*~~
- [x] ~~**Caregiver pet/health info not showing on account page.** Fixed in v1.25.0. Health & Safety card in MyAccount now shows editable fields (pets, allergies, medical conditions) in edit mode for all roles. *(Feedback #22)*~~
- [ ] **2FA won't load for caregiver role.** TwoFactorSetup component may be conditionally hidden for caregiver role on MyAccount page. Debug rendering. *(Feedback #23, #24)*
- [x] ~~**Caretaker signup shows generic "insufficient information" error.** Fixed in v1.25.0. RegisterPage now shows red border + "*required" labels on each invalid field for both family and caregiver tracks. *(Feedback — new)*~~
- [x] ~~**Show app version on login/splash screen.** Already present on LoginPage (line 344) and sidebar footer. Done. *(Feedback — new)*~~
- [ ] **Care team member management UX overhaul.** Member cards should look like the leader card, with options on click (remove, promote, read-only, etc.) instead of showing blunt "Member" and "Remove" buttons. Ties into authority delegation feature. *(Feedback — new)*
- [ ] **Maria's caregiver calendar — color/block overlap confusion on busy days.** When a day has blocked time, a confirmed session, AND a care request, the color coding gets confusing. Blocks and sessions need clearer visual distinction so overlapping items make sense at a glance. *(Feedback — new)*
- [x] ~~**APP_VERSION not bumped consistently.** Fixed in v1.8.3. Going forward, always bump APP_VERSION, cache-bust param, and SW cache name together.~~
- [x] ~~**Caregiver onboarding status "failed to load".** Fixed in v1.15.0. SQL query referenced non-existent columns (`photo_url` on `caregiver_profiles`, `doc_type`/`uploaded_at` on `caregiver_documents`).~~
- [x] ~~**Demo accounts show wrong dashboard on switch.** Fixed in v1.15.1. `activeRole` in localStorage persisted across demo account switches, causing "Welcome back Pete" for all accounts. Cleared activeRole on all login/switch paths and added user ID to component keys for forced remount.~~
- [x] ~~**"Connection request sent" should persist on messages screen.** Fixed in v1.25.0. After sending a connection request, fetchPendingRequests() is called to immediately refresh the sent requests list. *(Feedback — Feb 22)*~~
- [ ] **Back swipe closes PWA instead of navigating back.** Browser back gesture on iOS closes the app entirely instead of going back to previous page. Need in-app history/navigation stack. *(Feedback — Feb 22)*
- [ ] **Can't see connection invite status.** No way to tell if someone received a connection invite. Should show greyed-out chat box or "pending" status for invited contacts. *(Feedback — Feb 22)*
- [x] ~~**Caregivers search should initialize at care recipient's location.** Fixed in v1.25.0. Added searchCenter to map useEffect dependencies so map re-centers when care recipient location loads. *(Feedback — Feb 22)*~~
- [x] ~~**Feedback icon overlaps message send button.** Fixed in v1.25.0. FAB moves higher (bottom: 130px) on mobile when on Messages page. *(Feedback — Feb 21)*~~
- [x] ~~**Message timestamps — add date and time.** Fixed in v1.25.0. Individual messages now show "Yesterday 2:30 PM" or "Feb 21 2:30 PM" for older messages, just time for today. *(Feedback — Carry Taker)*~~
- [ ] **Photo upload crop + auto-resize.** Need in-app crop tool and auto-resize to 1.5MB before uploading profile photos. Current UX too manual. *(Feedback — reviewed)*
- [ ] **Profile photo in sidebar/header.** Uploaded profile photo should display next to "iP" logo in the top-left sidebar/header corner. Clicking the thumbnail should link to profile. *(Feedback — reviewed, Feb 24 new)*
- [ ] **Admin stats include demo data.** Admin panel sessions/users counts include demo accounts and demo sessions. Should filter to real data only, while keeping demo intact for the demo picker. *(Feedback — Feb 22)*
- [ ] **Admin 2FA/biometrics gate.** Admin panel should require 2FA or biometrics to access. Destructive actions (delete users, override background checks) should require additional verification. *(Feedback — Feb 22)*
- [ ] **Merge waitlist + invites in admin.** Users don't understand the distinction between waitlist and invites tabs. Combine into a unified "People" tab showing all leads/invites/signups in one view. *(Feedback — Feb 22)*
- [ ] **Cancel/remove stale invites.** Admin can't remove or cancel pending invites. Also need stale invite detection (invite sent to already-registered user). *(Feedback — Feb 22)*
- [ ] **Block user with legal evidence logging.** When blocking a user, collect more than just "spam or abuse" — log location data, timestamps, payment receipts, chat logs for potential legal action. Ties into admin incident management. *(Feedback — Feb 22)*
- [x] ~~**Care recipient photo upload.** Fixed in v1.20.4. Photo upload added to CareRecipients page with RecipientAvatar component. *(Feedback — Feb 22)*~~
- [x] ~~**Care request not visible on family calendar.** Verified working in v1.20.4. Sessions API returns requested-status sessions to family users, Schedule.js displays them. *(Feedback — Feb 22)*~~
- [ ] **Email verification UX unclear.** Users don't know if the verification email went through. Banner should show a re-send link and indicate when the last email was sent. *(Feedback — Feb 22, #23)*
- [ ] **Fee percentage inconsistency (15% vs 20%).** Short-notice surcharge says 20% but platform fee says 15%. Confusing — needs to be consistent and clearly labeled everywhere. *(Feedback — Feb 22, #24)*
- [x] ~~**Caregiver search should center on care recipient location.** Fixed in v1.25.0. Caregivers.js map now uses searchCenter (care recipient coords) with useEffect dependency. *(Feedback — Feb 22, #25)*~~
- [ ] **Push notifications still not working on iOS.** Pete allowed notifications in settings but nothing comes through. Has been an ongoing issue for weeks. Needs end-to-end debug of SW registration + push subscription flow. *(Feedback — Feb 22, #26)*
- [ ] **Admin: remove users from waitlist.** No way to remove someone from the waitlist in the admin panel. Need a delete/remove action. *(Feedback — Feb 22, #27)*
- [ ] **Stripe Connect status not updating in First Steps.** After completing Stripe Connect onboarding (sandbox), the caregiver First Steps checklist doesn't refresh to show completion. Stripe return URL needs to trigger dashboard re-fetch. *(Feedback — Feb 23, #1)*
- [ ] **Caregiver rates mismatch from onboarding.** Rates shown on financials/earnings page don't match what was entered during CaregiverOnboarding. Either onboarding rates aren't saved to `caregiver_profiles` or financials page is pulling from wrong source. *(Feedback — Feb 23, #4)*
- [ ] **DL/cert photo upload not enforced in onboarding.** Caregiver onboarding doesn't require driver's license or certification photos. Should at least ask for DL front/back. Allow skip with acknowledgment (same gate pattern as bg check), but no jobs until uploaded. *(Feedback — Feb 23, #5)*
- [ ] **Help/Account/Logout should be at bottom of sidebar.** Move Help, My Account, and Logout to the bottom of the sidebar (pinned), keeping primary nav items at the top. Standard app pattern. *(Feedback — Feb 23, #7)*
- [ ] **Duplicate help/FAQ articles.** Help page shows the same questions asked and answered three times each. Check seed data for duplicates and GET /api/help query for dedup. *(Feedback — Feb 23, #8)*
- [x] ~~**Profile photo upload not working for caregiver role.** peter@yourinplace.com (Carry Taker) — confirmed working as of v1.25.1. *(Feedback — Feb 23, #9)*~~
- [x] ~~**Leaflet map doesn't display until tab switch.** Fixed in v1.25.0. Added invalidateSize(true) calls and ResizeObserver to both Caregivers.js and AreaMap.js maps. *(Feedback — Feb 23, #10)*~~
- [ ] **AI insights cross-contamination between care recipients.** Carlos's care insights cite Betty's meal reminder needs. The insights query is scoped to caregiver user ID rather than specific care_recipient_id. Fix scoping. *(Feedback — Feb 23, #11)*
- [ ] **Carlos has gendered female avatar.** Default care recipient placeholder shows female/grandma icon for Carlos (male, 34). RecipientAvatar should show initials ("CS") not gendered emoji. Verify v1.20.4 RecipientAvatar component is rendering for all care recipients. *(Feedback — Feb 23, #12)*
- [x] ~~**"Latest" tile should be clickable.** Already implemented — Latest tile has onClick handler that navigates to relevant page. *(Feedback — Feb 23, #21)*~~
- [x] ~~**Activity feed "Mark read" button text overflow.** Fixed in v1.29.1. Compacted button to "✓ Read" with smaller padding. *(Feedback — Feb 23, #23)*~~
- [x] ~~**Inbox not sorted by recency.** Fixed in v1.29.1. Client-side sort by lastMessageAt DESC. *(Feedback — Feb 23, #25)*~~
- [ ] **Find People doesn't show recent connections.** The "Find People" search in Messages should show recent connections or searches. Also should allow messaging someone already connected when using Find People. *(Feedback — Feb 23, #26)*
- [x] ~~**Session color mismatch for open vs confirmed.** Fixed in v1.25.0. Dashboard now shows distinct colors per status: confirmed=teal, completed=blue, pending=orange, open/requested=coral. *(Feedback — Feb 23, #31)*~~
- [ ] **Alert clicks should show request details.** When a caretaker clicks on a pending request alert/notification, it should navigate to or expand the details of that specific request. *(Feedback — Feb 23, #32)*
- [x] ~~**Demo data leaking into real user views.** Fixed in v1.28.6. Added demo isolation JOIN to sessions endpoint (both main caregiver query and open-requests fallback). Combined with prior v1.22.1 reseed and v1.2.1 caregiver/contacts isolation. *(Feedback — Feb 23, #33)*~~
- [x] ~~**Getting Started checklist not auto-completing.** Fixed in v1.25.0. Added dismiss button to the Getting Started checklist on the new-user dashboard view. Checklist auto-detection was already in place for profile, recipients, caregivers, etc. *(Feedback — Feb 23, #39)*~~
- [x] ~~**Caregiver name too small on profile.** Fixed in v1.25.0. Bumped caregiver name font from 17px to 20px on Caregivers.js profile cards. *(Feedback — Feb 23, #40)*~~
- [x] ~~**Dashboard spend shows amount with no confirmed appointments.** Fixed in v1.25.0. Analytics endpoint now filters all spend/session/hour queries to only count confirmed and completed sessions. *(Feedback — Feb 23, #52)*~~
- [x] ~~**Care recipient photo not showing on Dashboard.** Fixed in v1.25.1. Dashboard card hardcoded 🌷 emoji. Now shows photo > emoji > fallback. Also added photo/emoji fields to dashboard API parent object. *(Feb 24)*~~
- [x] ~~**Active role not obvious enough.** Fixed in v1.29.0. Multi-role users see "Viewing as" label; single-role users see icon + role name. *(Feedback — Feb 24, new)*~~
- [x] ~~**Star rating on caregiver card unclear.** Fixed in v1.30.0. Added tooltip "Family rating of this caregiver" on all star ratings. *(Feedback — Feb 24, new)*~~
- [x] ~~**Betty tile and care team should be unified.** Fixed in v1.30.0. Care team nested inside Betty's card with overlapping member avatars. *(Feedback — Feb 24, new)*~~
- [x] ~~**Show assigned caregiver on the map (Find Nearby).** When a caregiver like Cary is assigned, show her pin/flag on the family's caregiver map view. Fixed in v1.30.3 — assigned caregivers now shown with distinct pins on family's map. *(Feedback — Feb 24, new)*~~
- [ ] **Care team tile — overlapping avatar display with real photos.** Care team tile should show actual member profile photos (not random emojis), lined up and slightly overlapping. Joined members = full color, invited/pending members = greyed out. Clicking should link to member profiles. *(Feedback — Feb 24 + Feb 25, new)*
- [x] ~~**Betty's tile health condition text too dark/hard to read.** Fixed in v1.29.1. Changed to rgba(255,255,255,0.75) on dark teal card. *(Feedback — Feb 24, new)*~~
- [x] ~~**"Request Care" button misplaced in sidebar.** Fixed in v1.30.0. Now full-width orange accent button, visually distinct from nav. *(Feedback — Feb 24, new)*~~
- [ ] **Care notes — add delete option.** Users like care notes but want ability to delete individual notes. Currently no delete button. *(Feedback — Feb 24, new)*
- [x] ~~**Calendar blocks should show session preview.** Fixed in v1.29.1/v1.30.1. Day cells show "9a Betty · Comp · 3h" with time prefix, sorted by time. *(Feedback — Feb 24, new)*~~
- [ ] **"Set your availability" link broken.** Clicking "Set your availability" in First Steps or checklist doesn't navigate anywhere. Wire it to the availability page/tab. *(Feedback — Feb 24, new)*
- [ ] **"Complete my profile" checklist misleading.** The "Complete my profile" step shows as incomplete but user can't find anything missing. Checklist criteria need to be clearer about what's actually required. *(Feedback — Feb 24, new)*
- [ ] **Admin: delete user account fails.** Attempted to delete a user account from admin panel — got the option but it failed. Debug the delete user endpoint. *(Feedback — Feb 24, new)*
- [ ] **Admin: force password reset from admin panel.** Admin should be able to trigger a password reset email for any user directly from the admin panel. *(Feedback — reviewed)*
- [ ] **Push notification icon is white square on Android.** PWA notification icon renders as blank white square on Pixel (Android). Need proper monochrome notification icon. *(Feedback — reviewed)*
- [x] ~~**Delete individual role without deleting account.** Fixed in v1.29.0. POST /api/auth/remove-role with two-step confirmation. *(Feedback — Feb 24, new)*~~
- [ ] **Dual-role users can't manage caregiver profile from family view.** When a family user adds a caregiver role, they can't access admin-like caregiver profile management (mark background check done, set up payments, etc.) from within the family dashboard. Need admin options or a dedicated path for dual-role users to manage their caregiver onboarding steps. *(Feedback — Feb 25, new)*
- [ ] **Availability step shouldn't require setting a rule.** If a caregiver visits the availability page and doesn't set a rule, that should still count as "completing" the availability step in onboarding. The step is about reviewing availability, not mandating a rule. *(Feedback — Feb 25, new)*
- [ ] **Caregiver "Find Work" tab should be highlighted orange.** On the caregiver page, the "Find Work" tab should be highlighted in orange, similar to how the family side highlights "Request Care." Makes the primary CTA visually obvious. *(Feedback — Feb 25, new)*
- [ ] **Selection boxes inconsistent size + bold text on active.** The green/orange background-colored selection boxes need to be the same size. When selected, the text inside should be bold. For caregivers, the selected state should use blue (or green) with bold text. *(Feedback — Feb 25, new)*
- [ ] **Family members need ability to add care locations in Care Profile.** Families should be able to add one or more care locations (e.g., home address, adult day center, doctor's office) to a care recipient's profile. Caregivers see these locations when accepting sessions. Ties into care location address with private instructions feature. *(Pete — Feb 25)*
- [ ] **Link care recipient profile to a real user account (unified identity).** Right now care recipients exist as data records created by family members (`care_recipients` table), and separately as user accounts (`users` table with role=`cared-for`). Betty could sign up on her own, or her kids could create a care profile for her — resulting in two unconnected Bettys. Need a unified model:
  - ~~**Step 1 (v1.31.0):** `linked_user_id` column + backfill migration + replaced 4 name-matching queries with FK lookups + "My Care Info" tab in CaredForView.~~ ✅
  - ~~**Step 2 (v1.31.1):** Permission tiers (Full/Collaborative/Managed) + `visibility_settings` JSON column + family-side permission controls in CareProfile + CaredForView enforces section visibility per tier.~~ ✅
  - **Step 3 (pending):** Invite/claim flow — care team sends invite to join care circle. Links existing account or creates managed account. Auto-links on signup if matching care_recipient exists.
  - **Schema implications:** `linked_user_id` ✅, `permission_tier` ✅, `visibility_settings` ✅. Remaining: invite token table, claim endpoint.
  - This is foundational — affects onboarding, care teams, notifications, and the cared-for experience. *(Pete — Feb 25)*
- [x] ~~**Caregiver avatar in assignment block.** Fixed in v1.30.0. Shows profile photo or initials circle on assigned caregiver cards. *(Feedback — reviewed)*~~


## Features — Up Next

> Ideas and features not yet batched. When enough accumulate, we'll group them into the next batch.

- [ ] **Session check-in/checkout + time extension.** Protocol for caregivers to check in when they arrive and check out when they leave. If they're there 2:30 but it was a 2hr appt, mechanism to request an additional half hour. Caretaker coordinates with care team to approve, gets paid for extra time. *(Feedback — Feb 23, #1)*
- [ ] **Short-notice upcharge description on financials page.** The <24hr booking surcharge (15% upcharge, worker gets 10% more) is not explained anywhere on the caregiver financials view. Add visible description of pricing rules. Ties into fee percentage inconsistency bug. *(Feedback — Feb 23, #2)*
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
- [ ] **Calendar icon consistency.** Replace the static "17" calendar emoji with one showing the actual date. Match the red/white color scheme of the footer calendar icon. *(Feedback — Feb 23, #20)*
- [ ] **Dismissable dashboard tiles.** Add hide/dismiss (X) button to Latest tile and other dashboard blocks. Users should be able to hide tiles they don't need. *(Feedback — Feb 23, #53, #55)*
- [ ] **Calendar bottom nav icon color.** Change the green calendar emoji in the bottom nav to red and white to match app color scheme. *(Feedback — Feb 23, #54)*
- [ ] **Caregivers page default to map view.** The Caregivers/Find Work page should populate with the map as the default view rather than requiring a tab switch. *(Feedback — Feb 23, #57)*
- [ ] **Admin default to real users.** Admin user list should default to showing only real (non-demo) users. Demo users available via filter toggle. *(Feedback — Feb 23, #35)*
- [x] ~~**Biometric sign-in (WebAuthn/passkeys).** Support fingerprint/Face ID authentication. Fixed in v1.30.7–v1.30.9 — full passkey registration + authentication via SimpleWebAuthn. *(Feedback — Feb 23, #36)*~~
- [ ] **AI fraud detection.** Explore how AI could detect possible fraud patterns through the platform — unusual booking patterns, identity mismatches, payment anomalies. *(Feedback — Feb 23, #28)*
- [ ] **Care profile enrichment — doctor contacts, shopping areas.** Add doctor/physician contact info and favorite shopping areas to care recipient profile. Useful for caregivers who take the person out. *(Feedback — Feb 23, #38)*
- [ ] **Connection request → auto-open chat.** When someone sends a connection request and you accept it, the chat history should stay as an initial message. Currently Cary sent a request to connect but Pete can't find how to message her back. *(Feedback — Feb 23, #27)*
- [ ] **Weekly availability rules (multi-day repeat).** Current availability rules are per-day only. Caregivers want to set "available 8-5 Mon-Thu" as one rule instead of 4 separate entries. Add multi-day selection to the "Add Recurring Rule" modal. Intermediate step before the full drag-to-select calendar rewrite. *(Feedback — Feb 23, #6)*
- [ ] **Clearer signup role selection.** New users don't immediately understand what role they're signing up for. Replace the current registration flow with a clear upfront question: "Are you: Looking for Help / Family trying to find help for someone / Ready to work as a Caretaker" (or similar). The language needs to be immediately understandable — no jargon, no ambiguity. This is the first thing a new user sees after clicking "Sign Up." *(Pete — Feb 24)*
- [x] ~~**Splash page rework — collapse, simplify, focus.** Done in v1.24.0. B2 design: split hero with fade, tabbed audience sections, signup form, fair-wages subheadline.~~ The splash is too busy with too much information in a confusing scroll order. Needs: (1) Elevator pitch up front with minimum space, (2) Clear demo CTA, (3) Sign up now button. Collapse detailed sections under expandable banners that invite the user to learn more. Remove waitlist signup — replace with direct sign-in at top with password assistance. Replace the pill photo with happy imagery: smiling elderly people, someone with Down syndrome being helped (shopping, etc.). All existing content is good but needs better information architecture with interaction beyond just scrolling. *(Pete — Feb 24)*
- [ ] **Time-of-day positioned calendar blocks.** Calendar day cells should visually position sessions by time of day: AM sessions anchored to top of cell, PM to bottom, mid-day in the middle. Currently cells just stack session labels; this would make the calendar a true at-a-glance time map. Requires taller cells (100-120px), proportional vertical positioning of session blocks within each cell. Phase 1 (done v1.30.1): time prefix labels ("9a", "7p") on each preview. Phase 2: actual spatial positioning. *(Pete — Feb 25)*
- [ ] **Plausible Analytics setup:** Sign up at plausible.io, add `yourinplace.com` as a site. Script tag is already in index.html.
- [ ] **Google OAuth setup on Railway:** Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars (requires Google Cloud Console setup — it's free)
- [ ] **Upgrade to Google Maps geocoding:** Swap Nominatim → Google Maps for better residential accuracy when ready for production
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
- [ ] **Remove all Uber references:** Reword any "Uber for X" comparisons in CLAUDE.md and SplashPage.js (The Problem section). Replace with language that describes what InPlace does without inviting the comparison.
- [x] ~~**Floating feedback button (v1.6.1):** Implemented in v1.6.1, refined in v1.8.3 (moved to left on mobile, changed icon to lightbulb to avoid blocking send button).~~
- [ ] **Admin API key for automated scripts.** Added in v1.8.3 — `ADMIN_API_KEY` env var bypasses JWT/2FA for the collect-feedback script. Set on Railway. Future: extend to other admin automation.
- [x] ~~**Demo data enrichment — realistic messages.** Seed realistic conversations between Maria/Pete/Betty including group messages and video chat references. Currently messages are empty/placeholder. (Fixed by demo reseed with full rich data) *(Feedback #6, #14, #15)*~~
- [ ] **Maria demo profile polish.** Maria needs: profile photo, completed onboarding/background check status shown as "done", fake license photos, distinct families (not 3x Betty). *(Feedback #17, #18, #19, #20)*
- [ ] **Caregiver schedule → "Find Work" view.** Caregiver schedule page shows "Request Care" which makes no sense for caregivers. Should show nearby care needs they can sign up for, with availability and job discovery. *(Feedback #3)*
- [ ] **Calendar import (Apple/Google/Microsoft).** Caregivers want to import existing calendar events and see them alongside InPlace availability on one unified view. *(Feedback #3)*
- [ ] **Financials/payments tab for caregivers.** Visible "Financials" or "Payments" sidebar link beyond just the Earnings sub-tab. Link bank account, view payment history, see Stripe status. *(Feedback #1)*
- [ ] **Analytics condensed into dashboard.** Analytics page is too heavy as standalone tab — condense into an expandable callout section on the Dashboard. *(Feedback #8)*
- [ ] **Upcoming sessions widget — make clickable.** Dashboard session items should link to the session detail or schedule page when tapped. *(Feedback #10)*
- [ ] **Caregiver assignment flow — make obvious.** The "assign caretakers" flow isn't discoverable. Add clearer CTA or walkthrough. *(Feedback #9)*
- [x] ~~**Dashboard "Latest" / status section.** Fixed in v1.6.0. Context-aware top section with DisclaimerModal + Latest tile showing status and next action. *(Feedback #17 implied)*~~
- [ ] **Push notification debugging.** Pete gets emails but never push notifications. Debug SW registration, verify push subscriptions are created, test end-to-end. *(Feedback #5)*
- [ ] **_ARCHIVED — Floating feedback button spec (v1.6.1):_** _Original full spec kept for reference._ Add a persistent, always-visible feedback button that floats on every screen (all roles). Tapping it opens a feedback form where users can submit comments, bug reports, feature requests, or general impressions.
  - **Button placement:** Fixed-position floating action button (FAB) in the bottom-right corner, above the mobile bottom nav on small screens. Subtle but always accessible — small circular button with a speech bubble or lightbulb icon. Doesn't block content.
  - **Feedback form:** Modal/drawer that opens on tap. Fields: (1) Category — dropdown: Bug Report, Feature Request, General Feedback, Complaint, Praise. (2) Description — free text area (required, 10+ chars). (3) Mood — optional emoji row (😊 🙂 😐 😟 😡) for quick sentiment. (4) Screenshot — optional "attach screenshot" button (reuse existing image upload pattern). (5) Page context — auto-captured: current page/tab, user role, app version, timestamp, device info (mobile vs desktop).
  - **Backend:** New `feedback` table: `id TEXT PK, user_id TEXT FK, category TEXT, description TEXT, mood TEXT, screenshot TEXT (base64), page_context TEXT (JSON), status TEXT DEFAULT 'new', admin_notes TEXT, created_at TIMESTAMPTZ`. New routes: POST `/api/feedback` (any authenticated user), GET `/api/feedback` (admin only — paginated, filterable by category/status/date), PUT `/api/feedback/:id` (admin — update status and notes).
  - **Admin review panel:** New "Feedback" tab in AdminPanel.js. Shows all submissions in a sortable table with columns: date, user, category, mood, status, preview. Click to expand full detail + screenshot. Status workflow: New → Reviewed → Planned → Done → Dismissed. Admin can add internal notes. Filter by category, status, date range.
  - **Feedback binning/triage:** Admin can tag feedback as "bug", "feature", "ux", "content", etc. Group similar feedback items together. When enough feedback clusters around a theme, it informs the next dev batch. This is the review-and-confirm step before anything becomes a task.
  - **Notifications:** When feedback is submitted, push notification to admin (peterjslee@gmail.com). Optional: email digest of new feedback (daily or weekly).
  - **Privacy:** Feedback is visible only to admins. Users can see their own past submissions (optional "My Feedback" section in MyAccount). No user-to-user visibility.
  - **Implementation:** New component `FeedbackButton.js` (FAB + modal), new route file `src/routes/feedback.js`, new table in `database.js`, new tab in `AdminPanel.js`. Wire FAB into `app.js` so it renders on every page for authenticated users.


## Pete's Action Items (External Setup)

> Things only Pete can do — account signups, API keys, config. These unblock dev tasks above. Check them off as you go.

- [ ] **Stripe: Add API keys to Railway.** You've created a Stripe account. Now go to Stripe Dashboard → Developers → API keys. Copy the **Secret key** and **Publishable key**. In Railway dashboard, add env vars: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`. (Use test-mode keys first — they start with `sk_test_` and `pk_test_`.) This unblocks: background check payment during caregiver onboarding + future Stripe Connect marketplace payments.
- [ ] **Checkr: Sign up and get API key.** Go to [checkr.com](https://checkr.com) and sign up for a partner/platform account. You'll get a `CHECKR_API_KEY`. Add it to Railway env vars. This unblocks: actually running background checks during caregiver onboarding. (Checkr has a sandbox/test mode for development.)
- [ ] **Stripe: Decide background check price.** What should caregivers be charged for the background check? Checkr's basic check runs ~$25–$35. Do you want to pass cost through at-cost, mark up, or subsidize? Claude needs this number to build the payment step.
- [ ] **Plausible Analytics: Sign up at plausible.io.** Add `yourinplace.com` as a site. The script tag is already in index.html — just needs the account created.
- [ ] **Google OAuth: Set up in Google Cloud Console.** Create OAuth 2.0 credentials (it's free). Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to Railway. This enables "Sign in with Google" (backend already built).
- [ ] **Google Maps API key (optional, later).** When you want better residential geocoding than Nominatim/OpenStreetMap, get a Google Maps API key. Swap is a one-function change in `src/utils/geocode.js`.


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


## Done

### Admin Tab Layout, Maria Dual-Role, Branding Sweep & Bug Fixes (v1.15.2–v1.16.0)
- [x] **Branding icon sweep (v1.15.2):** Replaced all 12 remaining old icons (👩‍⚕️, 👨‍⚕️, 👵) with new branding (🤝, 🌷) across 8 component files.
- [x] **CaretakerHub white screen fix (v1.15.2a):** useEffect placed after early returns violated React Rules of Hooks, crashing all caregiver dashboards. Moved hook before early returns.
- [x] **Maria dual-role + Carlos care recipient (v1.15.3):** Maria now has `["caregiver","family"]` roles with brother Carlos Santos (age 34, TBI recovery) as her care recipient. Includes care team, caregiver assignments, sessions, activity items, and notes.
- [x] **Production role switching fix (v1.15.3a):** Auto-reseed skipped on production when real users exist. Expanded demo data patch in server.js to update Maria's roles and create Carlos + care team on every server start.
- [x] **Admin card-grid tab layout on all dashboards (v1.16.0):** Applied the AdminPanel's card-grid tab navigation pattern (icon + label cards in responsive grid) to CaretakerHub and CaredForView, replacing the old horizontal underline-style tabs. Consistent navigation UX across all roles.
- [x] **Feedback protocol (v1.16.0):** Collected 69 items from production (27 new, 39 reviewed). Updated FEEDBACK.md with 5 new items (#23–#27) and TASKS.md with 6 new actionable bugs.

### Help/FAQ, Onboarding Fix & Demo Fixes (v1.15.0–v1.15.1)
- [x] **Help/FAQ page (v1.15.0):** Dynamic help_articles DB table, 20 seed articles across 5 categories, role-based visibility, deep-link navigation to in-app pages, search and category filtering.
- [x] **Admin help management (v1.15.0):** Help/FAQ tab in AdminPanel with CRUD, publish/unpublish, "Create FAQ from this" button on feedback items.
- [x] **Onboarding status fix (v1.15.0):** Fixed admin onboarding endpoint — removed references to non-existent `photo_url` column, corrected `doc_type`→`document_type` and `uploaded_at`→`created_at`.
- [x] **Demo account switching (v1.15.1):** Fixed stale `activeRole` persisting across demo switches. Cleared activeRole on all login/switch paths. Added user ID to page component keys for forced remount.
- [x] **Branding icon updates (v1.15.1):** Demo picker and sidebar icons updated to match v1.14.0 branding — Maria 🤝, Betty 🌷, Caregivers 🤝, Care Profile 🌷.
- [x] **Seed roles column (v1.15.1):** All demo user INSERTs now include explicit `roles` JSON array. Bumped DEMO_SEED_VERSION to 1.15.1 to trigger re-seed.

### Dual-Role System (v1.14.0)
- [x] **Dual-role support:** Users can hold multiple roles (e.g., family + caregiver). Roles stored as JSON array in `roles` column. JWT encodes roles array. Role switcher card on My Account page.
- [x] **"Add a Role" card:** My Account shows option to add caregiver or family role if user only has one.
- [x] **Database migration:** Backfills `roles` column for ALL existing users (production-wide, not just demo).
- [x] **Registration page branding:** Updated icons — Maria 🤝 "Caregiver / Companion", Betty 🌷 "I Would Like Help".

### Feedback Fixes, Photo Upload & Invite Flow (v1.8.0–v1.8.3)
- [x] **Floating feedback button (v1.8.0):** FeedbackButton.js FAB on all pages, feedback form with category/mood/screenshot/page context, admin review panel in AdminPanel.js, feedback table in database.
- [x] **Feedback button refinement (v1.8.3):** Moved FAB to left side on mobile (was blocking send button in Messages), changed icon from chat bubble to lightbulb.
- [x] **Profile photo upload for all roles (v1.8.2):** Added photo upload UI to MyAccount with client-side auto-resize (400x400 JPEG 80% quality). Sidebar avatar updates in real-time via `setCurrentUser` prop.
- [x] **Photo upload server error fix (v1.8.3):** Route-specific 5mb JSON limit for `/api/auth/me/photo`, `limitBodySize` bypass for photo endpoint. Any size photo now works thanks to client-side resize.
- [x] **Care requests show on calendar (v1.8.3):** Schedule calendar shows pink/red shading for days with open/requested/pending care sessions.
- [x] **Message timestamps (v1.8.3):** Changed from relative ("5m", "2h") to actual time (h:mm AM/PM) using `toLocaleTimeString()`.
- [x] **2FA tap-to-copy (v1.8.3):** Manual entry code in TwoFactorSetup is now clickable to copy to clipboard.
- [x] **Admin panel shows care team invites (v1.8.3):** Admin search-email endpoint now queries `care_team_invites` alongside `platform_invites`. AdminPanel displays both.
- [x] **Care team invite registration flow (v1.8.3):** Family users registering via care team invite link skip "About Your Loved One" and "Care Needs" steps — go straight from Basic Info to Review. They join the inviting team after login.
- [x] **Admin API key (v1.8.3):** `ADMIN_API_KEY` env var for script auth that bypasses JWT + 2FA. `collect-feedback.js` updated to use it. Set on Railway.
- [x] **Admin in mobile nav (v1.8.3):** Admin users see 🛡️ Admin in the mobile bottom nav bar.
- [x] **Service worker network-first (v1.8.3):** Changed SW fetch strategy from cache-first to network-first for app assets (JS/CSS/HTML). CDN assets stay cache-first. Prevents stale cache issues on deploy.
- [x] **APP_VERSION fix (v1.8.3):** `window.APP_VERSION` was stuck at 1.7.5 — now bumped alongside cache-bust param.
- [x] **Archive obsolete files (v1.8.2):** Moved KinCareIcon.js, InPlace_App_Roadmap.docx, InPlace_Font_Options.pdf, font_options.png, ROADMAP.md to archive/.
- [x] **Git workflow fix (v1.8.2):** Eliminated push-clone workflow that was causing changes to silently get lost. Now push directly from local repo.

### Calendar Unification & Care Requests (v1.4.1)
- [x] **CaregiverCalendar query fix:** Changed `?start=X&end=Y` to `?from=X&to=Y` so Maria's bookings load correctly.
- [x] **Admin invite auto-search:** useEffect triggers search when switching to invites tab from waitlist with pre-filled email.
- [x] **CaretakerHub earnings overhaul:** Earnings tab fetches completed sessions from API, shows itemized breakdown table (date, client, service, hours, amount).
- [x] **AvailabilityTab rewrite:** Replaced weekly hourly grid with month calendar view matching Schedule.js. Day-click editing for availability rules.
- [x] **CaredForView rewrite:** Betty's calendar is now a real month calendar. Pink = seeking help, Blue = confirmed. "Request Care" form on day click.
- [x] **Care request system:** `status='requested'` sessions, POST /api/sessions/request, PUT /api/sessions/:id/claim with WebSocket notifications.
- [x] **CaregiverCalendar care requests:** Pink cells for care requests in weekly grid, "Accept" button in day detail panel.
- [x] **Seed data:** 4 care request sessions for Betty (Feb 22, 26, Mar 1, Mar 4).

### Admin Invites & Caregiver Onboarding (v1.4.0)
- [x] **Admin invite system:** Admin panel "Invites" tab — search any email across users/waitlist/invites, send branded invitation emails via Resend, track invite status.
- [x] **Platform invites table:** `platform_invites` table with token-based accept flow, 7-day expiry.
- [x] **Caregiver onboarding wizard:** `CaregiverOnboarding.js` — 5-step wizard for new caregiver registration.
- [x] **Waitlist-to-invite flow:** Click "Invite" on any waitlist entry → auto-populates invite tab with their email.

### Availability Engine & Scheduling UX (v1.3.7–v1.3.9)
- [x] **Maria earnings bump:** Rate $28→$34/hr, ~19 past completed sessions (~$3,890 monthly), 8-hour days for calendar saturation.
- [x] **Availability rules engine:** New `availability` table with CRUD, `computeAvailableSlots()`, backend validation on booking.
- [x] **CaretakerHub Availability tab:** Weekly grid with color-coded cells, rule management modals.
- [x] **CaregiverCalendar component:** Weekly calendar with availability overlay (green/blue/red/gray), hour-by-hour grid, week navigation.
- [x] **API-driven scheduling modals:** RequestCareModal and CaregiverScheduleModal fetch real availability instead of hardcoded data.

### Demo Mode UX & PWA Fixes (v1.3.1–v1.3.6)
- [x] **Demo mode banner (v1.3.1):** DemoModeBanner component with account switcher chips and "Exit Demo" button. Sidebar logout says "Exit Demo" in demo mode. Email verification banner suppressed for demo users.
- [x] **Splash cleanup (v1.3.2):** Removed "Dev Login" section, demo credential hints from hero and working product CTA. Added auto-restore guard that clears demo tokens on page refresh.
- [x] **Demo token fix (v1.3.3):** Demo login now stores JWT in memory only (`AUTH_TOKEN` variable) — never persists to localStorage. Prevents auto-login on revisit.
- [x] **Production DB fixes (v1.3.4):** Backfilled `is_demo = 1` for all demo accounts in production (they had `is_demo = 0` because they were seeded before the column existed). Added Leaflet CSS + JS CDN to index.html (maps were broken without it).
- [x] **PWA icons (v1.3.5):** Regenerated all icons at 8 sizes (48, 72, 96, 128, 144, 192, 384, 512px) for both regular and maskable variants. Updated manifest.json with 16 icon entries. Cache-busted SW registration (`/sw.js?v=X.Y.Z`). Added 32px favicon.
- [x] **Demo simplification (v1.3.6):** Removed David Lee and Susan Lee from demo picker page and demo banner switcher. Demo now shows 3 personas: Pete (family), Maria (caregiver), Betty (care recipient). David/Susan data remains in DB for message history.
- [x] **Admin auto-migration:** `is_admin = 1` auto-set for `peterjslee@gmail.com` on every server start via migration in database.js.

### Caregiver Search & Location (v1.2.0)
- [x] **Geocoding utility:** `src/utils/geocode.js` — Nominatim geocoder with documented Google Maps swap path (one function body change). `haversineDistance()` for radius filtering. `buildAddressString()` helper.
- [x] **Location-based caregiver search API:** `GET /api/caregivers` now accepts `lat`/`lng`/`radius`/`address` params. Returns distance from search center, sorted by proximity. `GET /api/caregivers/nearby/:recipientId` finds caregivers near a care recipient.
- [x] **Auto-geocoding:** Caregiver profile create/update and care recipient create/update both auto-geocode address → lat/lng via Nominatim.
- [x] **Caregivers "Find Nearby" tab:** Address/zip search input, radius selector (5-50 mi), integrated Leaflet map with caregiver pins + radius circle, distance badges on caregiver cards.
- [x] **AreaMap real coordinates:** Caregiver AreaMap now uses real lat/lng from API instead of hardcoded demo offsets. Service radius circle overlay, click-to-fly-to cards.
- [x] **Browse All tab upgrade:** Cards now show bio, specialties, background check badges, and location info.

### Splash Page Rework (v1.1.1)
- [x] **Splash layout rearranged:** Pitch content (Problem, Solution, Market, Business Model, Personal Story, Vision, Working Product CTA) all higher up; audience sections (For Family, For Care Recipients, For Caregivers) grouped chronologically near the bottom.
- [x] **For Caregivers styling fixed:** Hero button now matches siblings (white text, transparent bg). Section label color changed to teal (`#1b6b5a`) to match other audience sections.
- [x] **Dev Login button:** One-click login buttons for all 5 demo accounts added above footer. Calls `/api/auth/login` directly and navigates to dashboard. Cache version v1.1.1.

### Group Messaging & Calendar for Real Users (v1.1.0)
- [x] **Phase 3 — Group Messaging:** New `conversations` and `conversation_members` tables. `conversation_id` column on messages. Full backend rewrite of `/api/messages` with conversation-centric endpoints (list, create, get messages, send). Legacy backward compatibility with auto-migration. Auto-created care team conversations on care recipient creation and invite acceptance. Frontend Messages.js rewrite with conversation list (direct + group), group chat with sender names, contact picker, group creation flow. WebSocket events include `conversationId`. Seed data: 5 direct conversations, 1 care team conversation with 6 group messages.
- [x] **Phase 5 — Calendar for Real Users:** RequestCareModal 4-step wizard for real users (skips caregiver matching), `status: 'open'` for open care requests. Schedule.js empty state with "Request Care" CTA, `open` status badge. Sessions route accepts `open` status. Cache version v1.1.0.

### Auth Foundation & Care Teams (v1.0.0)
- [x] **Phase 1 — Auth Foundation:** Google OAuth backend (Passport.js + passport-google-oauth20), TOTP 2FA (otplib + qrcode), "Remember This Device" (trusted_devices table, 30-day trust), temp password & forced change, demo mode isolation (is_demo flag, redesigned LoginPage), enhanced MyAccount (Profile | Security | Devices | Notifications tabs), TwoFactorSetup wizard component. 3 new DB tables: oauth_accounts, user_2fa, trusted_devices. 4 new npm packages.
- [x] **Phase 2 — Care Teams:** 3 new DB tables (care_teams, care_team_members, care_team_invites). Full /api/care-teams CRUD with email invite flow (branded Resend email, 7-day token, handles existing + new users). Auto care team creation on care recipient add. CareTeamManage.js (member management, invite/resend/cancel, role changes). CareTeamPage.js (team listing, auto-select). Dashboard onboarding checklist (4 steps for non-demo users). Dynamic greeting. Invite token URL handling (?invite=TOKEN). Seed data with 3 care teams. Cache version v1.0.0.

### Real-Time WebSocket Updates & Visit Photos (v0.9.0)
- [x] **Real-Time WebSocket Updates:** Socket.io integration with JWT-authenticated connections. Live message delivery (`new_message`), session status changes (`session_update`), activity feed updates (`activity_update`), and photo uploads (`visit_photos`). Connected users tracked in server-side Map. Frontend WebSocket manager with `connectSocket()`, `disconnectSocket()`, `onSocketEvent()`. Auto-connect on login and page load, auto-disconnect on logout. Dashboard, ActivityFeed, Messages, and CaretakerHub all listen for real-time events.
- [x] **Visit Photo Uploads:** Multer-based file upload (5MB limit, image-only, max 5 per visit). Base64 storage in PostgreSQL `visit_photos` table. New `/api/photos` route with upload, retrieval by visit log ID and session ID. Caregiver photo upload UI in CaretakerHub visit log modal with preview thumbnails. Family-side photo viewer in ActivityFeed with expandable thumbnails and full-size lightbox modal.
- [x] **Splash Page Cache-Bust Fix:** Previous deploy (v0.8.0) failed silently on Railway due to `package-lock.json` out of sync. Fixed by regenerating lock file. Cache-bust version bumped to v0.9.0 in index.html and sw.js.
- [x] **Infrastructure:** Socket.io CDN added to index.html. 2 new npm dependencies (socket.io, multer). 1 new route file (photos.js). `http.createServer` wrapper for Express+Socket.io. Cache bumped to v0.9.0. 53 tests passing.

### Analytics, Push Notifications & Shared Care Recipients (v0.8.0)
- [x] **Family Dashboard Analytics:** New `/api/analytics` endpoint with 6-month historical data (sessions, hours, spend per month), service type breakdown, and caregiver utilization stats. Frontend Analytics page with SVG bar charts (hours/spend/sessions monthly trends), donut chart for service types, caregiver utilization horizontal bars, summary stat cards. Tab switcher for different views.
- [x] **Push Notifications:** `web-push` VAPID keys, `push_subscriptions` table, subscribe/unsubscribe API at `/api/push`. Service worker `push` + `notificationclick` event handlers. Push triggered on new messages with sender name and content preview. Frontend `subscribeToPush()` helper auto-subscribes on login.
- [x] **Shared Care Recipients:** `care_recipient_shares` table with owner/edit/view permission levels. `hasAccess()` helper in careRecipients route. Share/unshare API endpoints on `/api/care-recipients/:id/share`. Dashboard includes shared recipients. Seed shares Betty with David & Susan (edit permission).
- [x] **Infrastructure:** 2 new database tables (push_subscriptions, care_recipient_shares), 2 new route files (analytics.js, push.js), 1 new component (Analytics.js). Cache bumped to v0.8.0. 53 tests passing.

### Recurring Sessions (v0.7.0)
- [x] **Recurring session booking:** Weekly and biweekly repeating care sessions. `recurrence_rule` and `recurrence_group_id` columns on care_sessions. `generateRecurringDates()` helper. POST /api/sessions creates multiple linked sessions. DELETE /api/sessions/recurring/:groupId cancels future sessions in a series.
- [x] **Recurring UI:** RequestCareModal step 2 has One-time / Weekly / Every 2 weeks toggle + weeks selector (2-12). Review step shows recurrence summary. Schedule shows 🔁 badge on recurring session cards.
- [x] **Expanded validation:** validateSession now accepts all frontend service types (companionship, personal_care, meal_prep, transportation, health_wellness, full_day) and validates recurrence fields. 8 new tests (53 total).

### Email Verification & Tests (v0.6.2)
- [x] **Centralized email utility:** New `src/utils/email.js` with `sendEmail()` and `brandedHtml()`. All routes (auth, password reset, waitlist) now use shared utility. Sandbox mode detection with clear warnings. FROM_EMAIL env var support for verified domain senders.
- [x] **Email verification flow:** Verification email sent on registration. `email_verification_tokens` table with 24h expiry. GET /api/auth/verify?token=xxx validates and marks user verified. POST /api/auth/resend-verification sends new email. Frontend: ?verify= URL handling, dismissable success/error banner, EmailVerificationBanner component for unverified users.
- [x] **Test suite:** Jest + supertest with mock database layer (no PostgreSQL needed). 45 tests across 4 suites: auth routes (register, login, profile, email verification), waitlist routes, health/API endpoints, middleware (auth tokens, role checks, validation). `npm test` script added.

### Production Hardening (v0.6.1)
- [x] **Calendar heat map stale bug:** Added `key={currentPage}` to all page components in renderPage(), forcing full React remount on navigation. Fixes blank calendar on tab switch.
- [x] **Input validation:** New `src/middleware/validate.js` with validators for register, login, profile update, messages, sessions. Email format, password strength (8-128 chars), phone format, string length limits, input sanitization (trim + null byte removal).
- [x] **Rate limiting:** `express-rate-limit` — auth endpoints (20 attempts per 15 min), general API (120 req/min). JSON body size limit (100KB).

### PWA Android Fix & Email Domain (v0.7.2)
- [x] **PWA Android installability fix:** Split manifest icon `purpose: "any maskable"` into separate entries. Created dedicated maskable icons (full-bleed, no rounded corners) for Android's adaptive icon system. Added `id: "/"` to manifest. Cache bumped to v0.7.2.
- [x] **Resend domain verification:** DKIM + SPF DNS records added in Cloudflare for yourinplace.com. Domain verified in Resend dashboard. Production email now sends from `noreply@yourinplace.com`.
- [x] **FROM_EMAIL env var on Railway:** Set `FROM_EMAIL=noreply@yourinplace.com` so all transactional emails (verification, password reset, waitlist) use the verified domain sender.

### PWA & Mobile Polish (v0.6.0)
- [x] **PWA add-to-homescreen:** Web app manifest, service worker (cache-first for static, network-first for API), install banner with `beforeinstallprompt`, offline indicator, Apple meta tags. Icons: 192x192, 512x512, apple-touch-icon.
- [x] **Mobile touch polish:** 44px minimum tap targets, `font-size: 16px` to prevent iOS auto-zoom, `viewport-fit=cover` for notched phones, `display-mode: standalone` CSS adjustments, 2-column stats grid on mobile, single-column info-grid.
- [x] **Sibling logins:** David Lee (david.lee@inplace.care) and Susan Lee (susan.lee@inplace.care) added as family users. Both can see Betty's care, have caregiver assignments, sessions, messages, and activity feed items. Quick-login buttons on LoginPage.

### Demo Polish (v0.5.3)
- [x] **Loading spinners & empty states:** Animated CSS spinner on every page during API fetches. Empty-state illustrations with helpful messages when no data exists. Consistent pattern across Dashboard, CareProfile, Schedule, Caregivers, Activity Feed, Messages, CareRecipients, MyAccount, CaretakerHub, CaredForView.
- [x] **Toast notifications:** Global toast notification system (success/error/info). ToastProvider wraps the app, `useToast()` hook available in all components. Toasts for profile saves, caregiver assign/unassign, mark-all-read, recipient save, notification prefs. Auto-dismiss after 3.5s, mobile-friendly positioning.
- [x] **MyAccount persistence:** PUT /api/auth/me endpoint for updating profile (name, phone) and notification preferences. MyAccount page now has Edit Profile mode with inline form. Notification toggles auto-save to database. New `notification_prefs` column on users table.

### Onboarding & Mobile (v0.5.1–v0.5.2)
- [x] **Wire registration to API:** RegisterPage handleComplete() now calls POST /api/auth/register, auto-logs in on success, shows inline errors. Both family and caregiver tracks supported.
- [x] **Password reset flow:** ForgotPasswordPage + ResetPasswordPage components. New password_reset_tokens table. POST /api/password-reset/request sends branded email via Resend. POST /api/password-reset/confirm validates token and updates password. "Forgot password?" link on login page.
- [x] **Mobile bottom navigation:** Replaced hamburger sidebar with fixed bottom nav bar on screens ≤768px. Role-aware icons (Home, Schedule, Care, Messages, More). Safe-area padding for notched phones. Desktop sidebar unchanged.

### PostgreSQL Migration (v0.5.0)
- [x] **PostgreSQL on Railway:** Replaced SQLite with PostgreSQL via `pg` library. Custom query wrapper auto-converts `?` to `$1, $2, ...` placeholders. All 10 route files updated with async/await + PostgreSQL datetime syntax. Data persists across deploys.
- [x] **Waitlist email notifications:** Resend HTTP API sends notification email when someone joins the waitlist.
- [x] **MyAccount shows real user data:** MyAccount page now displays logged-in user's actual data instead of hardcoded values.
- [x] **Caregiver recruitment on splash:** Added "For Caregivers" section to the splash page.
- [x] **Registration wizard improvements:** Back navigation between steps + form validation on all fields.

### Mobile Sidebar (v0.4.2)
- [x] **Responsive hamburger menu:** Sidebar collapses to hamburger overlay on mobile screens.

### Schedule Fix (v0.4.1)
- [x] **Restored calendar heat map:** Full 294-line Schedule.js with calendar grid, saturation shading, and session detail panel was accidentally replaced during rebrand sync. Restored from git history.

### Rebrand & Cache Fix (v0.4.0)
- [x] **KinCare → InPlace rebrand:** All user-facing text, emails (@inplace.care), passwords (inplace123), DB filename (inplace.db), JWT secrets, component names (InPlaceIcon), package metadata. 26 files changed.
- [x] **Cache-busting for Cloudflare:** Added `?v=0.4.0` to all JS/CSS fetches in index.html. Fixes stale cached files after deploys behind Cloudflare proxy.
- [x] **Login fix after rebrand:** DB auto-reseeds with new InPlace credentials on deploy since DB filename changed.

### Waitlist & Splash Updates (v0.3.3)
- [x] **Email capture / waitlist:** "Get Early Access" form on splash page. Writes to `waitlist` table via `/api/waitlist` (no auth). Dedupes by email, shows success/already-exists messages inline. Public `/api/waitlist/count` endpoint.
- [x] **Splash page stat corrections:** Fixed to match elevator pitch — 63M caregivers, $200B market, 11,200 boomers/day.
- [x] **Center-justified stat bubbles:** All card grids use flexbox centering so orphan items don't sit left-aligned.

### Splash Page Redesign (v0.3.2)
- [x] **Investor pitch landing page:** Rewrote splash page to read like an elevator pitch — market stats ($200B, 63M, 11.2K boomers/day), problem/solution framing, business model (20% commission, $45-85 sessions), personal story, vision (operating system for aging in place), Unsplash photos of seniors at home.

### Batch 2: UI & Scheduling (v0.3.1)
- [x] **Multiple emergency contacts:** CRUD for emergency contacts on care profiles. Betty has 4: Pete (primary), Susan Lee-Park, David Lee, Dr. Anita Sharma. Add/edit/delete inline.
- [x] **Calendar view with saturation shading:** Month grid with teal heat map based on care hours. Legend, month navigation, summary bar.
- [x] **Favorite caretakers:** Favorites sort first in booking matching. Dashboard shows star next to favorite caregivers.
- [x] **Grey out past appointments:** Past dates muted on calendar, clickable for full detail (cost, notes, caregiver rating).

### Batch 1: Role Foundation (v0.3.0)
- [x] **Three user roles in UI:** Care Team (Pete), Caregiver (Maria), Care Recipient (Betty). Role-based sidebar navigation, dashboards, and page routing.
- [x] **Maria login (caretaker view):** Full caregiver dashboard with schedule, families, earnings, reviews. Area Map as standalone sidebar page with real Leaflet/OpenStreetMap + family pins.
- [x] **Betty login (cared-for view):** Calendar of upcoming sessions + personal notes section (CRUD). Limited sidebar with Home, Messages, Account.
- [x] **Assigned caregivers clickable:** Dashboard "Assigned Caregivers" card links to Caregivers page. Assign/unassign/favorite toggle all work.
- [x] **Messaging groundwork:** Database-backed messages table, conversations API, real send/receive between Pete, Maria, Betty. Messages page fully wired.

### Frontend Modularization (v0.2.0)
- [x] Split monolithic index.html (3,900 lines) into 17 modular files with zero-build-step CDN approach.

## Future Features

- [ ] **Location check-in and location tracking during sessions:** Real-time location tracking for caregivers during active care sessions. Check-in before starting session, live location updates on family-side map, automatic check-out on session end. Includes geofencing alerts if caregiver strays from expected service location. Requires GPS permissions on mobile.
- [ ] **Surge / dynamic pricing system:** Real-time supply/demand matching with automatic price adjustments. Needs: `demand_snapshots` table logging pending requests vs available caregivers by zone, `surge_multiplier` on sessions (default 1.0), pricing rules engine triggered at booking time (e.g., ratio < 0.5 = 1.3x), geographic zone partitioning, peak-hour detection from historical patterns, caregiver share of surge premium (incentive to accept high-demand work). Depends on: tiered rates (v1.12.0), location tracking, sufficient transaction volume for pattern detection.
- [ ] **Multi-team membership with visual differentiation:** Allow users to be on multiple care teams (e.g., Pete is on his mother Betty's team, but could also be invited to a friend's parent's team). Each team gets a selectable color accent (e.g., green, purple, blue) so the user can visually distinguish which team they're viewing. Sidebar/header should show active team with a team switcher. Users only see members and data for teams they belong to — inviting someone to your team doesn't expose your other teams. Needs: team color column on care_teams, active_team_id on users or in session state, UI team picker component.
- [ ] **Admin activity heat map & cancellation metrics:** Admin panel view showing geographic heat map of where care sessions are happening (by city/zip), plus cancellation rate analytics: cancel rate by caregiver, by family, by service type, by time-of-day. Filterable by date range. Helps identify problem markets and unreliable users. Depends on: sufficient session volume and geocoded data.
- [ ] **Admin support/incident management tab:** A dedicated admin tab for handling escalated support cases. When a caregiver doesn't show up, a charge is disputed, or inappropriate behavior is reported (e.g., in chat), admin can open an "incident" that captures all relevant data: chat logs between parties, session details, payment records, location check-in data, and user profiles. Admin can block/suspend users while investigating. Incidents are stored as structured records with status tracking (open/investigating/resolved/closed). Intent: protect brand reputation by capturing full context of any dispute. Needs: incidents table, incident_evidence table (links to chats, payments, sessions), user suspension flag, admin incident management UI.
- [ ] **Pet/allergy mismatch warning on caregiver-family matching:** When a caregiver and care recipient are being matched (e.g., during care request flow, caregiver assignment, or Find Work browsing), automatically flag conflicts between caregiver allergies and household conditions. Example: if a caregiver has "allergic to dogs" and the care recipient's profile says "has dogs as pets," show a prominent warning to both parties before confirming the match. Applies to all pet types and common allergens. Depends on: onboarding profile questions (pets/allergies fields on both care_recipients and caregiver_profiles).
- [ ] **"Average in your area" rate data + job alert threshold.** Show caregivers the average hourly rate in their area based on platform data. Also let caregivers set a threshold like "alert me if a job pays more than $X, even if I'm marked unavailable." Preview to surge pricing. Depends on: sufficient transaction volume. *(Feedback — Feb 23, #3)*
- [ ] **Admin panel UX overhaul:** The admin panel is getting too busy with many tabs. Redesign with larger icons, collapsible sections, and a cleaner information hierarchy. Group related features: "Financials" section (revenue, transactions, projections), "Incident Resolution" section (support cases, blocked users), "Market Intelligence" section (heat map, usage stats, cancellation rates). Admin doesn't need to be pretty but needs to be scannable and efficient. Consider card-based navigation instead of a flat tab bar.
