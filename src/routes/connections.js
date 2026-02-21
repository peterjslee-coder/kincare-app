const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

// ─── GET /api/connections/search?q=... ─── Search for users by name or email
router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ users: [] });

    const db = await getDb();
    const term = `%${q.trim().toLowerCase()}%`;

    const users = await db.prepare(`
      SELECT id, first_name, last_name, email, role, profile_photo
      FROM users
      WHERE id != ? AND is_demo = 0
        AND (LOWER(first_name || ' ' || last_name) LIKE ? OR LOWER(email) LIKE ?)
      ORDER BY first_name ASC
      LIMIT 20
    `).all(req.user.id, term, term);

    // Get existing connection statuses
    const connectionStatuses = {};
    if (users.length > 0) {
      const userIds = users.map(u => u.id);
      for (const uid of userIds) {
        const conn = await db.prepare(`
          SELECT id, status, requester_id FROM connections
          WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
        `).get(req.user.id, uid, uid, req.user.id);
        if (conn) {
          connectionStatuses[uid] = {
            connectionId: conn.id,
            status: conn.status,
            direction: conn.requester_id === req.user.id ? 'sent' : 'received',
          };
        }
      }
    }

    res.json({
      users: users.map(u => ({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        role: u.role,
        profilePhoto: u.profile_photo,
        connection: connectionStatuses[u.id] || null,
      })),
    });
  } catch (err) {
    console.error("Search users error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

// ─── GET /api/connections ─── List all connections for current user
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const connections = await db.prepare(`
      SELECT c.*,
        CASE WHEN c.requester_id = ? THEN r.first_name ELSE q.first_name END AS other_first_name,
        CASE WHEN c.requester_id = ? THEN r.last_name ELSE q.last_name END AS other_last_name,
        CASE WHEN c.requester_id = ? THEN r.email ELSE q.email END AS other_email,
        CASE WHEN c.requester_id = ? THEN r.id ELSE q.id END AS other_user_id,
        CASE WHEN c.requester_id = ? THEN r.profile_photo ELSE q.profile_photo END AS other_photo
      FROM connections c
      JOIN users q ON c.requester_id = q.id
      JOIN users r ON c.recipient_id = r.id
      WHERE (c.requester_id = ? OR c.recipient_id = ?)
      ORDER BY c.updated_at DESC
    `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

    res.json({
      connections: connections.map(c => ({
        id: c.id,
        otherUserId: c.other_user_id,
        otherFirstName: c.other_first_name,
        otherLastName: c.other_last_name,
        otherEmail: c.other_email,
        otherPhoto: c.other_photo,
        status: c.status,
        direction: c.requester_id === req.user.id ? 'sent' : 'received',
        createdAt: c.created_at,
      })),
    });
  } catch (err) {
    console.error("List connections error:", err);
    res.status(500).json({ error: "Failed to list connections" });
  }
});

// ─── POST /api/connections ─── Send a connection request
router.post("/", async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    if (userId === req.user.id) return res.status(400).json({ error: "Cannot connect with yourself" });

    const db = await getDb();

    // Check if connection already exists
    const existing = await db.prepare(`
      SELECT id, status FROM connections
      WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)
    `).get(req.user.id, userId, userId, req.user.id);

    if (existing) {
      if (existing.status === 'accepted') return res.json({ message: "Already connected" });
      if (existing.status === 'pending') return res.json({ message: "Connection request already pending" });
      // If declined, allow re-request
      await db.prepare("UPDATE connections SET status = 'pending', requester_id = ?, recipient_id = ?, updated_at = NOW() WHERE id = ?")
        .run(req.user.id, userId, existing.id);
      return res.json({ message: "Connection request sent" });
    }

    const id = uuid();
    await db.prepare(
      "INSERT INTO connections (id, requester_id, recipient_id, status) VALUES (?, ?, ?, 'pending')"
    ).run(id, req.user.id, userId);

    // Notify the recipient
    await db.prepare(
      "INSERT INTO activity_feed (id, family_user_id, event_type, title, message) VALUES (?, ?, 'connection_request', ?, ?)"
    ).run(uuid(), userId, "Connection request",
      `${req.user.firstName || ''} ${req.user.lastName || ''} wants to connect with you`);

    const emitToUser = req.app.get("emitToUser");
    if (emitToUser) emitToUser(userId, "activity_update", { type: "connection_request" });

    res.status(201).json({ message: "Connection request sent", connectionId: id });
  } catch (err) {
    console.error("Send connection error:", err);
    res.status(500).json({ error: "Failed to send connection request" });
  }
});

// ─── PUT /api/connections/:id ─── Accept or decline a connection request
router.put("/:id", async (req, res) => {
  try {
    const { action } = req.body; // 'accept' or 'decline'
    if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: "Action must be accept or decline" });

    const db = await getDb();
    const conn = await db.prepare("SELECT * FROM connections WHERE id = ?").get(req.params.id);
    if (!conn) return res.status(404).json({ error: "Connection not found" });
    if (conn.recipient_id !== req.user.id) return res.status(403).json({ error: "Only the recipient can respond to this request" });
    if (conn.status !== 'pending') return res.status(400).json({ error: "This request has already been handled" });

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    await db.prepare("UPDATE connections SET status = ?, updated_at = NOW() WHERE id = ?")
      .run(newStatus, req.params.id);

    if (action === 'accept') {
      // Notify requester
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message) VALUES (?, ?, 'connection_accepted', ?, ?)"
      ).run(uuid(), conn.requester_id, "Connection accepted",
        `${req.user.firstName || ''} ${req.user.lastName || ''} accepted your connection request`);

      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) emitToUser(conn.requester_id, "activity_update", { type: "connection_accepted" });
    }

    res.json({ message: `Connection ${newStatus}` });
  } catch (err) {
    console.error("Update connection error:", err);
    res.status(500).json({ error: "Failed to update connection" });
  }
});

module.exports = router;
