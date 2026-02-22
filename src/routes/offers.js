// ─── Session Offers (Negotiation / Counter-Offer) ───
// Mounted at /api/sessions — adds offer sub-routes under /api/sessions/:sessionId/offers

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

const MAX_ROUNDS = 3;
const OFFER_EXPIRY_HOURS = 24;

// ─── POST /api/sessions/:sessionId/offers ───
// Create an offer or counter-offer on a session
router.post("/:sessionId/offers", async (req, res) => {
  const { offeredRate, message, parentOfferId } = req.body;
  const { sessionId } = req.params;

  if (!offeredRate || offeredRate <= 0) {
    return res.status(400).json({ error: "offeredRate is required and must be positive" });
  }
  if (offeredRate > 500) {
    return res.status(400).json({ error: "Rate cannot exceed $500/hr" });
  }

  const db = await getDb();

  // Get session with caregiver user info
  const session = await db.prepare(`
    SELECT cs.*, cp.user_id AS caregiver_user_id
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    WHERE cs.id = ?
  `).get(sessionId);

  if (!session) return res.status(404).json({ error: "Session not found" });

  // Determine who can make offers: family (session owner) or caregiver (assigned or open request)
  const isFamily = req.user.id === session.family_user_id;
  const isCaregiver = req.user.role === "caregiver";

  if (!isFamily && !isCaregiver) {
    return res.status(403).json({ error: "Only the family or a caregiver can make offers" });
  }

  // Determine the "to" user
  let toUserId;
  if (isFamily) {
    if (!session.caregiver_user_id) {
      return res.status(400).json({ error: "No caregiver assigned — cannot negotiate yet" });
    }
    toUserId = session.caregiver_user_id;
  } else {
    toUserId = session.family_user_id;
  }

  // Check round limit
  let roundNumber = 1;
  if (parentOfferId) {
    const parent = await db.prepare("SELECT * FROM session_offers WHERE id = ?").get(parentOfferId);
    if (!parent) return res.status(404).json({ error: "Parent offer not found" });
    if (parent.session_id !== sessionId) return res.status(400).json({ error: "Parent offer belongs to a different session" });
    roundNumber = parent.round_number + 1;
    if (roundNumber > MAX_ROUNDS) {
      return res.status(400).json({ error: `Maximum ${MAX_ROUNDS} negotiation rounds reached. Please accept or reject.` });
    }
    // Mark parent as countered
    await db.prepare("UPDATE session_offers SET status = 'countered' WHERE id = ?").run(parentOfferId);
  } else {
    // First offer — check no pending offers exist
    const existing = await db.prepare(
      "SELECT id FROM session_offers WHERE session_id = ? AND status = 'pending'"
    ).get(sessionId);
    if (existing) {
      return res.status(400).json({ error: "There is already a pending offer on this session. Respond to it first." });
    }
  }

  // Create the offer
  const id = uuid();
  const expiresAt = new Date(Date.now() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO session_offers (id, session_id, from_user_id, to_user_id, offered_rate, message, status, parent_offer_id, round_number, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, sessionId, req.user.id, toUserId, offeredRate, message || null, parentOfferId || null, roundNumber, expiresAt);

  // Move session to negotiating status if not already
  if (session.status !== 'negotiating') {
    const canNegotiate = ['open', 'requested', 'pending', 'confirmed'].includes(session.status);
    if (canNegotiate) {
      await db.prepare("UPDATE care_sessions SET status = 'negotiating', updated_at = NOW() WHERE id = ?").run(sessionId);
    }
  }

  // WebSocket notification
  const emitToUser = req.app.get("emitToUser");
  if (emitToUser) {
    const fromName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Someone';
    emitToUser(toUserId, "offer_update", {
      sessionId,
      offerId: id,
      type: parentOfferId ? "counter" : "new",
      fromName,
      offeredRate,
      message: message || null,
      roundNumber,
    });
  }

  const offer = await db.prepare("SELECT * FROM session_offers WHERE id = ?").get(id);
  res.status(201).json({ offer });
});

// ─── PUT /api/sessions/:sessionId/offers/:offerId/respond ───
// Accept or reject an offer
router.put("/:sessionId/offers/:offerId/respond", async (req, res) => {
  const { action } = req.body; // 'accept' or 'reject'
  const { sessionId, offerId } = req.params;

  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: "action must be 'accept' or 'reject'" });
  }

  const db = await getDb();
  const offer = await db.prepare("SELECT * FROM session_offers WHERE id = ? AND session_id = ?").get(offerId, sessionId);
  if (!offer) return res.status(404).json({ error: "Offer not found" });
  if (offer.status !== 'pending') {
    return res.status(400).json({ error: `Offer is already ${offer.status}` });
  }
  if (offer.to_user_id !== req.user.id) {
    return res.status(403).json({ error: "Only the recipient can respond to this offer" });
  }

  // Check expiry
  if (new Date(offer.expires_at) < new Date()) {
    await db.prepare("UPDATE session_offers SET status = 'expired' WHERE id = ?").run(offerId);
    return res.status(400).json({ error: "This offer has expired" });
  }

  if (action === 'accept') {
    await db.prepare("UPDATE session_offers SET status = 'accepted' WHERE id = ?").run(offerId);
    // Set agreed rate on the session and move to confirmed
    await db.prepare(`
      UPDATE care_sessions SET agreed_rate = ?, status = 'confirmed', updated_at = NOW() WHERE id = ?
    `).run(offer.offered_rate, sessionId);
  } else {
    await db.prepare("UPDATE session_offers SET status = 'rejected' WHERE id = ?").run(offerId);
    // If max rounds reached, return session to previous state
    if (offer.round_number >= MAX_ROUNDS) {
      await db.prepare(`
        UPDATE care_sessions SET status = CASE WHEN caregiver_id IS NULL THEN 'open' ELSE 'pending' END, updated_at = NOW() WHERE id = ?
      `).run(sessionId);
    }
  }

  // WebSocket notification
  const emitToUser = req.app.get("emitToUser");
  if (emitToUser) {
    const fromName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'Someone';
    emitToUser(offer.from_user_id, "offer_update", {
      sessionId,
      offerId,
      type: action,
      fromName,
      offeredRate: offer.offered_rate,
      roundNumber: offer.round_number,
    });
  }

  const session = await db.prepare("SELECT * FROM care_sessions WHERE id = ?").get(sessionId);
  res.json({ offer: { ...offer, status: action === 'accept' ? 'accepted' : 'rejected' }, session });
});

// ─── GET /api/sessions/:sessionId/offers ───
// Get all offers for a session (chronological)
router.get("/:sessionId/offers", async (req, res) => {
  const { sessionId } = req.params;
  const db = await getDb();

  // Verify user has access to this session
  const session = await db.prepare(`
    SELECT cs.*, cp.user_id AS caregiver_user_id
    FROM care_sessions cs
    LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    WHERE cs.id = ?
  `).get(sessionId);

  if (!session) return res.status(404).json({ error: "Session not found" });

  const isFamily = req.user.id === session.family_user_id;
  const isCaregiver = req.user.id === session.caregiver_user_id;
  const isAdmin = req.user.role === 'admin';

  if (!isFamily && !isCaregiver && !isAdmin) {
    return res.status(403).json({ error: "Access denied" });
  }

  // Expire any stale pending offers
  await db.prepare(`
    UPDATE session_offers SET status = 'expired' WHERE session_id = ? AND status = 'pending' AND expires_at < NOW()
  `).run(sessionId);

  const offers = await db.prepare(`
    SELECT so.*, u.first_name, u.last_name, u.role AS from_role
    FROM session_offers so
    JOIN users u ON so.from_user_id = u.id
    WHERE so.session_id = ?
    ORDER BY so.created_at ASC
  `).all(sessionId);

  res.json({ offers, session });
});

module.exports = router;
