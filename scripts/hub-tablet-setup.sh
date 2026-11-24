#!/usr/bin/env bash
# ─── InPlace Hub tablet setup (1.3) ───
#
# Turns a plugged-in Android tablet into an InPlace Hub: InPlace installed, made the tablet's
# device owner (so kiosk mode can keep it on InPlace), screen on while charging,
# and the app open at the sign-in screen.
#
# Run on the Mac, with the tablet plugged in by USB:
#     bash scripts/hub-tablet-setup.sh                 # InPlace already on the tablet (from Play)
#     bash scripts/hub-tablet-setup.sh path/to/app.apk # install this build first (a demo tablet)
#
# BEFORE running, on the tablet (none of this can be done over USB):
#   1. Finish the setup screens. Connect Wi-Fi. SKIP the Google and Samsung sign-ins: Android
#      only lets an app become device owner on a tablet with no accounts at all.
#   2. Settings → About tablet → Software information → tap Build number 7 times.
#   3. Settings → Security and privacy → Auto Blocker → off.
#   4. Settings → Developer options → USB debugging → on. Plug in; allow this computer.
#
# After it finishes: sign in as the Hub person, then in your own InPlace app turn the Hub on.
# A Google account can be added back afterwards (needed for Play Store updates).
# Undo kiosk any time: Hub settings → "Keep the tablet on InPlace" off, or five quick taps in
# the tablet's top-left corner (unlocks for 10 minutes).

# No pipefail: `grep -q` stops reading early, adb then exits on SIGPIPE, and pipefail would
# turn a found match into a failure (that is exactly what happened on the first real tablet).
set -u

PKG="com.yourinplace.app"
ADMIN="$PKG/.KioskAdminReceiver"
APK="${1:-}"
MEET_OFF=0

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
stop() { printf '\n  \033[31m✗ %s\033[0m\n\n' "$*"; exit 1; }

# adb: on the PATH, or where Android Studio puts it on a Mac.
ADB="$(command -v adb 2>/dev/null || true)"
[ -z "$ADB" ] && [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ] && ADB="$HOME/Library/Android/sdk/platform-tools/adb"
[ -z "$ADB" ] && stop "adb not found. Install Android Studio's Platform-Tools, or: brew install --cask android-platform-tools"
sh_() { "$ADB" shell "$@" 2>/dev/null | tr -d '\r'; }

say "1. Finding the tablet"
"$ADB" start-server >/dev/null 2>&1
LIST="$("$ADB" devices | tail -n +2 | grep -v '^\s*$' || true)"
COUNT="$(printf '%s\n' "$LIST" | grep -c . || true)"
[ "$COUNT" = "0" ] && stop "No tablet found. Check the cable (some are charge-only), unlock the tablet, and turn on USB debugging."
[ "$COUNT" != "1" ] && stop "More than one Android device is plugged in. Unplug all but the tablet."
STATE="$(printf '%s' "$LIST" | awk '{print $2}')"
[ "$STATE" = "unauthorized" ] && stop "The tablet hasn't allowed this computer. Unlock it, tap Allow on \"Allow USB debugging?\", then run this again."
[ "$STATE" != "device" ] && stop "The tablet is \"$STATE\". Unplug it, plug it back in, and run this again."
MODEL="$(sh_ getprop ro.product.model)"; ANDROID="$(sh_ getprop ro.build.version.release)"
ok "$MODEL, Android $ANDROID"

say "2. Checking it can become a Hub"
USERS="$(sh_ pm list users | grep -c 'UserInfo{' || true)"
[ "$USERS" != "1" ] && stop "This tablet has more than one user or a Secure Folder. Remove them (Settings → Accounts and backup / Secure Folder) and run this again."
ok "one user"
if sh_ dpm list-owners 2>/dev/null | grep -q "$PKG"; then
  ALREADY=1; ok "InPlace is already its device owner"
else
  ALREADY=0
  ACCTS="$(sh_ dumpsys account | grep -E '^\s+Account \{' || true)"
  if [ -n "$ACCTS" ]; then
    # Google Meet keeps its own account, and clearing its data doesn't remove it; switching
    # Meet off does. It is switched back on at the end.
    if printf '%s' "$ACCTS" | grep -q 'com.google.android.apps.tachyon'; then
      sh_ pm disable-user --user 0 com.google.android.apps.tachyon >/dev/null
      MEET_OFF=1
      sleep 2
      ok "Google Meet switched off for a moment"
      ACCTS="$(sh_ dumpsys account | grep -E '^\s+Account \{' || true)"
    fi
  fi
  if [ -n "$ACCTS" ]; then
    printf '%s\n' "$ACCTS" | sed -E 's/name=[^,]*/name=(hidden)/' | sed 's/^/    /'
    stop "These accounts must come off first: Settings → Accounts and backup → Manage accounts → each one → Remove. (Add the Google account back after this finishes.)"
  fi
  ok "no accounts"
fi

say "3. InPlace"
if [ -n "$APK" ]; then
  [ -f "$APK" ] || stop "No file at $APK"
  "$ADB" install -r "$APK" >/tmp/inplace-install.log 2>&1 || { cat /tmp/inplace-install.log; stop "Install failed. If it says INSTALL_FAILED_UPDATE_INCOMPATIBLE, a Play copy is on the tablet: run without the .apk, or uninstall it first."; }
  ok "installed $(basename "$APK")"
fi
sh_ pm list packages | grep -q "package:$PKG\$" || stop "InPlace isn't on the tablet. Run with the path to an .apk, or install it from Play first."
VER="$(sh_ dumpsys package "$PKG" | grep -m1 versionName | sed 's/.*versionName=//')"
ok "InPlace $VER"
if ! sh_ dumpsys package "$PKG" | grep -q "KioskAdminReceiver"; then
  stop "This InPlace ($VER) is older than 1.3 and has no kiosk mode. Install 1.3 first."
fi

say "4. Making InPlace the tablet's device owner"
if [ "$ALREADY" = "0" ]; then
  OUT="$("$ADB" shell dpm set-device-owner "$ADMIN" 2>&1 | tr -d '\r')"
  printf '%s\n' "$OUT" | grep -q "Success" || { printf '    %s\n' "$OUT"; stop "Android refused. The usual cause is an account still on the tablet."; }
fi
ok "device owner (kiosk mode is available)"

if [ "$MEET_OFF" = "1" ]; then sh_ pm enable com.google.android.apps.tachyon >/dev/null; ok "Google Meet back on"; fi

say "5. Tablet settings for a counter"
sh_ settings put global stay_on_while_plugged_in 7 >/dev/null && ok "screen stays on while charging"

say "6. Opening InPlace"
sh_ am start -n "$PKG/.MainActivity" >/dev/null && ok "open"

cat <<'EOF'

  Done. Next:
    • On the tablet: sign in as the Hub person (their own InPlace login).
    • On your phone: Care Team → Accessibility Options → InPlace Hub → on.
      "Keep the tablet on InPlace" is on by default; turn it off any time to use the tablet.
    • Optional: add a Google account back (Settings → Accounts) for Play Store updates,
      and turn Auto Blocker back on (it doesn't affect kiosk mode).
    • Then unplug. USB debugging can stay on; nothing else can use it without this Mac.

EOF
