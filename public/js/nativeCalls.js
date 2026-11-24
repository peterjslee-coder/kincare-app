// ─── The web half of native ringing (calls-native, 1.3) ───
//
// The phone rings in NATIVE code — CallKit on iOS, the full-screen call on Android — because
// that is the only thing that rings a locked phone. The call itself still happens HERE, in the
// web app, with the same Twilio room it always used. This file is the handshake between them:
//
//   1. Tell the server this device can ring like a phone (POST /api/calls/devices).
//   2. When someone answers on the lock screen, open the call screen and join that room.
//   3. When the call ends here, tell native so the system call UI and audio session close.
//
// ⚠️ The app loads its screens from yourinplace.com, so this file reaches EVERY installed copy
// the moment it deploys — including the 1.2 store build, which has no call plugin. Every entry
// point below checks for the plugin first and does nothing at all without it. A 1.2 phone must
// not be able to tell this file exists.

(function () {
  const PLUGIN = 'InPlaceCalls';

  function plugin() {
    try {
      const C = window.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      if (typeof C.isPluginAvailable === 'function' && !C.isPluginAvailable(PLUGIN)) return null;
      return (C.Plugins && C.Plugins[PLUGIN]) || null;
    } catch { return null; }
  }

  const available = () => !!plugin();

  // A call answered natively: park it where Messages already looks for a call to pick up
  // (window.__pendingCall, the v1.105.99 path), marked so Messages joins instead of ringing
  // a second time on a screen the person just answered from.
  function takeAnswered(d) {
    if (!d || !d.roomName) return;
    window.__pendingCall = {
      roomName: d.roomName,
      callType: d.callType === 'video' ? 'video' : 'audio',
      callerId: d.callerId,
      callerName: d.callerName,
      answeredNatively: true,
    };
    try { window.dispatchEvent(new CustomEvent('inplace:native-call-answered', { detail: window.__pendingCall })); } catch {}
  }

  let _started = false;
  async function start() {
    const p = plugin();
    if (!p || _started) return false;
    _started = true;
    try {
      const reg = await p.getDeviceToken(); // { platform, token, pushToken? }
      if (reg && reg.token && typeof apiFetch === 'function') {
        await apiFetch('/api/calls/devices', {
          method: 'POST',
          body: JSON.stringify({ platform: reg.platform, token: reg.token, pushToken: reg.pushToken || null }),
        });
      }
    } catch (err) { console.warn('NativeCalls: could not register this device for calls', err); }
    try {
      p.addListener('callAnswered', takeAnswered);
      // End / Mute pressed on the phone's own call screen (VideoCallOverlay acts on these).
      const relay = (name) => (d) => {
        try { window.dispatchEvent(new CustomEvent(name, { detail: d || {} })); } catch {}
      };
      p.addListener('callEnded', relay('inplace:native-call-ended'));
      p.addListener('callMuted', relay('inplace:native-call-muted'));
      // PushKit may hand over a new VoIP token at any time.
      p.addListener('tokenChanged', (reg) => {
        if (reg && reg.token && typeof apiFetch === 'function') {
          apiFetch('/api/calls/devices', {
            method: 'POST',
            body: JSON.stringify({ platform: reg.platform, token: reg.token, pushToken: reg.pushToken || null }),
          }).catch(() => {});
        }
      });
      // Cold start: the person answered on the lock screen and THAT launched the app, before
      // any listener existed. Native keeps the answer until we ask for it.
      const pending = await p.getPendingAnswer();
      if (pending && pending.roomName) takeAnswered(pending);
    } catch (err) { console.warn('NativeCalls: listener setup failed', err); }
    return true;
  }

  // The web call is over; close the system call (CallKit's in-call UI, the audio session).
  function ended(roomName) {
    const p = plugin();
    if (!p || !roomName) return;
    try { p.endCall({ roomName }); } catch {}
  }

  window.NativeCalls = { available, start, ended };
})();
