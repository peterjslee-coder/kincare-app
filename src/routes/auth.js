const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken, authenticate } = require("../middleware/auth");
const { validateRegister, validateLogin, validateProfileUpdate } = require("../middleware/validate");

const router = express.Router();

// ─── POST /api/auth/register ───
router.post("/register", validateRegister, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, role = "family" } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Missing required fields: email, password, firstName, lastName" });
    }

    if (!["family", "caregiver", "care_for"].includes(role)) {
      return res.status(400).json({ error: "Role must be 'family', 'caregiver', or 'care_for'" });
    }

    const db = await getDb();
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, 10);

    await db.prepare(`
      INSERT INTO users (id, email, password_hash, role, first_name, last_name, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, passwordHash, role, firstName, lastName, phone || null);

    const user = { id, email, role, firstName, lastName };
    const token = generateToken(user);

    res.status(201).json({ user, token });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── POST /api/auth/login ───
router.post("/login", validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    const db = await getDb();
    const user = await db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken(user);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
      },
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── GET /api/auth/me ───
router.get("/me", authenticate, async (req, res) => {
  const db = await getDb();
  const user = await db.prepare(
    "SELECT id, email, role, first_name, last_name, phone, avatar_url, notification_prefs, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({ user });
});

// ─── PUT /api/auth/me ───
router.put("/me", authenticate, validateProfileUpdate, async (req, res) => {
  try {
    const { firstName, lastName, phone, notificationPrefs } = req.body;
    const db = await getDb();

    // Build dynamic update
    const fields = [];
    const values = [];

    if (firstName !== undefined) { fields.push("first_name = ?"); values.push(firstName); }
    if (lastName !== undefined) { fields.push("last_name = ?"); values.push(lastName); }
    if (phone !== undefined) { fields.push("phone = ?"); values.push(phone || null); }
    if (notificationPrefs !== undefined) {
      fields.push("notification_prefs = ?");
      values.push(JSON.stringify(notificationPrefs));
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(req.user.id);
    await db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    // Return updated user
    const user = await db.prepare(
      "SELECT id, email, role, first_name, last_name, phone, avatar_url, notification_prefs, created_at FROM users WHERE id = ?"
    ).get(req.user.id);

    res.json({ user });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

module.exports = router;
