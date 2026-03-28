package com.yourinplace.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
    }
}
