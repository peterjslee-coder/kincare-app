// ─── Data integrity checks (admin) ───
//
// Stale-link sweep (after v1.111.2). care_recipients.linked_user_id marks a care recipient's
// OWN account. Betty's profile carried a link to an unrelated person (Kit Conn), left over from
// a March self-signup, and the app treated Kit as Betty. utils/linkedAccount now refuses to
// trust any link that is neither the record's owner nor on her care team; this report lists
// every such link so an admin can see where they are and remove them deliberately.
//
//   GET  /api/admin/integrity/linked-accounts                     — the untrusted links
//   POST /api/admin/integrity/linked-accounts/:recipientId/unlink — remove one
//
// The unlink is a compare-and-set: it clears the link only if it is STILL the same id and
// STILL untrusted (409 otherwise), writes consent_audit_log under the admin's own id, and is
// refused under impersonation. Admin auth + the trusted-network / TOTP second factor come from
// the admin router (./index.js) like every other admin write.
const { v4: uuid } = require("uuid");
const { getDb } = require("../../models/database");
const { authenticate, requireAdmin } = require("../../middleware/auth");
const { blockWhileImpersonating } = require("../../middleware/noImpersonation");
const { TRUSTED_LINK_SQL } = require("../../utils/linkedAccount");
const { logAdminAction, checkAdmin } = require("./shared");

module.exports = function register(router) {

// ─── GET /api/admin/integrity/linked-accounts ───
router.get("/integrity/linked-accounts", authenticate, checkAdmin, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT cr.id AS recipient_id, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        cr.consent_method, cr.created_at AS recipient_created_at,
        cr.linked_user_id, lu.first_name AS linked_first_name, lu.last_name AS linked_last_name, lu.email AS linked_email,
        ou.first_name AS owner_first_name, ou.last_name AS owner_last_name,
        (SELECT ldr.first_name || ' ' || ldr.last_name
           FROM care_team_members lctm
           JOIN care_teams lct ON lct.id = lctm.care_team_id
           JOIN users ldr ON ldr.id = lctm.user_id
          WHERE lct.care_recipient_id = cr.id AND lctm.role = 'leader'
          ORDER BY lctm.created_at ASC LIMIT 1) AS leader_name
      FROM care_recipients cr
      LEFT JOIN users lu ON lu.id = cr.linked_user_id
      LEFT JOIN users ou ON ou.id = cr.family_user_id
      WHERE cr.linked_user_id IS NOT NULL AND NOT ${TRUSTED_LINK_SQL}
      ORDER BY cr.created_at ASC
    `).all();
    const name = (f, l) => [f, l].filter(Boolean).join(" ") || null;
    res.json({
      staleLinks: rows.map((r) => ({
        recipientId: r.recipient_id,
        recipientName: name(r.recipient_first_name, r.recipient_last_name),
        linkedUserId: r.linked_user_id,
        linkedUserName: name(r.linked_first_name, r.linked_last_name),
        linkedUserEmail: r.linked_email || null,
        linkedUserExists: !!(r.linked_first_name || r.linked_last_name || r.linked_email),
        consentMethod: r.consent_method || null,
        recipientCreatedAt: r.recipient_created_at,
        ownerName: name(r.owner_first_name, r.owner_last_name),
        leaderName: r.leader_name || null,
      })),
    });
  } catch (err) {
    console.error("[integrity] linked-accounts report error:", err);
    res.status(500).json({ error: "Could not run the linked-accounts check" });
  }
});

// ─── POST /api/admin/integrity/linked-accounts/:recipientId/unlink ───
// Body: { linkedUserId } — the id the admin saw in the report.
router.post("/integrity/linked-accounts/:recipientId/unlink", authenticate, checkAdmin, requireAdmin,
  blockWhileImpersonating("remove a linked account"), async (req, res) => {
  try {
    const { recipientId } = req.params;
    const linkedUserId = req.body && typeof req.body.linkedUserId === "string" ? req.body.linkedUserId : null;
    if (!linkedUserId) return res.status(400).json({ error: "linkedUserId is required" });

    const db = await getDb();
    let removed = false;
    await db.transaction(async (tx) => {
      const r = await tx.prepare(`
        UPDATE care_recipients cr SET linked_user_id = NULL, updated_at = NOW()
        WHERE cr.id = ? AND cr.linked_user_id = ? AND NOT ${TRUSTED_LINK_SQL}
      `).run(recipientId, linkedUserId);
      if (!r || !r.changes) return;
      removed = true;
      await tx.prepare(`
        INSERT INTO consent_audit_log (id, care_recipient_id, actor_id, actor_role, event_type, description, metadata)
        VALUES (?, ?, ?, 'admin', 'linked_account_removed', ?, ?)
      `).run(uuid(), recipientId, req.user.id,
        "Admin removed a linked \"own account\" that was not this person (not the owner and not on the care team).",
        JSON.stringify({ previous_linked_user_id: linkedUserId, source: "admin_integrity_check" }));
    });

    if (!removed) {
      return res.status(409).json({ error: "That link has already changed — it is gone, different, or now trusted. Refresh the list." });
    }
    await logAdminAction(req, "linked_account_removed", "care_recipient", recipientId, { previousLinkedUserId: linkedUserId });
    res.json({ ok: true, recipientId, previousLinkedUserId: linkedUserId });
  } catch (err) {
    console.error("[integrity] unlink error:", err);
    res.status(500).json({ error: "Could not remove the link" });
  }
});

};
