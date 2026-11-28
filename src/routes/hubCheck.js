// ─── /api/admin/hub-check — checking what a Hub counts as "up" (v1.164.1) ───
//
// Pete, 11/26: "Don't over complicate it. Put it in admin or something behind a passkey. I can
// review there." Mounted after /api/admin, so the admin router's authentication, admin check and
// network/passkey gate run first (server.js). The rules — 7 days at most, each saved minute gone
// within 72 hours, bytes in R2 only, a "Checking" mark on the Hub — are in utils/hubReview.js.

const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { checkAdmin, logAdminAction } = require("./admin/shared");
const { captureException } = require("../utils/sentry");
const R = require("../utils/hubReview");
const D = require("../utils/dropIn");
const { parseSimpleMode } = require("../utils/simpleMode");

const router = express.Router();
router.use(authenticate, checkAdmin, requireAdmin);

async function state(db, cr) {
  const c = await R.current(db, cr.id);
  const { parseSimpleMode } = require("../utils/simpleMode");
  const hub = parseSimpleMode(cr.simple_mode).hub || {};
  return {
    id: cr.id, firstName: cr.first_name, lastName: cr.last_name || "",
    hubOn: !!hub.on, noticing: await D.mayNotice(db, cr.id),
    on: !!c, startedAt: c ? c.created_at : null, endsAt: c ? c.ends_at : null, startedBy: c ? c.signer_name : null,
    days: R.REVIEW_DAYS, hours: R.CLIP_HOURS,
  };
}

// GET / — every recipient with a Hub turned on
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(
      "SELECT id, first_name, last_name, simple_mode FROM care_recipients WHERE simple_mode IS NOT NULL AND simple_mode::text LIKE '%\"hub\"%' ORDER BY first_name"
    ).all();
    const out = [];
    for (const cr of rows) { const s = await state(db, cr); if (s.hubOn) out.push(s); }
    res.json({ hubs: out });
  } catch (err) {
    captureException(err, { where: "hubCheck: list" });
    res.status(500).json({ error: "Couldn't load the Hubs" });
  }
});

async function load(db, id) {
  return db.prepare("SELECT id, first_name, last_name, simple_mode FROM care_recipients WHERE id = ?").get(id);
}

// GET /:id — state and the saved minutes
router.get("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const cr = await load(db, req.params.id);
    if (!cr) return res.status(404).json({ error: "Not found" });
    const clips = await R.listClips(db, cr.id);
    const marks = await db.prepare("SELECT clip_id, verdict, counted, signals FROM hub_review_marks WHERE care_recipient_id = ? ORDER BY created_at").all(cr.id);
    const byClip = {};
    for (const m of marks) if (m.clip_id) byClip[m.clip_id] = m.verdict;
    for (const c of clips) c.mark = byClip[c.id] || null;
    const T = require("../utils/hubTuning");
    const tuning = parseSimpleMode(cr.simple_mode).hub.tuning || T.cleanTuning(null);
    const parsed = marks.map((m) => { let g = {}; try { g = JSON.parse(m.signals || "{}"); } catch { g = {}; } return { verdict: m.verdict, counted: !!m.counted, signals: g }; });
    res.json({ ...(await state(db, cr)), clips, tuning, defaults: T.DEFAULTS, ...T.suggestions(parsed, tuning) });
  } catch (err) {
    captureException(err, { where: "hubCheck: get" });
    res.status(500).json({ error: "Couldn't load that" });
  }
});

// POST /:id/start — turn checking on for REVIEW_DAYS
router.post("/:id/start", async (req, res) => {
  try {
    const db = await getDb();
    const cr = await load(db, req.params.id);
    if (!cr) return res.status(404).json({ error: "Not found" });
    if (!(await D.mayNotice(db, cr.id))) return res.status(409).json({ error: "Noticing is off for this Hub (drop-in consent and Notice when up)." });
    const me = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const name = `${(me && me.first_name) || ""} ${(me && me.last_name) || ""}`.trim() || "Admin";
    await R.sign(db, cr, req.user, "admin", name,
      `Turned on from Admin by ${name} to check what the Hub counts as ${cr.first_name || "them"} being up. ` +
      `For ${R.REVIEW_DAYS} days, each minute it notices something it saves one picture and about 15 seconds of sound. ` +
      `Only admins can see or play them; each is deleted when reviewed and always within ${R.CLIP_HOURS} hours. The Hub shows a "Checking" mark while it is on.`);
    await logAdminAction(req, "hub_check_started", "care_recipient", cr.id, { days: R.REVIEW_DAYS });
    await D.audit(db, cr.id, req.user.id, "hub_review_signed", `${name} turned on checking from Admin for ${R.REVIEW_DAYS} days`, { by: "admin" });
    res.status(201).json(await state(db, cr));
  } catch (err) {
    captureException(err, { where: "hubCheck: start" });
    res.status(500).json({ error: "Couldn't turn it on" });
  }
});

// POST /:id/stop — off, and everything saved is deleted
router.post("/:id/stop", async (req, res) => {
  try {
    const db = await getDb();
    const cr = await load(db, req.params.id);
    if (!cr) return res.status(404).json({ error: "Not found" });
    const deleted = await R.withdraw(db, cr.id, req.user.id);
    await logAdminAction(req, "hub_check_stopped", "care_recipient", cr.id, { deleted });
    res.json({ ...(await state(db, cr)), deleted });
  } catch (err) {
    captureException(err, { where: "hubCheck: stop" });
    res.status(500).json({ error: "Couldn't stop it" });
  }
});

// POST /:id/delete — "Reviewed — delete these"
router.post("/:id/delete", async (req, res) => {
  try {
    const db = await getDb();
    const cr = await load(db, req.params.id);
    if (!cr) return res.status(404).json({ error: "Not found" });
    const deleted = await R.deleteClips(db, cr.id);
    await logAdminAction(req, "hub_check_deleted", "care_recipient", cr.id, { deleted });
    res.json({ deleted });
  } catch (err) {
    captureException(err, { where: "hubCheck: delete" });
    res.status(500).json({ error: "Couldn't delete them" });
  }
});

// ─── v1.167.0 — marks and tuning (utils/hubTuning.js): suggest, then confirm ───
const VERDICTS = new Set(["right", "not_up", "missed"]);

// POST /:id/clips/:clipId/mark { verdict: "right" | "not_up" | "missed" | null }
router.post("/:id/clips/:clipId/mark", async (req, res) => {
  try {
    const db = await getDb();
    const clip = await db.prepare("SELECT id, counted, signals FROM hub_review_clips WHERE id = ? AND care_recipient_id = ?").get(req.params.clipId, req.params.id);
    if (!clip) return res.status(404).json({ error: "That minute was already deleted" });
    const verdict = req.body && req.body.verdict;
    const clearing = verdict === null || verdict === undefined;
    if (!clearing && !VERDICTS.has(verdict)) return res.status(400).json({ error: "Unknown mark" });
    // A minute it counted can't be "missed", and one it didn't count can't be "not up".
    if ((verdict === "missed" && clip.counted) || (verdict === "not_up" && !clip.counted)) return res.status(400).json({ error: "That mark doesn't fit this minute" });
    // Only once the new mark is known to be good does the old one go.
    await db.prepare("DELETE FROM hub_review_marks WHERE clip_id = ?").run(clip.id);
    if (clearing) return res.json({ mark: null });
    await db.prepare("INSERT INTO hub_review_marks (id, care_recipient_id, clip_id, marked_by, verdict, counted, signals) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(require("uuid").v4(), req.params.id, clip.id, req.user.id, verdict, !!clip.counted, clip.signals);
    res.json({ mark: verdict });
  } catch (err) {
    captureException(err, { where: "hubCheck: mark" });
    res.status(500).json({ error: "Couldn't save that" });
  }
});

// POST /:id/tuning { change: { personMin?, motionNearPerson?, soundNearPerson? } } | { reset: true }
router.post("/:id/tuning", async (req, res) => {
  try {
    const db = await getDb();
    const cr = await db.prepare("SELECT id, first_name, simple_mode, linked_user_id FROM care_recipients WHERE id = ?").get(req.params.id);
    if (!cr) return res.status(404).json({ error: "Not found" });
    const T = require("../utils/hubTuning");
    let v = {};
    try { v = cr.simple_mode ? JSON.parse(cr.simple_mode) : {}; } catch { v = {}; }
    v.hub = v.hub && typeof v.hub === "object" ? v.hub : {};
    const before = T.cleanTuning(v.hub.tuning);
    const change = req.body && req.body.change && typeof req.body.change === "object" ? req.body.change : {};
    const allowed = {};
    for (const k of Object.keys(T.DEFAULTS)) if (k in change) allowed[k] = change[k];
    const after = req.body && req.body.reset === true ? T.cleanTuning(null) : T.cleanTuning({ ...before, ...allowed });
    v.hub.tuning = after;
    await db.prepare("UPDATE care_recipients SET simple_mode = ?, updated_at = NOW() WHERE id = ?").run(JSON.stringify(v), cr.id);
    await logAdminAction(req, "hub_tuning_changed", "care_recipient", cr.id, { before, after });
    // The Hub reloads to pick it up (the same nudge as Refresh the Hub).
    if (cr.linked_user_id) require("../utils/callRegistry").emitToUser(cr.linked_user_id, "hub_refresh", {});
    res.json({ tuning: after });
  } catch (err) {
    captureException(err, { where: "hubCheck: tuning" });
    res.status(500).json({ error: "Couldn't change that" });
  }
});

// GET /:id/clips/:clipId/:part — the picture or the sound
router.get("/:id/clips/:clipId/:part", async (req, res) => {
  try {
    const db = await getDb();
    const col = req.params.part === "photo" ? "photo_ref" : req.params.part === "audio" ? "audio_ref" : null;
    if (!col) return res.status(404).json({ error: "Not found" });
    const row = await db.prepare(`SELECT ${col} AS ref FROM hub_review_clips WHERE id = ? AND care_recipient_id = ? AND expires_at > NOW()`).get(req.params.clipId, req.params.id);
    if (!row || !row.ref) return res.status(404).json({ error: "Not found" });
    const data = await require("../utils/storage").resolveFileData(row.ref);
    const m = data && String(data).match(/^data:([^;,]+)[^,]*;base64,(.+)$/s);
    if (!m) return res.status(404).json({ error: "Not found" });
    res.set("Content-Type", m[1]);
    res.set("Cache-Control", "private, no-store");
    res.send(Buffer.from(m[2], "base64"));
  } catch (err) {
    captureException(err, { where: "hubCheck: media" });
    res.status(500).json({ error: "Couldn't load that" });
  }
});

module.exports = router;
