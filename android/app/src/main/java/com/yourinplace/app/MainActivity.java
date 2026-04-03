package com.yourinplace.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int MIC_PERMISSION_REQUEST = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Request microphone permission at runtime (needed for Kindred voice).
        // The manifest declares RECORD_AUDIO, but Android also needs a runtime grant.
        // Asking on launch so it's ready before the user opens Kindred.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION_REQUEST);
        }

        // Enable WebAuthn / Passkey support in the WebView
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

        // NOTE: Do NOT set a custom WebChromeClient here — Capacitor's bridge
        // relies on its own BridgeWebChromeClient. Overriding it breaks the bridge.
        // Capacitor handles onPermissionRequest internally when the manifest
        // declares the permission and the runtime grant is given.
    }
}
