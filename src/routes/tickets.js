/**
 * Admin Tickets — CRUD + assignment + resolution
 * Mounted at /api/admin/tickets
 *
 * Ticket lifecycle: open → in_progress → resolved / closed
 * Sources: 'user' (from Help page), 'system' (auto-generated), 'admin' (manual)
 * Categories: visit_issue, billing, onboarding, matching, technical, safety, general
 * Priorities: urgent, high, medium, low
 */
const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ─── Role check helpers ───
// These check admin_role column: god > ops > cs > view
const ROLE_RANK = { god: 100, ops: 80, cs: 60, view: 20 };

function getAdminRole(user) {
  return user?.admin_role || (user?.is_admin ? 'god' : null);
}

function requireRole(minRole) {
  const minRank = ROLE_RANK[minRole] || 0;
  return (req, res, next) => {
    const role = getAdminRole(req.user);
    if (!role || (ROLE_RANK[role] || 0) < minRank) {
      return res.status(403).json({ error: 'Insufficient admin privileges' });
    }
    req.adminRole = role;
    next();
  };
}

// All ticket routes require authentication
router.use(authenticate);

// ─── Middleware: load admin role from DB ───
router.use(async (req, res, next) => {
  try {
    const db = await getDb();
    const u = await db.prepare("SELECT is_admin, admin_role FROM users WHERE id = ?").get(req.user.id);
    if (u) {
      req.user.is_admin = u.is_admin;
      req.user.admin_role = u.admin_role;
    }
    next();
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════
// USER-FACING: Submit a ticket (from Help page)
// Any authenticated user can submit
// ════════════════════════════════════════════

router.post("/submit", async (req, res) => {
  try {
    const db = await getDb();
    const { subject, description, category, relatedSessionId } = req.body;
    if (!subject || !subject.trim()) return res.status(400).json({ error: "Subject is required" });

    const id = uuid();
    await db.prepare(`
      INSERT INTO admin_tickets (id, subject, description, category, priority, status, reporter_user_id, related_session_id, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'medium', 'open', ?, ?, 'user', NOW(), NOW())
    `).run(id, subject.trim(), (description || '').trim(), category || 'general', req.user.id, relatedSessionId || null);

    // Log in audit
    try {
      await db.prepare(
        "INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(uuid(), req.user.id, 'ticket_created', 'ticket', id, JSON.stringify({ subject: subject.trim(), source: 'user' }));
    } catch (e) { /* audit non-critical */ }

    res.json({ ok: true, ticketId: id });
  } catch (err) {
    console.error("Ticket submit error:", err.message);
    res.status(500).json({ error: "Failed to submit ticket" });
  }
});

// User: list my tickets
router.get("/mine", async (req, res) => {
  try {
    const db = await getDb();
    const tickets = await db.prepare(`
      SELECT t.*,
        u_assigned.first_name || ' ' || u_assigned.last_name AS assigned_name
      FROM admin_tickets t
      LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.id
      WHERE t.reporter_user_id = ?
      ORDER BY t.created_at DESC
      LIMIT 50
    `).all(req.user.id);
    res.json({ tickets });
  } catch (err) {
    console.error("My tickets error:", err.message);
    res.status(500).json({ error: "Failed to load tickets" });
  }
});

// ════════════════════════════════════════════
// ADMIN: Full ticket management
// Requires cs+ role for reading, ops+ for modifying
// ════════════════════════════════════════════

// List all tickets (admin: cs+)
router.get("/", requireRole('cs'), async (req, res) => {
  try {
    const db = await getDb();
    const { status, category, priority, assignedTo, limit: lim } = req.query;

    let where = [];
    let params = [];
    if (status) { where.push("t.status = ?"); params.push(status); }
    if (category) { where.push("t.category = ?"); params.push(category); }
    if (priority) { where.push("t.priority = ?"); params.push(priority); }
    if (assignedTo) { where.push("t.assigned_to = ?"); params.push(assignedTo); }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limitVal = Math.min(parseInt(lim) || 100, 500);

    const tickets = await db.prepare(`
      SELECT t.*,
        u_reporter.first_name || ' ' || u_reporter.last_name AS reporter_name,
        u_reporter.email AS reporter_email,
        u_reporter.role AS reporter_role,
        u_assigned.first_name || ' ' || u_assigned.last_name AS assigned_name
      FROM admin_tickets t
      LEFT JOIN users u_reporter ON t.reporter_user_id = u_reporter.id
      LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.id
      ${whereClause}
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
        t.created_at DESC
      LIMIT ?
    `).all(...params, limitVal);

    // Counts by status
    const counts = await db.prepare(`
      SELECT status, COUNT(*) as count FROM admin_tickets GROUP BY status
    `).all();

    res.json({ tickets, counts });
  } catch (err) {
    console.error("List tickets error:", err.message);
    res.status(500).json({ error: "Failed to list tickets" });
  }
});

// Get single ticket with comments (admin: cs+)
router.get("/:id", requireRole('cs'), async (req, res) => {
  try {
    const db = await getDb();
    const ticket = await db.prepare(`
      SELECT t.*,
        u_reporter.first_name || ' ' || u_reporter.last_name AS reporter_name,
        u_reporter.email AS reporter_email,
        u_assigned.first_name || ' ' || u_assigned.last_name AS assigned_name
      FROM admin_tickets t
      LEFT JOIN users u_reporter ON t.reporter_user_id = u_reporter.id
      LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.id
      WHERE t.id = ?
    `).get(req.params.id);

    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    const comments = await db.prepare(`
      SELECT c.*, u.first_name || ' ' || u.last_name AS author_name, u.admin_role
      FROM admin_ticket_comments c
      JOIN users u ON c.author_id = u.id
      WHERE c.ticket_id = ?
      ORDER BY c.created_at ASC
    `).all(req.params.id);

    res.json({ ticket, comments });
  } catch (err) {
    console.error("Get ticket error:", err.message);
    res.status(500).json({ error: "Failed to load ticket" });
  }
});

// Create ticket (admin: cs+)
router.post("/", requireRole('cs'), async (req, res) => {
  try {
    const db = await getDb();
    const { subject, description, category, priority, relatedUserId, relatedSessionId, relatedSafetyFlagId, assignedTo, source } = req.body;
    if (!subject) return res.status(400).json({ error: "Subject is required" });

    const id = uuid();
    await db.prepare(`
      INSERT INTO admin_tickets (id, subject, description, category, priority, status, reporter_user_id, assigned_to, related_user_id, related_session_id, related_safety_flag_id, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `).run(id, subject, description || null, category || 'general', priority || 'medium', req.user.id, assignedTo || null, relatedUserId || null, relatedSessionId || null, relatedSafetyFlagId || null, source || 'admin');

    // Audit
    try {
      await db.prepare(
        "INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(uuid(), req.user.id, 'ticket_created', 'ticket', id, JSON.stringify({ subject, priority, source: source || 'admin' }));
    } catch (e) { /* non-critical */ }

    res.json({ ok: true, ticketId: id });
  } catch (err) {
    console.error("Create ticket error:", err.message);
    res.status(500).json({ error: "Failed to create ticket" });
  }
});

// Update ticket (admin: cs+ for comments/notes, ops+ for status/priority/assignment)
router.put("/:id", requireRole('cs'), async (req, res) => {
  try {
    const db = await getDb();
    const { status, priority, assignedTo, adminNotes, category } = req.body;
    const role = getAdminRole(req.user);
    const isOpsPlus = (ROLE_RANK[role] || 0) >= ROLE_RANK.ops;

    // CS can only update notes; ops+ can update everything
    const updates = [];
    const params = [];

    if (adminNotes !== undefined) { updates.push("admin_notes = ?"); params.push(adminNotes); }
    if (isOpsPlus) {
      if (status) {
        updates.push("status = ?"); params.push(status);
        if (status === 'resolved' || status === 'closed') {
          updates.push("resolved_at = NOW()");
        }
      }
      if (priority) { updates.push("priority = ?"); params.push(priority); }
      if (assignedTo !== undefined) { updates.push("assigned_to = ?"); params.push(assignedTo || null); }
      if (category) { updates.push("category = ?"); params.push(category); }
    } else if (status || priority || assignedTo !== undefined || category) {
      return res.status(403).json({ error: "CS role cannot change status, priority, assignment, or category" });
    }

    if (updates.length === 0) return res.status(400).json({ error: "No updates provided" });

    updates.push("updated_at = NOW()");
    params.push(req.params.id);

    await db.prepare(`UPDATE admin_tickets SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Audit
    try {
      await db.prepare(
        "INSERT INTO admin_audit_log (id, admin_user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(uuid(), req.user.id, 'ticket_updated', 'ticket', req.params.id, JSON.stringify(req.body));
    } catch (e) { /* non-critical */ }

    res.json({ ok: true });
  } catch (err) {
    console.error("Update ticket error:", err.message);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

// Add comment to ticket (admin: cs+, or ticket reporter)
router.post("/:id/comments", async (req, res) => {
  try {
    const db = await getDb();
    const { content, isInternal } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: "Content is required" });

    // Check access: admin (cs+) or the ticket reporter
    const role = getAdminRole(req.user);
    const isAdmin = role && (ROLE_RANK[role] || 0) >= ROLE_RANK.cs;

    if (!isAdmin) {
      const ticket = await db.prepare("SELECT reporter_user_id FROM admin_tickets WHERE id = ?").get(req.params.id);
      if (!ticket || ticket.reporter_user_id !== req.user.id) {
        return res.status(403).json({ error: "Not authorized to comment on this ticket" });
      }
    }

    const id = uuid();
    await db.prepare(`
      INSERT INTO admin_ticket_comments (id, ticket_id, author_id, content, is_internal, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `).run(id, req.params.id, req.user.id, content.trim(), isInternal && isAdmin ? 1 : 0);

    // Update ticket updated_at
    await db.prepare("UPDATE admin_tickets SET updated_at = NOW() WHERE id = ?").run(req.params.id);

    res.json({ ok: true, commentId: id });
  } catch (err) {
    console.error("Add comment error:", err.message);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// ════════════════════════════════════════════
// SYSTEM: Auto-create tickets from events
// Called internally from other routes/pollers
// ════════════════════════════════════════════

async function createSystemTicket({ subject, description, category, priority, relatedUserId, relatedSessionId, relatedSafetyFlagId }) {
  try {
    const db = await getDb();
    const id = uuid();
    await db.prepare(`
      INSERT INTO admin_tickets (id, subject, description, category, priority, status, source, related_user_id, related_session_id, related_safety_flag_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', 'system', ?, ?, ?, NOW(), NOW())
    `).run(id, subject, description || null, category || 'general', priority || 'medium', relatedUserId || null, relatedSessionId || null, relatedSafetyFlagId || null);
    return id;
  } catch (err) {
    console.error("System ticket creation error:", err.message);
    return null;
  }
}

// Export both router and system ticket creator
router.createSystemTicket = createSystemTicket;

module.exports = router;
