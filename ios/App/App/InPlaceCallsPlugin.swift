// ─── InPlaceCalls — the bridge between CallManager and the web app (calls-native, 1.3) ───
//
// A thin Capacitor plugin. All the ringing logic is in CallManager, which runs whether or not
// the web view exists; this only passes things across. The JS side is public/js/nativeCalls.js,
// which does nothing at all on a build without this plugin (the 1.1/1.2 store builds).
//
// Methods:  getDeviceToken() → { platform: "ios", token, pushToken? }
//           getPendingAnswer() → { roomName, callType, callerId, callerName } | {}
//           endCall({ roomName })
// Events:   callAnswered, callEnded, callMuted, tokenChanged
//
// Registered in InPlaceViewController.capacitorDidLoad (a plugin inside the app target is not
// found automatically).

import Foundation
import Capacitor

@objc(InPlaceCallsPlugin)
public class InPlaceCallsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InPlaceCallsPlugin"
    public let jsName = "InPlaceCalls"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getDeviceToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingAnswer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        let m = CallManager.shared
        // retainUntilConsumed: an answer that arrives before the page has added its listener
        // (reload, slow start) is held and delivered when it does.
        m.onAnswered = { [weak self] d in self?.notifyListeners("callAnswered", data: d, retainUntilConsumed: true) }
        m.onEnded = { [weak self] d in self?.notifyListeners("callEnded", data: d) }
        m.onMuted = { [weak self] d in self?.notifyListeners("callMuted", data: d) }
        m.onTokenChanged = { [weak self] d in self?.notifyListeners("tokenChanged", data: d) }
    }

    @objc func getDeviceToken(_ call: CAPPluginCall) {
        // Plugin methods arrive on a background queue; CallManager lives on main.
        DispatchQueue.main.async {
            CallManager.shared.whenVoipToken(timeout: 10) { token in
                guard token != nil else {
                    call.reject("No VoIP token yet")
                    return
                }
                call.resolve(CallManager.shared.registration())
            }
        }
    }

    @objc func getPendingAnswer(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(CallManager.shared.takePendingAnswer() ?? [:])
        }
    }

    @objc func endCall(_ call: CAPPluginCall) {
        guard let room = call.getString("roomName"), !room.isEmpty else {
            call.reject("roomName is required")
            return
        }
        DispatchQueue.main.async {
            CallManager.shared.endFromWeb(roomName: room)
            call.resolve()
        }
    }
}
