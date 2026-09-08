// ─── /api/known-caregivers (v1.105.186) ───
//
// "I find someone interested in the wild. I get their name and number and email, and the next
// thing they get is an email to finish setting up their account." — Pete, Sep 7 2026.
//
// Read src/utils/knownCaregivers.js first for the posture: the family brought this person; this
// is not a vouch and never draws as a check InPlace ran. Email is the only channel (SMS is
// blocked on TCPA/10DLC); the phone is stored on their profile so they do not retype it.

const express = require("express");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { sendEmail, brandedHtml } = require("../utils/email");
const {
  KIND, INVITE_DAYS, OPEN_CAP_PER_LEADER,
  recipientIfLeader, relationshipFor, fulfillKnownCaregiverInvite,
} = require("../utils/knownCaregivers");
const { caregiverIdentityDoc } = require("../utils/identity");

const router = express.Router();
const APP_URL = process.env.APP_URL || "https://yourinplace.com";

router.use(authenticate, requireRole("family"));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function inviteUrl(token) { return `${APP_URL}?platformInvite=${token}`; }
function expiry() { return new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000).toISOString(); }

// "his mother, Betty" when the care team recorded a relationship; "Betty" when it did not.
function recipientPhrase(recipient, relationship) {
  const first = recipient.first_name;
  return relationship ? `their ${relationship.toLowerCase()}, ${first}` : first;
}

function inviteEmail({ inviterName, recipient, relationship, firstName, token, reminder }) {
  const who = esc(recipientPhrase(recipient, relationship));
  const rf = esc(recipient.first_name);
  const inv = esc(inviterName);
  const invFirst = esc(inviterName.split(" ")[0]);
  return {
    subject: reminder
      ? `Reminder: ${inviterName} asked you to care for ${recipient.first_name}`
      : `${inviterName} asked you to care for ${recipient.first_name}`,
    html: brandedHtml({
      title: reminder ? "Still here when you're ready" : `Care for ${rf}, get paid through InPlace`,
      greeting: `Hi ${esc(firstName)},`,
      body:
        `<strong>${inv}</strong> would like you to help care for ${who}, and has added you as ` +
        `${rf}'s caregiver on InPlace.<br><br>` +
        `Set up your account so ${invFirst} can book you and pay you through the app. ` +
        `It takes about ten minutes: a few quick details about you, where your pay should land, ` +
        `and a photo of your driver's licence.`,
      ctaUrl: inviteUrl(token),
      ctaText: "Finish setting up",
      footnote:
        `You're set up for ${rf} only. If you'd like to work with other families on InPlace later, ` +
        `you can add a background check from your account. This link expires in ${INVITE_DAYS} days. ` +
        `If you weren't expecting this, you can ignore it.`,
    }),
  };
}

// Progress for the leader's "Waiting on Carol · 2 of 4" line. Four jobs on the short path:
// account, quick details (profile exists), pay (Stripe), licence photo (submitted counts —
// approval is our wait, not hers).
async function progressFor(db, email) {
  const user = await db.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(email);
  if (!user) return { account: false, details: false, pay: false, licence: false, done: 0, of: 4, ready: false };
  const profile = await db.prepare(
    "SELECT id, stripe_onboard_complete FROM caregiver_profiles WHERE user_id = ?"
  ).get(user.id);
  const doc = await caregiverIdentityDoc(db, user.id, profile ? profile.id : null);
  const p = {
    userId: user.id,
    account: true,
    details: !!profile,
    pay: !!(profile && profile.stripe_onboard_complete),
    licence: !!doc,
  };
  p.done = ["account", "details", "pay", "licence"].filter((k) => p[k]).length;
  p.of = 4;
  p.ready = p.done === 4;
  return p;
}

// ─── GET /api/known-caregivers?careRecipientId= ───
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const { careRecipientId } = req.query;
    if (!careRecipientId) return res.status(400).json({ error: "careRecipientId required" });
    const recipient = await recipientIfLeader(db, careRecipientId, req.user.id);
    if (!recipient) return res.status(403).json({ error: "Only the care team leader can see this." });

    const rows = await db.prepare(`
      SELECT pi.*, u.first_name AS inviter_first_name, u.last_name AS inviter_last_name
      FROM platform_invites pi
      JOIN users u ON u.id = pi.invited_by
      WHERE pi.kind = ? AND pi.care_recipient_id = ? AND pi.status IN ('pending', 'accepted')
      ORDER BY pi.created_at DESC
    `).all(KIND, recipient.id);

    const invites = [];
    for (const r of rows) {
      const expired = r.status === "pending" && new Date(r.expires_at) < new Date();
      invites.push({
        id: r.id,
        name: r.invited_name,
        email: r.invited_email,
        phone: r.phone,
        status: expired ? "expired" : r.status,
        sentAt: r.created_at,
        expiresAt: r.expires_at,
        inviterName: `${r.inviter_first_name} ${r.inviter_last_name}`,
        progress: r.status === "accepted" ? await progressFor(db, r.invited_email) : null,
      });
    }
    res.json({ invites });
  } catch (err) {
    console.error("Known caregivers list error:", err);
    res.status(500).json({ error: "Failed to load invites" });
  }
});

// ─── POST /api/known-caregivers ─── { careRecipientId, name, email, phone? }
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const { careRecipientId, name, email, phone } = req.body || {};
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanPhone = phone ? String(phone).replace(/[^\d+]/g, "").slice(0, 20) : null;
    if (!careRecipientId) return res.status(400).json({ error: "careRecipientId required" });
    if (!cleanName) return res.status(400).json({ error: "Their name is required." });
    if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: "That email doesn't look right." });

    const recipient = await recipientIfLeader(db, careRecipientId, req.user.id);
    if (!recipient) return res.status(403).json({ error: "Only the care team leader can add a caregiver." });

    const inviter = await db.prepare("SELECT first_name, last_name, email FROM users WHERE id = ?").get(req.user.id);
    if (inviter && inviter.email && inviter.email.toLowerCase() === cleanEmail.toLowerCase()) {
      return res.status(400).json({ error: "That's your own email." });
    }

    // One open door at a time per email, and a small cap per leader so this cannot become a
    // bulk way around the safety check.
    const open = await db.prepare(
      "SELECT id, care_recipient_id FROM platform_invites WHERE kind = ? AND LOWER(invited_email) = LOWER(?) AND status = 'pending' AND expires_at > NOW()"
    ).get(KIND, cleanEmail);
    if (open) {
      return res.status(409).json({
        error: open.care_recipient_id === recipient.id
          ? "They already have an open invite for this care recipient. Resend it instead."
          : "They already have an open invite from another family. Ask them to finish that one first.",
      });
    }
    const openCount = await db.prepare(
      "SELECT COUNT(*) AS n FROM platform_invites WHERE kind = ? AND invited_by = ? AND status = 'pending' AND expires_at > NOW()"
    ).get(KIND, req.user.id);
    if (parseInt(openCount.n, 10) >= OPEN_CAP_PER_LEADER) {
      return res.status(429).json({ error: `You can have ${OPEN_CAP_PER_LEADER} invites open at once. Withdraw one first.` });
    }

    // An existing account changes what happens on accept, not whether we send.
    const existing = await db.prepare(
      "SELECT id, role, roles FROM users WHERE LOWER(email) = LOWER(?)"
    ).get(cleanEmail);
    if (existing) {
      const roles = existing.roles ? String(existing.roles).split(",") : [existing.role];
      if (!roles.includes("caregiver")) {
        return res.status(409).json({
          error: "That email already has an InPlace account that isn't a caregiver account. Ask them which email they'd like to use.",
        });
      }
    }

    const token = crypto.randomBytes(32).toString("hex");
    const id = uuid();
    const expiresAt = expiry();
    await db.prepare(`
      INSERT INTO platform_invites (id, invited_email, invited_by, role, token, status, expires_at, kind, care_recipient_id, invited_name, phone)
      VALUES (?, ?, ?, 'caregiver', ?, 'pending', ?, ?, ?, ?, ?)
    `).run(id, cleanEmail, req.user.id, token, expiresAt, KIND, recipient.id, cleanName, cleanPhone);

    const inviterName = inviter ? `${inviter.first_name} ${inviter.last_name}` : "Someone on InPlace";
    const relationship = await relationshipFor(db, recipient.id, req.user.id);
    const firstName = cleanName.split(/\s+/)[0];
    const mail = inviteEmail({ inviterName, recipient, relationship, firstName, token });
    sendEmail({ to: cleanEmail, ...mail }).catch((err) => console.error("Known caregiver invite email error:", err));

    res.status(201).json({
      invite: { id, name: cleanName, email: cleanEmail, phone: cleanPhone, status: "pending", sentAt: new Date().toISOString(), expiresAt, progress: null },
      existingAccount: !!existing,
      message: `We've emailed ${firstName}.`,
    });
  } catch (err) {
    console.error("Known caregiver invite error:", err);
    res.status(500).json({ error: "Failed to send the invite" });
  }
});

async function ownInvite(db, id, userId) {
  const invite = await db.prepare("SELECT * FROM platform_invites WHERE id = ? AND kind = ?").get(id, KIND);
  if (!invite) return null;
  const recipient = await recipientIfLeader(db, invite.care_recipient_id, userId);
  return recipient ? { invite, recipient } : null;
}

// ─── POST /api/known-caregivers/:id/resend ───
router.post("/:id/resend", async (req, res) => {
  try {
    const db = await getDb();
    const found = await ownInvite(db, req.params.id, req.user.id);
    if (!found) return res.status(404).json({ error: "Invite not found" });
    const { invite, recipient } = found;
    if (invite.status !== "pending") return res.status(400).json({ error: `That invite is already ${invite.status}.` });

    const expiresAt = expiry();
    await db.prepare("UPDATE platform_invites SET expires_at = ? WHERE id = ?").run(expiresAt, invite.id);

    const inviter = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(invite.invited_by);
    const inviterName = inviter ? `${inviter.first_name} ${inviter.last_name}` : "Someone on InPlace";
    const relationship = await relationshipFor(db, recipient.id, invite.invited_by);
    const firstName = (invite.invited_name || "there").split(/\s+/)[0];
    const mail = inviteEmail({ inviterName, recipient, relationship, firstName, token: invite.token, reminder: true });
    sendEmail({ to: invite.invited_email, ...mail }).catch((err) => console.error("Known caregiver resend error:", err));

    res.json({ message: `Sent ${firstName} another email.`, expiresAt });
  } catch (err) {
    console.error("Known caregiver resend error:", err);
    res.status(500).json({ error: "Failed to resend" });
  }
});

// ─── DELETE /api/known-caregivers/:id ─── withdraw
router.delete("/:id", async (req, res) => {
  try {
    const db = await getDb();
    const found = await ownInvite(db, req.params.id, req.user.id);
    if (!found) return res.status(404).json({ error: "Invite not found" });
    if (found.invite.status !== "pending") return res.status(400).json({ error: "Only an open invite can be withdrawn." });
    await db.prepare("UPDATE platform_invites SET status = 'cancelled' WHERE id = ?").run(found.invite.id);
    res.json({ message: "Invite withdrawn" });
  } catch (err) {
    console.error("Known caregiver withdraw error:", err);
    res.status(500).json({ error: "Failed to withdraw" });
  }
});

module.exports = router;
module.exports._fulfill = fulfillKnownCaregiverInvite; // re-exported for tests
