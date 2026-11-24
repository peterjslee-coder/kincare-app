package com.yourinplace.app;

// ─── IncomingCallActivity — the full-screen incoming call (calls-native, 1.3) ───
//
// What a locked or idle phone shows when CallRinger rings: the caller's name and two big
// buttons. It is also where the notification's Answer button lands (ACTION_ANSWER), because
// Android 12+ will not let a broadcast receiver open the app from a notification action.
//
// Built in code (no layout file) and shown over the lock screen. On Answer the screen asks to be
// unlocked and then opens the app, which joins the call (public/js/nativeCalls.js).

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.lang.ref.WeakReference;

public class IncomingCallActivity extends Activity {
    private static WeakReference<IncomingCallActivity> current = new WeakReference<>(null);

    private String roomName;
    private boolean acting = false;
    private TextView status;

    /** CallRinger: this call stopped ringing (elsewhere, missed, hung up) — close its screen. */
    static void closeFor(String room) {
        IncomingCallActivity a = current.get();
        if (a != null && room != null && room.equals(a.roomName) && !a.acting) a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        current = new WeakReference<>(this);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    @Override
    protected void onDestroy() {
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }

    private void handle(Intent intent) {
        roomName = intent != null ? intent.getStringExtra(CallRinger.EXTRA_ROOM) : null;
        CallRinger.Call call = CallRinger.get(roomName);
        if (call == null || call.ended) { finish(); return; }
        build(call);
        if (CallRinger.ACTION_ANSWER.equals(intent.getAction())) answer();
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private Button roundButton(String label, int color) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(40));
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(72), 1f);
        lp.setMargins(dp(12), 0, dp(12), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private void build(CallRinger.Call call) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#1d1b19"));
        root.setPadding(dp(24), dp(96), dp(24), dp(64));

        TextView kind = new TextView(this);
        kind.setText("video".equals(call.callType) ? "InPlace video call" : "InPlace call");
        kind.setTextColor(Color.parseColor("#c8c2b8"));
        kind.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        kind.setGravity(Gravity.CENTER);
        root.addView(kind);

        TextView name = new TextView(this);
        name.setText(call.callerName);
        name.setTextColor(Color.WHITE);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 38);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setGravity(Gravity.CENTER);
        name.setPadding(0, dp(12), 0, 0);
        root.addView(name);

        status = new TextView(this);
        status.setText("is calling");
        status.setTextColor(Color.parseColor("#c8c2b8"));
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(8), 0, 0);
        root.addView(status);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        Button decline = roundButton("Decline", Color.parseColor("#c0392b"));
        Button answer = roundButton("Answer", Color.parseColor("#1e8e4e"));
        decline.setOnClickListener(v -> decline());
        answer.setOnClickListener(v -> answer());
        row.addView(decline);
        row.addView(answer);
        root.addView(row, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        setContentView(root);
    }

    private void decline() {
        if (acting) return;
        acting = true;
        CallRinger.decline(getApplicationContext(), roomName);
        finish();
    }

    private void answer() {
        if (acting) return;
        acting = true;
        if (status != null) status.setText("Connecting…");
        final Context app = getApplicationContext();
        CallRinger.answer(app, roomName, won -> {
            if (!won) {
                Toast.makeText(app, "This call was answered elsewhere or has ended", Toast.LENGTH_LONG).show();
                finish();
                return;
            }
            openApp();
        });
    }

    /** Ask to unlock (if locked), then bring the app forward; it joins the call. */
    private void openApp() {
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        Runnable go = () -> {
            Intent i = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(i);
            finish();
        };
        if (km != null && km.isKeyguardLocked() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { go.run(); }
                @Override public void onDismissCancelled() { go.run(); }
                @Override public void onDismissError() { go.run(); }
            });
        } else {
            go.run();
        }
    }
}
