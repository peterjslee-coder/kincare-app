package com.yourinplace.app;

// ─── InPlaceCalls — the bridge between CallRinger and the web app (calls-native, 1.3) ───
//
// Same name and shape as the iOS plugin (ios/App/App/InPlaceCallsPlugin.swift), so
// public/js/nativeCalls.js needs no Android branch:
//
// Methods:  getDeviceToken() → { platform: "android", token, pushToken }
//           getPendingAnswer() → { roomName, callType, callerId, callerName } | {}
//           endCall({ roomName })   (nothing to close on Android; kept for parity)
// Events:   callAnswered, tokenChanged
//
// Registered in MainActivity (a plugin inside the app module is not found automatically).

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;
import java.lang.ref.WeakReference;
import org.json.JSONObject;

@CapacitorPlugin(name = "InPlaceCalls")
public class InPlaceCallsPlugin extends Plugin {
    private static WeakReference<InPlaceCallsPlugin> instance = new WeakReference<>(null);

    @Override
    public void load() {
        instance = new WeakReference<>(this);
        CallRinger.listener = answer -> {
            // retainUntilConsumed: an answer that arrives before the page has added its listener
            // is held and delivered when it does.
            notifyListeners("callAnswered", toJS(answer), true);
            CallRinger.consumed(answer.optString("roomName"));
        };
    }

    static void tokenChanged(String token) {
        InPlaceCallsPlugin p = instance.get();
        if (p == null || token == null) return;
        JSObject o = new JSObject();
        o.put("platform", "android");
        o.put("token", token);
        o.put("pushToken", token);
        p.notifyListeners("tokenChanged", o);
    }

    private static JSObject toJS(JSONObject j) {
        JSObject o = new JSObject();
        if (j == null) return o;
        o.put("roomName", j.optString("roomName"));
        o.put("callType", j.optString("callType"));
        o.put("callerId", j.optString("callerId"));
        o.put("callerName", j.optString("callerName"));
        return o;
    }

    @PluginMethod
    public void getDeviceToken(PluginCall call) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                call.reject("No FCM token yet");
                return;
            }
            String token = task.getResult();
            JSObject o = new JSObject();
            o.put("platform", "android");
            o.put("token", token);
            // The ordinary push uses the same FCM token; the server skips that endpoint when
            // this phone is already ringing full-screen.
            o.put("pushToken", token);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void getPendingAnswer(PluginCall call) {
        call.resolve(toJS(CallRinger.takePendingAnswer()));
    }

    @PluginMethod
    public void endCall(PluginCall call) {
        call.resolve();
    }
}
