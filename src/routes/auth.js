const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { generateToken, authenticate } = require("../middleware/auth");

const router = express.Router();

// ─── POST /api/auth/register ───
router.post("/register", async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, role = "family" } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: "Missing required fields: email, password, firstName, lastName" });
    }

    if (!["family", "caregiver"].includes(role)) {
      return res.status(400).json({ error: "Role must be 'family' or 'caregiver'" });
    }

    const db = await getDb();
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, 10);

    db.prepare(`
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
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const db = await getDb();
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").get(email);

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
  const user = db.prepare(
    "SELECT id, email, role, first_name, last_name, phone, avatar_url, created_at FROM users WHERE id = ?"
  ).get(req.user.id);

  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({ user });
});

module.exports = router;
