package com.yourinplace.app;

// ─── InPlaceKiosk — lets the Hub screen turn kiosk mode on and off (1.3) ───
//
// getStatus() → { deviceOwner, wanted, locked }
// set({ on })  → applies Kiosk (does nothing unless this tablet made the app device owner)
//
// The Hub screen (RecipientPhone.js) calls set() with the family's "Keep the tablet on InPlace"
// setting each time it loads, so changing it on Pete's phone changes the tablet.

import android.app.Activity;
import android.content.Context;
import android.media.AudioManager;
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

    // ─── v1.166.0 (vc27) — lost mode: "keeps playing the tone at maximum volume until I turn it
    // off or it is found" (Pete, 11/27). The Hub's sound plays on the media stream; this turns it
    // all the way up and remembers where it was, and restoreVolume puts it back.
    private int savedVolume = -1;

    @PluginMethod
    public void maxVolume(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) { call.reject("No audio"); return; }
        try {
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            if (savedVolume < 0) savedVolume = am.getStreamVolume(AudioManager.STREAM_MUSIC);
            am.setStreamVolume(AudioManager.STREAM_MUSIC, max, 0);
            JSObject o = new JSObject();
            o.put("volume", max);
            call.resolve(o);
        } catch (SecurityException e) {
            call.reject("Not allowed to change the volume");
        }
    }

    @PluginMethod
    public void restoreVolume(PluginCall call) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null && savedVolume >= 0) {
            try { am.setStreamVolume(AudioManager.STREAM_MUSIC, savedVolume, 0); } catch (SecurityException ignored) { }
        }
        savedVolume = -1;
        call.resolve();
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
