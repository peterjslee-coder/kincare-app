// ─── /api/series-changes (v1.139.0) — change a whole series, pay included ───
// The rules live in src/utils/seriesChange.js. This file is who may, and who is told.

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const SC = require("../utils/seriesChange");

const router = express.Router();
router.use(authenticate);

async function loadSession(db, id) {
  return db.prepare(`
    SELECT cs.*, cr.family_user_id AS owner_id, cr.first_name AS recipient_first, cr.timezone AS tz
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
     WHERE cs.id = ?
  `).get(id);
}

/** Family who can schedule for her — the same people who can edit a request. */
async function mayChange(db, session, userId) {
  if (!session) return false;
  if (userId === session.owner_id || userId === session.family_user_id) return true;
  const { recipientCapabilities } = require("../utils/access");
  const { can, CAP } = require("../utils/capabilities");
  try { return can(await recipientCapabilities(db, session.care_recipient_id, userId), CAP.SCHEDULE_EVENTS); } catch { return false; }
}

function baselineOf(rows) {
  const s = rows[0];
  if (!s) return null;
  return {
    time: String(s.scheduled_time || "").slice(0, 5),
    durationHours: Number(s.duration_hours) || null,
    rate: SC.currentRate(s),
    instructions: s.special_instructions || "",
  };
}

function groupByCaregiver(taken) {
  const by = new Map();
  for (const s of taken) {
    if (!by.has(s.caregiver_id)) by.set(s.caregiver_id, { caregiverId: s.caregiver_id, userId: s.caregiver_user_id, first: s.caregiver_first, last: s.caregiver_last, rows: [] });
    by.get(s.caregiver_id).rows.push(s);
  }
  return [...by.values()];
}

// GET /api/series-changes/preview/:sessionId — what the form opens with
router.get("/preview/:sessionId", async (req, res) => {
  try {
    const db = await getDb();
    const session = await loadSession(db, req.params.sessionId);
    if (!session || !(await mayChange(db, session, req.user.id))) return res.status(404).json({ error: "Visit not found" });
    if (!session.recurrence_group_id) return res.status(400).json({ error: "This visit isn't part of a series." });
    const { open, taken } = await SC.seriesTargets(db, session);
    const pending = await db.prepare(
      "SELECT id, caregiver_user_id FROM series_change_requests WHERE recurrence_group_id = ? AND status = 'pending'"
    ).all(session.recurrence_group_id);
    res.json({
      fromDate: String(session.scheduled_date).slice(0, 10),
      current: baselineOf([session]),
      open: open.length,
      caregivers: groupByCaregiver(taken).map((g) => ({
        caregiverId: g.caregiverId, name: [g.first, g.last].filter(Boolean).join(" "), first: g.first, count: g.rows.length,
        pendingRequestId: (pending.find((p) => p.caregiver_user_id === g.userId) || {}).id || null,
      })),
      dates: [...open, ...taken].map((s) => String(s.scheduled_date).slice(0, 10)).sort(),
    });
  } catch (err) {
    captureException(err, { where: "seriesChanges: preview" });
    console.error("[seriesChanges] preview:", err.message);
    res.status(500).json({ error: "Could not load the series" });
  }
});

// POST /api/series-changes { sessionId, time?, durationHours?, rate?, instructions? }
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const session = await loadSession(db, String((req.body || {}).sessionId || ""));
    if (!session || !(await mayChange(db, session, req.user.id))) return res.status(404).json({ error: "Visit not found" });
    if (!session.recurrence_group_id) return res.status(400).json({ error: "This visit isn't part of a series." });
    const norm = SC.normalizeChanges(req.body);
    if (norm.error) return res.status(400).json({ error: norm.error });
    const changes = norm.changes;
    if (!Object.keys(changes).length) return res.status(400).json({ error: "Nothing to change." });

    const { open, taken } = await SC.seriesTargets(db, session);
    const groups = groupByCaregiver(taken)
      .map((g) => ({ ...g, rows: g.rows.filter((s) => Object.keys(SC.effectiveChanges(changes, s)).length) }))
      .filter((g) => g.rows.length);
    const openChanged = open.filter((s) => Object.keys(SC.effectiveChanges(changes, s)).length);
    if (!groups.length && !openChanged.length) return res.status(400).json({ error: "Those are already the details of every visit." });

    const requests = [];
    let release = [];
    await db.transaction(async (tx) => {
      release = await SC.applyTo(tx, openChanged, changes, { taken: false });
      for (const g of groups) {
        // One pending request per caregiver per series: a newer one replaces the older.
        await tx.prepare(`
          UPDATE series_change_requests SET status = 'withdrawn', responded_at = NOW()
           WHERE recurrence_group_id = ? AND caregiver_id = ? AND status = 'pending'
        `).run(session.recurrence_group_id, g.caregiverId);
        const id = uuid();
        await tx.prepare(`
          INSERT INTO series_change_requests (id, recurrence_group_id, care_recipient_id, caregiver_id, caregiver_user_id,
            proposed_by_user_id, changes, session_ids)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, session.recurrence_group_id, session.care_recipient_id, g.caregiverId, g.userId,
          req.user.id, JSON.stringify(changes), JSON.stringify(g.rows.map((s) => s.id)));
        requests.push({ id, caregiver: g });
      }
    });
    await SC.releaseHolds(db, release, captureException);

    const { sendPushToUser } = require("./push");
    const me = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
    for (const r of requests) {
      const what = SC.describe(SC.effectiveChanges(changes, r.caregiver.rows[0]), r.caregiver.rows[0]);
      sendPushToUser(r.caregiver.userId, {
        title: "A change to your visits",
        body: `${(me && me.first_name) || "The family"} would like to change ${r.caregiver.rows.length} of ${session.recipient_first || "their"}${session.recipient_first ? "'s" : ""} visits: ${what.join(", ")}. Tap to accept or keep them as they are.`,
        data: { type: "series_change", requestId: r.id, page: "dashboard" },
      }, "time_change").catch(() => {});
    }

    res.json({
      changedNow: openChanged.length,
      asked: requests.map((r) => ({ id: r.id, caregiver: r.caregiver.first, count: r.caregiver.rows.length })),
    });
  } catch (err) {
    captureException(err, { where: "seriesChanges: create" });
    console.error("[seriesChanges] create:", err.message);
    res.status(500).json({ error: "Could not change the series" });
  }
});

async function loadRequest(db, id) {
  const r = await db.prepare(`
    SELECT r.*, cr.first_name AS recipient_first, u.first_name AS family_first,
           cu.first_name AS caregiver_first
      FROM series_change_requests r
      LEFT JOIN care_recipients cr ON r.care_recipient_id = cr.id
      LEFT JOIN users u ON r.proposed_by_user_id = u.id
      LEFT JOIN users cu ON r.caregiver_user_id = cu.id
     WHERE r.id = ?
  `).get(id);
  if (!r) return null;
  try { r.changesObj = JSON.parse(r.changes); } catch { r.changesObj = {}; }
  try { r.ids = JSON.parse(r.session_ids); } catch { r.ids = []; }
  return r;
}

/** The visits a request still covers: hers, confirmed, not started. */
async function liveRows(db, r) {
  if (!r.ids.length) return [];
  const rows = await db.prepare(`
    SELECT cs.* FROM care_sessions cs
     WHERE cs.id IN (${r.ids.map(() => "?").join(",")}) AND cs.caregiver_id = ?
       AND cs.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM visit_logs vl WHERE vl.session_id = cs.id AND vl.check_in_time IS NOT NULL)
     ORDER BY cs.scheduled_date, cs.scheduled_time
  `).all(...r.ids, r.caregiver_id);
  return rows;
}

// GET /api/series-changes/:id — the request, for either side
router.get("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const r = await loadRequest(db, req.params.id);
    if (!r) return res.status(404).json({ error: "Not found" });
    const isCg = r.caregiver_user_id === req.user.id;
    const session = r.ids.length ? await loadSession(db, r.ids[0]) : null;
    if (!isCg && !(await mayChange(db, session, req.user.id))) return res.status(404).json({ error: "Not found" });
    const rows = await liveRows(db, r);
    res.json({
      id: r.id, status: r.status, recipientFirst: r.recipient_first, familyFirst: r.family_first, caregiverFirst: r.caregiver_first,
      changes: r.changesObj,
      lines: rows[0] ? SC.describe(SC.effectiveChanges(r.changesObj, rows[0]), rows[0]) : [],
      dates: rows.map((s) => String(s.scheduled_date).slice(0, 10)),
      instructions: r.changesObj.instructions != null ? r.changesObj.instructions : null,
      canRespond: isCg && r.status === "pending",
    });
  } catch (err) {
    captureException(err, { where: "seriesChanges: get" });
    console.error("[seriesChanges] get:", err.message);
    res.status(500).json({ error: "Could not load that" });
  }
});

// PUT /api/series-changes/:id/respond { accept: true|false } — the caregiver
router.put("/:id/respond", async (req, res) => {
  try {
    const db = await getDb();
    const r = await loadRequest(db, req.params.id);
    if (!r || r.caregiver_user_id !== req.user.id) return res.status(404).json({ error: "Not found" });
    const accept = !!(req.body && req.body.accept);
    if (r.status !== "pending") {
      const same = (accept && r.status === "accepted") || (!accept && r.status === "declined");
      return res.status(409).json({ error: same ? `Already ${r.status}` : `This change was ${r.status}`, code: "ALREADY_RESPONDED", status: r.status });
    }
    let release = [];
    let changed = 0;
    await db.transaction(async (tx) => {
      // Claim it first, so two taps can't apply it twice.
      const claim = await tx.prepare(
        "UPDATE series_change_requests SET status = ?, responded_at = NOW() WHERE id = ? AND status = 'pending'"
      ).run(accept ? "accepted" : "declined", r.id);
      if (!((claim && (claim.changes ?? claim.rowCount)) > 0)) return;
      if (accept) {
        const rows = await liveRows(tx, r);
        changed = rows.length;
        release = await SC.applyTo(tx, rows, r.changesObj, { taken: true });
      }
    });
    await SC.releaseHolds(db, release, captureException);

    const { sendPushToUser } = require("./push");
    const whose = r.recipient_first ? `${r.recipient_first}'s` : "the";
    sendPushToUser(r.proposed_by_user_id, {
      title: accept ? "Change accepted" : "Change declined",
      body: accept
        ? `${r.caregiver_first || "Your caregiver"} accepted the change to ${changed} of ${whose} visits.`
        : `${r.caregiver_first || "Your caregiver"} kept ${whose} visits as they were — same time, length and pay.`,
      data: { type: "series_change_answered", requestId: r.id, page: "schedule" },
    }, "time_change").catch(() => {});
    res.json({ status: accept ? "accepted" : "declined", changed });
  } catch (err) {
    captureException(err, { where: "seriesChanges: respond" });
    console.error("[seriesChanges] respond:", err.message);
    res.status(500).json({ error: "Could not answer that" });
  }
});

// PUT /api/series-changes/:id/withdraw — the family takes it back
router.put("/:id/withdraw", async (req, res) => {
  try {
    const db = await getDb();
    const r = await loadRequest(db, req.params.id);
    const session = r && r.ids.length ? await loadSession(db, r.ids[0]) : null;
    if (!r || !(await mayChange(db, session, req.user.id))) return res.status(404).json({ error: "Not found" });
    await db.prepare("UPDATE series_change_requests SET status = 'withdrawn', responded_at = NOW() WHERE id = ? AND status = 'pending'").run(r.id);
    res.json({ status: "withdrawn" });
  } catch (err) {
    captureException(err, { where: "seriesChanges: withdraw" });
    console.error("[seriesChanges] withdraw:", err.message);
    res.status(500).json({ error: "Could not withdraw that" });
  }
});

module.exports = router;
