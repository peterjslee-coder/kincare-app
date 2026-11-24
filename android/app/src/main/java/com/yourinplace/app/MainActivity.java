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
        super.onCreate(savedInstanceState);

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

        // Microphone permission: declared in AndroidManifest.xml (RECORD_AUDIO).
        // Runtime permission is requested by the WebView automatically when
        // Kindred's SpeechRecognition.start() is called. No need to request
        // it here in onCreate — doing so interrupts Capacitor's bridge setup.
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
