// ─── /api/calls — the native ringing path (calls-native, 1.3) ───
//
// Two kinds of caller:
//
//   1. The logged-in app registering THIS device as one that can ring like a phone
//      (POST/DELETE /devices). Normal authentication.
//
//   2. Native code on a ringing phone — CallKit on iOS, the full-screen call on Android — asking
//      whether the call is still ringing, or reporting Answer/Decline. That code runs before the
//      web view exists, often on a locked phone with the app not running, so it has no login.
//      It has the `callToken` from the ring instead: signed, one room, one person, two minutes
//      (utils/callRegistry.js). That is the ONLY thing these three routes accept, and the only
//      thing they can do is move that one call along.
//
// Nothing here is reachable by the 1.2 store build: it never registers a call device, so no
// call is ever rung natively for it and it never holds a callToken.

const express = require("express");
const { authenticate } = require("../middleware/auth");
const registry = require("../utils/callRegistry");
const { registerCallDevice, removeCallDevice } = require("../utils/callDevices");

const router = express.Router();

router.post("/devices", authenticate, async (req, res) => {
  // Same rule as /api/push/subscribe: an admin impersonating someone is holding the ADMIN's
  // phone. Registering it would ring Pete's phone with another person's calls.
  if (req.user.impersonatedBy) return res.json({ success: true, skipped: "impersonation" });
  try {
    const { platform, token, pushToken } = req.body || {};
    await registerCallDevice(req.user.id, { platform, token, pushToken });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not register this device for calls" });
  }
});

router.delete("/devices", authenticate, async (req, res) => {
  try {
    const { platform, token } = req.body || {};
    await removeCallDevice(req.user.id, { platform, token });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Could not remove this device" });
  }
});

// The pass is the call, so it is checked before anything else, and every failure looks the
// same from outside: a wrong room, an expired pass and a forged one are all just 403.
function passFor(req) {
  const roomName = req.params.roomName;
  if (!registry.validRoom(roomName)) return null;
  const token = req.get("X-Call-Token") || (req.body && req.body.callToken) || null;
  return registry.verifyCallToken(token, roomName);
}

router.get("/:roomName/status", (req, res) => {
  const pass = passFor(req);
  if (!pass) return res.status(403).json({ error: "Not allowed" });
  const call = registry.getCall(pass.roomName);
  if (call && call.targetUserId !== pass.userId) return res.status(403).json({ error: "Not allowed" });
  res.json(registry.publicStatus(call));
});

function settle(state) {
  return (req, res) => {
    const pass = passFor(req);
    if (!pass) return res.status(403).json({ error: "Not allowed" });
    const call = registry.getCall(pass.roomName);
    if (!call || call.targetUserId !== pass.userId) return res.status(404).json({ state: "unknown" });
    const result = registry.finishCall(pass.roomName, state, pass.userId);
    if (result && result.changed) {
      // Tell the caller, exactly as the socket handlers would have.
      const event = state === "answered" ? "call_accepted" : "call_declined";
      registry.emitToUser(call.callerId, event, { roomName: call.roomName });
      // And the person's OTHER open apps, so a browser tab stops ringing too.
      registry.emitToUser(call.targetUserId, state === "answered" ? "call_answered_elsewhere" : "call_ended",
        { roomName: call.roomName });
    }
    res.json(registry.publicStatus(registry.getCall(pass.roomName)));
  };
}

router.post("/:roomName/answer", settle("answered"));
router.post("/:roomName/decline", settle("declined"));

module.exports = router;
