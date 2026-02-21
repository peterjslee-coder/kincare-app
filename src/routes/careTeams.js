const express = require("express");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { sendEmail, brandedHtml } = require("../utils/email");

const router = express.Router();
router.use(authenticate);

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

    // Add member counts
    for (const team of teams) {
      const countRow = await db.prepare(
        "SELECT COUNT(*) AS count FROM care_team_members WHERE care_team_id = ?"
      ).get(team.id);
      team.memberCount = parseInt(countRow?.count || 0);
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
        cr.age AS recipient_age, cr.location_city AS recipient_city, cr.location_state AS recipient_state
      FROM care_teams ct
      JOIN care_recipients cr ON ct.care_recipient_id = cr.id
      WHERE ct.id = ?
    `).get(req.params.id);

    // Get members
    const members = await db.prepare(`
      SELECT ctm.id AS membership_id, ctm.role, ctm.joined_at, ctm.relationship_label,
        u.id AS user_id, u.first_name, u.last_name, u.email, u.avatar_url
      FROM care_team_members ctm
      JOIN users u ON ctm.user_id = u.id
      WHERE ctm.care_team_id = ?
      ORDER BY ctm.role = 'leader' DESC, ctm.joined_at ASC
    `).all(req.params.id);

    // Get pending invites (leaders only)
    let invites = [];
    if (membership.role === "leader") {
      invites = await db.prepare(
        "SELECT id, invited_email, role, status, expires_at, created_at FROM care_team_invites WHERE care_team_id = ? AND status = 'pending' ORDER BY created_at DESC"
      ).all(req.params.id);
    }

    res.json({
      careTeam: {
        ...team,
        myRole: membership.role,
        myUserId: req.user.id,
        members: members.map(m => ({
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
        })),
      },
    });
  } catch (err) {
    console.error("Get care team error:", err);
    res.status(500).json({ error: "Failed to get care team" });
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

// ─── POST /api/care-teams/:id/invite ─── Invite someone to the care team (leader only)
router.post("/:id/invite", requireRole("family"), async (req, res) => {
  try {
    const db = await getDb();
    const membership = await db.prepare(
      "SELECT role FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);
    if (!membership) return res.status(404).json({ error: "Care team not found" });
    if (membership.role !== "leader") return res.status(403).json({ error: "Only the team leader can invite members" });

    const { email, role = "member" } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!["member", "viewer"].includes(role)) return res.status(400).json({ error: "Role must be member or viewer" });

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
      "INSERT INTO care_team_invites (id, care_team_id, invited_email, invited_by, role, token, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
    ).run(inviteId, req.params.id, email, req.user.id, role, token, expiresAt);

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

    res.status(201).json({
      invite: {
        id: inviteId,
        email,
        role,
        status: "pending",
        expiresAt,
      },
      message: `Invitation sent to ${email}`,
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

    // Check if already a member
    const existing = await db.prepare(
      "SELECT id FROM care_team_members WHERE care_team_id = ? AND user_id = ?"
    ).get(invite.care_team_id, req.user.id);
    if (existing) {
      await db.prepare("UPDATE care_team_invites SET status = 'accepted' WHERE id = ?").run(invite.id);
      return res.json({ message: "You're already on this care team", careTeamId: invite.care_team_id });
    }

    // Add as member
    const memberId = uuid();
    await db.prepare(
      "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, ?, ?)"
    ).run(memberId, invite.care_team_id, req.user.id, invite.role, invite.invited_by);

    // Mark invite as accepted
    await db.prepare("UPDATE care_team_invites SET status = 'accepted' WHERE id = ?").run(invite.id);

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
      }
    }

    // Notify the team leader
    const leader = await db.prepare(
      "SELECT user_id FROM care_team_members WHERE care_team_id = ? AND role = 'leader'"
    ).get(invite.care_team_id);
    if (leader) {
      const teamInfo = await db.prepare(
        "SELECT ct.name FROM care_teams ct WHERE ct.id = ?"
      ).get(invite.care_team_id);
      await db.prepare(
        "INSERT INTO activity_feed (id, family_user_id, event_type, title, message) VALUES (?, ?, 'team_join', ?, ?)"
      ).run(uuid(), leader.user_id, "New team member",
        `${req.user.firstName || ""} ${req.user.lastName || ""} joined ${teamInfo?.name || "the care team"}`
      );

      // Real-time notification
      const emitToUser = req.app.get("emitToUser");
      if (emitToUser) emitToUser(leader.user_id, "activity_update", { type: "team_join" });
    }

    res.json({ message: "You've joined the care team!", careTeamId: invite.care_team_id });
  } catch (err) {
    console.error("Accept invite error:", err);
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

// ─── GET /api/care-teams/invite-info?token=... ─── Get invite details (for pre-login display)
router.get("/invite-info", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token required" });

    const db = await getDb();
    const invite = await db.prepare(
      "SELECT cti.*, ct.name AS team_name, cr.first_name AS recipient_first_name, cr.last_name AS recipient_last_name FROM care_team_invites cti JOIN care_teams ct ON cti.care_team_id = ct.id JOIN care_recipients cr ON ct.care_recipient_id = cr.id WHERE cti.token = ? AND cti.status = 'pending'"
    ).get(token);

    if (!invite) return res.status(404).json({ error: "Invalid or expired invite" });
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

    const { role } = req.body;
    if (!["member", "viewer"].includes(role)) return res.status(400).json({ error: "Role must be member or viewer" });

    await db.prepare("UPDATE care_team_members SET role = ? WHERE care_team_id = ? AND user_id = ?")
      .run(role, req.params.id, req.params.userId);

    res.json({ message: "Role updated" });
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

module.exports = router;
