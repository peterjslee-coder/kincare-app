package com.yourinplace.app;

// ─── The app's ONE Firebase messaging service (calls-native, 1.3) ───
//
// Android delivers FCM to exactly one service, and Capacitor's push plugin ships its own. So this
// one replaces it (AndroidManifest removes the plugin's entry) and extends it: a data-only
// `call_ring` rings the phone (CallRinger); EVERYTHING else goes to the plugin exactly as before,
// so ordinary pushes, taps and token updates behave the same as in 1.2.

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class CallMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data != null && "call_ring".equals(data.get("type"))) {
            CallRinger.ring(this, data);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        InPlaceCallsPlugin.tokenChanged(token);
    }
}
