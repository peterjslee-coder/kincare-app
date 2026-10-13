/**
 * One-time to-dos — "for the next visit" (v1.109.9, feedback e4cd314a).
 *
 * Pete: "The task function. It's set up like everything is recurring. There needs to be a to-do
 * option… Something that reminds the next person that shows up at her house to accomplish a
 * task. Like, I need to lock her stove against the wall. It doesn't have a time, it doesn't have
 * to be me, but somebody needs to do it when they're there. It would appear to the same people
 * that look at the other tasks like medications, but not be accomplished in the same way."
 *
 * So, deliberately, NOT a care task:
 *   • no due time, no owner, no recurrence — nothing to be late for, so no missed/overdue state,
 *     no adherence strip, no reminder push, no Needs-you row (it is nobody's blocker);
 *   • its own table (care_todos, migration 052), so the recurrence engine, the 107 poller and
 *     the nightly roll to 'missed' cannot see it at all — not "filtered out", absent;
 *   • done ONCE, by anyone on the team or by the caregiver on today's visit, recording who and
 *     when, with an optional note. Undo is allowed. A second "done" is 409 — already answered.
 *
 * Audience = the care-task audience, reusing careTasks.js's own guards:
 *   • a family/team member who may READ tasks sees them; one who may CHECK tasks can add and
 *     finish them;
 *   • a caregiver sees them only while she is the visit — booked today or in progress
 *     (accessibleRecipients' viaVisit rows). She can finish one, not add or remove one.
 */
const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { blockWhileImpersonating } = require("../middleware/noImpersonation");
const { captureException } = require("../utils/sentry");
const { _shared } = require("./careTasks");

const { hasAccess, canManage, canCheckOff, canSeeTasks, accessibleRecipients } = _shared;

const router = express.Router();
router.use(authenticate);

const TITLE_MAX = 200;
const DETAILS_MAX = 2000;
const NOTE_MAX = 1000;
const DONE_SHOWN = 20;

/**
 * What this user may do with to-dos for each person they can reach.
 * @returns {Promise<Map<string, {recipient:object, viaVisit:boolean, canSee:boolean, canDo:boolean, canAdd:boolean, canRemove:boolean}>>}
 */
async function todoAccess(db, userId) {
  const out = new Map();
  for (const cr of await accessibleRecipients(db, userId)) {
    if (cr.viaVisit) {
      out.set(cr.id, { recipient: cr, viaVisit: true, canSee: true, canDo: true, canAdd: false, canRemove: false });
      continue;
    }
    const access = await hasAccess(db, cr.id, userId);
    const see = !!access && canSeeTasks(access);
    if (!see) continue;
    const check = canCheckOff(access);
    out.set(cr.id, { recipient: cr, viaVisit: false, canSee: true, canDo: check, canAdd: check, canRemove: canManage(access) });
  }
  return out;
}

const ROW_SQL = `
  SELECT td.id, td.care_recipient_id, td.title, td.details, td.created_at, td.created_by,
         td.completed_at, td.completed_by_user_id, td.completion_note,
         cb.first_name AS created_by_first_name,
         du.first_name AS completed_by_first_name, du.last_name AS completed_by_last_name
  FROM care_todos td
  LEFT JOIN users cb ON cb.id = td.created_by
  LEFT JOIN users du ON du.id = td.completed_by_user_id
`;

async function loadTodo(db, id) {
  return db.prepare(`${ROW_SQL} WHERE td.id = ? AND td.removed_at IS NULL`).get(id);
}

// ─── GET /api/care-todos[?recipientId=] ───
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const access = await todoAccess(db, req.user.id);
    const only = req.query.recipientId ? String(req.query.recipientId) : null;
    if (only && !access.has(only)) return res.status(403).json({ error: "Access denied" });
    const groups = [];
    for (const [rid, a] of access) {
      if (only && rid !== only) continue;
      const open = await db.prepare(
        `${ROW_SQL} WHERE td.care_recipient_id = ? AND td.removed_at IS NULL AND td.completed_at IS NULL ORDER BY td.created_at ASC`
      ).all(rid);
      const done = await db.prepare(
        `${ROW_SQL} WHERE td.care_recipient_id = ? AND td.removed_at IS NULL AND td.completed_at IS NOT NULL
         ORDER BY td.completed_at DESC LIMIT ${DONE_SHOWN}`
      ).all(rid);
      // Without a filter, only people who have something: the dashboard does not need an empty
      // card per relative. With one, the group comes back anyway so the profile can offer "Add".
      if (!only && open.length === 0 && done.length === 0) continue;
      groups.push({
        careRecipientId: rid,
        recipientFirstName: a.recipient.first_name || null,
        viaVisit: a.viaVisit,
        canAdd: a.canAdd,
        canDo: a.canDo,
        canRemove: a.canRemove,
        open,
        done,
      });
    }
    return res.json({ groups });
  } catch (err) {
    captureException(err);
    console.error("Care to-dos list error:", err.message);
    return res.status(500).json({ error: "Failed to load to-dos" });
  }
});

// ─── POST /api/care-todos ─── { care_recipient_id, title, details? }
router.post("/", blockWhileImpersonating("add a to-do"), async (req, res) => {
  try {
    const db = await getDb();
    const rid = req.body?.care_recipient_id ? String(req.body.care_recipient_id) : null;
    if (!rid) return res.status(400).json({ error: "care_recipient_id required" });
    const a = (await todoAccess(db, req.user.id)).get(rid);
    if (!a) return res.status(403).json({ error: "Access denied" });
    if (!a.canAdd) return res.status(403).json({ error: "Only the care team can add to-dos" });
    const title = String(req.body?.title || "").trim().slice(0, TITLE_MAX);
    if (!title) return res.status(400).json({ error: "What needs doing?" });
    const details = String(req.body?.details || "").trim().slice(0, DETAILS_MAX) || null;
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_todos (id, care_recipient_id, created_by, title, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, rid, req.user.id, title, details);
    return res.status(201).json({ todo: await loadTodo(db, id) });
  } catch (err) {
    captureException(err);
    console.error("Care to-do create error:", err.message);
    return res.status(500).json({ error: "Failed to add the to-do" });
  }
});

// ─── POST /api/care-todos/:id/done ─── { note? }
router.post("/:id/done", blockWhileImpersonating("finish a to-do"), async (req, res) => {
  try {
    const db = await getDb();
    const todo = await loadTodo(db, req.params.id);
    if (!todo) return res.status(404).json({ error: "To-do not found" });
    const a = (await todoAccess(db, req.user.id)).get(todo.care_recipient_id);
    if (!a) return res.status(404).json({ error: "To-do not found" });
    if (!a.canDo) return res.status(403).json({ error: "Access denied" });
    if (todo.completed_at) return res.status(409).json({ error: "Already done", todo });
    const note = String(req.body?.note || "").trim().slice(0, NOTE_MAX) || null;
    // Conditional, so two people tapping at once get one record and one 409 — never a silent
    // overwrite of who did it.
    const upd = await db.prepare(`
      UPDATE care_todos SET completed_at = NOW(), completed_by_user_id = ?, completion_note = ?, updated_at = NOW()
      WHERE id = ? AND completed_at IS NULL AND removed_at IS NULL
    `).run(req.user.id, note, todo.id);
    if (!upd || upd.changes !== 1) {
      return res.status(409).json({ error: "Already done", todo: await loadTodo(db, todo.id) });
    }
    return res.json({ todo: await loadTodo(db, todo.id) });
  } catch (err) {
    captureException(err);
    console.error("Care to-do done error:", err.message);
    return res.status(500).json({ error: "Failed to mark it done" });
  }
});

// ─── POST /api/care-todos/:id/undo ───
router.post("/:id/undo", blockWhileImpersonating("undo a to-do"), async (req, res) => {
  try {
    const db = await getDb();
    const todo = await loadTodo(db, req.params.id);
    if (!todo) return res.status(404).json({ error: "To-do not found" });
    const a = (await todoAccess(db, req.user.id)).get(todo.care_recipient_id);
    if (!a) return res.status(404).json({ error: "To-do not found" });
    if (!a.canDo) return res.status(403).json({ error: "Access denied" });
    if (!todo.completed_at) return res.status(409).json({ error: "Not done yet", todo });
    // The visiting caregiver can take back her own tick, not the family's.
    if (a.viaVisit && todo.completed_by_user_id !== req.user.id) {
      return res.status(403).json({ error: "Only the person who finished it, or the care team, can undo it" });
    }
    await db.prepare(`
      UPDATE care_todos SET completed_at = NULL, completed_by_user_id = NULL, completion_note = NULL, updated_at = NOW()
      WHERE id = ?
    `).run(todo.id);
    return res.json({ todo: await loadTodo(db, todo.id) });
  } catch (err) {
    captureException(err);
    console.error("Care to-do undo error:", err.message);
    return res.status(500).json({ error: "Failed to undo" });
  }
});

// ─── DELETE /api/care-todos/:id ─── the person who added it, or a manager
router.delete("/:id", blockWhileImpersonating("remove a to-do"), async (req, res) => {
  try {
    const db = await getDb();
    const todo = await loadTodo(db, req.params.id);
    if (!todo) return res.status(404).json({ error: "To-do not found" });
    const a = (await todoAccess(db, req.user.id)).get(todo.care_recipient_id);
    if (!a) return res.status(404).json({ error: "To-do not found" });
    const mine = !a.viaVisit && todo.created_by === req.user.id;
    if (!mine && !a.canRemove) return res.status(403).json({ error: "Only the person who added it, or the care team leader, can remove it" });
    // Kept, not deleted: a finished to-do is a record of who did what.
    await db.prepare(
      "UPDATE care_todos SET removed_at = NOW(), removed_by = ?, updated_at = NOW() WHERE id = ? AND removed_at IS NULL"
    ).run(req.user.id, todo.id);
    return res.json({ success: true });
  } catch (err) {
    captureException(err);
    console.error("Care to-do remove error:", err.message);
    return res.status(500).json({ error: "Failed to remove the to-do" });
  }
});

module.exports = router;
module.exports._todoAccess = todoAccess;
