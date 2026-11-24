package com.yourinplace.app;

// ─── CallRinger — the phone rings like a phone, Android half (calls-native, 1.3) ───
//
// The Android twin of ios/App/App/CallManager.swift. The CALL still happens in the web app (the
// same Twilio room as always); this class only does what the web view cannot do on a locked or
// closed phone:
//
//   1. Takes the data-only `call_ring` FCM message (CallMessagingService) and posts a full-screen,
//      ringing call notification — Answer / Decline — that wakes a locked screen.
//   2. Answer / Decline go straight to the server with the call's `callToken` (no login, no web
//      view). Answer only joins if the server says THIS phone won; then the app opens and the web
//      side (public/js/nativeCalls.js) joins the room.
//   3. While ringing, polls the call's status every 3 s so the ringing stops when the caller gives
//      up, another of their devices answers, or the 45 s ring runs out.
//
// Server half: src/routes/calls.js, src/utils/callRegistry.js, src/utils/callDevices.js.

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class CallRinger {
    private static final String TAG = "InPlaceCalls";
    static final String CHANNEL_ID = "inplace_calls";
    static final String EXTRA_ROOM = "inplace_call_room";
    static final String ACTION_ANSWER = "com.yourinplace.app.CALL_ANSWER";
    static final String ACTION_DECLINE = "com.yourinplace.app.CALL_DECLINE";
    static final String ACTION_SHOW = "com.yourinplace.app.CALL_SHOW";
    private static final long POLL_MS = 3000;

    /** One ringing call this phone knows about. */
    static final class Call {
        final String roomName, callType, callerId, callerName, callToken;
        final long expiresAt;
        final int notificationId;
        volatile boolean ended = false;

        Call(Map<String, String> d) {
            roomName = d.get("roomName");
            callType = "video".equals(d.get("callType")) ? "video" : "audio";
            callerId = d.get("callerId") != null ? d.get("callerId") : "";
            callerName = d.get("callerName") != null && !d.get("callerName").isEmpty() ? d.get("callerName") : "InPlace";
            callToken = d.get("callToken");
            long exp;
            try { exp = Long.parseLong(d.get("expiresAt")); } catch (Exception e) { exp = System.currentTimeMillis() + 45000; }
            expiresAt = exp;
            notificationId = 7000 + Math.abs(roomName.hashCode() % 1000);
        }

        JSONObject asAnswer() {
            JSONObject o = new JSONObject();
            try {
                o.put("roomName", roomName);
                o.put("callType", callType);
                o.put("callerId", callerId);
                o.put("callerName", callerName);
            } catch (Exception ignored) { }
            return o;
        }
    }

    private static final Map<String, Call> calls = new HashMap<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final ExecutorService net = Executors.newSingleThreadExecutor();

    // An answer the web app hasn't picked up yet (cold start from the lock screen).
    private static JSONObject pendingAnswer;
    private static long pendingAnswerAt;

    // Set by InPlaceCallsPlugin while the web view is alive.
    interface Listener { void onAnswered(JSONObject answer); }
    static volatile Listener listener;

    private CallRinger() { }

    // ─── Ringing ───

    static synchronized void ring(Context ctx, Map<String, String> data) {
        if (data.get("roomName") == null || data.get("callToken") == null) return;
        Call call = new Call(data);
        if (call.expiresAt <= System.currentTimeMillis()) {
            Log.i(TAG, "stale ring ignored");
            return;
        }
        if (calls.containsKey(call.roomName)) return; // the same ring twice
        calls.put(call.roomName, call);
        ensureChannel(ctx);
        Context app = ctx.getApplicationContext();
        NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(call.notificationId, buildNotification(app, call));
        Log.i(TAG, "ringing for " + call.callType + " call");
        schedulePoll(app, call);
    }

    static synchronized Call get(String roomName) {
        return roomName == null ? null : calls.get(roomName);
    }

    private static Notification buildNotification(Context ctx, Call call) {
        PendingIntent full = activityIntent(ctx, call, ACTION_SHOW, 1);
        PendingIntent answer = activityIntent(ctx, call, ACTION_ANSWER, 2);
        Intent declineI = new Intent(ctx, CallActionReceiver.class).setAction(ACTION_DECLINE).putExtra(EXTRA_ROOM, call.roomName);
        PendingIntent decline = PendingIntent.getBroadcast(ctx, call.notificationId * 10 + 3, declineI,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Person caller = new Person.Builder().setName(call.callerName).setImportant(true).build();
        String what = "video".equals(call.callType) ? "Video call" : "Call";
        long timeout = Math.max(1000, call.expiresAt - System.currentTimeMillis());

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(call.callerName)
            .setContentText(what + " on InPlace")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(timeout)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer)
                .setIsVideo("video".equals(call.callType)));
        Notification n = b.build();
        // Keep ringing (sound + vibration) until answered, declined or timed out.
        n.flags |= Notification.FLAG_INSISTENT;
        return n;
    }

    private static PendingIntent activityIntent(Context ctx, Call call, String action, int slot) {
        Intent i = new Intent(ctx, IncomingCallActivity.class)
            .setAction(action)
            .putExtra(EXTRA_ROOM, call.roomName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        return PendingIntent.getActivity(ctx, call.notificationId * 10 + slot, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Calls", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Incoming InPlace calls");
        Uri tone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        ch.setSound(tone, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 800, 600, 800, 600 });
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    // ─── Polling: stop ringing when the call stops being ours to answer ───

    private static void schedulePoll(Context ctx, Call call) {
        main.postDelayed(() -> poll(ctx, call), POLL_MS);
    }

    private static void poll(Context ctx, Call call) {
        if (call.ended) return;
        if (System.currentTimeMillis() > call.expiresAt + 2000) { finish(ctx, call, "missed"); return; }
        request(ctx, call, "status", "GET", (status, json) -> {
            if (call.ended) return;
            if (status == 403 || status == 404) { finish(ctx, call, "gone"); return; }
            String state = json != null ? json.optString("state", "") : "";
            if (status == 200 && !state.isEmpty() && !"ringing".equals(state)) {
                // answered elsewhere, declined elsewhere, missed, or the caller hung up
                finish(ctx, call, state);
                return;
            }
            schedulePoll(ctx, call);
        });
    }

    // ─── Answer / Decline ───

    interface Done { void done(boolean ok); }

    /** Answer: the server decides who won; only the winner joins. */
    static void answer(Context ctx, String roomName, Done done) {
        Call call = get(roomName);
        if (call == null || call.ended) { done.done(false); return; }
        stopRinging(ctx, call);
        request(ctx, call, "answer", "POST", (status, json) -> {
            boolean won = status == 200 && json != null && json.optBoolean("won", false)
                && "answered".equals(json.optString("state", ""));
            finish(ctx, call, won ? "answered" : "lost");
            if (won) deliverAnswer(call.asAnswer());
            done.done(won);
        });
    }

    static void decline(Context ctx, String roomName) {
        Call call = get(roomName);
        if (call == null || call.ended) return;
        stopRinging(ctx, call);
        request(ctx, call, "decline", "POST", (status, json) -> finish(ctx, call, "declined"));
    }

    private static void stopRinging(Context ctx, Call call) {
        NotificationManager nm = (NotificationManager) ctx.getApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(call.notificationId);
    }

    private static synchronized void finish(Context ctx, Call call, String why) {
        if (call.ended) return;
        call.ended = true;
        calls.remove(call.roomName);
        stopRinging(ctx, call);
        IncomingCallActivity.closeFor(call.roomName);
        Log.i(TAG, "call ended here: " + why);
    }

    // ─── Web app hand-offs ───

    private static synchronized void deliverAnswer(JSONObject answer) {
        pendingAnswer = answer;
        pendingAnswerAt = System.currentTimeMillis();
        Listener l = listener;
        if (l != null) main.post(() -> l.onAnswered(answer));
    }

    /** An answer the web app hasn't taken yet; older than two minutes is a call long over. */
    static synchronized JSONObject takePendingAnswer() {
        JSONObject a = pendingAnswer;
        long at = pendingAnswerAt;
        pendingAnswer = null;
        pendingAnswerAt = 0;
        if (a == null || System.currentTimeMillis() - at > 120000) return null;
        return a;
    }

    /** The web side took the answer through the live listener; don't hand it over twice. */
    static synchronized void consumed(String roomName) {
        if (pendingAnswer != null && roomName != null && roomName.equals(pendingAnswer.optString("roomName"))) {
            pendingAnswer = null;
            pendingAnswerAt = 0;
        }
    }

    // ─── The server ───

    interface Response { void on(int status, JSONObject json); }

    private static void request(Context ctx, Call call, String path, String method, Response cb) {
        final String base = serverUrl(ctx);
        net.execute(() -> {
            int status = 0;
            JSONObject json = null;
            HttpURLConnection c = null;
            try {
                URL url = new URL(base + "/api/calls/" + URLEncoder.encode(call.roomName, "UTF-8") + "/" + path);
                c = (HttpURLConnection) url.openConnection();
                c.setRequestMethod(method);
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestProperty("X-Call-Token", call.callToken);
                c.setRequestProperty("Accept", "application/json");
                if ("POST".equals(method)) {
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json");
                    try (OutputStream os = c.getOutputStream()) { os.write("{}".getBytes(StandardCharsets.UTF_8)); }
                }
                status = c.getResponseCode();
                InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
                if (is != null) {
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = r.readLine()) != null) sb.append(line);
                    }
                    try { json = new JSONObject(sb.toString()); } catch (Exception ignored) { }
                }
            } catch (Exception e) {
                Log.w(TAG, "call request failed: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
            final int s = status;
            final JSONObject j = json;
            main.post(() -> cb.on(s, j));
        });
    }

    private static String cachedServer;

    /** Same origin as the web view (capacitor.config.json's server.url), so a test build talks to its own server. */
    static String serverUrl(Context ctx) {
        if (cachedServer != null) return cachedServer;
        String url = "https://yourinplace.com";
        try (InputStream is = ctx.getAssets().open("capacitor.config.json")) {
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            JSONObject server = new JSONObject(sb.toString()).optJSONObject("server");
            String u = server != null ? server.optString("url", "") : "";
            if (u.startsWith("https://")) url = u.replaceAll("/+$", "");
        } catch (Exception ignored) { }
        cachedServer = url;
        return url;
    }
}
