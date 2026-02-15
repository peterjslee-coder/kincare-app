require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { initializeDatabase } = require("./models/database");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───
app.use(cors());
app.use(express.json());

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

// ─── Health check ───
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "KinCare API",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  });
});

// ─── API docs overview ───
app.get("/api", (req, res) => {
  res.json({
    name: "KinCare API",
    version: "0.1.0",
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
  const { getDb: fetchDb, resetDb } = require("./models/database");
  const db = await fetchDb();
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
  if (userCount.count === 0) {
    console.log("  Empty database detected — running seed...");
    require("child_process").execSync("node " + path.join(__dirname, "seed.js"), {
      stdio: "inherit",
      env: { ...process.env },
    });
    // Reload database from disk after seed child process wrote to it
    resetDb();
    console.log("  Database reloaded after seeding");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  KinCare API v0.1 running on port ${PORT}\n`);
  });
}

start().catch(console.error);
module.exports = app;
