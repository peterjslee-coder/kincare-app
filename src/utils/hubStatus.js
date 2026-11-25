// ─── InPlace Hub status (v1.158.0) ───
//
// Pete, 11/24: "for remote management, do we need to look into that on the hub?" The Hub is a
// tablet nobody touches, so the family needs to SEE it from their phone: is it online, which
// version is it on, is it locked to InPlace, is it charging. The Hub reports every two minutes
// (RecipientPhone.js HubHeartbeat) and Hub settings shows the last report.
//
// Kept in memory on purpose: it is a live reading, not a record. A deploy clears it and the
// Hub's next report (within two minutes) fills it again. One Railway replica (CLAUDE.md
// limitation 7) — the same assumption the sockets already make.

const ONLINE_MS = 5 * 60 * 1000; // two missed reports and a margin
const _hubs = new Map();

function clean(body) {
  const b = body && typeof body === "object" ? body : {};
  const version = typeof b.version === "string" && /^[0-9][0-9.]{0,19}$/.test(b.version) ? b.version : null;
  const k = b.kiosk && typeof b.kiosk === "object" ? b.kiosk : null;
  const bat = b.battery && typeof b.battery === "object" ? b.battery : null;
  const level = bat && Number.isFinite(Number(bat.level)) ? Math.max(0, Math.min(100, Math.round(Number(bat.level)))) : null;
  const pc = ["idle", "loading", "ready", "failed"].includes(b.personCheck) ? b.personCheck : null;
  return {
    version,
    personCheck: pc, // v1.160.0 — the on-tablet person check: is it running?
    kiosk: k ? { deviceOwner: k.deviceOwner === true, locked: k.locked === true } : null,
    battery: level === null ? null : { level, charging: bat.charging === true },
  };
}

function record(recipientId, body, now = Date.now()) {
  if (!recipientId) return;
  _hubs.set(recipientId, { ...clean(body), at: now });
}

function get(recipientId, now = Date.now()) {
  const s = _hubs.get(recipientId);
  if (!s) return null;
  return { ...s, at: new Date(s.at).toISOString(), online: now - s.at < ONLINE_MS };
}

function _reset() { _hubs.clear(); }

module.exports = { record, get, clean, ONLINE_MS, _reset };
