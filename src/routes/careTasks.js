/**
 * Care Tasks — flexible recurring care-task engine (v1.99.0).
 *
 * Medication tracking is the first use case ("give Betty her evening
 * medication, nightly 7pm, watch her take it"), but the engine is
 * deliberately task-agnostic: bathroom visits, baths, meals, check-ins.
 *
 * Model (see Care_Tasks_Plan_2026-07-22.md):
 *  - care_tasks            → the definition (what/when/how often/who's on it)
 *  - care_task_occurrences → one row per due instance; THE record of what was
 *                            done and what wasn't. Lazily materialized here
 *                            and by the server poller (idempotent via UNIQUE).
 *  - care_task_helpers     → remembered manual "who did it" names per
 *                            recipient (people who aren't app users).
 *
 * Deliberate non-goals (legal line): no dosage advice, no interaction
 * warnings, no medical guidance of any kind. We record that care happened.
 */
const express = require("express");
const { can, CAP } = require("../utils/capabilities");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const { getTodayStringInZone, zonedDateTimeToInstant } = require("../utils/timezone");
const { isDueOn, validateTaskInput } = require("../utils/careTaskSchedule");

const router = express.Router();
router.use(authenticate);

const DEFAULT_TZ = "America/New_York";

// ─── Access control (same pattern as notes.js / careRecipients.js) ───
async function hasAccess(db, recipientId, userId) {
  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (user?.is_admin) return "admin";
  const owned = await db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(recipientId, userId);
  if (owned) return "owner";
  const shared = await db.prepare(
    "SELECT permission, capabilities FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
  ).get(recipientId, userId);
  // v1.105.78 — return the capability LIST, not the level. can() accepts either, so the
  // canManage/canCheckOff guards below work for both shapes during the transition.
  if (shared) return require("../utils/capabilities").capabilitiesFor(shared.capabilities, shared.permission);
  const teamMember = await db.prepare(`
    SELECT ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ctm.care_team_id = ct.id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
  `).get(recipientId, userId);
  if (teamMember) return teamMember.role === "leader" ? "edit" : "member";
  const assignedCg = await db.prepare(`
    SELECT cs.id FROM care_sessions cs
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    WHERE cs.care_recipient_id = ? AND cp.user_id = ?
      AND cs.status IN ('confirmed', 'in_progress')
    LIMIT 1
  `).get(recipientId, userId);
  if (assignedCg) return "member";
  return null;
}

// Manage (create/edit/pause) = owner, admin, edit/leader, or full share.
const canManage = (access) => Array.isArray(access) ? can(access, CAP.MANAGE) : ["owner", "admin", "edit", "full"].includes(access);
// Check off = anyone with access at all — any team member, shared user, or
// assigned caregiver can record that care happened (Pete's rule: "Peggy
// watched her take it, I'm logging it").
// v1.105.78 — this was `(access) => !!access`: ANY share, including a plain 'view', could tick
// off a medication task. A guard that reads like a permission check and admits everyone is the
// same shape as the vacuous predicates in v1.105.77.
//
// It now asks for the capability. The legacy mapping still grants CHECK_TASKS to 'view', so
// nobody loses access the day this ships — but a share created with the new invite UI can
// withhold it, which is the point: Peggy is granted medication tasks deliberately, Julia is not.
const canCheckOff = (caps) => can(caps, CAP.CHECK_TASKS);
const canSeeTasks = (caps) => can(caps, CAP.READ_TASKS);

// ─── Shared helpers ───

function taskTz(task, recipientTz) {
  return task.tz || recipientTz || DEFAULT_TZ;
}

// Idempotently create the occurrence row for `dateStr` if the task is due.
// v1.100.0: due_at is a TRUE instant (zonedDateTimeToInstant, not the
// shifted-frame buildDateTimeInZone) — the poller and the client both
// compare it against the real clock. The old frame-mixed value made due
// pushes fire 4h early on Railway's UTC server.
async function materializeOccurrence(db, task, recipientTz, dateStr) {
  if (!isDueOn(task, dateStr)) return;
  const tz = taskTz(task, recipientTz);
  const dueAt = zonedDateTimeToInstant(dateStr, task.due_time, tz);
  await db.prepare(`
    INSERT INTO care_task_occurrences (id, task_id, due_date, due_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (task_id, due_date) DO NOTHING
  `).run(uuid(), task.id, dateStr, dueAt.toISOString());
  // Self-heal: pending rows created before the frame fix (or after a
  // due_time edit that raced) get their due_at corrected in place.
  await db.prepare(
    "UPDATE care_task_occurrences SET due_at = ? WHERE task_id = ? AND due_date = ? AND status = 'pending' AND due_at <> ?"
  ).run(dueAt.toISOString(), task.id, dateStr, dueAt.toISOString());
}

// Care recipients this user can see tasks for (owner + shares + team member).
async function accessibleRecipients(db, userId) {
  return db.prepare(`
    SELECT DISTINCT cr.id, cr.first_name, cr.last_name, cr.family_user_id, cr.timezone
    FROM care_recipients cr
    LEFT JOIN care_recipient_shares s
      ON s.care_recipient_id = cr.id AND s.shared_with_user_id = ?
    LEFT JOIN care_teams ct ON ct.care_recipient_id = cr.id
    LEFT JOIN care_team_members ctm
      ON ctm.care_team_id = ct.id AND ctm.user_id = ?
    WHERE cr.family_user_id = ? OR s.id IS NOT NULL OR ctm.id IS NOT NULL
  `).all(userId, userId, userId);
}

// Everyone on the "team" for a recipient: the owner + care team members.
// Used for the who-did-it picker and by the poller for escalation fan-out.
async function teamUserIds(db, recipientId) {
  const rows = await db.prepare(`
    SELECT DISTINCT u.id, u.first_name, u.last_name, u.role, u.roles
    FROM users u
    WHERE u.id IN (
      SELECT family_user_id FROM care_recipients WHERE id = ?
      UNION
      SELECT ctm.user_id FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      WHERE ct.care_recipient_id = ?
      UNION
      SELECT shared_with_user_id FROM care_recipient_shares WHERE care_recipient_id = ?
    ) AND COALESCE(u.is_active, 1) = 1
  `).all(recipientId, recipientId, recipientId);
  return rows;
}

// v1.99.2 — Pete's rule (7/22): task notices are FAMILY-ONLY for now.
// Caregiver-role users can still check tasks off and be attributed, but they
// don't receive due/escalation pushes until the caregiver-side surface ships.
// A user with a family or care_for role anywhere in their roles list (e.g.
// Pete = family+caregiver) still gets notified.
function isFamilyNotifiable(member) {
  const FAMILY_ROLES = ["family", "care_for"];
  if (FAMILY_ROLES.includes(member.role)) return true;
  try {
    const roles = JSON.parse(member.roles || "[]");
    return Array.isArray(roles) && roles.some((r) => FAMILY_ROLES.includes(r));
  } catch {
    return false;
  }
}

async function helpersFor(db, recipientId) {
  return db.prepare(
    "SELECT id, name FROM care_task_helpers WHERE care_recipient_id = ? ORDER BY last_used_at DESC LIMIT 12"
  ).all(recipientId);
}

// ─── GET /api/care-tasks/today ───
// Today's occurrences across every recipient the user can access, with the
// attribution picker data (team members + remembered helpers) per recipient.
// Materializes on read so the list is correct even if the poller hasn't
// ticked since a task was created.
router.get("/today", async (req, res) => {
  try {
    const db = await getDb();
    const recipients = await accessibleRecipients(db, req.user.id);
    const groups = [];
    for (const cr of recipients) {
      const tasks = await db.prepare(
        "SELECT * FROM care_tasks WHERE care_recipient_id = ? AND is_active = 1"
      ).all(cr.id);
      if (tasks.length === 0) continue;
      const today = getTodayStringInZone(cr.timezone || DEFAULT_TZ);
      for (const t of tasks) await materializeOccurrence(db, t, cr.timezone, today);
      const occurrences = await db.prepare(`
        SELECT o.*, t.title, t.task_type, t.details, t.due_time, t.assigned_user_id,
               t.grace_minutes, au.first_name AS assignee_first_name,
               cu.first_name AS completed_by_first_name, cu.last_name AS completed_by_last_name
        FROM care_task_occurrences o
        JOIN care_tasks t ON o.task_id = t.id
        LEFT JOIN users au ON t.assigned_user_id = au.id
        LEFT JOIN users cu ON o.completed_by_user_id = cu.id
        WHERE t.care_recipient_id = ? AND o.due_date = ?
        ORDER BY o.due_at ASC
      `).all(cr.id, today);
      if (occurrences.length === 0) continue;
      groups.push({
        careRecipientId: cr.id,
        recipientName: `${cr.first_name} ${cr.last_name}`.trim(),
        recipientFirstName: cr.first_name,
        timezone: cr.timezone || DEFAULT_TZ,
        today,
        occurrences,
        teamMembers: await teamUserIds(db, cr.id),
        helpers: await helpersFor(db, cr.id),
      });
    }
    return res.json({ groups });
  } catch (err) {
    captureException(err);
    console.error("Care tasks /today error:", err.message);
    return res.status(500).json({ error: "Failed to load today's tasks" });
  }
});

// ─── GET /api/care-tasks/recipient/:recipientId ───
// Task definitions for one recipient + a 14-day adherence strip each,
// plus picker data. Powers the Care Tasks card on the recipient profile.
router.get("/recipient/:recipientId", async (req, res) => {
  try {
    const db = await getDb();
    const access = await hasAccess(db, req.params.recipientId, req.user.id);
    if (!access) return res.status(403).json({ error: "Access denied" });
    // v1.105.78 — seeing Betty's medication schedule is its own grant. A helper who is on the
    // team to leave a note and record a visit does not get the health record thrown in.
    if (!canSeeTasks(access)) return res.status(403).json({ error: "Access denied" });
    const tasks = await db.prepare(`
      SELECT t.*, au.first_name AS assignee_first_name, au.last_name AS assignee_last_name
      FROM care_tasks t
      LEFT JOIN users au ON t.assigned_user_id = au.id
      WHERE t.care_recipient_id = ?
      ORDER BY t.is_active DESC, t.due_time ASC, t.created_at ASC
    `).all(req.params.recipientId);
    for (const t of tasks) {
      t.recent = await db.prepare(`
        SELECT due_date, status, completed_by_name, completed_by_user_id
        FROM care_task_occurrences WHERE task_id = ?
        ORDER BY due_date DESC LIMIT 14
      `).all(t.id);
    }
    return res.json({
      tasks,
      canManage: canManage(access),
      teamMembers: await teamUserIds(db, req.params.recipientId),
      helpers: await helpersFor(db, req.params.recipientId),
    });
  } catch (err) {
    captureException(err);
    console.error("Care tasks list error:", err.message);
    return res.status(500).json({ error: "Failed to load tasks" });
  }
});

// ─── POST /api/care-tasks ─── create a task definition
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const { care_recipient_id } = req.body || {};
    if (!care_recipient_id) return res.status(400).json({ error: "care_recipient_id required" });
    const access = await hasAccess(db, care_recipient_id, req.user.id);
    if (!canManage(access)) return res.status(403).json({ error: "Only the family owner or care team leaders can create tasks" });

    const { errors, grace, rec, type } = validateTaskInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    if (req.body.assigned_user_id) {
      const assigneeAccess = await hasAccess(db, care_recipient_id, req.body.assigned_user_id);
      if (!assigneeAccess) return res.status(400).json({ error: "Assignee must be on the care team" });
    }

    let details = null;
    if (req.body.details && typeof req.body.details === "object") {
      details = JSON.stringify(req.body.details).slice(0, 2000);
    }

    const cr = await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(care_recipient_id);
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_tasks (id, care_recipient_id, created_by, title, task_type, details,
        recurrence, recurrence_days, due_time, tz, start_date, end_date, assigned_user_id, grace_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, care_recipient_id, req.user.id, String(req.body.title).trim(), type, details,
      rec, rec === "days" ? String(req.body.recurrence_days).toLowerCase() : null,
      req.body.due_time, cr?.timezone || null, req.body.start_date, req.body.end_date || null,
      req.body.assigned_user_id || null, grace
    );
    const task = await db.prepare("SELECT * FROM care_tasks WHERE id = ?").get(id);
    // Materialize today immediately so it shows up in Next Up without waiting
    // for the poller (but never in the past: if due_time already passed today,
    // the row is still created — pending until checked or rolled to missed).
    const today = getTodayStringInZone(taskTz(task, cr?.timezone));
    await materializeOccurrence(db, task, cr?.timezone, today);
    return res.status(201).json({ task });
  } catch (err) {
    captureException(err);
    console.error("Care task create error:", err.message);
    return res.status(500).json({ error: "Failed to create task" });
  }
});

// ─── PUT /api/care-tasks/:id ─── edit definition (never rewrites history)
router.put("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const task = await db.prepare("SELECT * FROM care_tasks WHERE id = ?").get(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    const access = await hasAccess(db, task.care_recipient_id, req.user.id);
    if (!canManage(access)) return res.status(403).json({ error: "Only the family owner or care team leaders can edit tasks" });

    const merged = { ...task, ...req.body };
    const { errors, grace, rec, type } = validateTaskInput(merged);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    if (req.body.assigned_user_id) {
      const assigneeAccess = await hasAccess(db, task.care_recipient_id, req.body.assigned_user_id);
      if (!assigneeAccess) return res.status(400).json({ error: "Assignee must be on the care team" });
    }
    let details = task.details;
    if (req.body.details !== undefined) {
      details = req.body.details && typeof req.body.details === "object"
        ? JSON.stringify(req.body.details).slice(0, 2000) : null;
    }
    const isActive = req.body.is_active === undefined ? task.is_active : (req.body.is_active ? 1 : 0);
    await db.prepare(`
      UPDATE care_tasks SET title = ?, task_type = ?, details = ?, recurrence = ?,
        recurrence_days = ?, due_time = ?, start_date = ?, end_date = ?,
        assigned_user_id = ?, grace_minutes = ?, is_active = ?, updated_at = NOW()
      WHERE id = ?
    `).run(
      String(merged.title).trim(), type, details, rec,
      rec === "days" ? String(merged.recurrence_days).toLowerCase() : null,
      merged.due_time, merged.start_date, merged.end_date || null,
      req.body.assigned_user_id === undefined ? task.assigned_user_id : (req.body.assigned_user_id || null),
      grace, isActive, task.id
    );
    const updated = await db.prepare("SELECT * FROM care_tasks WHERE id = ?").get(task.id);
    // Reflect schedule changes in today's not-yet-actioned occurrence.
    const cr = await db.prepare("SELECT timezone FROM care_recipients WHERE id = ?").get(task.care_recipient_id);
    const tz = taskTz(updated, cr?.timezone);
    const today = getTodayStringInZone(tz);
    if (updated.is_active && isDueOn(updated, today)) {
      await materializeOccurrence(db, updated, cr?.timezone, today);
      const dueAt = zonedDateTimeToInstant(today, updated.due_time, tz);
      await db.prepare(
        "UPDATE care_task_occurrences SET due_at = ? WHERE task_id = ? AND due_date = ? AND status = 'pending'"
      ).run(dueAt.toISOString(), updated.id, today);
    } else {
      // No longer due today (paused, rescheduled, or ended) — drop the
      // pending row so it doesn't linger in Next Up. Done/skipped rows stay.
      await db.prepare(
        "DELETE FROM care_task_occurrences WHERE task_id = ? AND due_date = ? AND status = 'pending'"
      ).run(updated.id, today);
    }
    return res.json({ task: updated });
  } catch (err) {
    captureException(err);
    console.error("Care task update error:", err.message);
    return res.status(500).json({ error: "Failed to update task" });
  }
});

// ─── DELETE /api/care-tasks/:id ─── deactivate (history is never deleted)
router.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const task = await db.prepare("SELECT * FROM care_tasks WHERE id = ?").get(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    const access = await hasAccess(db, task.care_recipient_id, req.user.id);
    if (!canManage(access)) return res.status(403).json({ error: "Only the family owner or care team leaders can remove tasks" });
    await db.prepare("UPDATE care_tasks SET is_active = 0, updated_at = NOW() WHERE id = ?").run(task.id);
    await db.prepare(
      "DELETE FROM care_task_occurrences WHERE task_id = ? AND status = 'pending' AND due_date >= ?"
    ).run(task.id, getTodayStringInZone(DEFAULT_TZ));
    return res.json({ success: true });
  } catch (err) {
    captureException(err);
    console.error("Care task delete error:", err.message);
    return res.status(500).json({ error: "Failed to remove task" });
  }
});

// ─── GET /api/care-tasks/:id/history?days=30 ───
router.get("/:id/history", async (req, res) => {
  try {
    const db = await getDb();
    const task = await db.prepare("SELECT * FROM care_tasks WHERE id = ?").get(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    const access = await hasAccess(db, task.care_recipient_id, req.user.id);
    if (!access) return res.status(403).json({ error: "Access denied" });
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 120);
    const occurrences = await db.prepare(`
      SELECT o.*, cu.first_name AS completed_by_first_name, cu.last_name AS completed_by_last_name,
             ru.first_name AS recorded_by_first_name
      FROM care_task_occurrences o
      LEFT JOIN users cu ON o.completed_by_user_id = cu.id
      LEFT JOIN users ru ON o.recorded_by = ru.id
      WHERE o.task_id = ? ORDER BY o.due_date DESC LIMIT ?
    `).all(task.id, days);
    return res.json({ task, occurrences });
  } catch (err) {
    captureException(err);
    console.error("Care task history error:", err.message);
    return res.status(500).json({ error: "Failed to load history" });
  }
});

// ─── POST /api/care-tasks/occurrences/:id/check ───
// The check-off. Body: { status: 'done'|'skipped', completed_by_user_id? |
// completed_by_name?, note? }. Defaults: done, by the tapper.
router.post("/occurrences/:id/check", async (req, res) => {
  try {
    const db = await getDb();
    const occ = await db.prepare(`
      SELECT o.*, t.care_recipient_id, t.title, t.task_type
      FROM care_task_occurrences o JOIN care_tasks t ON o.task_id = t.id
      WHERE o.id = ?
    `).get(req.params.id);
    if (!occ) return res.status(404).json({ error: "Occurrence not found" });
    const access = await hasAccess(db, occ.care_recipient_id, req.user.id);
    if (!canCheckOff(access)) return res.status(403).json({ error: "Access denied" });
    if (occ.status === "done" || occ.status === "skipped") {
      return res.status(409).json({ error: "Already checked off", occurrence: occ });
    }

    const status = req.body?.status === "skipped" ? "skipped" : "done";
    let byUserId = req.body?.completed_by_user_id || null;
    let byName = (req.body?.completed_by_name || "").trim().slice(0, 80) || null;
    if (byUserId && byName) byName = null; // user attribution wins
    if (!byUserId && !byName) byUserId = req.user.id; // default: the tapper did it
    if (byUserId) {
      const memberAccess = await hasAccess(db, occ.care_recipient_id, byUserId);
      if (!memberAccess) return res.status(400).json({ error: "That person isn't on the care team" });
    }
    const note = (req.body?.note || "").trim().slice(0, 1000) || null;

    await db.prepare(`
      UPDATE care_task_occurrences
      SET status = ?, completed_at = NOW(), recorded_by = ?,
          completed_by_user_id = ?, completed_by_name = ?, note = ?
      WHERE id = ?
    `).run(status, req.user.id, byUserId, byName, note, occ.id);

    // Remember manual helpers so the picker pre-fills them next time.
    if (byName) {
      await db.prepare(`
        INSERT INTO care_task_helpers (id, care_recipient_id, name)
        VALUES (?, ?, ?)
        ON CONFLICT (care_recipient_id, name) DO UPDATE SET last_used_at = NOW()
      `).run(uuid(), occ.care_recipient_id, byName);
    }

    // A free-text observation is real care-notes material — it joins the
    // ground-truth notes stream (iPAi cardinal rule: human-recorded raw data).
    // The check-off itself does NOT spam notes; the occurrence row is the record.
    if (note) {
      let who = byName;
      if (!who) {
        const u = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(byUserId);
        who = u ? `${u.first_name} ${u.last_name}`.trim() : "care team";
      }
      await db.prepare(`
        INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type)
        VALUES (?, ?, ?, ?, 'task')
      `).run(uuid(), occ.care_recipient_id, req.user.id,
        `[${occ.title}${status === "skipped" ? " — skipped" : ""}, by ${who}] ${note}`);
    }

    // Timeline event for the family owner's activity feed.
    try {
      const cr = await db.prepare("SELECT family_user_id, first_name FROM care_recipients WHERE id = ?").get(occ.care_recipient_id);
      let whoLabel = byName;
      if (!whoLabel) {
        const u = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(byUserId);
        whoLabel = u?.first_name || "Care team";
      }
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, care_recipient_id, event_type, title, message, metadata)
        VALUES (?, ?, ?, 'care_task', ?, ?, ?)
      `).run(uuid(), cr.family_user_id, occ.care_recipient_id,
        status === "done" ? `✓ ${occ.title}` : `— ${occ.title} skipped`,
        `${whoLabel} ${status === "done" ? "completed this" : "skipped this"} for ${cr.first_name}.`,
        JSON.stringify({ occurrenceId: occ.id, taskId: occ.task_id, status }));
    } catch (feedErr) { /* non-critical */ }

    const updated = await db.prepare("SELECT * FROM care_task_occurrences WHERE id = ?").get(occ.id);
    return res.json({ occurrence: updated });
  } catch (err) {
    captureException(err);
    console.error("Care task check-off error:", err.message);
    return res.status(500).json({ error: "Failed to check off task" });
  }
});

// ─── POST /api/care-tasks/occurrences/:id/undo ─── mistakes happen
router.post("/occurrences/:id/undo", async (req, res) => {
  try {
    const db = await getDb();
    const occ = await db.prepare(`
      SELECT o.*, t.care_recipient_id FROM care_task_occurrences o
      JOIN care_tasks t ON o.task_id = t.id WHERE o.id = ?
    `).get(req.params.id);
    if (!occ) return res.status(404).json({ error: "Occurrence not found" });
    const access = await hasAccess(db, occ.care_recipient_id, req.user.id);
    if (!canCheckOff(access)) return res.status(403).json({ error: "Access denied" });
    if (occ.status !== "done" && occ.status !== "skipped") {
      return res.status(409).json({ error: "Nothing to undo" });
    }
    await db.prepare(`
      UPDATE care_task_occurrences
      SET status = 'pending', completed_at = NULL, recorded_by = NULL,
          completed_by_user_id = NULL, completed_by_name = NULL, note = NULL
      WHERE id = ?
    `).run(occ.id);
    const updated = await db.prepare("SELECT * FROM care_task_occurrences WHERE id = ?").get(occ.id);
    return res.json({ occurrence: updated });
  } catch (err) {
    captureException(err);
    console.error("Care task undo error:", err.message);
    return res.status(500).json({ error: "Failed to undo" });
  }
});

// ─── Poller tick (called from server.js under guardedPoller lock 107) ───
// 1. Materialize today's occurrences for every active task.
// 2. Due-time push to the assignee (whole team if unassigned).
// 3. Grace-window escalation push to the whole team.
// 4. Roll yesterday's still-pending occurrences to 'missed'.
async function pollCareTasks(sendPushToUser) {
  const db = await getDb();
  const tasks = await db.prepare(`
    SELECT t.*, cr.timezone AS recipient_tz, cr.first_name AS recipient_first_name,
           cr.family_user_id, u.is_demo AS owner_is_demo
    FROM care_tasks t
    JOIN care_recipients cr ON t.care_recipient_id = cr.id
    LEFT JOIN users u ON cr.family_user_id = u.id
    WHERE t.is_active = 1
  `).all();

  const now = new Date();
  for (const t of tasks) {
    const tz = taskTz(t, t.recipient_tz);
    const today = getTodayStringInZone(tz);
    try {
      await materializeOccurrence(db, t, t.recipient_tz, today);

      // Missed: any pending occurrence whose due_date is before today (in
      // this task's timezone) never got checked off.
      await db.prepare(
        "UPDATE care_task_occurrences SET status = 'missed' WHERE task_id = ? AND status = 'pending' AND due_date < ?"
      ).run(t.id, today);

      const occ = await db.prepare(
        "SELECT * FROM care_task_occurrences WHERE task_id = ? AND due_date = ? AND status = 'pending'"
      ).get(t.id, today);
      if (!occ) continue;
      const dueAt = new Date(occ.due_at);
      if (now < dueAt) continue;

      // Demo hygiene: sendPushToUser already skips is_demo users, but skip
      // the whole task when the recipient's owner is demo — belt & braces.
      if (t.owner_is_demo) continue;

      const team = await teamUserIds(db, t.care_recipient_id);
      // Family-only notices (v1.99.2). If the assignee is a caregiver-only
      // user, the due push falls back to the notifiable family members so
      // the reminder never goes nowhere.
      const notifiable = team.filter(isFamilyNotifiable);
      const sent = occ.reminders_sent || "";
      const detail = (() => {
        try { const d = JSON.parse(t.details || "null"); return d?.med_name ? ` (${d.med_name}${d.dose ? `, ${d.dose}` : ""})` : ""; } catch { return ""; }
      })();
      const pushData = {
        type: "care_task_due",
        page: "dashboard",
        occurrenceId: occ.id,
        taskId: t.id,
        careRecipientId: t.care_recipient_id,
      };

      // Due-time reminder → assignee (or everyone if unassigned). Don't
      // fire for ancient rows (e.g. server was down): 6h cutoff, the row
      // still shows as pending in the app either way.
      const staleMs = 6 * 60 * 60000;
      if (!sent.includes("due") && now - dueAt < staleMs) {
        const assignee = t.assigned_user_id ? notifiable.find((m) => m.id === t.assigned_user_id) : null;
        const targets = assignee ? [assignee.id] : notifiable.map((m) => m.id);
        for (const uid of targets) {
          // v1.105.39 — `t.title` is user-authored and routinely names a condition or a
          // medication ("Evening anxiety medication"), and `detail` was literally
          // ` (med_name, dose)`. Both were rendering on locked screens. The task is still
          // one tap away; the lock screen just stops naming the drug.
          sendPushToUser(uid, {
            title: "Care task due",
            body: `Something's due now for ${t.recipient_first_name}. Tap to check it off.`,
            data: pushData,
          }, "care_task").catch(() => {});
        }
        await db.prepare("UPDATE care_task_occurrences SET reminders_sent = ? WHERE id = ?")
          .run(sent ? `${sent},due` : "due", occ.id);
        continue; // escalation waits for the next tick at the earliest
      }

      // Escalation → whole team once the grace window has passed.
      const graceMs = (t.grace_minutes ?? 45) * 60000;
      if (!sent.includes("escalated") && now - dueAt >= graceMs && now - dueAt < staleMs + graceMs) {
        for (const m of notifiable) {
          // v1.105.39 — same: the title named the medication.
          sendPushToUser(m.id, {
            title: "Care task not checked off",
            body: `${t.recipient_first_name}'s ${occ.due_date} task hasn't been checked off. Can anyone confirm it happened?`,
            data: pushData,
          }, "care_task").catch(() => {});
        }
        await db.prepare("UPDATE care_task_occurrences SET reminders_sent = ? WHERE id = ?")
          .run(sent ? `${sent},escalated` : "escalated", occ.id);
      }
    } catch (taskErr) {
      // One bad task must never stall the rest of the loop.
      console.error(`  Care task poller error (task ${t.id}):`, taskErr.message);
    }
  }
}

module.exports = router;
module.exports.pollCareTasks = pollCareTasks;
// Shared access/team helpers — reused by careEvents.js (v1.100.0) so the
// access model stays defined in exactly one place.
module.exports._shared = { hasAccess, canManage, accessibleRecipients, teamUserIds, isFamilyNotifiable };
