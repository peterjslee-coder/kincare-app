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
- [x] ~~**Care team members can't view or edit shared care recipient details.** Fixed. careRecipients.js hasAccess() checks both owner and shared permissions. Team members with edit access can update via PUT endpoint. *(Verified v1.33.7 audit)*~~
- [x] ~~**Care recipient relationship label hardcoded as "Mother".** Fixed. care_team_members table has per-user `relationship_label` column. PUT endpoint allows each member to set their own label. *(Verified v1.33.7 audit)*~~
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
- [x] **2FA won't load for caregiver role.** ~~Not a role issue — Security tab hidden for demo users only (`isDemo` check). Real caregivers (e.g., Cary) can access 2FA.~~ Skipping per Pete's instruction. *(Feedback #23, #24)*
- [x] ~~**Caretaker signup shows generic "insufficient information" error.** Fixed in v1.25.0. RegisterPage now shows red border + "*required" labels on each invalid field for both family and caregiver tracks. *(Feedback — new)*~~
- [x] ~~**Show app version on login/splash screen.** Already present on LoginPage (line 344) and sidebar footer. Done. *(Feedback — new)*~~
- [ ] **Care team member management UX overhaul.** Member cards should look like the leader card, with options on click (remove, promote, read-only, etc.) instead of showing blunt "Member" and "Remove" buttons. Ties into authority delegation feature. *(Feedback — new)*
- [x] ~~**Maria's caregiver calendar — color/block overlap confusion on busy days.** Fixed in v1.33.9. Booked cells now show recipient first name (e.g., "Bett"), care requests show "NEW" label. Combined with existing color legend and distinct left-border colors for clearer visual distinction. *(Feedback — new)*~~
- [x] ~~**APP_VERSION not bumped consistently.** Fixed in v1.8.3. Going forward, always bump APP_VERSION, cache-bust param, and SW cache name together.~~
- [x] ~~**Caregiver onboarding status "failed to load".** Fixed in v1.15.0. SQL query referenced non-existent columns (`photo_url` on `caregiver_profiles`, `doc_type`/`uploaded_at` on `caregiver_documents`).~~
- [x] ~~**Demo accounts show wrong dashboard on switch.** Fixed in v1.15.1. `activeRole` in localStorage persisted across demo account switches, causing "Welcome back Pete" for all accounts. Cleared activeRole on all login/switch paths and added user ID to component keys for forced remount.~~
- [x] ~~**"Connection request sent" should persist on messages screen.** Fixed in v1.25.0. After sending a connection request, fetchPendingRequests() is called to immediately refresh the sent requests list. *(Feedback — Feb 22)*~~
- [x] **Back swipe closes PWA instead of navigating back.** ~~Fixed v1.33.12 — in-app navigation history using `history.pushState`. Back gesture navigates to previous page instead of closing app. At root, dummy entry prevents close.~~ *(Feedback — Feb 22)*
- [x] ~~**Can't see connection invite status.** Fixed. Messages.js shows "Pending" / "Request sent" status on contacts with pending connections. *(Verified v1.33.7 audit)*~~
- [x] ~~**Caregivers search should initialize at care recipient's location.** Fixed in v1.25.0. Added searchCenter to map useEffect dependencies so map re-centers when care recipient location loads. *(Feedback — Feb 22)*~~
- [x] ~~**Feedback icon overlaps message send button.** Fixed in v1.25.0. FAB moves higher (bottom: 130px) on mobile when on Messages page. *(Feedback — Feb 21)*~~
- [x] ~~**Message timestamps — add date and time.** Fixed in v1.25.0. Individual messages now show "Yesterday 2:30 PM" or "Feb 21 2:30 PM" for older messages, just time for today. *(Feedback — Carry Taker)*~~
- [ ] **Photo upload crop + auto-resize.** Need in-app crop tool and auto-resize to 1.5MB before uploading profile photos. Current UX too manual. *(Feedback — reviewed)*
- [x] ~~**Profile photo in sidebar/header.** Fixed. app.js sidebar renders user profile photo (or initials fallback) next to iP logo. *(Verified v1.33.7 audit)*~~
- [x] **Admin stats include demo data.** ~~Admin panel sessions/users counts include demo accounts and demo sessions.~~ Fixed v1.33.10 — sessions count and sessions-by-status now exclude demo user sessions. *(Feedback — Feb 22)*
- [ ] **Admin 2FA/biometrics gate.** Admin panel should require 2FA or biometrics to access. Destructive actions (delete users, override background checks) should require additional verification. *(Feedback — Feb 22)*
- [x] **Merge waitlist + invites in admin.** ~~Fixed v1.33.12 — combined into unified "People" tab with sub-tabs (All / Waitlist / Invites). Search & Invite at top, waitlist + invite tables below.~~ *(Feedback — Feb 22)*
- [x] **Cancel/remove stale invites.** ~~Admin can't remove or cancel pending invites.~~ Already implemented — Cancel, Resend, Re-invite buttons exist on invites tab. *(Feedback — Feb 22)*
- [ ] **Block user with legal evidence logging.** When blocking a user, collect more than just "spam or abuse" — log location data, timestamps, payment receipts, chat logs for potential legal action. Ties into admin incident management. *(Feedback — Feb 22)*
- [x] ~~**Care recipient photo upload.** Fixed in v1.20.4. Photo upload added to CareRecipients page with RecipientAvatar component. *(Feedback — Feb 22)*~~
- [x] ~~**Care request not visible on family calendar.** Verified working in v1.20.4. Sessions API returns requested-status sessions to family users, Schedule.js displays them. *(Feedback — Feb 22)*~~
- [x] **Email verification UX unclear.** ~~Users don't know if the verification email went through.~~ Fixed v1.33.10 — banner now shows "sent Xm ago", 60-second cooldown, and spam folder hint. *(Feedback — Feb 22, #23)*
- [x] ~~**Fee percentage inconsistency (15% vs 20%).** Fixed. All fees are consistently 20% across rateCalculator.js, payments.js, and financials.js. *(Verified v1.33.7 audit)*~~
- [x] ~~**Caregiver search should center on care recipient location.** Fixed in v1.25.0. Caregivers.js map now uses searchCenter (care recipient coords) with useEffect dependency. *(Feedback — Feb 22, #25)*~~
- [ ] **Push notifications still not working on iOS.** Pete allowed notifications in settings but nothing comes through. Has been an ongoing issue for weeks. Needs end-to-end debug of SW registration + push subscription flow. *(Feedback — Feb 22, #26)*
- [x] **Admin: remove users from waitlist.** ~~Already implemented — "Remove" button on each waitlist row with confirm dialog.~~ *(Feedback — Feb 22, #27)*
- [x] ~~**Stripe Connect status not updating in First Steps.** Fixed. CaretakerHub.js detects Stripe return URL hash (payments-complete/payments-refresh), refreshes Stripe status, and switches to financials tab. *(Verified v1.33.7 audit)*~~
- [x] ~~**Caregiver rates mismatch from onboarding.** Fixed. Onboarding saves rateDaytime/rateNighttime/rateOvernight to caregiver_profiles. Dashboard API returns them with hourly_rate fallback. CaretakerHub reads from profile data. *(Verified v1.33.7 audit)*~~
- [ ] **DL/cert photo upload not enforced in onboarding.** Caregiver onboarding doesn't require driver's license or certification photos. Should at least ask for DL front/back. Allow skip with acknowledgment (same gate pattern as bg check), but no jobs until uploaded. *(Feedback — Feb 23, #5)*
- [x] ~~**Help/Account/Logout should be at bottom of sidebar.** Fixed. app.js pins Help, Account, and Logout items at the bottom of the sidebar. *(Verified v1.33.7 audit)*~~
- [x] ~~**Duplicate help/FAQ articles.** Fixed. seed.js clears help_articles before reseeding, preventing duplicates. *(Verified v1.33.7 audit)*~~
- [x] ~~**Profile photo upload not working for caregiver role.** peter@yourinplace.com (Carry Taker) — confirmed working as of v1.25.1. *(Feedback — Feb 23, #9)*~~
- [x] ~~**Leaflet map doesn't display until tab switch.** Fixed in v1.25.0. Added invalidateSize(true) calls and ResizeObserver to both Caregivers.js and AreaMap.js maps. *(Feedback — Feb 23, #10)*~~
- [x] ~~**AI insights cross-contamination between care recipients.** Fixed. CareProfile.js generates insights client-side scoped to the selected care recipient's health conditions/medications. *(Verified v1.33.7 audit)*~~
- [x] ~~**Carlos has gendered female avatar.** Fixed. RecipientAvatar component uses initials (not gendered emoji) as fallback when no emoji or photo is set. *(Verified v1.33.7 audit)*~~
- [x] ~~**"Latest" tile should be clickable.** Already implemented — Latest tile has onClick handler that navigates to relevant page. *(Feedback — Feb 23, #21)*~~
- [x] ~~**Activity feed "Mark read" button text overflow.** Fixed in v1.29.1. Compacted button to "✓ Read" with smaller padding. *(Feedback — Feb 23, #23)*~~
- [x] ~~**Inbox not sorted by recency.** Fixed in v1.29.1. Client-side sort by lastMessageAt DESC. *(Feedback — Feb 23, #25)*~~
- [x] **Find People doesn't show recent connections.** ~~Should show recent connections or searches.~~ Fixed v1.33.10 — Find People now shows "Recent" section with up to 10 people from existing conversations. Clicking opens the conversation. *(Feedback — Feb 23, #26)*
- [x] ~~**Session color mismatch for open vs confirmed.** Fixed in v1.25.0. Dashboard now shows distinct colors per status: confirmed=teal, completed=blue, pending=orange, open/requested=coral. *(Feedback — Feb 23, #31)*~~
- [x] ~~**Alert clicks should show request details.** Fixed in v1.33.9. "View on Schedule" button in activity feed now passes the session date via `__pendingScheduleDate`. CaregiverCalendar jumps to the right week, Schedule.js jumps to the right month/day. *(Feedback — Feb 23, #32)*~~
- [x] ~~**Demo data leaking into real user views.** Fixed in v1.28.6. Added demo isolation JOIN to sessions endpoint (both main caregiver query and open-requests fallback). Combined with prior v1.22.1 reseed and v1.2.1 caregiver/contacts isolation. *(Feedback — Feb 23, #33)*~~
- [x] ~~**Getting Started checklist not auto-completing.** Fixed in v1.25.0. Added dismiss button to the Getting Started checklist on the new-user dashboard view. Checklist auto-detection was already in place for profile, recipients, caregivers, etc. *(Feedback — Feb 23, #39)*~~
- [x] ~~**Caregiver name too small on profile.** Fixed in v1.25.0. Bumped caregiver name font from 17px to 20px on Caregivers.js profile cards. *(Feedback — Feb 23, #40)*~~
- [x] ~~**Dashboard spend shows amount with no confirmed appointments.** Fixed in v1.25.0. Analytics endpoint now filters all spend/session/hour queries to only count confirmed and completed sessions. *(Feedback — Feb 23, #52)*~~
- [x] ~~**Care recipient photo not showing on Dashboard.** Fixed in v1.25.1. Dashboard card hardcoded 🌷 emoji. Now shows photo > emoji > fallback. Also added photo/emoji fields to dashboard API parent object. *(Feb 24)*~~
- [x] ~~**Active role not obvious enough.** Fixed in v1.29.0. Multi-role users see "Viewing as" label; single-role users see icon + role name. *(Feedback — Feb 24, new)*~~
- [x] ~~**Star rating on caregiver card unclear.** Fixed in v1.30.0. Added tooltip "Family rating of this caregiver" on all star ratings. *(Feedback — Feb 24, new)*~~
- [x] ~~**Betty tile and care team should be unified.** Fixed in v1.30.0. Care team nested inside Betty's card with overlapping member avatars. *(Feedback — Feb 24, new)*~~
- [x] ~~**Show assigned caregiver on the map (Find Nearby).** When a caregiver like Cary is assigned, show her pin/flag on the family's caregiver map view. Fixed in v1.30.3 — assigned caregivers now shown with distinct pins on family's map. *(Feedback — Feb 24, new)*~~
- [x] ~~**Care team tile — overlapping avatar display with real photos.** Fixed in v1.31.5. Real profile photos with initials fallback, pending invites shown as greyed "?" circles. CareTeamManage also shows photos. *(Feedback — Feb 24 + Feb 25, new)*~~
- [x] ~~**Betty's tile health condition text too dark/hard to read.** Fixed in v1.29.1. Changed to rgba(255,255,255,0.75) on dark teal card. *(Feedback — Feb 24, new)*~~
- [x] ~~**"Request Care" button misplaced in sidebar.** Fixed in v1.30.0. Now full-width orange accent button, visually distinct from nav. *(Feedback — Feb 24, new)*~~
- [x] ~~**Care notes — add delete option.** Fixed in v1.31.2. Delete button added to CareProfile family view with confirmation prompt. *(Feedback — Feb 24, new)*~~
- [x] ~~**Calendar blocks should show session preview.** Fixed in v1.29.1/v1.30.1. Day cells show "9a Betty · Comp · 3h" with time prefix, sorted by time. *(Feedback — Feb 24, new)*~~
- [x] ~~**"Set your availability" link broken.** Was already wired to goToStep('availability'). The real issue was the completion check requiring rules — fixed in v1.31.2 (visiting tab = done). *(Feedback — Feb 24, new)*~~
- [x] ~~**"Complete my profile" checklist misleading.** Fixed in v1.33.9. Caregiver First Steps profile step now shows "Still needed: bio and hourly rate" dynamically instead of generic description. *(Feedback — Feb 24, new)*~~
- [x] ~~**Admin: delete user account fails.** Fixed. admin.js DELETE /api/admin/users/:id implements full soft-delete with transaction (anonymize, unassign, cleanup). *(Verified v1.33.7 audit)*~~
- [x] **Admin: force password reset from admin panel.** ~~Admin should be able to trigger a password reset email for any user.~~ Fixed v1.33.10 — 🔑 button in admin user list sends reset email with one click. *(Feedback — reviewed)*
- [ ] **Push notification icon is white square on Android.** PWA notification icon renders as blank white square on Pixel (Android). Need proper monochrome notification icon. *(Feedback — reviewed)*
- [x] ~~**Delete individual role without deleting account.** Fixed in v1.29.0. POST /api/auth/remove-role with two-step confirmation. *(Feedback — Feb 24, new)*~~
- [ ] **Dual-role users can't manage caregiver profile from family view.** When a family user adds a caregiver role, they can't access admin-like caregiver profile management (mark background check done, set up payments, etc.) from within the family dashboard. Need admin options or a dedicated path for dual-role users to manage their caregiver onboarding steps. *(Feedback — Feb 25, new)*
- [x] ~~**Availability step shouldn't require setting a rule.** Fixed in v1.31.2. Visiting the availability tab now marks the step complete. *(Feedback — Feb 25, new)*~~
- [x] ~~**Caregiver "Find Work" tab should be highlighted orange.** Fixed in v1.31.2. Orange accent button in sidebar + bottom nav. *(Feedback — Feb 25, new)*~~
- [x] ~~**Selection boxes inconsistent size + bold text on active.** Fixed in v1.31.2. Active tab text now bold (700) across all dashboards. *(Feedback — Feb 25, new)*~~
- [ ] **Family members need ability to add care locations in Care Profile.** Families should be able to add one or more care locations (e.g., home address, adult day center, doctor's office) to a care recipient's profile. Caregivers see these locations when accepting sessions. Ties into care location address with private instructions feature. *(Pete — Feb 25)*
- [ ] **Link care recipient profile to a real user account (unified identity).** Right now care recipients exist as data records created by family members (`care_recipients` table), and separately as user accounts (`users` table with role=`cared-for`). Betty could sign up on her own, or her kids could create a care profile for her — resulting in two unconnected Bettys. Need a unified model:
  - ~~**Step 1 (v1.31.0):** `linked_user_id` column + backfill migration + replaced 4 name-matching queries with FK lookups + "My Care Info" tab in CaredForView.~~ ✅
  - ~~**Step 2 (v1.31.1):** Permission tiers (Full/Collaborative/Managed) + `visibility_settings` JSON column + family-side permission controls in CareProfile + CaredForView enforces section visibility per tier.~~ ✅
  - **Step 3 (pending):** Invite/claim flow — care team sends invite to join care circle. Links existing account or creates managed account. Auto-links on signup if matching care_recipient exists.
  - **Schema implications:** `linked_user_id` ✅, `permission_tier` ✅, `visibility_settings` ✅. Remaining: invite token table, claim endpoint.
  - This is foundational — affects onboarding, care teams, notifications, and the cared-for experience. *(Pete — Feb 25)*
- [x] ~~**Caregiver avatar in assignment block.** Fixed in v1.30.0. Shows profile photo or initials circle on assigned caregiver cards. *(Feedback — reviewed)*~~
- [x] ~~**Role selection confusing for new family/team members.** Fixed in v1.33.8. Added role confirmation banner on registration steps 2+3: "You are joining as a ___" with "you can add other roles later" and a Change link. *(Feedback — Sara Huber, Feb 25)* **P0**~~
- [x] ~~**Draft message leaking from individual to group chat.** Fixed in v1.33.4. Draft text is now scoped per conversation using a draftsRef keyed by conversation ID. Switching conversations saves/restores drafts correctly. *(Feedback — Pete, Feb 25)* **P1**~~
- [x] ~~**Connection disappears after accepting.** Fixed in v1.33.4. Backend now auto-creates a direct conversation when a connection is accepted. Frontend navigates to the new conversation after accepting. *(Feedback — Pete, Feb 25)* **P1**~~
- [ ] **Desktop push notifications not working.** Sara Huber reports push notifications don't work on desktop (likely macOS Chrome). Infrastructure is solid (test button works, VAPID keys configured). Most likely a macOS System Settings → Notifications issue for Chrome. Advise Sara to check Settings → Notifications → Chrome → Allow. *(Feedback — Sara Huber, Feb 25)* **P1**
- [x] ~~**Care team members should auto-connect for messaging.** Fixed in v1.33.4. When a user joins a care team via invite, auto-creates accepted connections with all existing team members. No separate connection request needed. *(Feedback — Pete, Feb 25)* **P1**~~
- [x] ~~**Grey out unavailable roles in role switcher.** Fixed in v1.33.8. All three roles always shown; unavailable ones greyed out at 50% opacity with no click handler. Active role bold/highlighted. *(Feedback — Pete, Feb 25)* **P2**~~
- [x] ~~**Push notification click should navigate to messages.** Fixed in v1.33.6. Added in-page PUSH_NAVIGATE listener in Messages.js so push clicks navigate to the right conversation even when already viewing messages. *(Feedback — Pete, Feb 25)* **P2**~~
- [x] ~~**Push notification should show message preview.** Already implemented — push payload includes sender name + message preview (truncated at 100 chars). Verified in messages.js `sendPushToUser` calls. *(Feedback — Pete, Feb 25)* **P2**~~
- [x] ~~**Red notification badge on message avatars.** Fixed in v1.33.5. Unread conversations now show a red dot on the avatar in the conversation list. *(Feedback — Pete, Feb 25)* **P2**~~
- [ ] **Swipe to reply and long-press for emojis in messages.** Mobile UX enhancement — swipe right on a message to reply, long-press to react with emoji. Standard messaging app pattern. *(Feedback — Pete, Feb 25)* **P3**
- [x] ~~**Passkey cross-account login — security concern.** Fixed in v1.33.5. When a user provides their email, the server now verifies the authenticated passkey belongs to that user. Blocks cross-account login when a shared device has multiple users' passkeys registered. Root cause: `stored.userId` was never checked against `passkey.uid`. *(Feedback — Pete, Feb 25)* **P0**~~
- [x] ~~**Cancellation flow: no-caregiver sessions should be free cancel.** Fixed in v1.33.5. Backend: `isLateCancel` now requires `hasCaregiver` — unassigned sessions always free to cancel. Frontend: cancel popup shows "No caregiver assigned — free to cancel" for unassigned sessions. *(Feedback — Pete, Feb 25)* **P1**~~
- [x] ~~**Cary's pin/flag not showing on family map.** Fixed in v1.33.7. Root cause: geocoding during profile save excluded zip code, causing NULL lat/lng for caregivers. Fixed geocoding to include zip + added server-startup backfill. *(Feedback — Pete, Feb 25)* **P1**~~
- [x] ~~**Sara's avatar shows initials instead of uploaded photo.** Fixed in v1.33.6. Conversations and contacts queries now return `profile_photo`. Frontend renders photo as `<img>` for direct conversations when available. *(Feedback — Pete, Feb 25)* **P1**~~
- [x] ~~**Splash page: clarify spring 2026 launch and VA-only.** Fixed in v1.33.6. Added "Launching Spring 2026 in Virginia" badge below the hero body text. *(Feedback — Pete, Feb 25)* **P2**~~
- [ ] **Track user navigation patterns (analytics).** Log how users flow through the app so we can optimize. Where do they go first after login? How often do they hit calendar vs messages? Use Plausible or custom event tracking. *(Feedback — Pete, Feb 25)* **P2**
- [x] ~~**Activity feed: show specific user names.** Fixed in v1.33.5 (cancellations) + v1.33.6 (session bookings). Activity feed now shows "Cancelled by Pete Lee" and "Companion care requested by Pete Lee" with the actual user's name. *(Feedback — Pete, Feb 25)* **P2**~~
- [x] ~~**"Cancelled by [Name]" not just "cancelled by family".** Fixed in v1.33.5. Activity feed now shows the specific user's name (e.g., "Cancelled by Pete Lee") instead of generic "Cancelled by Family". *(Feedback — Pete, Feb 25)* **P2**~~
- [ ] **Feedback button should be tester-only, not shown to all users.** The floating feedback FAB overlays on top of other UI elements and confuses real users trying to sign up. Need: (1) an `is_tester` flag on users table (or reuse `is_admin`), (2) admin panel toggle to mark specific users as testers, (3) feedback FAB only renders when `is_tester` is true. Regular users should never see it. **P0**
- [ ] **Timezone architecture — long-term fix (critical).** All session dates/times are stored as naive TEXT strings ("2026-02-26", "08:00") with no timezone metadata. The app currently assumes Eastern time on the backend and uses `toLocaleString('en-US', { timeZone: 'America/New_York' })` on the frontend for check-in gates. This works for Virginia-only care but is fragile and has caused repeated bugs (sessions showing as "Tomorrow" when they're today, "Invalid Date" in calendar, check-in gate blocking caregivers in other timezones). **Long-term fix:** (1) Store a `timezone` column on care_recipients (default 'America/New_York'), (2) backend normalizes all date comparisons to the care recipient's timezone, (3) frontend receives timezone with session data and compares accordingly, (4) phase out all hardcoded 'America/New_York' assumptions. This is foundational — affects scheduling, check-in/check-out, dashboard display, notifications, and future multi-state expansion. **P0**
- [ ] **Payment architecture: team-leader-assigned billing.** Team leader sets the default payment account (e.g., Betty's bank) for scheduled events. Per-member can pay from own account if they scheduled it. Team leader assigns $ qualifiers (who pays for what). *(Feedback — Pete, Feb 25)* **P2**
- [ ] **Home/mailing/billing address for caregivers and payers.** Address entry with option to flag if billing address differs from home. Needed for payment processing. *(Feedback — Pete, Feb 25)* **P2**
- [x] ~~**Group chat icon: overlapping avatars with care recipient on top.** Fixed in v1.33.8. Group conversations now show overlapping circular avatars (up to 3 members, excluding current user) with profile photos or colored initials. *(Feedback — Pete, Feb 25)* **P2**~~
- [x] ~~**Role explanation tooltips in care team management.** Fixed in v1.33.5. Added detailed role legend in the invite form area explaining Leader, Member, and View Only permissions. *(Feedback — Pete, Feb 25)* **P2**~~
- [ ] **"I don't know how to add a My Loved One" + undefined text on new-user screen.** Angela S (new family user) can't figure out how to add a care recipient after signup. Also sees "undefined" text on the initial screen. Need: (1) fix undefined text bug, (2) make the "Add My Loved One" flow obvious and guided for new family users — prominent CTA button, not buried in a sidebar link. *(Feedback — Angela S, Feb 27)* **P0**
- [x] ~~**Can't see Cary on caregiver page — not in assigned, browse, or map.** Fixed in v1.33.75. Backend COALESCE(is_active,1) handles NULL values. Frontend assigned tab uses assignment data for caregiver name fallback. *(Feedback — Pete, Feb 27)* **P1**~~
- [x] ~~**Cary's calendar "Bett" tiles need better labels.** Fixed in v1.33.75. Calendar cells now show full first name ("Betty" not "Bett"). Tooltip shows name, service type, and cost. *(Feedback — Cary Taker, Feb 27)* **P2**~~
- [x] ~~**Green outline on selectable profile role toggles.** Fixed in v1.33.75. Available roles show teal border, active role shows role-color border, unavailable roles have no border. *(Feedback — Pete, Feb 27)* **P2**~~
- [x] ~~**Hide demo column in admin panel.** Fixed in v1.33.75. Demo column and demo filter removed from admin user table. Default still filters to real users. *(Feedback — Pete, Feb 27)* **P2**~~
- [x] ~~**Manage own account from admin panel.** Fixed in v1.33.75. "My Account" button in admin header navigates to account settings page. *(Feedback — Pete, Feb 27)* **P2**~~
- [x] ~~**Admin should default to real accounts (not demo).** Already fixed — `userDemoFilter` defaults to `'real'` in AdminPanel.js.~~ *(Feedback — Pete, Feb 27)* **P1**
- [x] ~~**AI health summary regenerate button with rate limiting.** Fixed in v1.33.75. Regenerate button already exists; added backend rate-limiting — requires at least 1 completed visit since last generation. 429 error shown via toast. *(Feedback — Pete, Feb 27)* **P3**~~
- [ ] **Checkout feedback flows into care record with care team comments.** After session checkout, caregiver feedback should go into the care record. Care team members can comment on it (e.g., "oh yeah, we can unlock the door for you"). AI reads all comments for care profile insights. Ties into check-in/check-out feature spec. *(Feedback — Pete, Feb 27)* **P3**
- [ ] **Visit photo upload not accessible from CaretakerHub during sessions.** Caregiver can't find how to upload photos during or after a visit. Photo upload infrastructure exists (multer routes, visit_photos table) but there's no visible UI in CaretakerHub or check-out flow for caregivers to attach photos. Need: photo upload button in the check-out modal and/or on session detail cards. *(Feedback — Cary Taker, Mar 1)* **P1**
- [ ] **No push notification to check out.** Caregiver did not receive a push or SMS reminder to check out of an active session. The pre_check_out reminder should fire 15min before session end. Verify the poller is correctly computing check-out reminder timing and that the caregiver's device has an active push subscription. *(Feedback — Cary Taker, Mar 1)* **P1**
- [ ] **Caregiver tardiness feedback mechanism.** After a caregiver is late (detected by overdue check-in), send a supportive follow-up: "You were late today — is there anything we could do to help?" Collect reasons (traffic, car trouble, personal, etc.) to improve scheduling and support. Ties into overdue_check_in notification system (v1.34.46). *(Feedback — Cary Taker, Mar 1)* **P2**
- [ ] **Volunteer user role for companionship.** New sign-up class for volunteers willing to provide companionship visits at no cost. Distinct from paid caregivers — different onboarding (no Stripe, no rates), different matching (families see "volunteer" badge), different liability model. Long-term feature tied to community expansion. *(Feedback — Cary Taker, Mar 1)* **P3**
- [ ] **Medical professional role on care team.** New "medical" role for doctors/physicians who join a care team to liaise with the medical field. Doctor sees relevant health data, can add medical notes/orders, gets notified of health-related session feedback. Requires new role in care_team_members, scoped visibility, and potentially HIPAA considerations. *(Feedback — Cary Taker, Mar 1)* **P3**
- [ ] **Caregiver-initiated visit proposals.** Allow caregivers to reach out to families to offer service proactively: "Would love to come by to check on Betty, have time next Tuesday" with a proposed visit and negotiable rate. Reverse of the current model where only families post care requests. Marketplace feature — ties into caregiver branding and rate negotiation. *(Feedback — Cary Taker, Mar 1)* **P3**
- [ ] **No consent summary page for family members.** After a family member completes the consent/attestation flow, there's no page showing what they signed up for or what the care recipient consented to. Need a "what was agreed" summary view in the care team or documents section. *(Feedback — Consent Tester, Mar 4)* **P2**
- [x] ~~**AI summary button still says "select care preferences" after saving them.** Fixed in v1.37.1. When preferences are saved (3+ rated), AI summary card now shows "Generate Care Summary" button + "Edit Preferences" link instead of the initial "Set Up Care Preferences" message. *(Feedback — Consent Tester, Mar 4)*~~
- [x] ~~**First Steps 2FA review — white screen of death.** Fixed in v1.37.1. Three fixes: (1) security step marks as reviewed after 3 seconds on settings tab (not just scroll-to-bottom), (2) First Steps click sets __accountTab before navigation + fires accountTabSwitch event for already-mounted MyAccount, (3) added "I've reviewed my security settings" manual button as fallback. *(Feedback — Cary Taker, Mar 2)*~~
- [ ] **Care recipient email not required during add flow — blocks verification.** Son Tester couldn't go back to enter an email for Mom Tester after skipping it. No email = no verification email = stuck. Either require email upfront or provide a way to add it later and re-trigger verification. *(Feedback #5, #7, #8 — Son Tester, Mar 5)* **P0**
- [ ] **"Next" allowed without email on care recipient form.** Form lets user proceed without entering an email for the care recipient. Should either require it or clearly explain consequences of skipping. *(Feedback #8 — Son Tester, Mar 5)* **P0**
- [ ] **Phone number formatting inconsistent on care recipient form.** Phone numbers display in mismatched formats. Need consistent formatting (e.g., (555) 555-5555) with input mask. *(Feedback #9 — Son Tester, Mar 5)* **P1**
- [ ] **Getting Started checklist disappears after adding care recipient.** After completing "add a loved one," the Getting Started tile hides. User has to manually unhide it to find remaining steps (invite family, verify authorization). Checklist should stay visible until ALL steps are complete. *(Feedback #16, #17, #18 — Son Tester, Mar 5)* **P0**
- [ ] **"Complete your profile" checked prematurely.** Son Tester barely entered info but profile step shows as complete on first login. Needs stricter completion criteria — check that required fields (name, phone, address) are actually populated. *(Feedback #19 — Son Tester, Mar 5)* **P1**
- [ ] **Connection accepted notification doesn't say who.** Activity feed shows "Connection accepted" without naming the person who accepted. *(Feedback #21 — Son Tester, Mar 5)* **P1**
- [ ] **Overlapping caregiver map pins.** When caregivers are at similar locations (Cary and Pete), pins overlap so you can't tell there are two. Need clustered pins with "2 Caregivers" label that expands on tap. *(Feedback #14 — Son Tester, Mar 5)* **P2**
- [ ] **"Install the app" checklist item — false positive detection.** How does the app know it's installed? May be checking prematurely on desktop browsers. Verify PWA install detection logic doesn't false-positive. *(Feedback #15 — Son Tester, Mar 5)* **P2**
- [ ] **Scheduling care allowed before authorization is confirmed.** Son Tester could access schedule page and try to book care before the consent/authorization process was complete. Gate scheduling behind completed authorization. *(Feedback #3 — Son Tester, Mar 5)* **P0**
- [ ] **Overdue session — no popup to call caretaker.** If a session runs 15+ minutes past end time, show a popup giving the family option to call the caregiver directly. Safety feature. *(Feedback #20 — Son Tester, Mar 5)* **P1**
- [ ] **"Invite family to care team" greyed out and unfindable.** Son Tester can't find or access the invite family page. Checklist item appears greyed out. Don't mark checklist steps complete until they actually work. *(Feedback #3 — Son Tester, Mar 5 v1.38.0)* **P0**
- [ ] **Consent verification page appears unexpectedly mid-flow.** Son was dumped on a clean care team page, hit home, saw "add a loved one" still undone, clicked it, and found a new consent verification page he'd never seen. All verification should be inline in the add-recipient wizard, not scattered across pages. *(Feedback #7 — Son Tester, Mar 5 v1.38.0)* **P1**
- [ ] **After adding care recipient, no path forward.** User lands back on the care recipient page with no indication of what to do next. "This isn't a wizard, it just dumped me on a menu page." Need auto-advance to next step (care preferences → verification → done). *(Feedback #8 — Son Tester, Mar 5 v1.38.0)* **P0**
- [ ] **Format ALL phone numbers consistently as (XXX) YYY-ZZZZ.** Phone numbers still display in inconsistent formats across the app. Apply input mask + display formatting everywhere. *(Feedback #12 — Son Tester, Mar 5 v1.38.0)* **P1**

- [ ] **Mobile formatting broken on feedback/general pages.** Pete reports "formatting on mobile screen doesn't work here." Needs investigation — which page specifically. *(Feedback — Pete, Mar 6)* **P2**
- [ ] **Calendar text misaligned — days don't match numbers.** Days-of-week header doesn't line up with the date numbers below. *(Feedback — Pete, Mar 6)* **P1**
- [x] ~~**"Next" button unresponsive when scheduling care.** Pete tried to schedule care and couldn't click Next — "looks available but doesn't work." Pete confirmed working Mar 8. *(Feedback — Pete, Mar 6)* **P0**~~
- [ ] **Unfilled request escalation reminders.** If a care request goes unfilled: 48hr out → "raise your pay offer"; 24hr → "still no one, raise offer"; 1hr prior → "cancelled, no caretaker found." Auto-escalation system. *(Feedback — Pete, Mar 6)* **P2**
- [x] ~~**Caregiver drag-and-select on calendar not working.** Fixed v1.34.7. *(Feedback — Cary, Mar 6)* **P1**~~
- [ ] **Map search → caregiver shows only 1 week.** Selecting Cary from map search only shows one week of availability with no way to see more. Should show monthly calendar or a scheduling shortcut with Cary prefilled. *(Feedback — Pete, Mar 6)* **P2**
- [ ] **Caregiver appointment tiles need more detail on tap.** Cary wants to tap appointment tiles for care needs, notes from care team, feedback. Currently too sparse. *(Feedback — Cary, Mar 6)* **P2**
- [ ] **"$120 flew over" animation on accept — visual bug.** When Cary accepted Tony Nav's appointment, "$120" animated to the confirmed tab. Unintended animation. *(Feedback — Cary, Mar 6)* **P2**
- [ ] **Cancellation policy acknowledgment for caregivers.** On accepting an appointment, caregiver must check a box: "I understand I must cancel 24+ hours before start, or the care team can leave a review." *(Feedback — Cary, Mar 6)* **P2**
- [ ] **Family cancellation charge acknowledgment.** Families must click something acknowledging they'll be charged if cancelling inside 24 hours. *(Feedback — Cary, Mar 6)* **P2**
- [x] ~~**2FA First Steps checklist doesn't clear properly.** Fixed v1.37.1 — 3-second timer + manual button fallback. *(Feedback — Cary, Mar 6)* **P1**~~

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
- [ ] **Inline identity verification on attestation page.** When user clicks "I attest," expand into Stripe Identity verification right there — all on one page. Show legal attestation language placeholder: "I attest, under penalty of law and liability." More than just "we'll verify" — start the verification NOW, on this screen. *(Feedback #6, #9 — Son Tester, Mar 5 v1.38.0)*
- [ ] **Care recipient contact form — add verification purpose reminder.** Put a reminder on the phone/email fields: "This info will be used to contact your loved one and verify consent to visits." *(Feedback #11 — Son Tester, Mar 5 v1.38.0)*
- [ ] **Cursive signature font for consent/attestation forms.** Add a cursive script font option for digital signatures — classy touch, feels more personal than typed name. *(Feedback #11 — Son Tester, Mar 5)*
- [ ] **Overnight booking minimum notice.** When care extends past midnight, notify user that "most caregivers require a six-hour minimum overnight booking." Business rule enforcement. *(Feedback #23 — Son Tester, Mar 5)*
- [ ] **"Other" care type with free text.** Add "Other: ____" option to care type selection, allowing users to specify custom service. Track popular custom entries to promote to first-class options over time. *(Feedback #24 — Son Tester, Mar 5)*
- [ ] **Multi-mood selection on check-in/check-out.** Caretaker should be able to select more than one mood at check-in (e.g., "surprised" AND "upset"). Change from single-select to multi-select. *(Feedback #26 — Son Tester, Mar 5)*
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
  - **Time extension (future):** If caregiver stays past scheduled duration, mechanism to request extra time. Care team approves, caregiver gets paid for actual hours. Ties into Stripe payment flow.
  - **Schema changes:** Add to visit_logs: `arrival_mood TEXT`, `departure_mood TEXT`, `condition_tags TEXT` (JSON array), `care_feedback TEXT`, `service_feedback TEXT`, `check_in_adjusted INTEGER DEFAULT 0`. Existing columns: check_in_time, check_out_time, mood_rating, tasks_completed, notes, summary.
  - *(Pete — Feb 25. First session: Cary visiting Betty, Feb 26.)*
- [x] **Short-notice upcharge description on financials page.** ~~Already implemented — "How Pricing Works" card on Earnings tab explains platform fee, short-notice surcharge (20%, 75% to caregiver), and instant payout fee.~~ *(Feedback — Feb 23, #2)*
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
- [x] **Calendar icon consistency.** ~~Already implemented — `_DayIcon` SVG shows today's date with red/white theme, used in sidebar + mobile nav.~~ *(Feedback — Feb 23, #20)*
- [x] **Dismissable dashboard tiles.** ~~Already implemented — `dismissTile` with content fingerprints on Latest, Upcoming, Activity tiles. Auto-restores when content changes.~~ *(Feedback — Feb 23, #53, #55)*
- [x] **Calendar bottom nav icon color.** ~~Already implemented — `_DayIcon` SVG uses red header (#d32f2f) and white background.~~ *(Feedback — Feb 23, #54)*
- [x] **Caregivers page default to map view.** ~~Already implemented — `activeTab` defaults to `'nearby'` (map tab).~~ *(Feedback — Feb 23, #57)*
- [x] **Admin default to real users.** ~~Already implemented — `userDemoFilter` defaults to `'real'`.~~ *(Feedback — Feb 23, #35)*
- [x] ~~**Biometric sign-in (WebAuthn/passkeys).** Support fingerprint/Face ID authentication. Fixed in v1.30.7–v1.30.9 — full passkey registration + authentication via SimpleWebAuthn. *(Feedback — Feb 23, #36)*~~
- [ ] **AI fraud detection.** Explore how AI could detect possible fraud patterns through the platform — unusual booking patterns, identity mismatches, payment anomalies. *(Feedback — Feb 23, #28)*
- [ ] **Care profile enrichment — doctor contacts, shopping areas.** Add doctor/physician contact info and favorite shopping areas to care recipient profile. Useful for caregivers who take the person out. *(Feedback — Feb 23, #38)*
- [x] **Connection request → auto-open chat.** ~~Already implemented — backend creates conversation on accept, returns `conversationId`, frontend auto-opens it.~~ *(Feedback — Feb 23, #27)*
- [ ] **Weekly availability rules (multi-day repeat).** Current availability rules are per-day only. Caregivers want to set "available 8-5 Mon-Thu" as one rule instead of 4 separate entries. Add multi-day selection to the "Add Recurring Rule" modal. Intermediate step before the full drag-to-select calendar rewrite. *(Feedback — Feb 23, #6)*
- [x] **Clearer signup role selection.** ~~Already implemented — Step 1 shows 3 clear cards with plain language: "I need help around my home" / "I want to help my loved one arrange care" / "I want to find meaningful work at fair wages". Plus role confirmation banner in step 2.~~ *(Pete — Feb 24)*
- [x] ~~**Splash page rework — collapse, simplify, focus.** Done in v1.24.0. B2 design: split hero with fade, tabbed audience sections, signup form, fair-wages subheadline.~~ The splash is too busy with too much information in a confusing scroll order. Needs: (1) Elevator pitch up front with minimum space, (2) Clear demo CTA, (3) Sign up now button. Collapse detailed sections under expandable banners that invite the user to learn more. Remove waitlist signup — replace with direct sign-in at top with password assistance. Replace the pill photo with happy imagery: smiling elderly people, someone with Down syndrome being helped (shopping, etc.). All existing content is good but needs better information architecture with interaction beyond just scrolling. *(Pete — Feb 24)*
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
- [x] **Remove all Uber references:** ~~Already removed — no "Uber" references in CLAUDE.md or SplashPage.js.~~
- [x] ~~**Floating feedback button (v1.6.1):** Implemented in v1.6.1, refined in v1.8.3 (moved to left on mobile, changed icon to lightbulb to avoid blocking send button).~~
- [ ] **Admin API key for automated scripts.** Added in v1.8.3 — `ADMIN_API_KEY` env var bypasses JWT/2FA for the collect-feedback script. Set on Railway. Future: extend to other admin automation.
- [x] ~~**Demo data enrichment — realistic messages.** Seed realistic conversations between Maria/Pete/Betty including group messages and video chat references. Currently messages are empty/placeholder. (Fixed by demo reseed with full rich data) *(Feedback #6, #14, #15)*~~
- [ ] **Maria demo profile polish.** Maria needs: profile photo, completed onboarding/background check status shown as "done", fake license photos, distinct families (not 3x Betty). *(Feedback #17, #18, #19, #20)*
- [x] **Caregiver schedule → "Find Work" view.** ~~Fixed v1.33.12 — Schedule.js empty state now role-aware. Caregivers see "Find Work" button instead of "Request Care".~~ *(Feedback #3)*
- [ ] **Calendar import (Apple/Google/Microsoft).** Caregivers want to import existing calendar events and see them alongside InPlace availability on one unified view. *(Feedback #3)*
- [ ] **Financials/payments tab for caregivers.** Visible "Financials" or "Payments" sidebar link beyond just the Earnings sub-tab. Link bank account, view payment history, see Stripe status. *(Feedback #1)*
- [x] **Analytics condensed into dashboard.** ~~Already implemented — collapsible inline analytics section in Dashboard.js with summary + expandable detail.~~ *(Feedback #8)*
- [x] **Upcoming sessions widget — make clickable.** ~~Fixed v1.33.11 — clicking a session navigates to Schedule with the session date pre-selected via `__pendingScheduleDate`.~~ *(Feedback #10)*
- [x] **Caregiver assignment flow — make obvious.** ~~Already implemented — "Assign to..." dropdown on caregiver cards in Browse/Nearby tabs.~~ *(Feedback #9)*
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


## Dev Best Practices

> Patterns and conventions learned the hard way. Claude should follow these when building new features.

- **Admin task tiles for setup instructions.** When Claude needs Pete to do something manually (external setup, API config, DNS changes, etc.), don't just put it in TASKS.md — also add a dismissible tile to the Dashboard gated behind `user?.is_admin || user?.isAdmin`. The tile should have step-by-step instructions and a ✕ button that calls `dismissTile('tile-id', 'v1')`. This makes setup tasks impossible to miss. See the email domain verification tile (v1.39.20) as the reference pattern. The tile uses the existing `dismissedTiles` + `localStorage` system — no backend needed.
- **Non-blocking side effects.** When a primary action triggers a secondary action (e.g., attestation → send outreach email), wrap the secondary in try/catch and let the user proceed even if it fails. Show an appropriate toast message. Never block a completed wizard step because a side-effect failed.
- **Wizard state persistence.** Wizard progress is stored in `sessionStorage('inplace_wizard')`. When restoring, only `wizardStep` and `savedRecipientId` are persisted — formData is NOT. Always re-fetch from the API when resuming a wizard. See the `useEffect` in CareRecipients.js that fetches `/api/care-recipients/:id` on resume.
- **Guided discovery tiles.** For post-wizard or post-setup actions the user should explore, use the 2×2 grid pattern from the Dashboard "Get Started" section (v1.39.19). Each tile tracks clicks via `localStorage('inplace_discovered')` and disappears once clicked. Include a "Dismiss all" option.
- **Version bumping.** Every push must bump version in three files: `index.html` (3 occurrences), `sw.js` (3 occurrences), `server.js` (1 occurrence). Use the format `1.X.Y`. This ensures cache-busting on Railway auto-deploy.


## Pete's Action Items (External Setup)

> Things only Pete can do — account signups, API keys, config. These unblock dev tasks above. Check them off as you go.

- [x] ~~**Stripe: Add API keys to Railway.** You've created a Stripe account. Now go to Stripe Dashboard → Developers → API keys. Copy the **Secret key** and **Publishable key**. In Railway dashboard, add env vars: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`. (Use test-mode keys first — they start with `sk_test_` and `pk_test_`.) This unblocks: background check payment during caregiver onboarding + future Stripe Connect marketplace payments.~~
- [x] ~~**Resend: Verify domain and set FROM_EMAIL.** Domain `yourinplace.com` verified in Resend dashboard. `FROM_EMAIL` and `RESEND_API_KEY` set in Railway env vars. Consent outreach emails are live.~~
- [ ] **Checkr: Sign up and get API key.** Go to [checkr.com](https://checkr.com) and sign up for a partner/platform account. You'll get a `CHECKR_API_KEY`. Add it to Railway env vars. This unblocks: actually running background checks during caregiver onboarding. (Checkr has a sandbox/test mode for development.)
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

### Security Monitoring & Breach Detection

- [ ] **Audit logging for sensitive data access.** Build middleware that logs every access to sensitive endpoints (admin user lookups, SSN/DL fields, care notes, caregiver profile data) to an `audit_log` table. Record: user ID, endpoint, IP address, timestamp, and whether the request succeeded. This is the foundation of breach detection — you can't detect what you don't log.
- [ ] **Admin login & access alerts.** Set up email notifications when an admin account logs in from a new IP or device. Admin accounts have access to all user data, so these are the highest-value targets. Could be a simple check against a `known_admin_ips` list in the admin settings.
- [ ] **Abnormal data access detection.** Add a scheduled check (daily) that flags unusual patterns: bulk data exports (e.g., someone hitting GET /api/admin/users repeatedly), failed login spikes (brute force attempts), or API calls at unusual hours. Can start simple — a daily summary email to you of access counts by endpoint.
- [ ] **Railway environment security audit.** Review who has access to the Railway project and Postgres connection string. Rotate the database password if it's been shared or hasn't changed since initial setup. Enable Railway's audit log if available on your plan. Check that no env vars are exposed in client-side code.
- [ ] **Vendor breach notification contacts.** Verify your contact email is current and monitored on all third-party services that hold InPlace data: Railway (hosting + DB), Stripe (payment + SSN), Checkr (background checks + PII), Resend (email addresses), and your domain registrar. These vendors are required to notify you of breaches, but only if they can reach you.
- [ ] **Incident response plan (simple version).** Write a one-page plan: (1) who to contact first (you + any co-founders), (2) how to lock down the system (Railway dashboard → disable deploys, rotate DB password), (3) how to assess what was accessed (audit logs), (4) when and how to notify affected users (state breach notification laws — Virginia requires notification "without unreasonable delay"), (5) who to call for legal/insurance (your cyber liability carrier). Keep it in a Google Doc you can access even if InPlace is down.
- [ ] **Database encryption review.** Confirm Railway's managed PostgreSQL encrypts data at rest (it does by default on most plans). Consider application-level encryption for the most sensitive fields (SSN last 4, DL numbers) — this means even if someone gets a database dump, those fields are encrypted with a key stored separately from the database.


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

### Feedback FAB + Nuke Fix (v1.37.2–v1.37.3)
- [x] **Draggable feedback FAB (v1.37.3):** Feedback lightbulb now floats above all modals/popups (z-index 10000). Draggable via touch or mouse — position persists in localStorage. Users can always tap it, even during popups like booking modals.
- [x] **Enhanced feedback context (v1.37.3):** When opening feedback, captures a snapshot of open modals/popups, active element, scroll position, and last 5 navigation breadcrumbs. Shows a "Captured: [page] • [popup]" hint in the form so users can see what screen was recorded.
- [x] **Navigation history exposed (v1.37.3):** app.js now exposes navHistoryRef to window.__navHistory so FeedbackButton can include breadcrumb trail in submissions.

### Feedback Bug Fixes (v1.37.1)
- [x] **AI summary state refresh:** CareProfile.js — when care preferences are saved (3+ rated) but no AI summary exists yet, now shows "Generate Care Summary" button + "Edit Preferences" link instead of always showing "Set Up Care Preferences" prompt. *(Feedback — Consent Tester, Mar 4)*
- [x] **First Steps 2FA white screen:** CaretakerHub.js + MyAccount.js — (1) security step marks reviewed after 3 seconds on settings tab instead of requiring scroll-to-bottom (unreliable on mobile PWA), (2) First Steps security click now sets __accountTab before navigation and fires accountTabSwitch custom event for already-mounted MyAccount component, (3) added "I've reviewed my security settings" manual button as fallback. *(Feedback — Cary Taker, Mar 2)*
- [x] **Feedback loop workflow:** Added ADMIN_API_KEY to .env (from Railway), updated CLAUDE.md with "Step 0 — verify API key" instructions, improved collect-feedback.js to fail fast when 2FA blocks login.
- [x] **Admin nuke FK fix (v1.37.0–v1.37.2):** Comprehensive FK deletions in nuke transaction — consent/authorization tables, messages.recipient_id, session_offers, conversations.created_by, activity_feed.care_recipient_id. v1.37.2: added conversations.care_team_id nullification before care_teams deletion.

### Consent System Redesign + Production Caregiver Readiness (v1.37.0)
- [x] **Tier 3 consent redesign:** Replaced broken code-on-screen self-verification with proper 3-step flow: (1) family attestation with recipient contact info, (2) direct email outreach to care recipient with tokenized response page, (3) mandatory admin review before verification. Designed for three personas: eager recipients, reluctant recipients, and bad actors.
- [x] **Care recipient outreach:** System sends branded email to care recipient explaining what inPlace is. Recipient can respond "Yes, I'm aware" / "I have questions" / "I did not authorize this" via standalone public page (no login required). "Did not authorize" immediately pauses bookings.
- [x] **Admin consent review endpoints:** GET /api/admin/consent/pending for quick-view of tier3 attestations awaiting review. Enhanced authorization list with outreach response data, relationship info, and booking pause status.
- [x] **First-visit confirmation blocking:** Caregiver "no"/"unable" responses now pause future bookings for the care recipient and notify admin. Previously non-blocking.
- [x] **Disincentive structure:** Identity trail (verified email account), direct outreach (bad actor can't prevent), admin gate (human review), first-visit gate (caregiver meets recipient), legal language (consequences stated), rate limiting (max 3 tier3 recipients per family).
- [x] **Production caregiver readiness:** Onboarding gates now conditional on env vars — if STRIPE_SECRET_KEY missing, Stripe gate skipped; if CHECKR_API_KEY missing, background check gate skipped. GET /api/caregivers/platform-config endpoint tells frontend what's configured. First Steps checklist shows "Coming soon" for unconfigured services.
- [x] **Manual background check approval:** POST /api/admin/caregivers/:id/approve-bgcheck lets admin manually approve before Checkr is integrated.
- [x] **Schema additions:** consent_outreach table (tracks emails + responses), care_recipients (email, bookings_paused, bookings_paused_reason), attestations (admin_status, admin_notes, admin_reviewed_by), caregiver_profiles (bg_check_admin_approved).
- [x] **New component:** ConsentResponsePage.js — standalone public page for care recipient email responses, routed via ?consent-response=TOKEN URL param.

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

### Caregiver Onboarding & UX Polish (v1.34.55–v1.34.58)
- [x] **Password validation UI (v1.34.55):** Real-time red→green criteria indicators on registration (8+ chars, uppercase, number, symbol). Min password bumped from 6 to 8 chars.
- [x] **Combine caregiver disclosures (v1.34.55):** Removed standalone disclosures step from registration. "No Medical Care" disclosure moved into CaregiverOnboarding step 2.
- [x] **Nav gating for incomplete profiles (v1.34.55):** Caregivers with incomplete onboarding see greyed-out nav (Find Work, Messages) with 🔒 icon. Backend blocks search API for incomplete profiles.
- [x] **Pin Virginia at top of state dropdowns (v1.34.55):** Both license state and address state dropdowns in CaregiverOnboarding pin "VA — Virginia" at top with separator.
- [x] **Fix availability tab crash (v1.34.55):** FindWork.js rendered AvailabilityTab with zero props → white screen. Added full state management and all 13 required props.
- [x] **Suggested caregiver rates (v1.34.56):** Rate fields show "Most caregivers in your area start at these rates" with $24/$28/$30 suggestions per tier.
- [x] **Emoji onboarding fun-up (v1.34.56):** Added emojis to all section headings (👤📍🐾🔒📜🎓📄💰), pet comfort options (🐾/🌿).
- [x] **Interview openness preference (v1.34.56):** New "🤝 Open to intro call" question in onboarding. Stored as `open_to_interview` column on `caregiver_profiles`.
- [x] **Document viewer (v1.34.57):** My Account Documents tab now shows uploaded files with filename, date, and View/Hide image preview toggle.
- [x] **Expiration warnings (v1.34.57):** Red/yellow banner for certifications expiring within 30 days. Certification details panel with color-coded expiry status.
- [x] **Family-side interview request (v1.34.58):** Caregiver cards in RequestCareModal show "🤝 Open to intro call" badge. "Request Intro Call" button sends a message to the caregiver via existing messaging system.

## Future Features

- [ ] **Location check-in and location tracking during sessions:** Real-time location tracking for caregivers during active care sessions. Check-in before starting session, live location updates on family-side map, automatic check-out on session end. Includes geofencing alerts if caregiver strays from expected service location. Requires GPS permissions on mobile.
- [ ] **Surge / dynamic pricing system:** Real-time supply/demand matching with automatic price adjustments. Needs: `demand_snapshots` table logging pending requests vs available caregivers by zone, `surge_multiplier` on sessions (default 1.0), pricing rules engine triggered at booking time (e.g., ratio < 0.5 = 1.3x), geographic zone partitioning, peak-hour detection from historical patterns, caregiver share of surge premium (incentive to accept high-demand work). Depends on: tiered rates (v1.12.0), location tracking, sufficient transaction volume for pattern detection.
- [ ] **Multi-team membership with visual differentiation:** Allow users to be on multiple care teams (e.g., Pete is on his mother Betty's team, but could also be invited to a friend's parent's team). Each team gets a selectable color accent (e.g., green, purple, blue) so the user can visually distinguish which team they're viewing. Sidebar/header should show active team with a team switcher. Users only see members and data for teams they belong to — inviting someone to your team doesn't expose your other teams. Needs: team color column on care_teams, active_team_id on users or in session state, UI team picker component.
- [ ] **Admin activity heat map & cancellation metrics:** Admin panel view showing geographic heat map of where care sessions are happening (by city/zip), plus cancellation rate analytics: cancel rate by caregiver, by family, by service type, by time-of-day. Filterable by date range. Helps identify problem markets and unreliable users. Depends on: sufficient session volume and geocoded data.
- [ ] **Admin support/incident management tab:** A dedicated admin tab for handling escalated support cases. When a caregiver doesn't show up, a charge is disputed, or inappropriate behavior is reported (e.g., in chat), admin can open an "incident" that captures all relevant data: chat logs between parties, session details, payment records, location check-in data, and user profiles. Admin can block/suspend users while investigating. Incidents are stored as structured records with status tracking (open/investigating/resolved/closed). Intent: protect brand reputation by capturing full context of any dispute. Needs: incidents table, incident_evidence table (links to chats, payments, sessions), user suspension flag, admin incident management UI.
- [ ] **Pet/allergy mismatch warning on caregiver-family matching:** When a caregiver and care recipient are being matched (e.g., during care request flow, caregiver assignment, or Find Work browsing), automatically flag conflicts between caregiver allergies and household conditions. Example: if a caregiver has "allergic to dogs" and the care recipient's profile says "has dogs as pets," show a prominent warning to both parties before confirming the match. Applies to all pet types and common allergens. Depends on: onboarding profile questions (pets/allergies fields on both care_recipients and caregiver_profiles).
- [ ] **"Average in your area" rate data + job alert threshold.** Show caregivers the average hourly rate in their area based on platform data. Also let caregivers set a threshold like "alert me if a job pays more than $X, even if I'm marked unavailable." Preview to surge pricing. Depends on: sufficient transaction volume. *(Feedback — Feb 23, #3)*
- [ ] **Admin panel UX overhaul:** The admin panel is getting too busy with many tabs. Redesign with larger icons, collapsible sections, and a cleaner information hierarchy. Group related features: "Financials" section (revenue, transactions, projections), "Incident Resolution" section (support cases, blocked users), "Market Intelligence" section (heat map, usage stats, cancellation rates). Admin doesn't need to be pretty but needs to be scannable and efficient. Consider card-based navigation instead of a flat tab bar.
- [ ] **Accessibility feature roadmap:** Expand beyond text size to include: reduce motion toggle (`prefers-reduced-motion` media query support), high contrast mode, simplified view for care recipients (fewer elements, bigger touch targets), voice-to-text in messages (dictation for Betty), read-aloud for notifications and messages, comprehensive ARIA labels audit across all components, full keyboard navigation support, screen reader optimization. Each feature should be toggleable per-user in MyAccount and manageable per-care-recipient by the care team.
- [ ] **Feedback/review prompt for care team:** Where does Pete review Cary after a session, or review the whole care team? Need: (1) Post-session review prompt — after a completed session, the family member gets a clear nudge to rate the caregiver's performance (star rating + optional comment), (2) Periodic care team health check — monthly prompt for family members to review overall care team coordination, communication quality, and whether the team is meeting the care recipient's needs. Consider: review history visible in CareTeamManage, aggregate scores in caregiver profiles, and a dedicated "Reviews" tab in the care team page.
- [ ] **In-app voice & video calling (replace current implementation).** The current video call button in Messages opens a clunky flow that doesn't feel native. Replace with a real-time voice/video solution embedded directly in the chat UI. Key requirements: (1) One-tap audio or video call from any 1:1 conversation, (2) Incoming call notification (ring) even when app is in background, (3) Picture-in-picture or minimized call view so user can navigate while on a call, (4) Works on mobile (PWA) and desktop, (5) Group call support for care team check-ins. **Tech options to evaluate:** WebRTC peer-to-peer (free, complex to build — STUN/TURN servers, NAT traversal, overkill to DIY), Twilio Video/Voice (pay-per-minute, mature SDKs, HIPAA-eligible), Daily.co (simpler API than Twilio, embedded iframe or custom UI), Agora (low-latency, good mobile performance). **Recommendation:** Start with a managed service (Daily.co or Twilio) rather than raw WebRTC — reliability matters more than cost at this stage. Audio-first, video optional. Consider that elderly users (Betty's view) need a dead-simple incoming call UI — big green "Answer" button, no fumbling.
