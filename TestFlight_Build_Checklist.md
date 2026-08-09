# TestFlight build — everything batched

**As of v1.105.54, all four native gaps are wired in the web layer.** Every call
feature-detects its plugin and falls back to today's behaviour, so nothing changes until
you install them. Install the four packages, ship **one** build, and all of it turns on.

---

## The commands

```bash
npm i @capacitor/geolocation @capacitor/badge @capacitor/local-notifications @capacitor/filesystem @capacitor/share
npx cap sync ios
npx cap open ios
```

Then archive and upload to TestFlight as usual.

`npx cap sync` registers the plugins with the native project. No Swift to write — the web
code already calls each one through `window.Capacitor.Plugins.*`.

---

## What each one fixes

### 1. `@capacitor/geolocation` — the one you're chasing

**The evidence.** The card reported its own failure:

```
web:ceiling:timeout → watch:ceiling:timeout in 42s
```

`ceiling` is our outer deadline, hit twice. That means **neither the success nor the error
callback was ever invoked** by `getCurrentPosition` or `watchPosition`. A denial would read
`denied(1)`; a genuine failure `timeout(3)`. Nothing came back at all.

Capacitor's WKWebView does not connect the browser Geolocation API to Core Location. The
object exists; it just never answers. Not permission, not signal, not GPS, not indoors —
which is why my first three explanations were all wrong.

**Fixes, in one go:**
- "Notice when you're at Betty's" — the geofence nudge.
- **Caregiver check-in and check-out location.** This is the bigger one. Those called the
  same dead API, so the evidence that a caregiver was physically at the home has *never*
  been captured on an iPhone — it sat at `null` with no error, so nobody noticed. Worth
  checking your `visit_logs` for how many iOS check-ins have coordinates.
- The "On My Way" ETA, and map centering on the caregiver and family map views.

### 2. `@capacitor/badge` — the app icon clears itself

Waiting since v1.105.42. Today the icon only changes when a push arrives; the app can't set
it. After this build it sets the number directly on open and resume, so dealing with
something on your laptop no longer leaves a stale badge on your phone.

### 3. `@capacitor/local-notifications` — incoming calls ring

`new Notification()` throws on iOS (v1.105.49 fixed that), but the service-worker path it
now uses may not be available in the WebView either, so a call could still arrive silently.
This is the path that definitely works.

### 4. `@capacitor/filesystem` + `@capacitor/share` — Save and Export produce a file

`<a download>` is a no-op in WKWebView — Capacitor installs no download handler. Until
v1.105.49 the CSV export even showed "Exported 34 reimbursements" while writing nothing.
These two write the bytes and hand the OS a real share sheet.

---

## How to verify, in order

1. **Geofence** — dashboard → "Notice when you're at Betty's?" → **Yes, notice**.
   Expect a distance, e.g. *"You're 12.4 miles from Betty's right now, so no nudge — it
   appears within 1,000 ft."* If it fails, the grey diagnostic line under the message names
   the stage; send me that line.
2. **At Betty's** — the green *"Looks like you're with Betty"* card with **Log this visit**.
3. **Check-in** — have a caregiver check in on an iPhone and confirm the visit log now
   carries coordinates.
4. **Badge** — clear something on the laptop, then open the phone app: the icon should
   correct within a second or two, without a push.
5. **Export** — Reimbursements → Export CSV: an iOS share sheet, and a real file.

---

## Also worth doing while you're in the native project

- `NSLocationWhenInUseUsageDescription` is already in `Info.plist` — no change needed.
- If you ever want silent background badge pushes, that needs
  `UIBackgroundModes → remote-notification`. Not required for anything above; the badge
  push is an alert-type push precisely because that entitlement is absent.
- Android push still needs FCM configured before any of the notification work reaches an
  Android device.
