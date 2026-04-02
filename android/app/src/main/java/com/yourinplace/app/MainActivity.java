package com.yourinplace.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
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

        // Request microphone permission at runtime (needed for Kindred voice)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION_REQUEST);
        }

        try {
            WebView webView = getBridge().getWebView();

            // Enable WebAuthn / Passkey support in the WebView
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
                WebSettingsCompat.setWebAuthenticationSupport(
                    webView.getSettings(),
                    WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
                );
                android.util.Log.i("InPlace", "WebAuthn enabled in WebView");
            } else {
                android.util.Log.w("InPlace", "WebAuthn feature not supported on this device");
            }

            // Grant WebView permission requests (microphone for Kindred speech)
            // When the web page calls SpeechRecognition.start() or getUserMedia(),
            // the WebView fires onPermissionRequest. We grant audio if the Android
            // runtime permission is already allowed.
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    String[] resources = request.getResources();
                    for (String resource : resources) {
                        if (resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this,
                                    Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                                android.util.Log.i("InPlace", "Granted WebView audio permission");
                                return;
                            }
                        }
                    }
                    request.deny();
                }
            });

        } catch (Exception e) {
            android.util.Log.w("InPlace", "WebView setup error: " + e.getMessage());
        }
    }
}
