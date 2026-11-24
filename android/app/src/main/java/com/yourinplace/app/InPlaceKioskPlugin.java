package com.yourinplace.app;

// ─── InPlaceKiosk — lets the Hub screen turn kiosk mode on and off (1.3) ───
//
// getStatus() → { deviceOwner, wanted, locked }
// set({ on })  → applies Kiosk (does nothing unless this tablet made the app device owner)
//
// The Hub screen (RecipientPhone.js) calls set() with the family's "Keep the tablet on InPlace"
// setting each time it loads, so changing it on Pete's phone changes the tablet.

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "InPlaceKiosk")
public class InPlaceKioskPlugin extends Plugin {

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("deviceOwner", Kiosk.isDeviceOwner(getContext()));
        o.put("wanted", Kiosk.wanted(getContext()));
        o.put("locked", Kiosk.isLocked(getContext()));
        return o;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void set(PluginCall call) {
        Boolean on = call.getBoolean("on");
        if (on == null) { call.reject("on is required"); return; }
        Activity a = getActivity();
        if (a == null) { call.reject("No activity"); return; }
        a.runOnUiThread(() -> {
            Kiosk.set(a, on);
            call.resolve(status());
        });
    }
}
