// ─── Calls that are ringing, and what happened to them (calls-native, 1.3) ───
//
// Until now a call existed only as socket events flying between two open apps. Nothing on the
// server knew a call was ringing, so nothing could answer the questions a phone ringing on a
// lock screen has to ask:
//
//   - Is this call still ringing, or did the caller give up while I was reaching for it?
//   - Did I already answer it on my other device?
//   - The person tapped Decline on the lock screen. The app is not running. Who tells the caller?
//
// CallKit (iOS) and the full-screen call notification (Android) ask those questions from NATIVE
// code, often before the web view has loaded, so they cannot use the socket or the user's login.
// Each ring therefore mints a short-lived signed pass — the `callToken` — that names exactly one
// room and one person and is good only for that call. It rides in the VoIP push; the native side
// presents it to /api/calls/:roomName/{status,answer,decline}. It authorises nothing else.
//
// In-process on purpose: calls live for a minute, and this server runs one replica (CLAUDE.md,
// Known limitations 7). A second replica breaks this the same way it breaks socket fan-out.

const crypto = require("crypto");

const RING_MS = 45 * 1000;          // a call nobody answers is missed after this
const KEEP_MS = 10 * 60 * 1000;     // how long a finished call stays answerable for status checks
const TOKEN_MS = 2 * 60 * 1000;     // a callToken outlives the ring a little: answer near the end must still work
const ROOM_RE = /^[A-Za-z0-9_-]{1,128}$/;

const _calls = new Map(); // roomName -> call

// A secret of its own, derived from the JWT secret so there is nothing new to configure, and
// separate so a callToken can never be confused with — or replayed as — a login token.
let _secret = null;
function secret() {
  if (_secret) return _secret;
  const base = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
  _secret = crypto.createHmac("sha256", base).update("inplace-call-token-v1").digest();
  return _secret;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signCallToken(roomName, userId, now = Date.now()) {
  const body = b64url(JSON.stringify({ r: roomName, u: userId, e: now + TOKEN_MS }));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

// Returns { roomName, userId } or null. Constant-time on the signature.
function verifyCallToken(token, roomName, now = Date.now()) {
  if (typeof token !== "string" || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); }
  catch { return null; }
  if (!claims || claims.r !== roomName || !claims.u || !(claims.e > now)) return null;
  return { roomName: claims.r, userId: claims.u };
}

function sweep(now = Date.now()) {
  for (const [room, c] of _calls) {
    if (c.state === "ringing" && now - c.startedAt > RING_MS) { c.state = "missed"; c.endedAt = now; }
    if (c.state !== "ringing" && now - (c.endedAt || c.startedAt) > KEEP_MS) _calls.delete(room);
  }
}

function validRoom(roomName) { return typeof roomName === "string" && ROOM_RE.test(roomName); }

// A new ring. A second invite to the same room (a retry) replaces the first.
function startCall({ roomName, callerId, callerName, targetUserId, callType }, now = Date.now()) {
  sweep(now);
  if (!validRoom(roomName)) return null;
  const call = {
    roomName, callerId, callerName: callerName || "InPlace", targetUserId,
    callType: callType === "video" ? "video" : "audio",
    // CallKit identifies a call by UUID; one per ring, so a retried ring is a new call to iOS.
    callUuid: crypto.randomUUID(),
    state: "ringing", startedAt: now, endedAt: null, endedBy: null,
  };
  _calls.set(roomName, call);
  return call;
}

function getCall(roomName, now = Date.now()) {
  sweep(now);
  return _calls.get(roomName) || null;
}

// Moves a ringing call to a final state. Only from "ringing": a call that was already answered
// cannot then be declined from a second device, and a missed call cannot be answered late.
// Hang-up is the exception — it ends an answered call too.
function finishCall(roomName, state, byUserId, now = Date.now()) {
  const call = getCall(roomName, now);
  if (!call) return null;
  const from = call.state;
  if (state === "ended") {
    if (from !== "ringing" && from !== "answered") return { call, changed: false };
  } else if (from !== "ringing") {
    return { call, changed: false };
  }
  call.state = state;
  call.endedAt = now;
  call.endedBy = byUserId || null;
  return { call, changed: true, from };
}

// What the native side needs to decide whether to keep ringing.
function publicStatus(call) {
  if (!call) return { state: "unknown" };
  return { state: call.state, callType: call.callType, callerName: call.callerName, startedAt: call.startedAt };
}

// server.js owns the sockets; it hands over a way to reach a user's open apps so that an
// answer or decline arriving over HTTP (from native code, no socket) still reaches the caller.
let _emitToUser = () => 0;
function setEmitter(fn) { if (typeof fn === "function") _emitToUser = fn; }
function emitToUser(userId, event, payload) {
  try { return _emitToUser(userId, event, payload) || 0; } catch { return 0; }
}

function _reset() { _calls.clear(); _secret = null; }

module.exports = {
  RING_MS, TOKEN_MS,
  validRoom, startCall, getCall, finishCall, publicStatus,
  signCallToken, verifyCallToken,
  setEmitter, emitToUser,
  _reset,
};
