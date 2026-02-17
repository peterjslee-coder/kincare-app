require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { initializeDatabase, getDb } = require("./models/database");
const { limitBodySize } = require("./middleware/validate");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(limitBodySize(100000));

// ─── Rate Limiting ───
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  message: { error: "Too many attempts — please try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/password-reset", authLimiter);

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute
  max: 120,                  // 120 requests per minute
  message: { error: "Too many requests — please slow down" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

// ─── Serve Frontend ───
app.use(express.static(path.join(__dirname, "../public")));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// ─── Routes ───
app.use("/api/auth", require("./routes/auth"));
app.use("/api/care-recipients", require("./routes/careRecipients"));
app.use("/api/sessions", require("./routes/sessions"));
app.use("/api/caregivers", require("./routes/caregivers"));
app.use("/api/activity", require("./routes/activity"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/notes", require("./routes/notes"));
app.use("/api/assignments", require("./routes/assignments"));
app.use("/api/waitlist", require("./routes/waitlist"));
app.use("/api/password-reset", require("./routes/passwordReset"));

// ─── Health check ───
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "InPlace API",
    version: "0.2.0",
    timestamp: new Date().toISOString(),
  });
});

// ─── API docs overview ───
app.get("/api", (req, res) => {
  res.json({
    name: "InPlace API",
    version: "0.2.0",
    endpoints: {
      auth: {
        "POST /api/auth/register": "Create a new account",
        "POST /api/auth/login": "Sign in and get JWT token",
        "GET /api/auth/me": "Get current user profile",
      },
      careRecipients: {
        "GET /api/care-recipients": "List your care recipients",
        "POST /api/care-recipients": "Add a care recipient (parent)",
        "GET /api/care-recipients/:id": "Get care recipient details",
        "PUT /api/care-recipients/:id": "Update care recipient",
      },
      sessions: {
        "GET /api/sessions": "List care sessions (filter by status, date)",
        "POST /api/sessions": "Create a new care request",
        "GET /api/sessions/:id": "Get session details + visit log",
        "POST /api/sessions/:id/match": "Match a caregiver to session",
        "PUT /api/sessions/:id/status": "Update session status",
      },
      caregivers: {
        "GET /api/caregivers": "Search available caregivers",
        "GET /api/caregivers/:id": "Get caregiver profile + reviews",
        "POST /api/caregivers/profile": "Create/update caregiver profile",
      },
      activity: {
        "GET /api/activity": "Activity feed (notifications)",
        "PUT /api/activity/:id/read": "Mark notification as read",
        "PUT /api/activity/read-all": "Mark all as read",
        "POST /api/activity/visit-log": "Submit visit log (caregiver)",
      },
      dashboard: {
        "GET /api/dashboard": "Aggregated dashboard data",
      },
    },
  });
});

// ─── Catch-all: serve frontend for any non-API route ───
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ─── Error handling ───
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ───
async function start() {
  await initializeDatabase();

  // Auto-seed if database is empty (first deploy)
  const db = await getDb();
  const userCount = await db.prepare("SELECT COUNT(*) as count FROM users").get();
  if (parseInt(userCount.count) === 0) {
    console.log("  Empty database detected — running seed...");
    // Run seed in-process (PostgreSQL is shared, no need for child process)
    const { seed } = require("./seed");
    await seed();
    console.log("  Seed complete");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  InPlace API v0.6.1 running on port ${PORT}\n`);
  });
}

start().catch(console.error);
module.exports = app;
