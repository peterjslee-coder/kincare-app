package com.yourinplace.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 1.3 — plugins inside the app module must be registered before the bridge starts.
        registerPlugin(InPlaceCallsPlugin.class);
        registerPlugin(InPlaceKioskPlugin.class);
        super.onCreate(savedInstanceState);
        CallRinger.ensureChannel(this);

        // Create notification channel (required for Android 8.0+ / API 26+)
        // Without this, FCM silently drops notifications on modern Android
        createNotificationChannel();

        // Enable WebAuthn / Passkey support in the WebView
        // Delegates passkey requests to Android Credential Manager
        // Requires: androidx.webkit 1.12.0+ (we have 1.14.0)
        // Also requires: assetlinks.json on yourinplace.com linking this app's signing cert
        try {
            WebView webView = getBridge().getWebView();
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
                WebSettingsCompat.setWebAuthenticationSupport(
                    webView.getSettings(),
                    WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
                );
                android.util.Log.i("InPlace", "WebAuthn enabled in WebView");
            } else {
                android.util.Log.w("InPlace", "WebAuthn feature not supported on this device");
            }
        } catch (Exception e) {
            android.util.Log.w("InPlace", "Failed to enable WebAuthn: " + e.getMessage());
        }

        // v1.134.0 — follow the phone's text size, up to 130%. The WebView applies Android's
        // font scale to every font in the app; at the largest settings (a caregiver's Samsung,
        // 11/18) labels ran into each other and screens broke. Larger than normal still reads
        // larger here — it just stops at the size the layouts were built to hold.
        try {
            WebView webView = getBridge().getWebView();
            float scale = getResources().getConfiguration().fontScale;
            int zoom = Math.round(Math.min(Math.max(scale, 1.0f), 1.3f) * 100);
            webView.getSettings().setTextZoom(zoom);
            android.util.Log.i("InPlace", "Text zoom " + zoom + "% (system font scale " + scale + ")");
        } catch (Exception e) {
            android.util.Log.w("InPlace", "Failed to set text zoom: " + e.getMessage());
        }

        // Microphone permission: declared in AndroidManifest.xml (RECORD_AUDIO).
        // Runtime permission is requested by the WebView automatically when
        // Kindred's SpeechRecognition.start() is called. No need to request
        // it here in onCreate — doing so interrupts Capacitor's bridge setup.
    }

    // 1.3 kiosk escape at the tablet: five quick taps in the top-left corner (Kiosk.pause).
    private int cornerTaps = 0;
    private long firstCornerTap = 0;
    private final android.os.Handler kioskHandler = new android.os.Handler(android.os.Looper.getMainLooper());

    @Override
    public boolean dispatchTouchEvent(android.view.MotionEvent ev) {
        try {
            // Counted while locked (to unlock) and while a corner-tap unlock is running (to lock
            // again at once — Pete, 11/24: "can we have the 5 taps to lock it and unlock it?").
            if (ev.getActionMasked() == android.view.MotionEvent.ACTION_DOWN && (Kiosk.isLocked(this) || Kiosk.paused(this))) {
                float corner = 80 * getResources().getDisplayMetrics().density;
                if (ev.getX() < corner && ev.getY() < corner) {
                    long now = System.currentTimeMillis();
                    if (now - firstCornerTap > 4000) { firstCornerTap = now; cornerTaps = 0; }
                    if (++cornerTaps >= 5) {
                        cornerTaps = 0;
                        if (Kiosk.paused(this)) {
                            Kiosk.resume(this);
                            android.widget.Toast.makeText(this, "Locked to InPlace", android.widget.Toast.LENGTH_LONG).show();
                            return super.dispatchTouchEvent(ev);
                        }
                        Kiosk.pause(this);
                        android.widget.Toast.makeText(this, "Unlocked for 10 minutes", android.widget.Toast.LENGTH_LONG).show();
                        // Then come back to the front (a device owner may) and lock again.
                        final android.content.Context app = getApplicationContext();
                        kioskHandler.postDelayed(() -> Kiosk.bringBack(app), Kiosk.PAUSE_MS + 1000);
                    }
                }
            }
        } catch (Exception ignored) { }
        return super.dispatchTouchEvent(ev);
    }

    // 1.3 — is InPlace on screen? CallRinger stays silent when it is: the app's own ring is then
    // the one way to answer (Pete, 11/24: two answer paths on the Hub, neither worked).
    static volatile boolean inFront = false;

    @Override
    public void onPause() {
        inFront = false;
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        inFront = true;
        // 1.3 — on a Hub tablet made device owner, keep the screen locked to InPlace (or release
        // it) to match the family's last choice. Does nothing on any other phone.
        Kiosk.apply(this);
    }

    /**
     * Create the default notification channel for FCM push notifications.
     * On Android 8.0+ (API 26+), notifications MUST be posted to a channel —
     * otherwise they are silently dropped. This channel ID must match the
     * one used by FCM's default behavior ("default") or be specified in
     * the FCM payload's android.notification.channel_id field.
     */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "inplace_default",                      // must match server FCM channelId
                "InPlace Notifications",                // user-visible name
                NotificationManager.IMPORTANCE_HIGH     // heads-up + sound
            );
            channel.setDescription("Care updates, messages, and alerts from InPlace");
            channel.enableVibration(true);
            channel.setShowBadge(true);

            // Also create a "default" channel — FCM uses this when no channelId is in the payload
            NotificationChannel defaultChannel = new NotificationChannel(
                "default",
                "General",
                NotificationManager.IMPORTANCE_HIGH
            );
            defaultChannel.setDescription("General notifications");
            defaultChannel.enableVibration(true);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                manager.createNotificationChannel(defaultChannel);
                android.util.Log.i("InPlace", "Notification channels created (inplace_default + default)");
            }
        }
    }
}
