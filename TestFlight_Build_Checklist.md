# TestFlight build — v1.1 (9)

Everything in the repo is done and pushed. What's left is Xcode and App Store
Connect, which only you can run.

---

## On your Mac

```bash
cd <your kincare-app checkout>
git pull
npm install          # picks up the five new plugins
npx cap sync ios     # already committed, but harmless and confirms your copy matches
npx cap open ios     # opens Xcode
```

## In Xcode

1. Select **Any iOS Device (arm64)** as the destination — not a simulator, or Archive is greyed out.
2. **Product → Archive**.
3. When the Organizer opens: **Distribute App → App Store Connect → Upload**.
4. Let it manage signing automatically unless you've set it up otherwise.

Version is already bumped for you: **1.1, build 9** (build 8 was uploaded but came back with ITMS-90683 — see below). TestFlight
rejects a repeated build number, so this is the bit that most often bounces a re-upload —
if you ever need a second attempt, bump `CURRENT_PROJECT_VERSION` again.

## In App Store Connect

Processing usually takes 5–15 minutes. Then add the build to your TestFlight testers.
Export compliance is already declared in Info.plist (`ITSAppUsesNonExemptEncryption = false`),
so it shouldn't stop to ask.

---

## What was added

| Package | Turns on |
|---|---|
| `@capacitor/geolocation` | The geofence nudge **and** caregiver check-in/check-out location |
| `@capawesome/capacitor-badge` | App icon corrects itself on open |
| `@capacitor/local-notifications` | Incoming calls can ring on iOS |
| `@capacitor/filesystem` + `@capacitor/share` | Save and Export CSV produce a real file |

There is no official `@capacitor/badge` — that name 404s on npm. Badge is a community
plugin, and the one that matters is that `@capawesome/capacitor-badge` registers under the
name `Badge`, which is what the web code asks for.

This project uses **Swift Package Manager**, not CocoaPods, so there's no `pod install`.
`Package.swift` now lists all ten plugins and is committed.

No `Info.plist` changes were needed. `NSLocationWhenInUseUsageDescription` is already
there, and none of the other four require a usage string.

---

## Verify after installing, in this order

1. **Geofence** — dashboard → "Notice when you're at Betty's?" → **Yes, notice**.
   Expect a distance: *"You're 12.4 miles from Betty's right now, so no nudge — it appears
   within 1,000 ft."* If it fails, the grey diagnostic line under the message names the
   stage; send me that line.
2. **Check-in location** — the important one. Have a caregiver check in on an iPhone, then
   confirm the visit log carries coordinates. This has never worked on iOS, so it is worth
   checking against a real check-in rather than assuming.
3. **Badge** — clear something on your laptop, then open the phone app. The icon should
   correct within a second or two, with no push involved.
4. **Incoming call** — background the app and have someone call you. It should ring.
5. **Export** — Reimbursements → Export CSV. An iOS share sheet, and a real file.

If any of these still fails, it now fails *out loud* — every one of them reports a reason
rather than doing nothing. That's the difference from last week.

---

## Still outstanding, unrelated to this build

- **Android push** needs FCM configured before any notification work reaches an Android
  device.
- **`inplace.care`** returns a Cloudflare 525 (SSL handshake failure with the origin).
  Nothing depends on it any more — Stripe now points at `yourinplace.com/business` — but
  the domain is broken if you meant to use it.
