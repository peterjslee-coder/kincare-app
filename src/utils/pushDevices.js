// ─── What kind of device is behind a push subscription (v1.105.151) ───
//
// subscribe-native writes a synthetic endpoint, `native://<platform>/<token>`; Web Push
// writes whatever URL the browser's push service handed over. That string is the only place
// the kind is recorded, so the parsing of it must live in ONE function — it is now read by
// the admin reachability view, by /api/push/status, and by the client's push self-repair, and
// three copies of a regex is three chances for them to disagree about whether someone's phone
// is registered.
function deviceKind(endpoint) {
  const m = String(endpoint || "").match(/^native:\/\/([a-z]+)\//i);
  return m ? m[1].toLowerCase() : "web";
}

module.exports = { deviceKind };
