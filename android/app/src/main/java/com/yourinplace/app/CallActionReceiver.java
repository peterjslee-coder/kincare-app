package com.yourinplace.app;

// Decline from the ringing notification. (Answer goes to IncomingCallActivity instead: it has to
// open the app, and Android 12+ forbids doing that from a receiver.)

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !CallRinger.ACTION_DECLINE.equals(intent.getAction())) return;
        final PendingResult pr = goAsync();
        CallRinger.decline(context.getApplicationContext(), intent.getStringExtra(CallRinger.EXTRA_ROOM));
        // decline() posts its request on a background thread; give it a moment before releasing.
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(pr::finish, 4000);
    }
}
