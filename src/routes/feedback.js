const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ─── POST /api/feedback/anonymous ───
// Submit feedback without authentication (splash/demo visitors)
router.post("/anonymous", async (req, res) => {
  const db = await getDb();
  const { category, description, mood, screenshot, pageContext } = req.body;

  if (!category || !description || description.trim().length < 10) {
    return res.status(400).json({ error: "Category and description (10+ chars) are required" });
  }

  const validCategories = ['bug', 'feature', 'general', 'complaint', 'praise'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: "Invalid category" });
  }

  // Limit screenshot size (2MB base64)
  if (screenshot && screenshot.length > 2 * 1024 * 1024) {
    return res.status(400).json({ error: "Screenshot too large (max 2MB)" });
  }

  const id = uuid();
  try {
    await db.prepare(`
      INSERT INTO feedback (id, user_id, category, description, mood, screenshot, page_context, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NOW(), NOW())
    `).run(id, null, category, description.trim(), mood || null, screenshot || null, pageContext ? JSON.stringify(pageContext) : null);

    // Push notification to admin (with "Anonymous" as userName)
    try {
      const emitToUser = req.app.get("emitToUser");
      const adminUser = await db.prepare("SELECT id FROM users WHERE is_admin = 1 LIMIT 1").get();
      if (adminUser && emitToUser) {
        emitToUser(adminUser.id, "new_feedback", { id, category, description: description.trim().substring(0, 100), userName: "Anonymous" });
      }
    } catch (pushErr) { console.error("Feedback push error:", pushErr); }

    res.status(201).json({ id, message: "Feedback submitted — thank you!" });
  } catch (err) {
    console.error("Submit anonymous feedback error:", err);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

// All other routes require auth
router.use(authenticate);

// ─── POST /api/feedback ───
// Submit feedback (any authenticated user)
router.post("/", async (req, res) => {
  const db = await getDb();
  const { category, description, mood, screenshot, pageContext } = req.body;

  if (!category || !description || description.trim().length < 10) {
    return res.status(400).json({ error: "Category and description (10+ chars) are required" });
  }

  const validCategories = ['bug', 'feature', 'general', 'complaint', 'praise'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: "Invalid category" });
  }

  // Limit screenshot size (2MB base64)
  if (screenshot && screenshot.length > 2 * 1024 * 1024) {
    return res.status(400).json({ error: "Screenshot too large (max 2MB)" });
  }

  const id = uuid();
  try {
    await db.prepare(`
      INSERT INTO feedback (id, user_id, category, description, mood, screenshot, page_context, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NOW(), NOW())
    `).run(id, req.user.id, category, description.trim(), mood || null, screenshot || null, pageContext ? JSON.stringify(pageContext) : null);

    // Push notification to admin
    try {
      const emitToUser = req.app.get("emitToUser");
      const adminUser = await db.prepare("SELECT id FROM users WHERE is_admin = 1 LIMIT 1").get();
      if (adminUser && emitToUser) {
        emitToUser(adminUser.id, "new_feedback", { id, category, description: description.trim().substring(0, 100) });
      }
    } catch (pushErr) { console.error("Feedback push error:", pushErr); }

    res.status(201).json({ id, message: "Feedback submitted — thank you!" });
  } catch (err) {
    console.error("Submit feedback error:", err);
    res.status(500).json({ error: "Failed to submit feedback" });
  }
});

// ─── GET /api/feedback ───
// List feedback (admin only), with optional filters
router.get("/", async (req, res) => {
  const db = await getDb();

  // Check admin (API key auth sets req.isAdmin directly)
  if (!req.isAdmin) {
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!user || !user.is_admin) return res.status(403).json({ error: "Admin access required" });
  }

  const { category, status, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT f.*, u.first_name, u.last_name, u.email, u.role AS user_role
    FROM feedback f
    LEFT JOIN users u ON f.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (category) {
    query += " AND f.category = ?";
    params.push(category);
  }
  if (status) {
    query += " AND f.status = ?";
    params.push(status);
  }

  query += " ORDER BY f.created_at DESC LIMIT ? OFFSET ?";
  params.push(parseInt(limit), parseInt(offset));

  try {
    const items = await db.prepare(query).all(...params);

    const countQuery = `SELECT COUNT(*) as total FROM feedback${category ? " WHERE category = '" + category + "'" : ""}${status ? (category ? " AND" : " WHERE") + " status = '" + status + "'" : ""}`;
    const countResult = await db.prepare("SELECT COUNT(*) as total FROM feedback").get();

    res.json({
      feedback: items.map(f => ({
        id: f.id,
        userId: f.user_id,
        userName: f.user_id ? `${f.first_name} ${f.last_name}` : "Anonymous",
        userEmail: f.email || "—",
        userRole: f.user_role || "—",
        category: f.category,
        description: f.description,
        mood: f.mood,
        hasScreenshot: !!f.screenshot,
        pageContext: f.page_context ? JSON.parse(f.page_context) : null,
        tags: f.tags ? JSON.parse(f.tags) : [],
        status: f.status,
        adminNotes: f.admin_notes,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      })),
      total: countResult?.total || 0,
    });
  } catch (err) {
    console.error("List feedback error:", err);
    res.status(500).json({ error: "Failed to load feedback" });
  }
});

// ─── GET /api/feedback/my ───
// Get current user's own feedback submissions
router.get("/my", async (req, res) => {
  const db = await getDb();
  try {
    const items = await db.prepare(`
      SELECT id, category, description, mood, status, created_at
      FROM feedback WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 20
    `).all(req.user.id);

    res.json({ feedback: items });
  } catch (err) {
    console.error("My feedback error:", err);
    res.status(500).json({ error: "Failed to load feedback" });
  }
});

// ─── GET /api/feedback/:id/screenshot ───
// Get screenshot image for a feedback item (admin only)
router.get("/:id/screenshot", async (req, res) => {
  const db = await getDb();
  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
  if (!user || !user.is_admin) return res.status(403).json({ error: "Admin access required" });

  const item = await db.prepare("SELECT screenshot FROM feedback WHERE id = ?").get(req.params.id);
  if (!item || !item.screenshot) return res.status(404).json({ error: "No screenshot" });

  // Return as base64 data URL for img src
  const match = item.screenshot.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    const buffer = Buffer.from(match[2], 'base64');
    res.set('Content-Type', match[1]);
    res.send(buffer);
  } else {
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(item.screenshot, 'base64'));
  }
});

// ─── PUT /api/feedback/:id ───
// Update feedback status/notes/tags (admin only)
router.put("/:id", async (req, res) => {
  const db = await getDb();
  if (!req.isAdmin) {
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!user || !user.is_admin) return res.status(403).json({ error: "Admin access required" });
  }

  const { status, adminNotes, tags } = req.body;

  const validStatuses = ['new', 'reviewed', 'planned', 'done', 'dismissed'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const existing = await db.prepare("SELECT id FROM feedback WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Feedback not found" });

    const updates = [];
    const params = [];

    if (status) { updates.push("status = ?"); params.push(status); }
    if (adminNotes !== undefined) { updates.push("admin_notes = ?"); params.push(adminNotes); }
    if (tags !== undefined) { updates.push("tags = ?"); params.push(JSON.stringify(tags)); }
    updates.push("updated_at = NOW()");

    if (updates.length > 1) {
      params.push(req.params.id);
      await db.prepare(`UPDATE feedback SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }

    res.json({ message: "Feedback updated" });
  } catch (err) {
    console.error("Update feedback error:", err);
    res.status(500).json({ error: "Failed to update feedback" });
  }
});

module.exports = router;
