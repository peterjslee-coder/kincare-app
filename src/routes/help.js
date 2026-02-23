const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// ─── GET /api/help — Public: list published FAQ articles ───
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const { category, q } = req.query;

    let sql = "SELECT * FROM help_articles WHERE is_published = 1";
    const params = [];

    if (category && category !== "all") {
      sql += " AND category = ?";
      params.push(category);
    }

    if (q) {
      sql += " AND (LOWER(question) LIKE ? OR LOWER(answer) LIKE ?)";
      const search = `%${q.toLowerCase()}%`;
      params.push(search, search);
    }

    sql += " ORDER BY sort_order ASC, created_at ASC";

    const articles = await db.prepare(sql).all(...params);

    // Parse role_visibility JSON and filter by user role if authenticated
    let userRole = null;
    try {
      // Try to get user role from optional auth header
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const jwt = require("jsonwebtoken");
        const token = authHeader.replace("Bearer ", "");
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev-secret-change-me");
        userRole = req.headers["x-active-role"] || (decoded.roles ? decoded.roles[0] : decoded.role);
      }
    } catch {
      // No valid auth — show all public articles
    }

    // Deduplicate articles by question text (keep first occurrence per sort_order)
    const seen = new Set();
    const deduped = articles.filter(a => {
      const key = (a.question || '').trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const filtered = deduped.map(a => {
      let roleVisibility = null;
      try { roleVisibility = a.role_visibility ? JSON.parse(a.role_visibility) : null; } catch { roleVisibility = null; }
      let relatedFeedbackIds = [];
      try { relatedFeedbackIds = a.related_feedback_ids ? JSON.parse(a.related_feedback_ids) : []; } catch { relatedFeedbackIds = []; }
      return { ...a, role_visibility: roleVisibility, related_feedback_ids: relatedFeedbackIds };
    }).filter(a => {
      // If no role visibility set, show to everyone
      if (!a.role_visibility || a.role_visibility.length === 0) return true;
      // If user is not authenticated, show articles visible to all or with no restriction
      if (!userRole) return true;
      // If user has a role, show articles matching their role
      return a.role_visibility.includes(userRole);
    });

    res.json({ articles: filtered });
  } catch (err) {
    console.error("Help articles fetch error:", err);
    res.status(500).json({ error: "Failed to load help articles" });
  }
});

// ─── POST /api/help — Admin: create article ───
router.post("/", authenticate, async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: "Admin access required" });
    const db = await getDb();
    const { category, question, answer, link_page, link_label, role_visibility, sort_order, related_feedback_ids } = req.body;

    if (!category || !question || !answer) {
      return res.status(400).json({ error: "category, question, and answer are required" });
    }

    const id = uuidv4();
    const roleVis = role_visibility ? JSON.stringify(role_visibility) : null;
    const feedbackIds = related_feedback_ids ? JSON.stringify(related_feedback_ids) : null;

    await db.prepare(`
      INSERT INTO help_articles (id, category, question, answer, link_page, link_label, role_visibility, sort_order, related_feedback_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, category, question, answer, link_page || null, link_label || null, roleVis, sort_order || 0, feedbackIds);

    const article = await db.prepare("SELECT * FROM help_articles WHERE id = ?").get(id);
    res.status(201).json({ article });
  } catch (err) {
    console.error("Help article create error:", err);
    res.status(500).json({ error: "Failed to create article" });
  }
});

// ─── PUT /api/help/:id — Admin: update article ───
router.put("/:id", authenticate, async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: "Admin access required" });
    const db = await getDb();
    const existing = await db.prepare("SELECT * FROM help_articles WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Article not found" });

    const { category, question, answer, link_page, link_label, role_visibility, sort_order, is_published, related_feedback_ids } = req.body;
    const updates = [];
    const params = [];

    if (category !== undefined) { updates.push("category = ?"); params.push(category); }
    if (question !== undefined) { updates.push("question = ?"); params.push(question); }
    if (answer !== undefined) { updates.push("answer = ?"); params.push(answer); }
    if (link_page !== undefined) { updates.push("link_page = ?"); params.push(link_page || null); }
    if (link_label !== undefined) { updates.push("link_label = ?"); params.push(link_label || null); }
    if (role_visibility !== undefined) { updates.push("role_visibility = ?"); params.push(role_visibility ? JSON.stringify(role_visibility) : null); }
    if (sort_order !== undefined) { updates.push("sort_order = ?"); params.push(sort_order); }
    if (is_published !== undefined) { updates.push("is_published = ?"); params.push(is_published ? 1 : 0); }
    if (related_feedback_ids !== undefined) { updates.push("related_feedback_ids = ?"); params.push(related_feedback_ids ? JSON.stringify(related_feedback_ids) : null); }

    if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });

    updates.push("updated_at = NOW()");
    params.push(req.params.id);

    await db.prepare(`UPDATE help_articles SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    const article = await db.prepare("SELECT * FROM help_articles WHERE id = ?").get(req.params.id);
    res.json({ article });
  } catch (err) {
    console.error("Help article update error:", err);
    res.status(500).json({ error: "Failed to update article" });
  }
});

// ─── DELETE /api/help/:id — Admin: soft-delete (unpublish) article ───
router.delete("/:id", authenticate, async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: "Admin access required" });
    const db = await getDb();
    const existing = await db.prepare("SELECT * FROM help_articles WHERE id = ?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Article not found" });

    await db.prepare("UPDATE help_articles SET is_published = 0, updated_at = NOW() WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: "Article unpublished" });
  } catch (err) {
    console.error("Help article delete error:", err);
    res.status(500).json({ error: "Failed to delete article" });
  }
});

// ─── GET /api/help/admin — Admin: list ALL articles (including unpublished) ───
router.get("/admin", authenticate, async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: "Admin access required" });
    const db = await getDb();
    const articles = await db.prepare("SELECT * FROM help_articles ORDER BY category ASC, sort_order ASC, created_at ASC").all();

    const parsed = articles.map(a => {
      let roleVisibility = null;
      try { roleVisibility = a.role_visibility ? JSON.parse(a.role_visibility) : null; } catch { roleVisibility = null; }
      let relatedFeedbackIds = [];
      try { relatedFeedbackIds = a.related_feedback_ids ? JSON.parse(a.related_feedback_ids) : []; } catch { relatedFeedbackIds = []; }
      return { ...a, role_visibility: roleVisibility, related_feedback_ids: relatedFeedbackIds };
    });

    res.json({ articles: parsed });
  } catch (err) {
    console.error("Help admin list error:", err);
    res.status(500).json({ error: "Failed to load articles" });
  }
});

module.exports = router;
