// ─── CallManager — the phone rings like a phone (calls-native, 1.3) ───
//
// The native half of ringing on iOS. The CALL itself still happens in the web app (the same
// Twilio room it always used); this file only does the parts the web view cannot:
//
//   1. PushKit: holds the VoIP token the server rings (POST /api/calls/devices, via the plugin).
//   2. CallKit: shows the system incoming-call screen — the only thing that rings a locked phone.
//   3. Answer / Decline on that screen go straight to the server with the call's `callToken`
//      (no login, no web view), and Answer is handed to the web app to join the room.
//   4. While ringing, polls the call's status so the screen stops when the caller gives up,
//      someone else answers, or the 45 s ring runs out.
//
// ⚠️ THE RULE APPLE ENFORCES: every VoIP push MUST be reported to CallKit, immediately, in Swift,
// every single time — even a stale or malformed one (report it, then end it). An app that takes
// a VoIP push and doesn't report a call is killed, and after a few times iOS stops delivering
// its VoIP pushes at all. That is why this lives here and is started from AppDelegate at
// launch: a ring can wake the app from nothing, before any web view or plugin exists.
//
// Server half: src/routes/calls.js, src/utils/callRegistry.js, src/utils/callDevices.js.
// Web half: public/js/nativeCalls.js. Task list: docs/plans/Calls_Native_Tasks.md.

import Foundation
import UIKit
import PushKit
import CallKit
import AVFoundation

final class CallManager: NSObject {
    static let shared = CallManager()

    // One ringing or answered call this phone knows about.
    private final class Call {
        let uuid: UUID
        let roomName: String
        let callType: String          // "audio" | "video"
        let callerId: String
        let callerName: String
        let callToken: String
        let expiresAt: Date
        var answeredHere = false
        var declinedHere = false
        var endingFromWeb = false
        var ended = false
        var pollTimer: Timer?

        init(uuid: UUID, roomName: String, callType: String, callerId: String,
             callerName: String, callToken: String, expiresAt: Date) {
            self.uuid = uuid; self.roomName = roomName; self.callType = callType
            self.callerId = callerId; self.callerName = callerName
            self.callToken = callToken; self.expiresAt = expiresAt
        }

        var asAnswer: [String: Any] {
            ["roomName": roomName, "callType": callType, "callerId": callerId, "callerName": callerName]
        }
    }

    private let pushRegistry = PKPushRegistry(queue: .main)
    private let provider: CXProvider
    private let callController = CXCallController()
    private var calls: [UUID: Call] = [:]
    private var started = false

    private(set) var voipToken: String?
    private(set) var apnsToken: String?
    private var tokenWaiters: [(String?) -> Void] = []

    // An answer the web app hasn't picked up yet (cold start from the lock screen).
    private var pendingAnswer: [String: Any]?
    private var pendingAnswerAt: Date?

    // Set by InPlaceCallsPlugin. Everything here runs on the main queue.
    var onAnswered: (([String: Any]) -> Void)?
    var onEnded: (([String: Any]) -> Void)?
    var onMuted: (([String: Any]) -> Void)?
    var onTokenChanged: (([String: Any]) -> Void)?

    private static let pollInterval: TimeInterval = 3

    private override init() {
        let config = CXProviderConfiguration()
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        // A care call is not a phone number. Keeping it out of the Phone app's Recents means
        // there is no "call back" button there that would need an intent we don't handle.
        config.includesCallsInRecents = false
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: .main)
    }

    // Called from AppDelegate.didFinishLaunching — before anything else, every launch.
    func start() {
        guard !started else { return }
        started = true
        pushRegistry.delegate = self
        pushRegistry.desiredPushTypes = [.voIP]
    }

    // ─── Tokens ───

    // The ordinary APNs token (the one push_subscriptions holds). Sent alongside the VoIP token
    // so the server can skip the ordinary "Incoming call" banner on a phone that is already
    // ringing full screen — otherwise it rings twice.
    func setApnsToken(_ data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        guard hex != apnsToken else { return }
        apnsToken = hex
        if voipToken != nil { onTokenChanged?(registration()) }
    }

    func registration() -> [String: Any] {
        var r: [String: Any] = ["platform": "ios", "token": voipToken ?? ""]
        if let apns = apnsToken { r["pushToken"] = apns }
        return r
    }

    // PushKit usually hands over the token within a second of launch; wait for it rather than
    // telling the web app "no token" because it asked a moment too early.
    func whenVoipToken(timeout: TimeInterval, _ done: @escaping (String?) -> Void) {
        if let t = voipToken { done(t); return }
        var finished = false
        let once: (String?) -> Void = { t in if !finished { finished = true; done(t) } }
        tokenWaiters.append(once)
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { once(self.voipToken) }
    }

    // ─── Web app hand-offs ───

    func takePendingAnswer() -> [String: Any]? {
        defer { pendingAnswer = nil; pendingAnswerAt = nil }
        // An answer older than two minutes is a call that's long over (and its callToken has
        // expired) — joining that room would just be a black screen.
        if let at = pendingAnswerAt, Date().timeIntervalSince(at) > 120 { return nil }
        return pendingAnswer
    }

    // The web call is over (hung up in the app, or the other person left). Close the system call.
    func endFromWeb(roomName: String) {
        guard let call = calls.values.first(where: { $0.roomName == roomName && !$0.ended }) else { return }
        call.endingFromWeb = true
        let action = CXEndCallAction(call: call.uuid)
        callController.request(CXTransaction(action: action)) { [weak self] error in
            if error != nil {
                // CallKit no longer knows the call — just make sure our record is closed.
                DispatchQueue.main.async { self?.finish(call, reason: nil) }
            }
        }
    }

    // ─── Ending ───

    // Closes our record and, if `reason` is given, tells CallKit the call ended on its own
    // (as opposed to an action the person took on the call screen, which CallKit already knows).
    private func finish(_ call: Call, reason: CXCallEndedReason?) {
        guard !call.ended else { return }
        call.ended = true
        call.pollTimer?.invalidate()
        call.pollTimer = nil
        if let reason = reason {
            provider.reportCall(with: call.uuid, endedAt: Date(), reason: reason)
        }
        if pendingAnswer?["roomName"] as? String == call.roomName {
            pendingAnswer = nil
            pendingAnswerAt = nil
        }
        calls[call.uuid] = nil
    }

    // ─── The server ───

    // Same origin as the web view, so a build pointed at a test server talks to that server.
    // capacitor.config.json is copied into the app by `npx cap sync`.
    private lazy var baseURL: URL = {
        if let url = Bundle.main.url(forResource: "capacitor.config", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let server = json["server"] as? [String: Any],
           let s = server["url"] as? String,
           let u = URL(string: s) {
            return u
        }
        return URL(string: "https://yourinplace.com")!
    }()

    private func request(_ call: Call, _ path: String, method: String,
                         _ done: @escaping (Int, [String: Any]?) -> Void) {
        let room = call.roomName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? call.roomName
        guard let url = URL(string: "/api/calls/\(room)/\(path)", relativeTo: baseURL) else { done(0, nil); return }
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.httpMethod = method
        req.setValue(call.callToken, forHTTPHeaderField: "X-Call-Token")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if method == "POST" {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = "{}".data(using: .utf8)
        }
        URLSession.shared.dataTask(with: req) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            DispatchQueue.main.async { done(status, json) }
        }.resume()
    }

    // While it rings: has the caller given up, did another of my devices answer, did it time out?
    private func startPolling(_ call: Call) {
        call.pollTimer?.invalidate()
        call.pollTimer = Timer.scheduledTimer(withTimeInterval: CallManager.pollInterval, repeats: true) { [weak self] _ in
            self?.poll(call)
        }
    }

    private func poll(_ call: Call) {
        guard !call.ended else { return }
        if !call.answeredHere && Date() > call.expiresAt.addingTimeInterval(5) {
            finish(call, reason: .unanswered)
            return
        }
        request(call, "status", method: "GET") { [weak self] status, json in
            guard let self = self, !call.ended else { return }
            if status == 403 || status == 404 {
                // The callToken lasts two minutes. Once the call is answered HERE, the web app
                // owns the hang-up (it calls endCall), so an expired pass just means stop asking.
                if call.answeredHere { call.pollTimer?.invalidate(); call.pollTimer = nil }
                else { self.finish(call, reason: .remoteEnded) }
                return
            }
            guard status == 200, let state = json?["state"] as? String else { return } // network blip: try again
            switch state {
            case "ringing":
                break
            case "answered":
                if !call.answeredHere { self.finish(call, reason: .answeredElsewhere) }
            case "declined":
                if !call.declinedHere { self.finish(call, reason: .declinedElsewhere) }
            case "missed":
                self.finish(call, reason: .unanswered)
            case "ended":
                if call.answeredHere { self.onEnded?(["roomName": call.roomName, "by": "remote"]) }
                self.finish(call, reason: .remoteEnded)
            default:
                // "unknown": the server no longer has this call (it restarted, or it's long over).
                if !call.answeredHere { self.finish(call, reason: .remoteEnded) }
            }
        }
    }

    // ─── Audio ───

    // CallKit activates the session; WebKit's WebRTC (Twilio) plays and records through it.
    private func configureAudioSession(video: Bool) {
        let session = AVAudioSession.sharedInstance()
        var options: AVAudioSession.CategoryOptions = [.allowBluetooth]
        if video { options.insert(.defaultToSpeaker) }
        try? session.setCategory(.playAndRecord, mode: video ? .videoChat : .voiceChat, options: options)
    }
}

// ─── PushKit ───

extension CallManager: PKPushRegistryDelegate {
    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        let changed = hex != voipToken
        voipToken = hex
        let waiters = tokenWaiters
        tokenWaiters.removeAll()
        waiters.forEach { $0(hex) }
        if changed { onTokenChanged?(registration()) }
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        voipToken = nil
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload,
                      for type: PKPushType, completion: @escaping () -> Void) {
        guard type == .voIP else { completion(); return }
        let p = payload.dictionaryPayload
        func str(_ k: String) -> String? { p[k] as? String }

        let uuid = str("callUuid").flatMap { UUID(uuidString: $0) } ?? UUID()
        let roomName = str("roomName") ?? ""
        let callType = str("callType") == "video" ? "video" : "audio"
        let callerName = (str("callerName")?.isEmpty == false ? str("callerName") : nil) ?? "InPlace"
        let callerId = str("callerId") ?? ""
        let callToken = str("callToken") ?? ""
        // expiresAt is epoch milliseconds, as a string
        let expiresAt = str("expiresAt").flatMap { Double($0) }.map { Date(timeIntervalSince1970: $0 / 1000) }
            ?? Date().addingTimeInterval(45)

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerId.isEmpty ? callerName : callerId)
        update.localizedCallerName = callerName
        update.hasVideo = callType == "video"
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false

        let valid = !roomName.isEmpty && !callToken.isEmpty && type == .voIP
        let stale = Date() > expiresAt

        // A second ring for a call already on screen (two pushes for one call) — CallKit refuses
        // a UUID it already has, which is exactly right; nothing else to do.
        if calls[uuid] != nil { completion(); return }

        let call = Call(uuid: uuid, roomName: roomName, callType: callType, callerId: callerId,
                        callerName: callerName, callToken: callToken, expiresAt: expiresAt)
        if valid && !stale { calls[uuid] = call }

        configureAudioSession(video: callType == "video")
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            defer { completion() }
            guard let self = self else { return }
            if error != nil {
                // Do Not Disturb, a blocked caller, or a duplicate UUID. Nothing is ringing.
                self.calls[uuid] = nil
                return
            }
            if !valid || stale {
                // Reported (as Apple requires), and ended at once: this ring is malformed or late.
                self.provider.reportCall(with: uuid, endedAt: Date(), reason: valid ? .unanswered : .failed)
                return
            }
            self.startPolling(call)
        }
    }
}

// ─── CallKit ───

extension CallManager: CXProviderDelegate {
    func providerDidReset(_ provider: CXProvider) {
        for call in calls.values { call.pollTimer?.invalidate() }
        calls.removeAll()
        pendingAnswer = nil
        pendingAnswerAt = nil
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        guard let call = calls[action.callUUID], !call.ended else { action.fail(); return }
        call.answeredHere = true
        configureAudioSession(video: call.callType == "video")
        request(call, "answer", method: "POST") { [weak self] status, json in
            guard let self = self else { return }
            let state = json?["state"] as? String
            // `won`: this phone's answer is the one that counted (another of the person's
            // phones may have answered a moment earlier — both would see "answered").
            let won = json?["won"] as? Bool ?? false
            guard status == 200, state == "answered", won else {
                // Too late: the caller hung up, or another device answered first.
                action.fail()
                self.finish(call, reason: state == "answered" ? .answeredElsewhere : .remoteEnded)
                return
            }
            action.fulfill()
            // Hand the call to the web app: live if it is running, parked if this answer is
            // what launched it (nativeCalls.js asks for it with getPendingAnswer on start).
            self.pendingAnswer = call.asAnswer
            self.pendingAnswerAt = Date()
            self.onAnswered?(call.asAnswer)
        }
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        guard let call = calls[action.callUUID] else { action.fulfill(); return }
        if call.endingFromWeb {
            // The web app already hung up and told the other side.
        } else if !call.answeredHere {
            // Declined on the ringing screen.
            call.declinedHere = true
            request(call, "decline", method: "POST") { _, _ in }
        } else {
            // Ended with the red button on the system call screen: the web app must leave the
            // room and tell the other person, or they'd sit in an empty call.
            onEnded?(["roomName": call.roomName, "by": "user"])
        }
        action.fulfill()
        finish(call, reason: nil)
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        guard let call = calls[action.callUUID] else { action.fail(); return }
        // The microphone belongs to the web call; the mute button on the system screen is
        // passed through so it really mutes, instead of lighting up and doing nothing.
        onMuted?(["roomName": call.roomName, "muted": action.isMuted])
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        action.fail() // holding isn't supported (supportsHolding = false)
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // Nothing to start: WebKit's WebRTC owns playback and recording once the web app joins.
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}
}
