const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { v4: uuid } = require("uuid");

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ─── GET /api/legal/pending ───
// Returns legal documents the current user hasn't accepted yet
router.get("/pending", async (req, res) => {
  try {
    const db = await getDb();

    // Get all active legal documents
    const activeDocs = await db.prepare(`
      SELECT id, doc_type, version, title, content, change_summary, previous_version, published_at
      FROM legal_documents
      WHERE is_active = 1
      ORDER BY published_at DESC
    `).all();

    // Get user's latest acceptance per doc_type
    const acceptances = await db.prepare(`
      SELECT DISTINCT ON (doc_type) doc_type, version, accepted_at
      FROM user_legal_acceptances
      WHERE user_id = ?
      ORDER BY doc_type, accepted_at DESC
    `).all(req.user.id);

    const acceptMap = {};
    for (const a of acceptances) acceptMap[a.doc_type] = a.version;

    // Filter to docs where user hasn't accepted the current version
    const pending = activeDocs.filter(d => acceptMap[d.doc_type] !== d.version);

    res.json({ pending });
  } catch (err) {
    console.error("Legal pending error:", err);
    res.status(500).json({ error: "Failed to check legal documents" });
  }
});

// ─── POST /api/legal/accept ───
// User accepts a specific legal document version
router.post("/accept", async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: "documentId required" });

    const db = await getDb();
    const doc = await db.prepare("SELECT id, doc_type, version FROM legal_documents WHERE id = ? AND is_active = 1").get(documentId);
    if (!doc) return res.status(404).json({ error: "Document not found or inactive" });

    await db.prepare(`
      INSERT INTO user_legal_acceptances (id, user_id, document_id, doc_type, version, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(), req.user.id, doc.id, doc.doc_type, doc.version,
      req.ip || req.headers['x-forwarded-for'] || null,
      (req.headers['user-agent'] || '').slice(0, 255)
    );

    // Also update the legacy disclaimer fields for backward compat
    await db.prepare(
      "UPDATE users SET disclaimer_accepted_at = NOW(), disclaimer_version = ? WHERE id = ?"
    ).run(doc.version, req.user.id);

    res.json({ accepted: true, docType: doc.doc_type, version: doc.version });
  } catch (err) {
    console.error("Legal accept error:", err);
    res.status(500).json({ error: "Failed to accept document" });
  }
});

// ─── Admin routes ───

// GET /api/legal/admin/documents — List all versions of all legal docs
router.get("/admin/documents", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const docs = await db.prepare(`
      SELECT ld.*, u.first_name || ' ' || u.last_name AS published_by_name,
        (SELECT COUNT(*) FROM user_legal_acceptances ula WHERE ula.document_id = ld.id) AS acceptance_count
      FROM legal_documents ld
      LEFT JOIN users u ON ld.published_by = u.id
      ORDER BY ld.doc_type, ld.published_at DESC
    `).all();
    res.json({ documents: docs });
  } catch (err) {
    console.error("Legal admin list error:", err);
    res.status(500).json({ error: "Failed to list legal documents" });
  }
});

// POST /api/legal/admin/publish — Publish a new version of a legal document
// Automatically deactivates previous version and generates AI change summary
router.post("/admin/publish", requireAdmin, async (req, res) => {
  try {
    const { docType, version, title, content, changeSummary } = req.body;
    if (!docType || !version || !title || !content) {
      return res.status(400).json({ error: "docType, version, title, and content are required" });
    }

    const validTypes = ['terms', 'privacy', 'liability', 'disclaimer'];
    if (!validTypes.includes(docType)) {
      return res.status(400).json({ error: `docType must be one of: ${validTypes.join(', ')}` });
    }

    const db = await getDb();

    // Get the current active version for comparison
    const previous = await db.prepare(
      "SELECT id, version, content FROM legal_documents WHERE doc_type = ? AND is_active = 1 ORDER BY published_at DESC LIMIT 1"
    ).get(docType);

    // Generate AI change summary if not provided and there's a previous version
    let summary = changeSummary || null;
    if (!summary && previous) {
      summary = generateChangeSummary(previous.content, content);
    }

    // Deactivate previous versions
    await db.prepare(
      "UPDATE legal_documents SET is_active = 0 WHERE doc_type = ? AND is_active = 1"
    ).run(docType);

    // Insert new version
    const docId = uuid();
    await db.prepare(`
      INSERT INTO legal_documents (id, doc_type, version, title, content, change_summary, previous_version, published_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(docId, docType, version, title, content, summary, previous?.version || null, req.user.id);

    res.json({
      document: { id: docId, docType, version, title, changeSummary: summary, previousVersion: previous?.version || null },
      message: `Published ${docType} v${version}. All users will need to re-accept.`,
    });
  } catch (err) {
    console.error("Legal publish error:", err);
    res.status(500).json({ error: "Failed to publish document" });
  }
});

// GET /api/legal/admin/acceptances — Acceptance audit trail
router.get("/admin/acceptances", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { docType } = req.query;
    let query = `
      SELECT ula.*, u.first_name || ' ' || u.last_name AS user_name, u.email AS user_email
      FROM user_legal_acceptances ula
      LEFT JOIN users u ON ula.user_id = u.id
    `;
    const params = [];
    if (docType) { query += " WHERE ula.doc_type = ?"; params.push(docType); }
    query += " ORDER BY ula.accepted_at DESC LIMIT 100";
    const acceptances = await db.prepare(query).all(...params);

    // Stats
    const stats = await db.prepare(`
      SELECT ld.doc_type, ld.version,
        (SELECT COUNT(DISTINCT id) FROM users WHERE COALESCE(is_demo, 0) = 0 AND deleted_at IS NULL) AS total_users,
        (SELECT COUNT(DISTINCT ula.user_id) FROM user_legal_acceptances ula WHERE ula.doc_type = ld.doc_type AND ula.version = ld.version) AS accepted_count
      FROM legal_documents ld WHERE ld.is_active = 1
    `).all();

    res.json({ acceptances, stats });
  } catch (err) {
    console.error("Legal acceptances error:", err);
    res.status(500).json({ error: "Failed to fetch acceptances" });
  }
});

// ─── AI Change Summary Generator ───
function generateChangeSummary(oldContent, newContent) {
  // Simple diff-based summary (no external AI call needed for basic changes)
  const oldLines = oldContent.split('\n').map(l => l.trim()).filter(Boolean);
  const newLines = newContent.split('\n').map(l => l.trim()).filter(Boolean);

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  const added = newLines.filter(l => !oldSet.has(l));
  const removed = oldLines.filter(l => !newSet.has(l));

  const changes = [];
  if (added.length > 0) {
    // Categorize additions by keywords
    const sections = categorizeChanges(added);
    for (const [category, items] of Object.entries(sections)) {
      changes.push(`Added ${category}: ${items.length} new clause${items.length > 1 ? 's' : ''}`);
    }
  }
  if (removed.length > 0) {
    changes.push(`Removed ${removed.length} clause${removed.length > 1 ? 's' : ''}`);
  }
  if (changes.length === 0 && added.length === 0 && removed.length === 0) {
    changes.push('Minor wording updates and clarifications');
  }

  return changes.join('. ') + '.';
}

function categorizeChanges(lines) {
  const categories = {};
  const keywords = {
    'data & privacy': ['data', 'privacy', 'personal information', 'collect', 'share', 'cookie'],
    'liability': ['liable', 'liability', 'damages', 'indemnif', 'warranty', 'disclaim'],
    'services': ['service', 'care', 'caregiver', 'companion', 'platform'],
    'payments': ['payment', 'fee', 'charge', 'refund', 'billing'],
    'account': ['account', 'terminate', 'suspend', 'access', 'registration'],
    'general': [],
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    let matched = false;
    for (const [cat, kws] of Object.entries(keywords)) {
      if (cat === 'general') continue;
      if (kws.some(kw => lower.includes(kw))) {
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(line);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!categories['general updates']) categories['general updates'] = [];
      categories['general updates'].push(line);
    }
  }
  return categories;
}

module.exports = router;
