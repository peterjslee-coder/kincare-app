const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../models/database");
const nodemailer = require("nodemailer");
const dns = require("dns");

// Force IPv4 DNS resolution — Railway doesn't support IPv6 and Gmail
// resolves to IPv6 by default, causing ENETUNREACH errors
dns.setDefaultResultOrder("ipv4first");

// Email notification helper — sends signup alert to Pete
async function notifyNewSignup({ email, name, role, count }) {
  // Only send if SMTP credentials are configured
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("  [email] SMTP not configured, skipping notification");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: true, // Direct SSL on port 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000, // 10s to connect
    greetingTimeout: 10000,   // 10s for server greeting
    socketTimeout: 15000,     // 15s for socket inactivity
  });

  const roleName = role === "caregiver" ? "Caregiver" : "Family";
  const nameStr = name ? `${name} (${email})` : email;

  try {
    await transporter.sendMail({
      from: `"InPlace" <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
      subject: `New InPlace signup (#${count}): ${nameStr}`,
      text: [
        `New waitlist signup on yourinplace.com!`,
        ``,
        `Name:  ${name || "(not provided)"}`,
        `Email: ${email}`,
        `Role:  ${roleName}`,
        `Total signups: ${count}`,
        ``,
        `— InPlace notifications`,
      ].join("\n"),
      html: [
        `<div style="font-family: -apple-system, sans-serif; max-width: 480px;">`,
        `<h2 style="color: #1b6b5a; margin-bottom: 4px;">New Waitlist Signup</h2>`,
        `<p style="color: #666; margin-top: 0;">Someone just signed up on <a href="https://yourinplace.com" style="color: #1b6b5a;">yourinplace.com</a></p>`,
        `<table style="border-collapse: collapse; width: 100%;">`,
        `<tr><td style="padding: 8px 12px; font-weight: 600; color: #333;">Name</td><td style="padding: 8px 12px;">${name || "<em>not provided</em>"}</td></tr>`,
        `<tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: 600; color: #333;">Email</td><td style="padding: 8px 12px;"><a href="mailto:${email}">${email}</a></td></tr>`,
        `<tr><td style="padding: 8px 12px; font-weight: 600; color: #333;">Role</td><td style="padding: 8px 12px;">${roleName}</td></tr>`,
        `<tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: 600; color: #333;">Total signups</td><td style="padding: 8px 12px; font-weight: 600; color: #1b6b5a;">${count}</td></tr>`,
        `</table>`,
        `<p style="color: #999; font-size: 13px; margin-top: 16px;">— InPlace automated notification</p>`,
        `</div>`,
      ].join("\n"),
    });
    console.log(`  [email] Signup notification sent for ${email}`);
  } catch (err) {
    console.error("  [email] Failed to send notification:", err.message);
  }
}

// POST /api/waitlist — add email to waitlist (no auth required)
router.post("/", async (req, res) => {
  try {
    const db = await getDb();
    const { email, name, role } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    // Check if already on waitlist
    const existing = db.prepare("SELECT id FROM waitlist WHERE email = ?").get(email.toLowerCase().trim());
    if (existing) {
      return res.json({ message: "You're already on the list! We'll be in touch soon.", alreadyExists: true });
    }

    const id = uuidv4();
    db.prepare(
      "INSERT INTO waitlist (id, email, name, role) VALUES (?, ?, ?, ?)"
    ).run(id, email.toLowerCase().trim(), name || null, role || "family");

    // Log the count
    const count = db.prepare("SELECT COUNT(*) as count FROM waitlist").get();
    console.log(`  Waitlist signup: ${email} (#${count.count})`);

    // Send email notification (fire-and-forget, don't block response)
    notifyNewSignup({ email: email.toLowerCase().trim(), name, role: role || "family", count: count.count });

    res.status(201).json({ message: "You're on the list! We'll reach out when beta opens.", count: count.count });
  } catch (err) {
    console.error("Waitlist error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET /api/waitlist/count — public count (no auth)
router.get("/count", async (req, res) => {
  try {
    const db = await getDb();
    const result = db.prepare("SELECT COUNT(*) as count FROM waitlist").get();
    res.json({ count: result.count });
  } catch (err) {
    res.status(500).json({ error: "Failed to get count" });
  }
});

module.exports = router;
