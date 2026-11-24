package com.yourinplace.app;

// 1.3 kiosk: after a restart, open InPlace on a Hub tablet (InPlace is usually its Home screen
// already; this covers a restart during the 10-minute at-the-tablet unlock). Nothing on any
// other phone: Kiosk.bringBack does nothing unless the app is device owner and kiosk is on.

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class KioskBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        Kiosk.bringBack(context.getApplicationContext());
    }
}
