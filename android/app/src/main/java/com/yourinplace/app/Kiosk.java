package com.yourinplace.app;

// ─── Kiosk — keep an InPlace Hub tablet on InPlace (1.3) ───
//
// Pete, 11/24: Betty's kitchen tablet should only ever show InPlace. This works ONLY on a tablet
// where the app was made device owner (KioskAdminReceiver, one adb command). On every other phone
// isDeviceOwner() is false and every method here does nothing — a caregiver's Samsung can never
// be locked by this.
//
// When on:
//   • lock task mode: Home, Recents and the notification shade can't leave InPlace
//     (the power menu and the status bar's clock/battery stay, so it can still be restarted)
//   • InPlace is the tablet's Home screen, so it comes straight back after a restart
//   • camera, microphone and notifications are granted, so a drop-in never stops at a prompt
//     nobody is there to answer
// When off: all of that is undone and the tablet behaves like any other.
//
// On/off is the family's choice, from their own phone (Hub settings → "Keep the tablet on
// InPlace"); the web app on the tablet passes it here through InPlaceKioskPlugin. The last
// choice is remembered so a restart with no network still comes back locked.

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.IntentFilter;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

final class Kiosk {
    private static final String TAG = "InPlaceKiosk";
    private static final String PREFS = "inplace_kiosk";
    private static final String KEY_ON = "on";
    private static final String KEY_PAUSED_UNTIL = "paused_until";
    // The at-the-tablet escape (Pete, 11/24: "some sort of escape from kiosk mode"): five quick
    // taps in the top-left corner unlock it for this long, then it locks again by itself. For
    // when the phone switch can't reach the tablet (no Wi-Fi). The phone switch is the normal way.
    static final long PAUSE_MS = 10 * 60 * 1000L;
    // Activity-alias in AndroidManifest with the HOME filter. Disabled unless kiosk is on, so
    // no ordinary phone ever offers InPlace as a launcher.
    private static final String HOME_ALIAS = "com.yourinplace.app.KioskHome";
    // Allowed to open while locked, besides InPlace: Google's voice input, in case speech
    // recognition shows its own screen.
    private static final String[] ALSO_ALLOWED = { "com.google.android.googlequicksearchbox" };

    private Kiosk() { }

    static ComponentName admin(Context ctx) { return new ComponentName(ctx, KioskAdminReceiver.class); }

    static DevicePolicyManager dpm(Context ctx) {
        return (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    static boolean isDeviceOwner(Context ctx) {
        DevicePolicyManager d = dpm(ctx);
        return d != null && d.isDeviceOwnerApp(ctx.getPackageName());
    }

    static boolean wanted(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ON, false);
    }

    static boolean paused(Context ctx) {
        long until = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_PAUSED_UNTIL, 0);
        return until > System.currentTimeMillis();
    }

    /** Unlock for PAUSE_MS without changing the family's choice; apply() relocks afterwards. */
    static void pause(Activity activity) {
        Context ctx = activity.getApplicationContext();
        if (!isDeviceOwner(ctx) || !wanted(ctx)) return;
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong(KEY_PAUSED_UNTIL, System.currentTimeMillis() + PAUSE_MS).apply();
        apply(activity);
    }

    /** Open InPlace again (after a pause, after a restart); MainActivity.onResume relocks. */
    static void bringBack(Context ctx) {
        if (!isDeviceOwner(ctx) || !wanted(ctx)) return;
        try {
            Intent i = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            ctx.startActivity(i);
        } catch (Exception e) {
            Log.w(TAG, "could not bring InPlace back: " + e.getMessage());
        }
    }

    /** Five taps again while unlocked: lock now instead of waiting out the 10 minutes. */
    static void resume(Activity activity) {
        Context ctx = activity.getApplicationContext();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(KEY_PAUSED_UNTIL, 0).apply();
        apply(activity);
    }

    static boolean isLocked(Context ctx) {
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        return am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    /** The family's choice, from the web app. Applies at once if the activity is in front. */
    static void set(Activity activity, boolean on) {
        Context ctx = activity.getApplicationContext();
        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        // The family's choice from their phone wins over a corner-tap unlock still running
        // (Pete, 11/24: after five taps, turning the switch on didn't relock it).
        e.putBoolean(KEY_ON, on).putLong(KEY_PAUSED_UNTIL, 0).apply();
        apply(activity);
    }

    /** Called from MainActivity.onResume and after set(): make the tablet match the choice. */
    static void apply(Activity activity) {
        Context ctx = activity.getApplicationContext();
        if (!isDeviceOwner(ctx)) return;
        try {
            if (wanted(ctx) && !paused(ctx)) enter(activity); else exit(activity);
        } catch (Exception e) {
            Log.w(TAG, "kiosk apply failed: " + e.getMessage());
        }
    }

    private static void enter(Activity activity) {
        Context ctx = activity.getApplicationContext();
        DevicePolicyManager d = dpm(ctx);
        ComponentName admin = admin(ctx);
        String[] pkgs = new String[ALSO_ALLOWED.length + 1];
        pkgs[0] = ctx.getPackageName();
        System.arraycopy(ALSO_ALLOWED, 0, pkgs, 1, ALSO_ALLOWED.length);
        d.setLockTaskPackages(admin, pkgs);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            d.setLockTaskFeatures(admin,
                DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS | DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO);
        }
        // Camera, microphone, notifications: granted, so nothing waits on a prompt.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            grant(d, admin, ctx, Manifest.permission.CAMERA);
            grant(d, admin, ctx, Manifest.permission.RECORD_AUDIO);
            if (Build.VERSION.SDK_INT >= 33) grant(d, admin, ctx, Manifest.permission.POST_NOTIFICATIONS);
        }
        // InPlace as Home, so a restart comes straight back here.
        ComponentName home = new ComponentName(ctx.getPackageName(), HOME_ALIAS);
        ctx.getPackageManager().setComponentEnabledSetting(home,
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        IntentFilter f = new IntentFilter(Intent.ACTION_MAIN);
        f.addCategory(Intent.CATEGORY_HOME);
        f.addCategory(Intent.CATEGORY_DEFAULT);
        d.addPersistentPreferredActivity(admin, f, home);
        if (!isLocked(ctx)) activity.startLockTask();
        Log.i(TAG, "kiosk on");
    }

    private static void exit(Activity activity) {
        Context ctx = activity.getApplicationContext();
        DevicePolicyManager d = dpm(ctx);
        ComponentName admin = admin(ctx);
        if (isLocked(ctx)) {
            try { activity.stopLockTask(); } catch (Exception ignored) { }
        }
        d.clearPackagePersistentPreferredActivities(admin, ctx.getPackageName());
        ctx.getPackageManager().setComponentEnabledSetting(new ComponentName(ctx.getPackageName(), HOME_ALIAS),
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        d.setLockTaskPackages(admin, new String[0]);
        Log.i(TAG, "kiosk off");
    }

    private static void grant(DevicePolicyManager d, ComponentName admin, Context ctx, String perm) {
        try {
            d.setPermissionGrantState(admin, ctx.getPackageName(), perm, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
        } catch (Exception e) {
            Log.w(TAG, "could not grant " + perm + ": " + e.getMessage());
        }
    }
}
