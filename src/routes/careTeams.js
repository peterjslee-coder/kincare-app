const express = require("express");
const { ALL: ALL_CAPS, PRESETS } = require("../utils/capabilities");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { captureException } = require("../utils/sentry");
const { sendEmail, brandedHtml } = require("../utils/email");

const router = express.Router();

// ─── PUBLIC (no auth) invite endpoints — must be BEFORE router.use(authenticate) ───

// GET /api/care-teams/invite-info?token=... — Pre-login invite details
// This MUST be unauthenticated so new users can see who invited them
router.get("/invite-info", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token required" });

    const db = await getDb();
    const invite = await db.prepare(
      "SELECT cti.*, ct.name AS team_name, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name FROM care_team_invites cti JOIN care_teams ct ON cti.care_team_id = ct.id JOIN care_recipients cr ON ct.care_recipient_id = cr.id WHERE cti.token = ? AND cti.status = 'pending'"
    ).get(token);

    if (!invite) return res.status(404).json({ error: "Invalid or expired invite" });

    // ─── v1.105.78: nobody reaches a health record without the privacy statement ───
    //
    // This endpoint did not check legal acceptance at all. Accepting a care-team invite is the
    // moment a person gains access to another human's health record — notes, conditions,
    // medications — and it was possible to cross that line having agreed to nothing. Pete:
    // "we need to make sure that anyone invited has already read the privacy statement."
    //
    // The machinery already existed (/api/legal/pending, /accept, and pendingLegalDocs gates
    // the app on first open); the invite path simply never consulted it. 409 rather than 403
    // so the client can tell "you must accept this first" apart from "this isn't yours", and
    // the response names the documents so it can show them.
    const outstanding = await db.prepare(`
      SELECT ld.doc_type, ld.version, ld.title
      FROM legal_documents ld
      WHERE ld.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM user_legal_acceptances ula
          WHERE ula.user_id = ? AND ula.doc_type = ld.doc_type AND ula.version = ld.version
        )
    `).all(req.user.id);
    // No .catch here, deliberately. If this query fails we must NOT fall through and let the
    // person in — a privacy gate that fails open is worse than no gate, because it looks like
    // one. The outer try/catch answers 500 and they simply retry.
    if (outstanding && outstanding.length > 0) {
      return res.status(409).json({
        error: "Please review and accept the privacy statement before joining a care team.",
        needsLegalAcceptance: true,
        documents: outstanding.map((d) => ({ docType: d.doc_type, version: d.version, title: d.title })),
      });
    }
    if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: "This invite has expired" });

    const inviter = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(invite.invited_by);

    res.json({
      invite: {
        email: invite.invited_email,
        role: invite.role,
        teamName: invite.team_name,
        recipientName: `${invite.recipient_first_name} ${invite.recipient_last_name}`,
        inviterName: inviter ? `${inviter.first_name} ${inviter.last_name}` : "Someone",
        expiresAt: invite.expires_at,
      },
    });
  } catch (err) {
    console.error("Invite info error:", err);
    res.status(500).json({ error: "Failed to get invite info" });
  }
});

// ─── All routes below require authentication ───
router.use(authenticate);

// ─── GET /api/care-teams/my-pending-invites ─── Check for pending invites matching logged-in user's email
router.get("/my-pending-invites", async (req, res) => {
  try {
    const db = await getDb();
    const invites = await db.prepare(`
      SELECT cti.id, cti.token, cti.role, cti.expires_at,
             ct.name AS team_name, ct.id AS care_team_id,
             cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
             u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
      FROM care_team_invites cti
      JOIN care_teams ct ON cti.care_team_id = ct.id
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      JOIN users u ON cti.invited_by = u.id
      WHERE LOWER(cti.invited_email) = LOWER(?) AND cti.status = 'pending' AND cti.expires_at > NOW()
      ORDER BY cti.created_at DESC
    `).all(req.user.email);
    res.json({ invites });
  } catch (err) {
    console.error("Pending invites error:", err);
    res.status(500).json({ error: "Failed to check pending invites" });
  }
});

// ─── GET /api/care-teams ─── List care teams the current user belongs to
router.get("/", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const teams = await db.prepare(`
      SELECT ct.*, ctm.role AS my_role, ctm.relationship_label AS my_relationship_label,
        cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM care_team_members ctm
      JOIN care_teams ct ON ctm.care_team_id = ct.id
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      WHERE ctm.user_id = ?
      ORDER BY ct.created_at DESC
    `).all(req.user.id);

    // Add member counts + member summaries (for avatar display)
    for (const team of teams) {
      const members = await db.prepare(`
        SELECT ctm.role, u.first_name, u.last_name, u.avatar_url
        FROM care_team_members ctm
        JOIN users u ON ctm.user_id = u.id
        WHERE ctm.care_team_id = ?
        ORDER BY ctm.role = 'leader' DESC, ctm.joined_at ASC
      `).all(team.id);
      team.memberCount = members.length;
      team.members = members.map(m => ({
        firstName: m.first_name,
        lastName: m.last_name,
        avatarUrl: m.avatar_url,
        role: m.role,
      }));
      // Also get pending invite count
      const inviteCount = await db.prepare(
        "SELECT COUNT(*) AS count FROM care_team_invites WHERE care_team_id = ? AND status = 'pending'"
      ).get(team.id);
      team.pendingInvites = parseInt(inviteCount?.count || 0);
    }

    res.json({ careTeams: teams });
  } catch (err) {
    console.error("List care teams error:", err);
    res.status(500).json({ error: "Failed to list care teams" });
  }
});

// ─── GET /api/care-teams/:id ─── Get care team details with members and pending invites
router.get("/:id", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();

    // Verify membership
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Care team not found" });

    const team = await db.prepare(`
      SELECT ct.*, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name,
        cr.age AS recipient_age, cr.location_city AS recipient_city, cr.location_state AS recipient_state,
        cr.linked_user_id AS recipient_linked_user_id,
        lu.accessibility_prefs AS recipient_accessibility_prefs,
        cr.sms_phone AS recipient_sms_phone,
        cr.notification_channel AS recipient_notification_channel,
        cr.sms_reminder_intervals AS recipient_sms_reminder_intervals,
        bu.first_name || ' ' || bu.last_name AS billing_contact_name,
        bu.email AS billing_contact_email
      FROM care_teams ct
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      LEFT JOIN users lu ON cr.linked_user_id = lu.id
      LEFT JOIN users bu ON ct.billing_user_id = bu.id
      WHERE ct.id = ?
    `).get(req.params.id);

    // Get members
    // v1.105.79 — the member's actual capability set comes along, so the UI can show what
    // each person can really do instead of a role word that has been lying. crs.capabilities
    // is NULL for anyone predating v1.105.78; the client resolves that through the same legacy
    // mapping the server uses.
    const members = await db.prepare(`
      SELECT ctm.id AS membership_id, ctm.role, ctm.joined_at, ctm.relationship_label,
        u.id AS user_id, u.first_name, u.last_name, u.email, u.avatar_url,
        crs.capabilities AS capabilities, crs.permission AS share_permission
      FROM care_team_members ctm
      JOIN users u ON ctm.user_id = u.id
      LEFT JOIN care_teams ct2 ON ct2.id = ctm.care_team_id
      LEFT JOIN care_recipient_shares crs
        ON crs.care_recipient_id = ct2.care_recipient_id AND crs.shared_with_user_id = ctm.user_id
      WHERE ctm.care_team_id = ?
      ORDER BY ctm.role = 'leader' DESC, ctm.joined_at ASC
    `).all(req.params.id);

    // Get pending invites (leaders only)
    let invites = [];
    if (membership.role === "leader") {
      invites = await db.prepare(
        "SELECT id, invited_email, role, status, expires_at, created_at, capabilities FROM care_team_invites WHERE care_team_id = ? AND status = 'pending' ORDER BY created_at DESC"
      ).all(req.params.id);
    }

    res.json({
      careTeam: {
        ...team,
        myRole: membership.role,
        myUserId: req.user.id,
        members: members.map(m => ({
          capabilities: require("../utils/capabilities").capabilitiesFor(
            m.capabilities,
            m.role === "leader" ? "edit" : (m.share_permission || "view")
          ),
          membershipId: m.membership_id,
          userId: m.user_id,
          firstName: m.first_name,
          lastName: m.last_name,
          email: m.email,
          avatarUrl: m.avatar_url,
          role: m.role,
          joinedAt: m.joined_at,
          relationshipLabel: m.relationship_label,
        })),
        invites: invites.map(i => ({
          id: i.id,
          email: i.invited_email,
          role: i.role,
          status: i.status,
          expiresAt: i.expires_at,
          createdAt: i.created_at,
          // v1.105.81 — so the pending row can say "Viewer" rather than the role word.
          capabilities: require("../utils/capabilities").capabilitiesFor(i.capabilities, null),
        })),
      },
    });
  } catch (err) {
    console.error("Get care team error:", err);
    res.status(500).json({ error: "Failed to get care team" });
  }
});

// ─── GET /api/care-teams/:id/caregivers ─── All caregivers who've cared for this recipient
router.get("/:id/caregivers", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Care team not found" });

    const team = await db.prepare("SELECT care_recipient_id FROM care_teams WHERE id = ?").get(req.params.id);
    if (!team) return res.status(404).json({ error: "Care team not found" });

    // Get caregivers from sessions AND assignments (union to catch assigned-but-no-sessions)
    const caregivers = await db.prepare(`
      SELECT cp.id AS caregiver_profile_id, u.id AS user_id,
        u.first_name, u.last_name, u.avatar_url,
        COUNT(DISTINCT cs.id) AS visit_count,
        MAX(cs.scheduled_date) AS last_visit_date,
        MAX(CASE WHEN ca.is_favorite = 1 THEN 1 ELSE 0 END) AS is_favorite,
        MAX(ca.id) AS assignment_id,
        MAX(CASE WHEN ca.is_active = 1 THEN 1 ELSE 0 END) AS is_assigned
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      LEFT JOIN care_sessions cs ON cs.caregiver_id = cp.id
        AND cs.care_recipient_id = ? AND cs.status IN ('completed', 'in_progress')
      LEFT JOIN caregiver_assignments ca ON ca.caregiver_profile_id = cp.id
        AND ca.care_recipient_id = ? AND ca.is_active = 1
      WHERE (cs.id IS NOT NULL OR ca.id IS NOT NULL)
      GROUP BY cp.id, u.id, u.first_name, u.last_name, u.avatar_url
      ORDER BY MAX(CASE WHEN ca.is_favorite = 1 THEN 1 ELSE 0 END) DESC,
               MAX(CASE WHEN ca.is_active = 1 THEN 1 ELSE 0 END) DESC,
               COUNT(DISTINCT cs.id) DESC
    `).all(team.care_recipient_id, team.care_recipient_id);

    res.json({ caregivers, careRecipientId: team.care_recipient_id });
  } catch (err) {
    console.error("Get care team caregivers error:", err);
    res.status(500).json({ error: "Failed to get caregivers" });
  }
});

// ─── PUT /api/care-teams/:id ─── Update care team name (leader only)
router.put("/:id", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Care team not found" });
    if (membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can update the team" });

    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Team name is required" });

    await db.prepare("UPDATE care_teams SET name = ?, updated_at = NOW() WHERE id = ?")
      .run(name.trim(), req.params.id);

    res.json({ message: "Care team updated" });
  } catch (err) {
    console.error("Update care team error:", err);
    res.status(500).json({ error: "Failed to update care team" });
  }
});

// ─── PUT /api/care-teams/:id/billing ─── Set or clear the billing contact (leader only)
// The billing contact's Stripe will be used for all session payments for this care recipient.
router.put("/:id/billing", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Care team not found" });
    if (membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can set the billing contact" });

    const { billingUserId } = req.body;

    // If clearing the billing contact
    if (!billingUserId) {
      await db.prepare("UPDATE care_teams SET billing_user_id = NULL, updated_at = NOW() WHERE id = ?")
        .run(req.params.id);
      return res.json({ message: "Billing contact cleared — booker will be charged" });
    }

    // Verify the billing user is a member of this care team
    const billingMember = await db.prepare(
      "SELECT ctm.user_id, u.first_name, u.last_name, u.stripe_customer_id FROM care_team_members ctm JOIN users u ON ctm.user_id = u.id WHERE ctm.care_team_id = ? AND ctm.user_id = ?"
    ).get(req.params.id, billingUserId);
    if (!billingMember) return res.status(400).json({ error: "Billing contact must be a member of this care team" });

    await db.prepare("UPDATE care_teams SET billing_user_id = ?, updated_at = NOW() WHERE id = ?")
      .run(billingUserId, req.params.id);

    res.json({
      message: `Billing contact set to ${billingMember.first_name} ${billingMember.last_name}`,
      billingContact: {
        userId: billingMember.user_id,
        name: `${billingMember.first_name} ${billingMember.last_name}`,
        hasStripe: !!billingMember.stripe_customer_id,
      },
    });
  } catch (err) {
    console.error("Set billing contact error:", err);
    res.status(500).json({ error: "Failed to set billing contact" });
  }
});

// ─── POST /api/care-teams/:id/invite ─── Invite someone to the care team (leader only)
// ─── GET /api/care-teams/:id/invite-search?q= — who can I add? (v1.105.79) ───
//
// Deliberately NOT /api/connections/search, which matches every active user on the platform
// by name. This search is the doorway to another person's health record, and a global name
// lookup would let anyone enumerate who has an InPlace account. Pete's call: only people you
// already have a relationship with.
//
// "Connected" means an accepted connection, or someone you already share a care team with.
// Anyone else can still be invited — by typing their full email address, which proves you
// already know it.
router.get("/:id/invite-search", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Care team not found" });
    if (membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can invite members" });

    const q = (req.query.q || "").trim().toLowerCase();
    if (q.length < 2) return res.json({ people: [] });
    const term = `%${q}%`;

    const people = await db.prepare(`
      SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.profile_photo, u.avatar_url,
             EXISTS (
               SELECT 1 FROM care_team_members m WHERE m.care_team_id = ? AND m.user_id = u.id
             ) AS already_on_team
      FROM users u
      WHERE u.id != ?
        AND COALESCE(u.is_demo, 0) = 0
        AND COALESCE(u.is_active, 1) = 1
        AND (
          -- Two ways in, and the relationship requirement applies to the NAME branch only.
          -- An earlier version ANDed it across both, which silently killed the email escape
          -- hatch the UI copy promises ("type the email address they'll sign up with").
          --
          -- Name search: only people you already know, so nobody can enumerate the user base.
          (
            LOWER(u.first_name || ' ' || u.last_name) LIKE ?
            AND (
              EXISTS (
                SELECT 1 FROM connections c
                WHERE c.status = 'accepted'
                  AND ((c.requester_id = ? AND c.recipient_id = u.id) OR (c.recipient_id = ? AND c.requester_id = u.id))
              )
              OR EXISTS (
                SELECT 1 FROM care_team_members mine
                JOIN care_team_members theirs ON theirs.care_team_id = mine.care_team_id
                WHERE mine.user_id = ? AND theirs.user_id = u.id
              )
            )
          )
          -- Exact email: knowing the whole address is itself the proof you know them. A
          -- partial match would be enumeration by another route, so this is an equality test,
          -- never LIKE.
          OR LOWER(u.email) = ?
        )
      ORDER BY u.first_name ASC
      LIMIT 20
    `).all(req.params.id, req.user.id, term, req.user.id, req.user.id, req.user.id, q);

    res.json({
      people: people.map((p) => ({
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        email: p.email,
        photo: p.profile_photo || p.avatar_url || null,
        alreadyOnTeam: p.already_on_team === true || p.already_on_team === 1,
      })),
    });
  } catch (err) {
    console.error("Invite search error:", err);
    res.status(500).json({ error: "Could not search for people" });
  }
});

router.post("/:id/invite", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Care team not found" });
    if (membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can invite members" });

    const { email, role = "member", capabilities } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!["member", "viewer", "care_recipient"].includes(role)) return res.status(400).json({ error: "Role must be member, viewer, or care_recipient" });

    // v1.105.79 — the owner ticks capabilities when sending, and the invite carries them, so
    // the share created at accept is exactly what was chosen rather than re-derived from the
    // role word. Unknown values are dropped rather than trusted: this list is the difference
    // between reading a health record and not.
    let capsJson = null;
    if (Array.isArray(capabilities)) {
      const clean = capabilities.filter((c) => ALL_CAPS.includes(c));
      if (clean.length === 0) return res.status(400).json({ error: "Choose what this person can do" });
      capsJson = JSON.stringify(clean);
    }

    // v1.71.0 claim-by-invite: a care_recipient invite lets the person receiving care
    // claim this profile (unique token + exact email match at accept — never name matching).
    // Only valid while the profile is unclaimed.
    if (role === "care_recipient") {
      const rec = await db.prepare(
        "SELECT cr.linked_user_id FROM care_teams ct JOIN care_recipients cr ON ct.care_recipient_id = cr.id WHERE ct.id = ?"
      ).get(req.params.id);
      if (!rec) return res.status(404).json({ error: "Care team not found" });
      if (rec.linked_user_id) return res.status(400).json({ error: "This care recipient already has a linked account" });
    }

    // Check if already a member
    const existingUser = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existingUser) {
      const existingMember = await db.prepare(
        "SELECT id FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
      ).get(req.params.id, existingUser.id);
      if (existingMember) return res.status(400).json({ error: "This person is already on the care team" });
    }

    // Check for existing pending invite
    const existingInvite = await db.prepare(
      "SELECT id FROM care_team_invites WHERE care_team_id = ? AND invited_email = ? AND status = 'pending'"
    ).get(req.params.id, email);
    if (existingInvite) return res.status(400).json({ error: "An invite is already pending for this email" });

    // Get team details for the email
    const team = await db.prepare(`
      SELECT ct.name, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM care_teams ct JOIN care_recipients cr ON ct.care_recipient_id = cr.id WHERE ct.id = ?
    `).get(req.params.id);

    const inviter = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);

    // Create invite
    const inviteId = uuid();
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    await db.prepare(
      "INSERT INTO care_team_invites (id, care_team_id, invited_email, invited_by, role, token, status, expires_at, capabilities) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
    ).run(inviteId, req.params.id, email, req.user.id, role, token, expiresAt, capsJson);

    // Send invite email
    const appUrl = process.env.APP_URL || "https://yourinplace.com";
    const inviteUrl = `${appUrl}?invite=${token}`;
    const inviterName = `${inviter.first_name} ${inviter.last_name}`;
    const recipientName = `${team.recipient_first_name} ${team.recipient_last_name}`;

    await sendEmail({
      to: email,
      subject: `${inviterName} invited you to ${recipientName}'s Care Team`,
      html: brandedHtml({
        title: "You're Invited!",
        greeting: `${inviterName} has invited you to join ${recipientName}'s Care Team on InPlace.`,
        body: `As a care team ${role}, you'll be able to coordinate care, view schedules, and communicate with the rest of the team.`,
        ctaUrl: inviteUrl,
        ctaText: "Accept Invite",
        footnote: "This invite expires in 7 days. If you didn't expect this invitation, you can safely ignore it.",
      }),
    });

    // If invitee already has an account, also send in-app notification
    let inApp = false;
    if (existingUser) {
      try {
        await db.prepare(
          "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, 'care_team_invite', ?, ?, ?)"
        ).run(uuid(), existingUser.id, `You're invited to ${recipientName}'s Care Team`,
          `${inviterName} invited you to join ${recipientName}'s care team as a ${role}. Open the app to accept.`,
          JSON.stringify({ inviteToken: token, careTeamId: req.params.id, recipientName })
        );
        // Real-time push so they see it immediately
        const emitToUser = req.app.get("emitToUser");
        if (emitToUser) emitToUser(existingUser.id, "care_team_invite", { token, teamName: team.name, recipientName });
        // Push notification
        const { sendPushToUser } = require("./push");
        sendPushToUser(existingUser.id, {
          title: "Care Team Invite",
          body: `${inviterName} invited you to join ${recipientName}'s care team`,
          data: { type: "care_team_invite", token },
        }, "care_team_invite").catch(() => {});
        inApp = true;
      } catch (notifErr) {
        console.warn("[invite] In-app notification failed (non-blocking):", notifErr.message);
      }
    }

    res.status(201).json({
      invite: {
        id: inviteId,
        email,
        role,
        status: "pending",
        expiresAt,
      },
      message: inApp ? `Invitation sent to ${email} (in-app + email)` : `Invitation sent to ${email} (email only — not yet registered)`,
    });
  } catch (err) {
    console.error("Invite to care team error:", err);
    res.status(500).json({ error: "Failed to send invitation" });
  }
});

// ─── POST /api/care-teams/:id/invite/:inviteId/resend ─── Resend an invite (leader only)
router.post("/:id/invite/:inviteId/resend", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership || membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can resend invites" });

    const invite = await db.prepare(
      "SELECT * FROM care_team_invites WHERE id = ? AND care_team_id = ? AND status = 'pending'"
    ).get(req.params.inviteId, req.params.id);
    if (!invite) return res.status(404).json({ error: "Invite not found" });

    // Extend expiry and resend
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare("UPDATE care_team_invites SET expires_at = ? WHERE id = ?").run(newExpiry, invite.id);

    const team = await db.prepare(`
      SELECT ct.name, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
      FROM care_teams ct JOIN care_recipients cr ON ct.care_recipient_id = cr.id WHERE ct.id = ?
    `).get(req.params.id);
    const inviter = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);

    const appUrl = process.env.APP_URL || "https://yourinplace.com";
    await sendEmail({
      to: invite.invited_email,
      subject: `Reminder: Join ${team.recipient_first_name} ${team.recipient_last_name}'s Care Team`,
      html: brandedHtml({
        title: "Care Team Invite Reminder",
        greeting: `${inviter.first_name} ${inviter.last_name} is still waiting for you to join ${team.recipient_first_name}'s Care Team.`,
        body: "Click below to accept and start coordinating care together.",
        ctaUrl: `${appUrl}?invite=${invite.token}`,
        ctaText: "Accept Invite",
        footnote: "This invite expires in 7 days.",
      }),
    });

    res.json({ message: `Invite resent to ${invite.invited_email}` });
  } catch (err) {
    console.error("Resend invite error:", err);
    res.status(500).json({ error: "Failed to resend invite" });
  }
});

// ─── DELETE /api/care-teams/:id/invite/:inviteId ─── Cancel a pending invite (leader only)
router.delete("/:id/invite/:inviteId", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership || membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can cancel invites" });

    await db.prepare("UPDATE care_team_invites SET status = 'cancelled' WHERE id = ? AND care_team_id = ? AND status = 'pending'")
      .run(req.params.inviteId, req.params.id);

    res.json({ message: "Invite cancelled" });
  } catch (err) {
    console.error("Cancel invite error:", err);
    res.status(500).json({ error: "Failed to cancel invite" });
  }
});

// ─── POST /api/care-teams/accept-invite ─── Accept an invite (authenticated user, uses token)
router.post("/accept-invite", authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Invite token is required" });

    const db = await getDb();
    const invite = await db.prepare(
      "SELECT * FROM care_team_invites WHERE token = ? AND status = 'pending'"
    ).get(token);
    if (!invite) return res.status(404).json({ error: "Invalid or expired invite" });

    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      await db.prepare("UPDATE care_team_invites SET status = 'expired' WHERE id = ?").run(invite.id);
      return res.status(400).json({ error: "This invite has expired. Ask the team leader to resend it." });
    }

    // Check if email matches the logged-in user
    if (invite.invited_email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: `This invite was sent to ${invite.invited_email}. Please sign in with that email.` });
    }

    // ─── v1.71.0 claim-by-invite ───
    // A care_recipient invite links the accepting account to the team's care
    // recipient profile. Identity rail: unique invite token + exact email match
    // (checked above) — never name matching (removed in v1.70.0 as a PHI hazard).
    // Atomic: only links while the profile is unclaimed and the user isn't
    // already linked to another profile.
    let claimedRecipient = false;
    if (invite.role === 'care_recipient') {
      try {
        const claimTeam = await db.prepare("SELECT care_recipient_id FROM care_teams WHERE id = ?").get(invite.care_team_id);
        const alreadyLinked = await db.prepare("SELECT id FROM care_recipients WHERE linked_user_id = ? LIMIT 1").get(req.user.id);
        if (claimTeam && !alreadyLinked) {
          const linked = await db.prepare(`
            UPDATE care_recipients SET
              linked_user_id = ?,
              authorization_tier = 'tier1',
              consent_status = 'verified',
              consent_method = 'invite_accept',
              consent_verified_at = NOW()
            WHERE id = ? AND linked_user_id IS NULL
          `).run(req.user.id, claimTeam.care_recipient_id);
          if (linked.changes > 0) {
            claimedRecipient = true;
            // Unlock CaredForView: add care_for to roles (additive; primary role unchanged)
            try {
              const u = await db.prepare("SELECT role, roles FROM users WHERE id = ?").get(req.user.id);
              let list = [];
              try { list = u.roles ? JSON.parse(u.roles) : []; } catch { list = []; }
              if (!list.length && u.role) list = [u.role];
              if (!list.includes('care_for')) {
                list.push('care_for');
                await db.prepare("UPDATE users SET roles = ? WHERE id = ?").run(JSON.stringify(list), req.user.id);
              }
            } catch (e) { captureException(e, { where: "careTeams: add care_for role on claim" }); }
            // Consent audit trail
            try {
              await db.prepare(
                "INSERT INTO consent_audit_log (id, care_recipient_id, actor_id, actor_role, event_type, description) VALUES (?, ?, ?, 'care_recipient', 'linked_via_invite', ?)"
              ).run(uuid(), claimTeam.care_recipient_id, req.user.id,
                `Account ${req.user.email} claimed this care profile via care-team invite (token + email match)`);
            } catch (e) { captureException(e, { where: "careTeams: consent audit on claim" }); }
          }
        }
      } catch (e) { captureException(e, { where: "careTeams: claim-by-invite" }); }
    }

    // Check if already a member
    const existing = await db.prepare(
      "SELECT id FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(invite.care_team_id, req.user.id);
    if (existing) {
      await db.prepare("UPDATE care_team_invites SET status = 'accepted' WHERE id = ?").run(invite.id);
      return res.json({ message: "You're already on this care team", careTeamId: invite.care_team_id, claimedRecipient });
    }

    // Add as member
    const memberId = uuid();
    await db.prepare(
      "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, ?, ?)"
    ).run(memberId, invite.care_team_id, req.user.id, invite.role === 'care_recipient' ? 'member' : invite.role, invite.invited_by);

    // Mark invite as accepted
    await db.prepare("UPDATE care_team_invites SET status = 'accepted' WHERE id = ?").run(invite.id);

    // Auto-connect with all existing team members for direct messaging
    const existingMembers = await db.prepare(
      "SELECT user_id FROM care_team_members WHERE care_team_id = ? AND user_id != ?"
    ).all(invite.care_team_id, req.user.id);
    for (const member of existingMembers) {
      const existingConn = await db.prepare(
        "SELECT id FROM connections WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)"
      ).get(req.user.id, member.user_id, member.user_id, req.user.id);
      if (!existingConn) {
        await db.prepare(
          "INSERT INTO connections (id, requester_id, recipient_id, status) VALUES (?, ?, ?, 'accepted')"
        ).run(uuid(), req.user.id, member.user_id);
      }
    }

    // Auto-add to care team conversation
    const careTeamConv = await db.prepare(
      "SELECT id FROM conversations WHERE care_team_id = ? AND type = 'care_team'"
    ).get(invite.care_team_id);
    if (careTeamConv) {
      const alreadyInConv = await db.prepare(
        "SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
      ).get(careTeamConv.id, req.user.id);
      if (!alreadyInConv) {
        await db.prepare(
          "INSERT INTO conversation_members (id, conversation_id, user_id, role) VALUES (?, ?, ?, 'member')"
        ).run(uuid(), careTeamConv.id, req.user.id);
      }
    }

    // Also add to care_recipient_shares for backward compatibility
    const team = await db.prepare("SELECT care_recipient_id FROM care_teams WHERE id = ?").get(invite.care_team_id);
    if (team) {
      const shareExists = await db.prepare(
        "SELECT id FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
      ).get(team.care_recipient_id, req.user.id);
      if (!shareExists) {
        await db.prepare(
          "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, shared_by_user_id) VALUES (?, ?, ?, ?, ?)"
        ).run(uuid(), team.care_recipient_id, req.user.id, invite.role === "viewer" ? "view" : "edit", invite.invited_by);
        // v1.105.78 — if the invite carried an explicit capability set, it wins over the role.
        // What the owner ticked when sending is what the share gets, rather than being
        // re-derived from a role name here.
        if (invite.capabilities) {
          await db.prepare(
            "UPDATE care_recipient_shares SET capabilities = ? WHERE care_recipient_id = ? AND shared_with_user_id = ?"
          ).run(invite.capabilities, team.care_recipient_id, req.user.id).catch(() => {});
        }
      }
    }

    // Notify the team leader
    const leader = await db.prepare(
      "SELECT user_id FROM care_team_members WHERE care_team_id = ? AND role = 'leader'"
    ).get(invite.care_team_id);
    if (leader) {
      // Look up actual names from DB (JWT only has id/email/roles)
      const memberUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
      const memberName = memberUser ? `${memberUser.first_name} ${memberUser.last_name}`.trim() : "Someone";
      const teamInfo = await db.prepare(`
        SELECT ct.name, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name
        FROM care_teams ct JOIN care_recipients cr ON ct.care_recipient_id = cr.id WHERE ct.id = ?
      `).get(invite.care_team_id);
      const recipientName = teamInfo ? `${teamInfo.recipient_first_name} ${teamInfo.recipient_last_name}`.trim() : null;
      const teamLabel = recipientName ? `${recipientName}'s care team` : (teamInfo?.name || "your care team");

      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message) VALUES (?, ?, 'team_join', ?, ?)"
      ).run(uuid(), leader.user_id, "New team member",
        `${memberName} joined ${teamLabel}`
      );

      // Real-time notification
      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) emitToUser(leader.user_id, "activity_update", { type: "team_join" });

      // Push notification to team leader
      const { sendPushToUser, notifyAdmins } = require("./push");
      sendPushToUser(leader.user_id, {
        title: "New Team Member!",
        body: `${memberName} joined ${teamLabel}`,
        data: { type: "team_join", careTeamId: invite.care_team_id },
      }, "team_join").catch(() => {});

      // Admin notification
      notifyAdmins("invite_accepted", {
        title: `${memberName} joined ${teamLabel}`,
        body: `${memberName} is now on ${teamLabel}`,
        data: { type: "invite_accepted", careTeamId: invite.care_team_id },
      });
    }

    res.json({ message: claimedRecipient ? "You've joined — this is your care profile now!" : "You've joined the care team!", careTeamId: invite.care_team_id, claimedRecipient });
  } catch (err) {
    console.error("Accept invite error:", err);
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

// (invite-info endpoint is defined above, before authenticate middleware)

// ─── DELETE /api/care-teams/:id/members/:userId ─── Remove a member (leader only, can't remove self)
router.delete("/:id/members/:userId", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership || membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can remove members" });
    if (req.params.userId === req.user.id) return res.status(400).json({ error: "You can't remove yourself from the team" });

    await db.prepare("DELETE FROM care_team_members WHERE care_team_id = ? AND user_id = ?")
      .run(req.params.id, req.params.userId);

    // Also remove from care_recipient_shares
    const team = await db.prepare("SELECT care_recipient_id FROM care_teams WHERE id = ?").get(req.params.id);
    if (team) {
      await db.prepare("DELETE FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?")
        .run(team.care_recipient_id, req.params.userId);
    }

    res.json({ message: "Member removed" });
  } catch (err) {
    console.error("Remove member error:", err);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// ─── PUT /api/care-teams/:id/members/:userId ─── Change a member's role (leader only)
router.put("/:id/members/:userId", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership || membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can change roles" });

    const { role, capabilities } = req.body;
    if (role && !["member", "viewer"].includes(role)) return res.status(400).json({ error: "Role must be member or viewer" });

    if (role) {
      await db.prepare("UPDATE care_team_members SET role = ? WHERE care_team_id = ? AND user_id = ?")
        .run(role, req.params.id, req.params.userId);
    }

    // v1.105.79 — this is the upgrade path Pete asked for: change what someone can do without
    // creating a second anything. The share row is keyed on (recipient, user), so promoting a
    // viewer to full access is an UPDATE, never an INSERT.
    if (Array.isArray(capabilities)) {
      const clean = capabilities.filter((c) => ALL_CAPS.includes(c));
      if (clean.length === 0) return res.status(400).json({ error: "Choose what this person can do" });
      const team = await db.prepare("SELECT care_recipient_id FROM care_teams WHERE id = ?").get(req.params.id);
      if (!team) return res.status(404).json({ error: "Care team not found" });
      const existing = await db.prepare(
        "SELECT id FROM care_recipient_shares WHERE care_recipient_id = ? AND shared_with_user_id = ?"
      ).get(team.care_recipient_id, req.params.userId);
      if (existing) {
        await db.prepare("UPDATE care_recipient_shares SET capabilities = ? WHERE id = ?")
          .run(JSON.stringify(clean), existing.id);
      } else {
        await db.prepare(
          "INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, capabilities, shared_by_user_id) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(uuid(), team.care_recipient_id, req.params.userId, "view", JSON.stringify(clean), req.user.id);
      }
    }

    res.json({ message: "Updated" });
  } catch (err) {
    console.error("Change role error:", err);
    res.status(500).json({ error: "Failed to change role" });
  }
});

// ─── PUT /api/care-teams/:id/my-label ─── Update own relationship label
router.put("/:id/my-label", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT id FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Not a member of this care team" });

    const { relationshipLabel } = req.body;
    await db.prepare("UPDATE care_team_members SET relationship_label = ? WHERE care_team_id = ? AND user_id = ?")
      .run(relationshipLabel?.trim() || null, req.params.id, req.user.id);

    res.json({ message: "Relationship label updated" });
  } catch (err) {
    console.error("Update relationship label error:", err);
    res.status(500).json({ error: "Failed to update relationship label" });
  }
});

// ─── PUT /api/care-teams/:teamId/member-prefs/:userId ───
// Let a family member set accessibility prefs for a care_for team member (e.g., Pete sets Betty's text size)
router.put("/:teamId/member-prefs/:userId", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { teamId, userId: targetUserId } = req.params;
    const { accessibilityPrefs } = req.body;

    if (!accessibilityPrefs) {
      return res.status(400).json({ error: "accessibilityPrefs required" });
    }

    // Verify caller is a family member of this team
    const callerMember = await db.prepare(
      // v1.105.48 — care_team_members has no `status` column, so this threw and the route
      // always 500'd: setting a care recipient's accessibility prefs (text size and the
      // like) has never worked. A membership row IS the membership.
      "SELECT * FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(teamId, req.user.id);
    if (!callerMember) {
      return res.status(403).json({ error: "Not a member of this care team" });
    }

    // Verify target user is a care recipient linked to this team
    // Betty isn't in care_team_members — she's the care_recipient linked via care_teams.care_recipient_id → care_recipients.linked_user_id
    const linkedRecipient = await db.prepare(
      "SELECT cr.linked_user_id FROM care_teams ct JOIN care_recipients cr ON ct.care_recipient_id = cr.id WHERE ct.id = ? AND cr.linked_user_id = ?"
    ).get(teamId, targetUserId);

    // Also check if they're a care_for role member of the team (fallback)
    const targetMember = !linkedRecipient ? await db.prepare(
      "SELECT ctm.*, u.role FROM care_team_members ctm JOIN users u ON ctm.user_id = u.id WHERE ctm.care_team_id = ? AND ctm.user_id = ?"
    ).get(teamId, targetUserId) : null;

    if (!linkedRecipient && (!targetMember || targetMember.role !== 'care_for')) {
      return res.status(403).json({ error: "Can only set preferences for care recipients in your team" });
    }

    // Update the target user's accessibility prefs
    await db.prepare(
      "UPDATE users SET accessibility_prefs = ? WHERE id = ?"
    ).run(JSON.stringify(accessibilityPrefs), targetUserId);

    res.json({ success: true, accessibilityPrefs });
  } catch (err) {
    console.error("Update member prefs error:", err);
    res.status(500).json({ error: "Failed to update member preferences" });
  }
});

// ─── PUT /api/care-teams/:teamId/recipient-notifications ───
// Update SMS notification settings for the care recipient (leader only)
router.put("/:teamId/recipient-notifications", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { teamId } = req.params;
    const { smsPhone, notificationChannel, smsReminderIntervals } = req.body;

    // Verify caller is team leader
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(teamId, req.user.id);
    if (!membership) return res.status(404).json({ error: "Care team not found" });
    if (membership.role !== "leader") return res.status(403).json({ error: "Only team leaders can update notification settings" });

    // Validate notification channel
    const validChannels = ["push", "sms", "both", "none"];
    if (notificationChannel && !validChannels.includes(notificationChannel)) {
      return res.status(400).json({ error: "Invalid notification channel. Must be: push, sms, both, or none" });
    }

    // Validate phone if SMS is selected
    if (["sms", "both"].includes(notificationChannel) && !smsPhone) {
      return res.status(400).json({ error: "Phone number required for text message reminders" });
    }

    // Validate reminder intervals (must be array of valid minute values)
    const validIntervals = [120, 60, 30];
    let intervalsJson = null;
    if (smsReminderIntervals !== undefined) {
      const intervals = Array.isArray(smsReminderIntervals) ? smsReminderIntervals : [];
      const cleaned = intervals.filter(v => validIntervals.includes(Number(v))).map(Number);
      intervalsJson = JSON.stringify(cleaned);
    }

    // Get care recipient ID from team
    const team = await db.prepare("SELECT care_recipient_id FROM care_teams WHERE id = ?").get(teamId);
    if (!team) return res.status(404).json({ error: "Care team not found" });

    // Update care recipient
    if (intervalsJson !== null) {
      await db.prepare(
        "UPDATE care_recipients SET sms_phone = ?, notification_channel = ?, sms_reminder_intervals = ?, updated_at = NOW() WHERE id = ?"
      ).run(smsPhone || null, notificationChannel || "push", intervalsJson, team.care_recipient_id);
    } else {
      await db.prepare(
        "UPDATE care_recipients SET sms_phone = ?, notification_channel = ?, updated_at = NOW() WHERE id = ?"
      ).run(smsPhone || null, notificationChannel || "push", team.care_recipient_id);
    }

    res.json({
      success: true,
      smsPhone: smsPhone || null,
      notificationChannel: notificationChannel || "push",
      smsReminderIntervals: intervalsJson || "[120, 60, 30]",
    });
  } catch (err) {
    console.error("Update recipient notifications error:", err);
    res.status(500).json({ error: "Failed to update notification settings" });
  }
});

module.exports = router;
