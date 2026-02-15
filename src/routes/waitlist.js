const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../models/database");

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
