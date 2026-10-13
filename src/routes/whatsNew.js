/**
 * What's New (v1.112.4) — the splash that tells people what changed, once.
 *
 *   GET  /api/whats-new          → { entries } this person has not seen (newest first)
 *   GET  /api/whats-new?all=1    → { entries } everything in the window for their roles, seen or
 *                                  not (Help → "What's new" re-opens it)
 *   POST /api/whats-new/seen     { ids } → marks them seen
 *
 * The entries live in code (src/whatsNew/entries.js), so a release and its announcement ship in
 * the same commit and cannot drift apart.
 *
 * Who never gets the splash:
 *   • a demo account — the shared logins would mark it seen for every visitor at once, and the
 *     demo has its own orientation screen;
 *   • an admin viewing as someone else — the window is for looking; closing the splash there
 *     would mark it seen on HER account and she would never see it. GET answers empty and
 *     POST is refused.
 */
const express = require("express");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { blockWhileImpersonating, isImpersonating } = require("../middleware/noImpersonation");
const { captureException } = require("../utils/sentry");
const { careAccessFor } = require("../utils/careAccess");
const { ENTRIES, entriesFor, publicEntry } = require("../whatsNew/entries");

const router = express.Router();
router.use(authenticate);

const KNOWN_IDS = new Set(ENTRIES.map((e) => e.id));
const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

function parseSeen(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } }
  return [];
}

router.get("/", async (req, res) => {
  try {
    if (isImpersonating(req)) return res.json({ entries: [] });
    const db = await getDb();
    const u = await db.prepare("SELECT id, is_demo, created_at, whats_new_seen FROM users WHERE id = ?").get(req.user.id);
    if (!u || u.is_demo) return res.json({ entries: [] });
    const roles = req.user.roles || [req.user.role];
    let careAccess = null;
    try { careAccess = await careAccessFor(db, u.id); } catch (e) { captureException(e, { where: "whatsNew: careAccess" }); }
    const all = req.query.all === "1";
    const list = entriesFor({
      roles,
      createdAt: all ? null : u.created_at,
      seenIds: all ? [] : parseSeen(u.whats_new_seen),
      careAccess,
    });
    res.json({ entries: list.slice().sort(byDateDesc).map(publicEntry) });
  } catch (err) {
    captureException(err, { where: "GET /api/whats-new" });
    res.status(500).json({ error: "Could not load what's new" });
  }
});

router.post("/seen", blockWhileImpersonating("mark What's New as seen"), async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((id) => typeof id === "string" && KNOWN_IDS.has(id));
    if (!ids.length) return res.status(400).json({ error: "ids required" });
    const db = await getDb();
    const u = await db.prepare("SELECT whats_new_seen FROM users WHERE id = ?").get(req.user.id);
    if (!u) return res.status(404).json({ error: "Not found" });
    const merged = Array.from(new Set([...parseSeen(u.whats_new_seen), ...ids]));
    await db.prepare("UPDATE users SET whats_new_seen = ?::jsonb WHERE id = ?").run(JSON.stringify(merged), req.user.id);
    res.json({ ok: true, seen: merged });
  } catch (err) {
    captureException(err, { where: "POST /api/whats-new/seen" });
    res.status(500).json({ error: "Could not save" });
  }
});

module.exports = router;
