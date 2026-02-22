const express = require("express");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { sendEmail, brandedHtml } = require("../utils/email");

const router = express.Router();

// Admin check middleware (same as admin.js)
async function checkAdmin(req, res, next) {
  try {
    const db = await getDb();
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    req.isAdmin = !!(user && user.is_admin);
    next();
  } catch (err) {
    console.error("Admin check error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

const APP_URL = process.env.APP_URL || "https://yourinplace.com";

// ─── GET /api/platform-invites/info?token=... ─── Public: get invite details for onboarding page
router.get("/info", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token required" });

    const db = await getDb();
    const invite = await db.prepare(`
      SELECT pi.*, u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
      FROM platform_invites pi
      JOIN users u ON pi.invited_by = u.id
      WHERE pi.token = ?
    `).get(token);

    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.status !== "pending") return res.status(400).json({ error: `Invite is ${invite.status}` });
    if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: "Invite has expired" });

    res.json({
      invite: {
        email: invite.invited_email,
        role: invite.role,
        inviterName: `${invite.inviter_first_name} ${invite.inviter_last_name}`,
        expiresAt: invite.expires_at,
      },
    });
  } catch (err) {
    console.error("Invite info error:", err);
    res.status(500).json({ error: "Failed to get invite info" });
  }
});

// ─── POST /api/platform-invites/accept-invite ─── Authenticated: mark invite accepted after registration
router.post("/accept-invite", authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token required" });

    const db = await getDb();
    const invite = await db.prepare("SELECT * FROM platform_invites WHERE token = ?").get(token);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.status !== "pending") return res.status(400).json({ error: `Invite already ${invite.status}` });

    // Verify email matches
    if (invite.invited_email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ error: "Email does not match invite" });
    }

    await db.prepare("UPDATE platform_invites SET status = 'accepted' WHERE id = ?").run(invite.id);

    // Notify the admin who sent the invite via push
    const { notifyAdmins } = require("./push");
    const userName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;
    notifyAdmins("invite_accepted", {
      title: "Invite Accepted!",
      body: `${userName} just accepted your invite and joined InPlace`,
      data: { type: "invite_accepted", email: invite.invited_email, userId: req.user.id },
    });

    // Also notify via WebSocket if available
    const emitToUser = req.app.get("emitToUser");
    if (invite.invited_by && emitToUser) {
      emitToUser(invite.invited_by, "activity_update", {
        type: "invite_accepted",
        message: `${userName} accepted your invite`,
      });
    }

    res.json({ message: "Invite accepted" });
  } catch (err) {
    console.error("Accept invite error:", err);
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

// ─── All remaining routes require admin ───
router.use(authenticate, checkAdmin, requireAdmin);

// ─── POST /api/platform-invites ─── Create and send invite
router.post("/", async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    if (!["caregiver", "family", "care_for"].includes(role)) {
      return res.status(400).json({ error: "Role must be caregiver, family, or care_for" });
    }

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();

    // Check if already registered
    const existingUser = await db.prepare("SELECT id, email FROM users WHERE LOWER(email) = ?").get(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ error: "User already registered with this email" });
    }

    // Check for existing pending invite
    const existingInvite = await db.prepare(
      "SELECT id FROM platform_invites WHERE LOWER(invited_email) = ? AND status = 'pending'"
    ).get(normalizedEmail);
    if (existingInvite) {
      return res.status(409).json({ error: "Pending invite already exists for this email" });
    }

    // Generate token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    const id = uuid();

    await db.prepare(`
      INSERT INTO platform_invites (id, invited_email, invited_by, role, token, status, expires_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, email.trim(), req.user.id, role, token, expiresAt);

    // Send invite email — look up admin's name from DB
    const adminUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const inviterName = adminUser ? `${adminUser.first_name} ${adminUser.last_name}` : "InPlace Admin";
    const roleLabel = role === "caregiver" ? "caregiver" : role === "family" ? "care team member" : "care recipient";
    const inviteUrl = `${APP_URL}?platformInvite=${token}`;

    sendEmail({
      to: email.trim(),
      subject: `You're invited to join InPlace as a ${roleLabel}`,
      html: brandedHtml({
        title: "You're Invited!",
        greeting: `${inviterName} has invited you to join InPlace as a ${roleLabel}.`,
        body: role === "caregiver"
          ? "Provide care to families in your community and earn on your own schedule. Click below to complete your profile and get started."
          : "Coordinate care for your loved ones with a trusted team. Click below to create your account.",
        ctaUrl: inviteUrl,
        ctaText: "Get Started",
        footnote: "This invite expires in 7 days. If you didn't expect this invitation, you can safely ignore it.",
      }),
    }).catch((err) => console.error("Invite email error:", err));

    // If email was on waitlist, mark it (add invited_at or just note it)
    const waitlistEntry = await db.prepare("SELECT id FROM waitlist WHERE LOWER(email) = ?").get(normalizedEmail);

    res.status(201).json({
      invite: { id, email: email.trim(), role, status: "pending", expiresAt, token },
      message: `Invite sent to ${email.trim()}`,
      wasOnWaitlist: !!waitlistEntry,
    });
  } catch (err) {
    console.error("Create invite error:", err);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

// ─── GET /api/platform-invites ─── List invites
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const { status, role, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT pi.*, u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
      FROM platform_invites pi
      JOIN users u ON pi.invited_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      sql += ` AND pi.status = ?`;
    }
    if (role) {
      params.push(role);
      sql += ` AND pi.role = ?`;
    }

    sql += ` ORDER BY pi.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const invites = await db.prepare(sql).all(...params);

    // Total count
    let countSql = "SELECT COUNT(*) AS count FROM platform_invites WHERE 1=1";
    const countParams = [];
    if (status) { countParams.push(status); countSql += ` AND status = ?`; }
    if (role) { countParams.push(role); countSql += ` AND role = ?`; }
    const total = await db.prepare(countSql).get(...countParams);

    res.json({ invites, total: parseInt(total.count) });
  } catch (err) {
    console.error("List invites error:", err);
    res.status(500).json({ error: "Failed to list invites" });
  }
});

// ─── POST /api/platform-invites/:id/resend ─── Resend invite email
router.post("/:id/resend", async (req, res) => {
  try {
    const db = await getDb();
    const invite = await db.prepare("SELECT * FROM platform_invites WHERE id = ?").get(req.params.id);
    if (!invite) return res.status(404).json({ error: "Invite not found" });
    if (invite.status !== "pending") return res.status(400).json({ error: `Cannot resend ${invite.status} invite` });

    // Extend expiry
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare("UPDATE platform_invites SET expires_at = ? WHERE id = ?").run(newExpiry, invite.id);

    // Resend email
    const inviter = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(invite.invited_by);
    const inviterName = inviter ? `${inviter.first_name} ${inviter.last_name}` : "InPlace";
    const roleLabel = invite.role === "caregiver" ? "caregiver" : invite.role === "family" ? "care team member" : "care recipient";

    sendEmail({
      to: invite.invited_email,
      subject: `Reminder: You're invited to join InPlace`,
      html: brandedHtml({
        title: "Reminder: You're Invited!",
        greeting: `${inviterName} invited you to join InPlace as a ${roleLabel}.`,
        body: "We noticed you haven't completed your registration yet. Click below to get started — your invite has been extended.",
        ctaUrl: `${APP_URL}?platformInvite=${invite.token}`,
        ctaText: "Get Started",
        footnote: "This invite expires in 7 days.",
      }),
    }).catch((err) => console.error("Resend invite email error:", err));

    res.json({ message: "Invite resent", expiresAt: newExpiry });
  } catch (err) {
    console.error("Resend invite error:", err);
    res.status(500).json({ error: "Failed to resend invite" });
  }
});

// ─── DELETE /api/platform-invites/:id ─── Cancel invite
router.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const invite = await db.prepare("SELECT * FROM platform_invites WHERE id = ?").get(req.params.id);
    if (!invite) return res.status(404).json({ error: "Invite not found" });

    await db.prepare("UPDATE platform_invites SET status = 'cancelled' WHERE id = ?").run(invite.id);
    res.json({ message: "Invite cancelled" });
  } catch (err) {
    console.error("Cancel invite error:", err);
    res.status(500).json({ error: "Failed to cancel invite" });
  }
});

module.exports = router;
