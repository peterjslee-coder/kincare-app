const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const { validateMagicBytes } = require("../utils/fileValidation");
const { attachReactions } = require("../utils/reactions"); // v1.105.170

// v1.76.0 — parse stored JSON defensively (one malformed row must not 500 the list)
function safeJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

const router = express.Router();
router.use(authenticate);

// ─── Access control (same pattern as careRecipients.js) ───
async function hasAccess(db, recipientId, userId) {
  // Admin bypasses all checks
  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
  if (user?.is_admin) return "admin";
  // Owner
  const owned = await db.prepare(
    "SELECT id FROM care_recipients WHERE id = ? AND family_user_id = ?"
  ).get(recipientId, userId);
  if (owned) return "owner";
  // Shared
  const shared = await db.prepare(
    "SELECT permission FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
  ).get(recipientId, userId);
  if (shared) return shared.permission;
  // Care team membership
  const teamMember = await db.prepare(`
    SELECT ctm.role FROM care_team_members ctm
    JOIN care_teams ct ON ctm.care_team_id = ct.id
    WHERE ct.care_recipient_id = ? AND ctm.user_id = ?
  `).get(recipientId, userId);
  if (teamMember) return teamMember.role === 'leader' ? 'edit' : 'view';
  // Assigned caregiver (has an active/confirmed session)
  const assignedCg = await db.prepare(`
    SELECT cs.id FROM care_sessions cs
    JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
    WHERE cs.care_recipient_id = ? AND cp.user_id = ?
      AND cs.status IN ('confirmed', 'in_progress')
    LIMIT 1
  `).get(recipientId, userId);
  if (assignedCg) return "view";
  return null;
}

// GET /api/notes/:careRecipientId — get notes for a care recipient
// Accessible by: family (owner), shared users, care team members, assigned caregivers, admins
// ─── GET /api/notes/mine/recipients ───
//
// v1.105.153. Which people's notes may I read? Registered BEFORE /:careRecipientId — "mine"
// is two segments so it could not be swallowed anyway, but the next specific route added here
// might be one, and this is the order that stays correct.
//
// Membership, never role. Pete: "not all caregivers will be on the care team" — a caregiver
// assigned to a session and nothing more is in none of the three sources this reads, so she
// gets an empty list and no screen, which is the intended answer rather than a special case.
router.get("/mine/recipients", async (req, res) => {
  try {
    const db = await getDb();
    const { recipientsWithCapabilityFor } = require("../utils/access");
    const { CAP } = require("../utils/capabilities");
    const recipients = await recipientsWithCapabilityFor(db, req.user.id, CAP.READ_NOTES);
    // v1.105.156 — visits ride on the same screen, under their own capability. Asked here so
    // the client never requests a history it is not allowed to see and then handles a 403.
    const withVisits = new Set(
      (await recipientsWithCapabilityFor(db, req.user.id, CAP.READ_VISITS)).map((r) => r.id)
    );
    res.json({
      recipients: recipients.map((r) => ({
        id: r.id, firstName: r.first_name, lastName: r.last_name, timezone: r.timezone,
        canReadVisits: withVisits.has(r.id),
      })),
    });
  } catch (err) {
    captureException(err, { where: "notes: mine/recipients" });
    console.error("Notes recipients error:", err.message);
    res.status(500).json({ error: "Could not load your care recipients" });
  }
});

router.get("/:careRecipientId", async (req, res) => {
  const db = await getDb();
  const recipientId = req.params.careRecipientId;

  const access = await hasAccess(db, recipientId, req.user.id);
  if (!access) {
    return res.status(403).json({ error: "Not authorized to view notes for this care recipient" });
  }

  // v1.76.0 — visibility rules for family observations:
  //  • the linked care recipient sees their OWN notes + visit summaries, but not
  //    observations the family wrote about them (candor vs. dignity — team decision)
  //  • assigned caregivers (view-only via active session) get observations via the
  //    AI-digested briefing, never raw
  const cr = await db.prepare("SELECT linked_user_id, family_user_id FROM care_recipients WHERE id = ?").get(recipientId);
  const isLinkedRecipient = cr && cr.linked_user_id === req.user.id && cr.family_user_id !== req.user.id;
  const teamOrOwner = await db.prepare(`
    SELECT 1 FROM care_recipients c
    LEFT JOIN care_teams ct ON ct.care_recipient_id = c.id
    LEFT JOIN care_team_members ctm ON ctm.care_team_id = ct.id AND ctm.user_id = ?
    WHERE c.id = ? AND (c.family_user_id = ? OR ctm.user_id IS NOT NULL)
    LIMIT 1
  `).get(req.user.id, recipientId, req.user.id);
  const caregiverOnly = !teamOrOwner && access !== "admin" && !isLinkedRecipient;

  let filterSql = "";
  const filterParams = [];
  if (isLinkedRecipient) {
    filterSql = " AND (rn.note_type != 'observation' OR rn.author_id = ?)";
    filterParams.push(req.user.id);
  } else if (caregiverOnly) {
    filterSql = " AND rn.note_type != 'observation'";
  }

  const notes = await db.prepare(`
    SELECT rn.id, rn.care_recipient_id, rn.author_id, rn.content, rn.note_type,
           rn.needs_attention, rn.categories, rn.ai_highlights,
           (rn.photo IS NOT NULL) AS has_photo,
           rn.created_at, rn.updated_at,
           u.first_name AS author_first_name, u.last_name AS author_last_name, u.role AS author_role
    FROM recipient_notes rn
    JOIN users u ON rn.author_id = u.id
    WHERE rn.care_recipient_id = ?${filterSql}
    ORDER BY rn.created_at DESC
  `).all(recipientId, ...filterParams);

  // v1.105.170 — reactions ride along with the notes, in ONE query for the whole list.
  // They are loaded AFTER the visibility filter above, so a reaction can never appear on a
  // note this reader is not allowed to see — the filter is the only place that decision is
  // made, and adding a second one here is how the two drift apart.
  res.json({
    notes: await attachReactions(db, "note", notes.map((n) => ({
      ...n,
      categories: safeJson(n.categories, []),
      ai_highlights: safeJson(n.ai_highlights, null),
    }))),
  });
});

// POST /api/notes — create a note
router.post("/", async (req, res) => {
  // v1.103.2 — the whole handler is wrapped: an unhandled async throw in
  // Express 4 leaves the request HANGING (the client just spins forever).
  try {
  const db = await getDb();
  const { careRecipientId, content, noteType = "general", offlineTimestamp, offlineSync, needsAttention, photo } = req.body;

  if (!careRecipientId || !content) {
    return res.status(400).json({ error: "careRecipientId and content required" });
  }
  if (String(content).length > 5000) {
    return res.status(400).json({ error: "Note is too long (5,000 characters max)" });
  }
  if (!["general", "observation", "visit_summary"].includes(noteType)) {
    return res.status(400).json({ error: "Invalid note type" });
  }
  // v1.76.0 — optional photo (e.g. the toe that might be broken)
  let photoData = null;
  if (photo) {
    const m = typeof photo === "string" && photo.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return res.status(400).json({ error: "Photo must be a base64 data URI" });
    const mime = m[1].toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      return res.status(400).json({ error: "Photo must be JPEG, PNG, or WebP" });
    }
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: "Photo too large (5MB max)" });
    const magic = validateMagicBytes(buf, mime);
    if (!magic.valid) return res.status(400).json({ error: "Photo content does not match its type" });
    photoData = photo;
  }

  // Access check — must have at least view access to add notes
  const access = await hasAccess(db, careRecipientId, req.user.id);
  if (!access) {
    return res.status(403).json({ error: "Not authorized to add notes for this care recipient" });
  }

  // Use offline timestamp if provided (caregiver was offline and recorded locally)
  const isOfflineSync = !!offlineSync;
  if (isOfflineSync) {
    console.log(`[notes] Offline sync — original time: ${offlineTimestamp}, recipient ${careRecipientId.slice(0, 8)}`);
  }

  const id = uuid();
  const createdAtSQL = isOfflineSync && offlineTimestamp
    ? `'${new Date(offlineTimestamp).toISOString()}'`
    : 'NOW()';
  await db.prepare(`
    INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, needs_attention, photo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ${createdAtSQL})
  `).run(id, careRecipientId, req.user.id, content, noteType, needsAttention ? 1 : 0, photoData);

  // v1.76.0 — harvest structure from observations (non-blocking; chips appear when done)
  if (noteType === "observation" || noteType === "general") {
    try {
      const { categorizeObservation } = require("../utils/careIntelligence");
      categorizeObservation(id).catch((e) => captureException(e, { where: "notes: categorize" }));
    } catch (e) { captureException(e, { where: "notes: categorize require" }); }
  }

  // ─── v1.96.0 — every new note pings the whole care team (Pete's 7/12 feedback) ───
  // Urgent notes get the ⚠️ variant, photo notes the 📷 variant. The author is
  // never notified about their own note. Per-user opt-out via notification_prefs
  // (push_team_note; urgent notes use the pre-existing push_observation_attention).
  try {
    const cr = await db.prepare("SELECT family_user_id, first_name FROM care_recipients WHERE id = ?").get(careRecipientId);
    if (cr) {
      const author = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
      const authorName = author ? `${author.first_name} ${author.last_name}` : "A team member";

      // v1.105.81 — only people who can READ a note are told one exists. This used to be
      // every care_team_member, which with per-invitation capabilities means a helper who was
      // deliberately denied the care record still got "New note — Betty" for a note she
      // cannot open. Useless to her, and it leaks that something was written and about whom.
      const { usersWithCapability } = require("../utils/access");
      const { CAP } = require("../utils/capabilities");
      const notifyIds = new Set(await usersWithCapability(db, careRecipientId, CAP.READ_NOTES));
      notifyIds.delete(req.user.id); // never notify the author

      const title = needsAttention
        ? `⚠️ Needs attention — ${cr.first_name}`
        : photoData
          ? `📷 New photo note — ${cr.first_name}`
          : `New note — ${cr.first_name}`;
      const eventType = needsAttention ? "observation_attention" : "team_note";
      const { sendPushToUser } = require("./push");
      for (const userId of notifyIds) {
        // v1.105.39 — the note itself never leaves the app. recipient_notes.content is
        // marked /* PHI */ in the schema, and a push body renders on a LOCKED screen:
        // "confused about where she was, wouldn't take her evening pill" was readable by
        // anyone who picked up the phone. Pete: "no phi on lock screens."
        sendPushToUser(userId, {
          title,
          body: `${authorName} — tap to read`,
          tag: `note-${id.slice(0, 8)}`,
          data: { type: eventType, careRecipientId, noteId: id, page: "care-profile" },
        }, eventType).catch(() => {});
      }
    }
  } catch (e) { captureException(e, { where: "notes: team push" }); }

  const note = await db.prepare(`
    SELECT rn.*, u.first_name AS author_first_name, u.last_name AS author_last_name, u.role AS author_role
    FROM recipient_notes rn JOIN users u ON rn.author_id = u.id WHERE rn.id = ?
  `).get(id);
  res.status(201).json({ note });
  } catch (err) {
    captureException(err, { where: "notes: create" });
    console.error("Note create error:", err.message);
    res.status(500).json({ error: "Failed to add note" });
  }
});

// GET /api/notes/:id/photo — stream a note's photo (same access + visibility rules)
router.get("/:id/photo", async (req, res) => {
  try {
    const db = await getDb();
    const note = await db.prepare("SELECT care_recipient_id, author_id, note_type, photo FROM recipient_notes WHERE id = ?").get(req.params.id);
    if (!note || !note.photo) return res.status(404).json({ error: "Photo not found" });
    const access = await hasAccess(db, note.care_recipient_id, req.user.id);
    if (!access) return res.status(404).json({ error: "Photo not found" });
    const cr = await db.prepare("SELECT linked_user_id, family_user_id FROM care_recipients WHERE id = ?").get(note.care_recipient_id);
    const isLinkedRecipient = cr && cr.linked_user_id === req.user.id && cr.family_user_id !== req.user.id;
    if (note.note_type === "observation" && isLinkedRecipient && note.author_id !== req.user.id) {
      return res.status(404).json({ error: "Photo not found" });
    }
    const m = note.photo.match(/^data:([^;]+);base64,(.+)$/s);
    if (!m) return res.status(500).json({ error: "Stored photo is corrupt" });
    res.set("Content-Type", m[1]);
    res.set("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(m[2], "base64"));
  } catch (err) {
    captureException(err, { where: "notes: photo" });
    res.status(500).json({ error: "Failed to load photo" });
  }
});

// PUT /api/notes/:id — edit a note (author or family owner can edit)
router.put("/:id", async (req, res) => {
  const db = await getDb();
  const { content, noteType } = req.body;

  const existing = await db.prepare("SELECT * FROM recipient_notes WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Note not found" });

  // v1.105.35 — this used to read "author, OR anyone holding the family role", which is
  // every family user on the platform, on every note about every recipient. The correct
  // helper was already defined 230 lines above and used by the GET on this same router.
  const access = await hasAccess(db, existing.care_recipient_id, req.user.id);
  const canEdit = existing.author_id === req.user.id || access === "owner" || access === "edit" || access === "admin";
  if (!canEdit) {
    return res.status(403).json({ error: "Not authorized to edit this note" });
  }

  await db.prepare(`
    UPDATE recipient_notes SET content = COALESCE(?, content), note_type = COALESCE(?, note_type), updated_at = NOW()
    WHERE id = ?
  `).run(content, noteType, req.params.id);

  const note = await db.prepare(`
    SELECT rn.*, u.first_name AS author_first_name, u.last_name AS author_last_name, u.role AS author_role
    FROM recipient_notes rn JOIN users u ON rn.author_id = u.id WHERE rn.id = ?
  `).get(req.params.id);
  res.json({ note });
});

// DELETE /api/notes/:id — delete a note
router.delete("/:id", async (req, res) => {
  const db = await getDb();
  const existing = await db.prepare("SELECT * FROM recipient_notes WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Note not found" });

  // v1.105.35 — same fix as the edit above: scoped to this recipient, not to the role.
  const access = await hasAccess(db, existing.care_recipient_id, req.user.id);
  const canDelete = existing.author_id === req.user.id || access === "owner" || access === "edit" || access === "admin";
  if (!canDelete) {
    return res.status(403).json({ error: "Not authorized" });
  }

  await db.prepare("DELETE FROM recipient_notes WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
