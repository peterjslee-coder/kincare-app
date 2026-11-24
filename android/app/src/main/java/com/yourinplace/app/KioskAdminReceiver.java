package com.yourinplace.app;

// The device-admin component that makes kiosk mode possible on an InPlace Hub tablet. It does
// nothing by itself: it exists so the one-time
//     adb shell dpm set-device-owner com.yourinplace.app/.KioskAdminReceiver
// can make the app the tablet's device owner, which is what lets Kiosk lock the screen to InPlace.

import android.app.admin.DeviceAdminReceiver;

public class KioskAdminReceiver extends DeviceAdminReceiver { }
