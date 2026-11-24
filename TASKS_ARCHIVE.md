# InPlace — Completed Tasks Archive
> Completed bugs, features, and fixes. Moved here to keep TASKS.md clean.
> Last archived: March 17, 2026 (v1.46.6)

## Completed Bugs

- [x] **Calendar heat map sometimes stale on tab switch:** Fixed in v0.6.1 by adding `key={currentPage}` to all page components in renderPage(), forcing full remount on navigation.
- [x] **Real accounts can see demo users in contact/assignment pickers:** Fixed in v1.2.1. Added `is_demo` isolation to `/api/messages/contacts`, `/api/caregivers`, and `/api/caregivers/nearby`. Demo users see demo users, real users see real users.
- [x] **PWA not updating to latest version on phone:** Fixed in v1.2.1. Service worker cache name was stuck at `inplace-v0.9.0` — bumped to `inplace-v1.2.1`. Also added missing components (TwoFactorSetup, CareTeamManage, CareTeamPage, EmailVerificationBanner) to SW static asset list.
- [x] **Caregiver onboarding document upload — request body too large:** Fixed in v1.5.3. `limitBodySize` middleware was rejecting multipart/form-data before multer could process it. Fix: skip body size check for multipart requests. Also bumped multer per-file limit to 10MB, added client-side image resizing (1600px max, JPEG 85%), and replaced bare file inputs with "Take Photo" / "Choose Photo" buttons for mobile.
- [x] **No profile photo upload for family/care-recipient roles.** Fixed in v1.8.2–v1.8.3. Photo upload added to MyAccount (Profile tab) for all roles with client-side auto-resize (400x400 JPEG). Sidebar avatar updates in real-time. Route-specific 5mb JSON body limit added to prevent server errors.
- [x] **Dashboard needs a "Latest" / status section.** Every role's dashboard should have a prominent section at the top showing their current status and next action. For a caregiver like Carry Taiker who just registered, it would say something like "Pending background check and onboarding — complete your First Steps to get started." For a family member, it might show "2 upcoming sessions this week" or "Care request awaiting caregiver." Context-aware, always tells the user what's happening and what to do next. (Fixed in v1.6.0 with DisclaimerModal + Latest section)
- [x] **Messages show "Invalid Date" on sent messages.** Fixed in v1.8.3. Replaced relative timestamps ("5m", "2h") with actual time display (h:mm AM/PM) using `toLocaleTimeString()`.
- [x] **Care team members can't view or edit shared care recipient details.** Fixed. careRecipients.js hasAccess() checks both owner and shared permissions. Team members with edit access can update via PUT endpoint. *(Verified v1.33.7 audit)*
- [x] **Care recipient relationship label hardcoded as "Mother".** Fixed. care_team_members table has per-user `relationship_label` column. PUT endpoint allows each member to set their own label. *(Verified v1.33.7 audit)*
- [x] **"Upload profile photo" in First Steps has no link and no display location.** Fixed. CaretakerHub.js First Steps photo item has onClick handler navigating to account profile tab. Hidden file input + handleAvatarUpload implements the upload flow. MyAccount.js has full photo upload modal with auto-resize to 400x400 JPEG. Avatar displays in sidebar header.
- [x] **Dashboard needs a "Latest" / status section.** Duplicate of earlier item — fixed in v1.6.0 with DisclaimerModal + Latest section.
- [x] **Caregiver profile should show submitted onboarding documents and info for review.** Fixed. MyAccount.js has a dedicated "Documents" tab for caregivers showing DL, certifications, background check with thumbnail previews, re-upload buttons, and expiry warnings.
- [x] **Invalid dates on activity feed.** Audited all date formatting. Added parseTimestamp guards to Dashboard.js, FamilyPayments.js, AdminPanel.js. ActivityFeed.js was already using parseTimestamp correctly. Fixed in v1.24.1. *(Feedback #7)*
- [x] **Invalid dates on Betty's calendar.** CaredForView.js calendar was already using integer-based date construction (safe). Note timestamps use parseTimestamp with fallback. Fixed in v1.24.1. *(Feedback #12)*
- [x] **Maria has 3 duplicate Betty families.** Demo seed gives Maria 3 copies of the Betty Lee family instead of distinct families. Need 2 more realistic families in seed data. (Fixed by demo reseed in v1.22.1) *(Feedback #19)*
- [x] **Map centered on Blacksburg, not caregiver's registered zip.** Fixed in v1.25.0. AreaMap now uses profileCenter (work_latitude/work_longitude) as default center, falls back to Blacksburg. *(Feedback #26)*
- [x] **Caregiver pet/health info not showing on account page.** Fixed in v1.25.0. Health & Safety card in MyAccount now shows editable fields (pets, allergies, medical conditions) in edit mode for all roles. *(Feedback #22)*
- [x] **2FA won't load for caregiver role.** Not a role issue — Security tab hidden for demo users only (`isDemo` check). Real caregivers (e.g., Cary) can access 2FA. Skipping per Pete's instruction. *(Feedback #23, #24)*
- [x] **Caretaker signup shows generic "insufficient information" error.** Fixed in v1.25.0. RegisterPage now shows red border + "*required" labels on each invalid field for both family and caregiver tracks. *(Feedback — new)*
- [x] **Show app version on login/splash screen.** Already present on LoginPage (line 344) and sidebar footer. Done. *(Feedback — new)*
- [x] **Maria's caregiver calendar — color/block overlap confusion on busy days.** Fixed in v1.33.9. Booked cells now show recipient first name (e.g., "Bett"), care requests show "NEW" label. Combined with existing color legend and distinct left-border colors for clearer visual distinction. *(Feedback — new)*
- [x] **APP_VERSION not bumped consistently.** Fixed in v1.8.3. Going forward, always bump APP_VERSION, cache-bust param, and SW cache name together.
- [x] **Caregiver onboarding status "failed to load".** Fixed in v1.15.0. SQL query referenced non-existent columns (`photo_url` on `caregiver_profiles`, `doc_type`/`uploaded_at` on `caregiver_documents`).
- [x] **Demo accounts show wrong dashboard on switch.** Fixed in v1.15.1. `activeRole` in localStorage persisted across demo account switches, causing "Welcome back Pete" for all accounts. Cleared activeRole on all login/switch paths and added user ID to component keys for forced remount.
- [x] **"Connection request sent" should persist on messages screen.** Fixed in v1.25.0. After sending a connection request, fetchPendingRequests() is called to immediately refresh the sent requests list. *(Feedback — Feb 22)*
- [x] **Back swipe closes PWA instead of navigating back.** Fixed v1.33.12 — in-app navigation history using `history.pushState`. Back gesture navigates to previous page instead of closing app. At root, dummy entry prevents close. *(Feedback — Feb 22)*
- [x] **Can't see connection invite status.** Fixed. Messages.js shows "Pending" / "Request sent" status on contacts with pending connections. *(Verified v1.33.7 audit)*
- [x] **Caregivers search should initialize at care recipient's location.** Fixed in v1.25.0. Added searchCenter to map useEffect dependencies so map re-centers when care recipient location loads. *(Feedback — Feb 22)*
- [x] **Feedback icon overlaps message send button.** Fixed in v1.25.0. FAB moves higher (bottom: 130px) on mobile when on Messages page. *(Feedback — Feb 21)*
- [x] **Message timestamps — add date and time.** Fixed in v1.25.0. Individual messages now show "Yesterday 2:30 PM" or "Feb 21 2:30 PM" for older messages, just time for today. *(Feedback — Carry Taker)*
- [x] **Profile photo in sidebar/header.** Fixed. app.js sidebar renders user profile photo (or initials fallback) next to iP logo. *(Verified v1.33.7 audit)*
- [x] **Admin stats include demo data.** Fixed v1.33.10 — sessions count and sessions-by-status now exclude demo user sessions. *(Feedback — Feb 22)*
- [x] **Merge waitlist + invites in admin.** Fixed v1.33.12 — combined into unified "People" tab with sub-tabs (All / Waitlist / Invites). Search & Invite at top, waitlist + invite tables below. *(Feedback — Feb 22)*
- [x] **Cancel/remove stale invites.** Already implemented — Cancel, Resend, Re-invite buttons exist on invites tab. *(Feedback — Feb 22)*
- [x] **Care recipient photo upload.** Fixed in v1.20.4. Photo upload added to CareRecipients page with RecipientAvatar component. *(Feedback — Feb 22)*
- [x] **Care request not visible on family calendar.** Verified working in v1.20.4. Sessions API returns requested-status sessions to family users, Schedule.js displays them. *(Feedback — Feb 22)*
- [x] **Email verification UX unclear.** Fixed v1.33.10 — banner now shows "sent Xm ago", 60-second cooldown, and spam folder hint. *(Feedback — Feb 22, #23)*
- [x] **Fee percentage inconsistency (15% vs 20%).** Fixed. All fees are consistently 20% across rateCalculator.js, payments.js, and financials.js. *(Verified v1.33.7 audit)*
- [x] **Caregiver search should center on care recipient location.** Fixed in v1.25.0. Caregivers.js map now uses searchCenter (care recipient coords) with useEffect dependency. *(Feedback — Feb 22, #25)*
- [x] **Admin: remove users from waitlist.** Already implemented — "Remove" button on each waitlist row with confirm dialog. *(Feedback — Feb 22, #27)*
- [x] **Stripe Connect status not updating in First Steps.** Fixed. CaretakerHub.js detects Stripe return URL hash (payments-complete/payments-refresh), refreshes Stripe status, and switches to financials tab. *(Verified v1.33.7 audit)*
- [x] **Caregiver rates mismatch from onboarding.** Fixed. Onboarding saves rateDaytime/rateNighttime/rateOvernight to caregiver_profiles. Dashboard API returns them with hourly_rate fallback. CaretakerHub reads from profile data. *(Verified v1.33.7 audit)*
- [x] **Help/Account/Logout should be at bottom of sidebar.** Fixed. app.js pins Help, Account, and Logout items at the bottom of the sidebar. *(Verified v1.33.7 audit)*
- [x] **Duplicate help/FAQ articles.** Fixed. seed.js clears help_articles before reseeding, preventing duplicates. *(Verified v1.33.7 audit)*
- [x] **Profile photo upload not working for caregiver role.** peter@yourinplace.com (Carry Taker) — confirmed working as of v1.25.1. *(Feedback — Feb 23, #9)*
- [x] **Leaflet map doesn't display until tab switch.** Fixed in v1.25.0. Added invalidateSize(true) calls and ResizeObserver to both Caregivers.js and AreaMap.js maps. *(Feedback — Feb 23, #10)*
- [x] **AI insights cross-contamination between care recipients.** Fixed. CareProfile.js generates insights client-side scoped to the selected care recipient's health conditions/medications. *(Verified v1.33.7 audit)*
- [x] **Carlos has gendered female avatar.** Fixed. RecipientAvatar component uses initials (not gendered emoji) as fallback when no emoji or photo is set. *(Verified v1.33.7 audit)*
- [x] **"Latest" tile should be clickable.** Already implemented — Latest tile has onClick handler that navigates to relevant page. *(Feedback — Feb 23, #21)*
- [x] **Activity feed "Mark read" button text overflow.** Fixed in v1.29.1. Compacted button to "✓ Read" with smaller padding. *(Feedback — Feb 23, #23)*
- [x] **Inbox not sorted by recency.** Fixed in v1.29.1. Client-side sort by lastMessageAt DESC. *(Feedback — Feb 23, #25)*
- [x] **Find People doesn't show recent connections.** Fixed v1.33.10 — Find People now shows "Recent" section with up to 10 people from existing conversations. Clicking opens the conversation. *(Feedback — Feb 23, #26)*
- [x] **Session color mismatch for open vs confirmed.** Fixed in v1.25.0. Dashboard now shows distinct colors per status: confirmed=teal, completed=blue, pending=orange, open/requested=coral. *(Feedback — Feb 23, #31)*
- [x] **Alert clicks should show request details.** Fixed in v1.33.9. "View on Schedule" button in activity feed now passes the session date via `__pendingScheduleDate`. CaregiverCalendar jumps to the right week, Schedule.js jumps to the right month/day. *(Feedback — Feb 23, #32)*
- [x] **Demo data leaking into real user views.** Fixed in v1.28.6. Added demo isolation JOIN to sessions endpoint (both main caregiver query and open-requests fallback). Combined with prior v1.22.1 reseed and v1.2.1 caregiver/contacts isolation. *(Feedback — Feb 23, #33)*
- [x] **Getting Started checklist not auto-completing.** Fixed in v1.25.0. Added dismiss button to the Getting Started checklist on the new-user dashboard view. Checklist auto-detection was already in place for profile, recipients, caregivers, etc. *(Feedback — Feb 23, #39)*
- [x] **Caregiver name too small on profile.** Fixed in v1.25.0. Bumped caregiver name font from 17px to 20px on Caregivers.js profile cards. *(Feedback — Feb 23, #40)*
- [x] **Dashboard spend shows amount with no confirmed appointments.** Fixed in v1.25.0. Analytics endpoint now filters all spend/session/hour queries to only count confirmed and completed sessions. *(Feedback — Feb 23, #52)*
- [x] **Care recipient photo not showing on Dashboard.** Fixed in v1.25.1. Dashboard card hardcoded 🌷 emoji. Now shows photo > emoji > fallback. Also added photo/emoji fields to dashboard API parent object. *(Feb 24)*
- [x] **Active role not obvious enough.** Fixed in v1.29.0. Multi-role users see "Viewing as" label; single-role users see icon + role name. *(Feedback — Feb 24, new)*
- [x] **Star rating on caregiver card unclear.** Fixed in v1.30.0. Added tooltip "Family rating of this caregiver" on all star ratings. *(Feedback — Feb 24, new)*
- [x] **Betty tile and care team should be unified.** Fixed in v1.30.0. Care team nested inside Betty's card with overlapping member avatars. *(Feedback — Feb 24, new)*
- [x] **Show assigned caregiver on the map (Find Nearby).** When a caregiver like Cary is assigned, show her pin/flag on the family's caregiver map view. Fixed in v1.30.3 — assigned caregivers now shown with distinct pins on family's map. *(Feedback — Feb 24, new)*
- [x] **Care team tile — overlapping avatar display with real photos.** Fixed in v1.31.5. Real profile photos with initials fallback, pending invites shown as greyed "?" circles. CareTeamManage also shows photos. *(Feedback — Feb 24 + Feb 25, new)*
- [x] **Betty's tile health condition text too dark/hard to read.** Fixed in v1.29.1. Changed to rgba(255,255,255,0.75) on dark teal card. *(Feedback — Feb 24, new)*
- [x] **"Request Care" button misplaced in sidebar.** Fixed in v1.30.0. Now full-width orange accent button, visually distinct from nav. *(Feedback — Feb 24, new)*
- [x] **Care notes — add delete option.** Fixed in v1.31.2. Delete button added to CareProfile family view with confirmation prompt. *(Feedback — Feb 24, new)*
- [x] **Calendar blocks should show session preview.** Fixed in v1.29.1/v1.30.1. Day cells show "9a Betty · Comp · 3h" with time prefix, sorted by time. *(Feedback — Feb 24, new)*
- [x] **"Set your availability" link broken.** Was already wired to goToStep('availability'). The real issue was the completion check requiring rules — fixed in v1.31.2 (visiting tab = done). *(Feedback — Feb 24, new)*
- [x] **"Complete my profile" checklist misleading.** Fixed in v1.33.9. Caregiver First Steps profile step now shows "Still needed: bio and hourly rate" dynamically instead of generic description. *(Feedback — Feb 24, new)*
- [x] **Admin: delete user account fails.** Fixed. admin.js DELETE /api/admin/users/:id implements full soft-delete with transaction (anonymize, unassign, cleanup). *(Verified v1.33.7 audit)*
- [x] **Admin: force password reset from admin panel.** Fixed v1.33.10 — 🔑 button in admin user list sends reset email with one click. *(Feedback — reviewed)*
- [x] **Delete individual role without deleting account.** Fixed in v1.29.0. POST /api/auth/remove-role with two-step confirmation. *(Feedback — Feb 24, new)*
- [x] **Availability step shouldn't require setting a rule.** Fixed in v1.31.2. Visiting the availability tab now marks the step complete. *(Feedback — Feb 25, new)*
- [x] **Caregiver "Find Work" tab should be highlighted orange.** Fixed in v1.31.2. Orange accent button in sidebar + bottom nav. *(Feedback — Feb 25, new)*
- [x] **Selection boxes inconsistent size + bold text on active.** Fixed in v1.31.2. Active tab text now bold (700) across all dashboards. *(Feedback — Feb 25, new)*
- [x] **Link care recipient profile to a real user account (unified identity).**
  - **Step 1 (v1.31.0):** `linked_user_id` column + backfill migration + replaced 4 name-matching queries with FK lookups + "My Care Info" tab in CaredForView. ✅
  - **Step 2 (v1.31.1):** Permission tiers (Full/Collaborative/Managed) + `visibility_settings` JSON column + family-side permission controls in CareProfile + CaredForView enforces section visibility per tier. ✅
- [x] **Caregiver avatar in assignment block.** Fixed in v1.30.0. Shows profile photo or initials circle on assigned caregiver cards. *(Feedback — reviewed)*
- [x] **Role selection confusing for new family/team members.** Fixed in v1.33.8. Added role confirmation banner on registration steps 2+3: "You are joining as a ___" with "you can add other roles later" and a Change link. *(Feedback — Sara Huber, Feb 25)* **P0**
- [x] **Draft message leaking from individual to group chat.** Fixed in v1.33.4. Draft text is now scoped per conversation using a draftsRef keyed by conversation ID. Switching conversations saves/restores drafts correctly. *(Feedback — Pete, Feb 25)* **P1**
- [x] **Connection disappears after accepting.** Fixed in v1.33.4. Backend now auto-creates a direct conversation when a connection is accepted. Frontend navigates to the new conversation after accepting. *(Feedback — Pete, Feb 25)* **P1**
- [x] **Care team members should auto-connect for messaging.** Fixed in v1.33.4. When a user joins a care team via invite, auto-creates accepted connections with all existing team members. No separate connection request needed. *(Feedback — Pete, Feb 25)* **P1**
- [x] **Grey out unavailable roles in role switcher.** Fixed in v1.33.8. All three roles always shown; unavailable ones greyed out at 50% opacity with no click handler. Active role bold/highlighted. *(Feedback — Pete, Feb 25)* **P2**
- [x] **Push notification click should navigate to messages.** Fixed in v1.33.6. Added in-page PUSH_NAVIGATE listener in Messages.js so push clicks navigate to the right conversation even when already viewing messages. *(Feedback — Pete, Feb 25)* **P2**
- [x] **Push notification should show message preview.** Already implemented — push payload includes sender name + message preview (truncated at 100 chars). Verified in messages.js `sendPushToUser` calls. *(Feedback — Pete, Feb 25)* **P2**
- [x] **Red notification badge on message avatars.** Fixed in v1.33.5. Unread conversations now show a red dot on the avatar in the conversation list. *(Feedback — Pete, Feb 25)* **P2**
- [x] **Passkey cross-account login — security concern.** Fixed in v1.33.5. When a user provides their email, the server now verifies the authenticated passkey belongs to that user. Blocks cross-account login when a shared device has multiple users' passkeys registered. Root cause: `stored.userId` was never checked against `passkey.uid`. *(Feedback — Pete, Feb 25)* **P0**
- [x] **Cancellation flow: no-caregiver sessions should be free cancel.** Fixed in v1.33.5. Backend: `isLateCancel` now requires `hasCaregiver` — unassigned sessions always free to cancel. Frontend: cancel popup shows "No caregiver assigned — free to cancel" for unassigned sessions. *(Feedback — Pete, Feb 25)* **P1**
- [x] **Cary's pin/flag not showing on family map.** Fixed in v1.33.7. Root cause: geocoding during profile save excluded zip code, causing NULL lat/lng for caregivers. Fixed geocoding to include zip + added server-startup backfill. *(Feedback — Pete, Feb 25)* **P1**
- [x] **Sara's avatar shows initials instead of uploaded photo.** Fixed in v1.33.6. Conversations and contacts queries now return `profile_photo`. Frontend renders photo as `<img>` for direct conversations when available. *(Feedback — Pete, Feb 25)* **P1**
- [x] **Splash page: clarify spring 2026 launch and VA-only.** Fixed in v1.33.6. Added "Launching Spring 2026 in Virginia" badge below the hero body text. *(Feedback — Pete, Feb 25)* **P2**
- [x] **Activity feed: show specific user names.** Fixed in v1.33.5 (cancellations) + v1.33.6 (session bookings). Activity feed now shows "Cancelled by Pete Lee" and "Companion care requested by Pete Lee" with the actual user's name. *(Feedback — Pete, Feb 25)* **P2**
- [x] **"Cancelled by [Name]" not just "cancelled by family".** Fixed in v1.33.5. Activity feed now shows the specific user's name (e.g., "Cancelled by Pete Lee") instead of generic "Cancelled by Family". *(Feedback — Pete, Feb 25)* **P2**
- [x] **Feedback button should be tester-only, not shown to all users.** Fixed in v1.41.0. Pre-auth FAB removed entirely (anonymous users don't need it). Post-auth FAB already gated behind `is_tester || isAdmin`. Regular users and new signups no longer see it. **P0**
- [x] **Group chat icon: overlapping avatars with care recipient on top.** Fixed in v1.33.8. Group conversations now show overlapping circular avatars (up to 3 members, excluding current user) with profile photos or colored initials. *(Feedback — Pete, Feb 25)* **P2**
- [x] **Role explanation tooltips in care team management.** Fixed in v1.33.5. Added detailed role legend in the invite form area explaining Leader, Member, and View Only permissions. *(Feedback — Pete, Feb 25)* **P2**
- [x] **"I don't know how to add a My Loved One" + undefined text on new-user screen.** Fixed in v1.41.0. (1) Added prominent gradient "Add your loved one" CTA card on main dashboard when no care recipient exists. (2) Fixed "undefined" text in consent status banner by adding fallbacks for missing first/last name fields. (3) After adding a care recipient, user now sees main dashboard with Get Started tiles instead of the welcome screen. *(Feedback — Angela S, Feb 27)* **P0**
- [x] **Can't see Cary on caregiver page — not in assigned, browse, or map.** Fixed in v1.33.75. Backend COALESCE(is_active,1) handles NULL values. Frontend assigned tab uses assignment data for caregiver name fallback. *(Feedback — Pete, Feb 27)* **P1**
- [x] **Cary's calendar "Bett" tiles need better labels.** Fixed in v1.33.75. Calendar cells now show full first name ("Betty" not "Bett"). Tooltip shows name, service type, and cost. *(Feedback — Cary Taker, Feb 27)* **P2**
- [x] **Green outline on selectable profile role toggles.** Fixed in v1.33.75. Available roles show teal border, active role shows role-color border, unavailable roles have no border. *(Feedback — Pete, Feb 27)* **P2**
- [x] **Hide demo column in admin panel.** Fixed in v1.33.75. Demo column and demo filter removed from admin user table. Default still filters to real users. *(Feedback — Pete, Feb 27)* **P2**
- [x] **Manage own account from admin panel.** Fixed in v1.33.75. "My Account" button in admin header navigates to account settings page. *(Feedback — Pete, Feb 27)* **P2**
- [x] **Admin should default to real accounts (not demo).** Already fixed — `userDemoFilter` defaults to `'real'` in AdminPanel.js. *(Feedback — Pete, Feb 27)* **P1**
- [x] **AI health summary regenerate button with rate limiting.** Fixed in v1.33.75. Regenerate button already exists; added backend rate-limiting — requires at least 1 completed visit since last generation. 429 error shown via toast. *(Feedback — Pete, Feb 27)* **P3**
- [x] **Care recipient email not required during add flow — blocks verification.** Fixed in v1.41.0. Email is now required for new care recipients. Form shows "*required" label with orange border. Save handler validates email is present before proceeding. *(Feedback #5, #7, #8 — Son Tester, Mar 5)* **P0**
- [x] **"Next" allowed without email on care recipient form.** Fixed in v1.41.0. Same fix as above — handleSaveRecipient validates email is present and shows error message explaining it's needed for consent verification. *(Feedback #8 — Son Tester, Mar 5)* **P0**
- [x] **Phone number formatting inconsistent on care recipient form.** Fixed in v1.41.0. Applied `formatPhone()` utility consistently across CaredForView.js (emergency contact display) and CaregiverOnboarding.js (review step). All phone displays now use (XXX) YYY-ZZZZ format. *(Feedback #9 — Son Tester, Mar 5)* **P1**
- [x] **Getting Started checklist disappears after adding care recipient.** Fixed in v1.41.0. Changed welcome screen condition from `if (isNewUser)` to `if (isNewUser && !hasRecipient)` so users who've added a care recipient see the main dashboard with Get Started tiles instead of the blank welcome screen. *(Feedback #16, #17, #18 — Son Tester, Mar 5)* **P0**
- [x] **"Complete your profile" checked prematurely.** Fixed in v1.41.0. Strengthened `hasProfile` check to require city or zip in addition to name and phone: `!!(user?.first_name || user?.firstName) && !!(user?.phone) && !!(user?.city || user?.zip)`. *(Feedback #19 — Son Tester, Mar 5)* **P1**
- [x] **Connection accepted notification doesn't say who.** Fixed in v1.41.0. Activity feed title now includes accepter's name (e.g., "Jane Smith accepted your connection") instead of generic "Connection accepted". *(Feedback #21 — Son Tester, Mar 5)* **P1**
- [x] **Scheduling care allowed before authorization is confirmed.** Fixed. Schedule.js has `authGate` state that checks for at least one verified care recipient (consent_status verified/approved or tier1). If not authorized, shows blocking UI with message and navigation to recipients page. *(Feedback #3 — Son Tester, Mar 5)* **P0**
- [x] **"Invite family to care team" greyed out and unfindable.** Fixed. CareTeamManage.js has functional invite button for team leaders with full invite form (email, role selection, send). Button is conditionally rendered for leaders — non-leaders correctly don't see it. *(Feedback #3 — Son Tester, Mar 5 v1.38.0)* **P0**
- [x] **Consent verification page appears unexpectedly mid-flow.** Fixed in v1.41.0. Added explanatory header above ConsentVerification component in CareRecipients.js to contextualize why verification is shown. Consent status is now presented as an informational section within the recipient view rather than an unexpected standalone page. *(Feedback #7 — Son Tester, Mar 5 v1.38.0)* **P1**
- [x] **After adding care recipient, no path forward.** Fixed. CareRecipients.js wizard auto-advances: after saving a new recipient, `setWizardStep(1)` moves to preferences, then `setWizardStep(2)` advances to verification/attestation. Full wizard flow implemented with conditional step rendering. *(Feedback #8 — Son Tester, Mar 5 v1.38.0)* **P0**
- [x] **Format ALL phone numbers consistently as (XXX) YYY-ZZZZ.** Fixed across 14 locations in 8 components (CareRecipients, CaregiverOnboarding, CareTeamManage, CareProfile, CaredForView, MyAccount, ConsentVerification, RegisterPage). `formatPhone()` utility applies (XXX) YYY-ZZZZ formatting on input and display. *(Feedback #12 — Son Tester, Mar 5 v1.38.0)* **P1**
- [x] **Calendar text misaligned — days don't match numbers.** Fixed in v1.41.0. Normalized day header padding from `10px 4px` to `10px 0` and added `justifyContent: 'center'` to date number cells for consistent centering. *(Feedback — Pete, Mar 6)* **P1**
- [x] **"Next" button unresponsive when scheduling care.** Pete tried to schedule care and couldn't click Next — "looks available but doesn't work." Pete confirmed working Mar 8. *(Feedback — Pete, Mar 6)* **P0**
- [x] **Caregiver drag-and-select on calendar not working.** Fixed v1.34.7. *(Feedback — Cary, Mar 6)* **P1**
- [x] **2FA First Steps checklist doesn't clear properly.** Fixed v1.37.1 — 3-second timer + manual button fallback. *(Feedback — Cary, Mar 6)* **P1**
- [x] **Care preferences don't save (or don't show saved) in caregiver profile.** Fixed in v1.41.0. Simplified save handler to read profile directly from PUT response instead of separate verify fetch. Added proper error handling and toast feedback on success/failure. *(Pete, Mar 10)* **P1**
- [x] **Remove debug logging from jobMatching.js.** Fixed in v1.41.0. Removed console.warn and console.log from conflict detection block in jobMatching.js. **P2**

## Completed Features

- [x] **Short-notice upcharge description on financials page.** Already implemented — "How Pricing Works" card on Earnings tab explains platform fee, short-notice surcharge (20%, 75% to caregiver), and instant payout fee. *(Feedback — Feb 23, #2)*
- [x] **Calendar icon consistency.** Already implemented — `_DayIcon` SVG shows today's date with red/white theme, used in sidebar + mobile nav. *(Feedback — Feb 23, #20)*
- [x] **Dismissable dashboard tiles.** Already implemented — `dismissTile` with content fingerprints on Latest, Upcoming, Activity tiles. Auto-restores when content changes. *(Feedback — Feb 23, #53, #55)*
- [x] **Calendar bottom nav icon color.** Already implemented — `_DayIcon` SVG uses red header (#d32f2f) and white background. *(Feedback — Feb 23, #54)*
- [x] **Caregivers page default to map view.** Already implemented — `activeTab` defaults to `'nearby'` (map tab). *(Feedback — Feb 23, #57)*
- [x] **Admin default to real users.** Already implemented — `userDemoFilter` defaults to `'real'`. *(Feedback — Feb 23, #35)*
- [x] **Biometric sign-in (WebAuthn/passkeys).** Support fingerprint/Face ID authentication. Fixed in v1.30.7–v1.30.9 — full passkey registration + authentication via SimpleWebAuthn. *(Feedback — Feb 23, #36)*
- [x] **Connection request → auto-open chat.** Already implemented — backend creates conversation on accept, returns `conversationId`, frontend auto-opens it. *(Feedback — Feb 23, #27)*
- [x] **Clearer signup role selection.** Already implemented — Step 1 shows 3 clear cards with plain language: "I need help around my home" / "I want to help my loved one arrange care" / "I want to find meaningful work at fair wages". Plus role confirmation banner in step 2. *(Pete — Feb 24)*
- [x] **Splash page rework — collapse, simplify, focus.** Done in v1.24.0. B2 design: split hero with fade, tabbed audience sections, signup form, fair-wages subheadline. The splash is too busy with too much information in a confusing scroll order. Needs: (1) Elevator pitch up front with minimum space, (2) Clear demo CTA, (3) Sign up now button. Collapse detailed sections under expandable banners that invite the user to learn more. Remove waitlist signup — replace with direct sign-in at top with password assistance. Replace the pill photo with happy imagery: smiling elderly people, someone with Down syndrome being helped (shopping, etc.). All existing content is good but needs better information architecture with interaction beyond just scrolling. *(Pete — Feb 24)*
- [x] **Demo data enrichment — realistic messages.** Seed realistic conversations between Maria/Pete/Betty including group messages and video chat references. Currently messages are empty/placeholder. (Fixed by demo reseed with full rich data) *(Feedback #6, #14, #15)*
- [x] **Caregiver schedule → "Find Work" view.** Fixed v1.33.12 — Schedule.js empty state now role-aware. Caregivers see "Find Work" button instead of "Request Care". *(Feedback #3)*
- [x] **Analytics condensed into dashboard.** Already implemented — collapsible inline analytics section in Dashboard.js with summary + expandable detail. *(Feedback #8)*
- [x] **Upcoming sessions widget — make clickable.** Fixed v1.33.11 — clicking a session navigates to Schedule with the session date pre-selected via `__pendingScheduleDate`. *(Feedback #10)*
- [x] **Caregiver assignment flow — make obvious.** Already implemented — "Assign to..." dropdown on caregiver cards in Browse/Nearby tabs. *(Feedback #9)*
- [x] **Dashboard "Latest" / status section.** Fixed in v1.6.0. Context-aware top section with DisclaimerModal + Latest tile showing status and next action. *(Feedback #17 implied)*
- [x] **Floating feedback button (v1.6.1):** Implemented in v1.6.1, refined in v1.8.3 (moved to left on mobile, changed icon to lightbulb to avoid blocking send button).
- [x] **Remove all Uber references:** Already removed — no "Uber" references in CLAUDE.md or SplashPage.js.

## Completed Pete's Action Items

- [x] **Stripe: Add API keys to Railway.** You've created a Stripe account. Now go to Stripe Dashboard → Developers → API keys. Copy the **Secret key** and **Publishable key**. In Railway dashboard, add env vars: `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`. (Use test-mode keys first — they start with `sk_test_` and `pk_test_`.) This unblocks: background check payment during caregiver onboarding + future Stripe Connect marketplace payments.
- [x] **Resend: Verify domain and set FROM_EMAIL.** Domain `yourinplace.com` verified in Resend dashboard. `FROM_EMAIL` and `RESEND_API_KEY` set in Railway env vars. Consent outreach emails are live.
- [x] **D-U-N-S number** — 106784345. Registering as "InPlace" (organization).

## Completed App Store Tasks

- [x] **Our Story photo:** Converted mom-and-pete.heic to JPG, added to Our Story modal with caption.
- [x] **Our Story mobile button:** Added blue "Our Story" button visible on mobile hero next to "Sign Up Free".
- [x] **Mobile hero button overflow:** Fixed waterfalling buttons on mobile with reduced padding/font/gap via splash-hero-buttons class.
- [x] **Auto-login on hard refresh:** Added sessionStorage session-alive flag. Hard refresh (new tab/session) now requires login/passkey instead of silently restoring via refresh token.
- [x] **Passkey error handling:** LoginPage now shows specific server error messages instead of generic "Failed to start passkey login".
- [x] **Admin panel redesign (v1.41.4):** Replaced 14 flat tabs with 3 grouped sections (Core, Trust & Safety, Content & Config). Added always-visible "Action Required" banner for pending approvals. Unified People tab with Users/Waitlist/Invites sub-tabs — pending users highlighted with orange border and inline Approve/Reject buttons. Added universal search bar. Removed dead standalone Users tab.
- [x] **TASKS.md audit:** Cross-referenced 6 open bugs against codebase, found all already fixed. Marked as done to prevent duplicate work.

## Production Milestones — Completed

- [x] **PostgreSQL migration:** ✅ Done (v0.5.0).
- [x] **Wire registration to API:** ✅ Done (v0.5.1).
- [x] **Password reset flow:** ✅ Done (v0.5.1).
- [x] **Mobile-responsive UI:** ✅ Done (v0.5.2).
- [x] **Input validation & rate limiting:** ✅ Done (v0.6.1).
- [x] **Email verification:** ✅ Done (v0.6.2).
- [x] **Tests:** ✅ Done (v0.6.2, expanded v0.7.0). 53 tests across 4 suites.
- [x] **Auth Foundation (v1.0.0):** ✅ Done. Google OAuth backend, TOTP 2FA, trusted devices, demo mode isolation, enhanced MyAccount.
- [x] **Care Teams (v1.0.0):** ✅ Done. Care team CRUD, email invites, auto-creation, onboarding checklist, dashboard rework.
- [x] **Geocoding & distance:** ✅ Done (v1.2.0). Nominatim geocoding + Haversine radius search. Swap to Google Maps = one function change.
