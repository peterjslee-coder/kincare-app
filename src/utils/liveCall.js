// ─── Is she in a call right now? (v1.165.0) ───
//
// Pete, 11/26: "Can I see if she's currently in a call?"
//
// The call registry (utils/callRegistry.js) knows rings, not conversations: it forgets an
// answered call 10 minutes after it was answered, and a drop-in or a closed app never says
// "ended". The one place that knows who is connected right now is Twilio, where every call is a
// Video room and every participant's identity is their InPlace user id (routes/videoCall.js).
// So we ask Twilio: the in-progress rooms, then each room's connected participants.
//
// One snapshot serves everyone for SNAPSHOT_MS, so a screen that asks every few seconds costs
// at most a few Twilio requests a minute. If Twilio can't be asked, the answer is "unknown",
// never "not in a call".

const SNAPSHOT_MS = 15 * 1000;
const TIMEOUT_MS = 5000;
let _snap = null; // { at, rooms: [{ sid, name, createdAt, identities: [{ id, since }] }] }
let _inflight = null;

function client() {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_API_KEY_SID: key, TWILIO_API_KEY_SECRET: secret } = process.env;
  if (!accountSid || !key || !secret) return null;
  return require("twilio")(key, secret, { accountSid });
}

const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("twilio timeout")), TIMEOUT_MS))]);

async function snapshot(now = Date.now(), tw = client()) {
  if (_snap && now - _snap.at < SNAPSHOT_MS) return _snap;
  if (_inflight) return _inflight;
  if (!tw) return null;
  _inflight = (async () => {
    try {
      const rooms = await withTimeout(tw.video.v1.rooms.list({ status: "in-progress", limit: 50 }));
      const out = [];
      for (const r of rooms) {
        const ps = await withTimeout(tw.video.v1.rooms(r.sid).participants.list({ status: "connected", limit: 20 }));
        out.push({
          sid: r.sid, name: r.uniqueName, createdAt: r.dateCreated,
          identities: ps.map((p) => ({ id: p.identity, since: p.startTime || p.dateCreated || null })),
        });
      }
      _snap = { at: now, rooms: out };
      return _snap;
    } catch (e) {
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/**
 * → { inCall: true, since, withIds: [...] } | { inCall: false } | { inCall: null } (couldn't tell)
 * A room where she is the only one connected (calling out, nobody picked up yet) is not a call.
 */
async function callFor(userId, opts = {}) {
  const s = await snapshot(opts.now, opts.client === undefined ? client() : opts.client);
  if (!s) return { inCall: null };
  for (const r of s.rooms) {
    const me = r.identities.find((x) => x.id === userId);
    if (!me) continue;
    const others = r.identities.filter((x) => x.id !== userId).map((x) => x.id);
    if (!others.length) continue;
    return { inCall: true, since: me.since || r.createdAt || null, withIds: others };
  }
  return { inCall: false };
}

const _reset = () => { _snap = null; _inflight = null; };

module.exports = { callFor, snapshot, SNAPSHOT_MS, _reset };
