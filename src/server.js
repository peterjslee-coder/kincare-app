require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { initializeDatabase, getDb } = require("./models/database");
const { limitBodySize } = require("./middleware/validate");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "inplace-dev-secret-change-me";

// ─── Socket.io Setup ───
const io = new Server(server, { cors: { origin: "*" } });

// JWT auth middleware for socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});

// Track connected users: userId -> Set of socket ids
const connectedUsers = new Map();

io.on("connection", (socket) => {
  const userId = socket.user.id;
  if (!connectedUsers.has(userId)) connectedUsers.set(userId, new Set());
  connectedUsers.get(userId).add(socket.id);
  console.log(`WS connected: ${socket.user.email} (${connectedUsers.get(userId).size} sockets)`);

  socket.on("disconnect", () => {
    const sockets = connectedUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) connectedUsers.delete(userId);
    }
  });
});

// Helper: emit to a specific user (all their connected sockets)
function emitToUser(userId, event, data) {
  const sockets = connectedUsers.get(userId);
  if (sockets) {
    for (const socketId of sockets) {
      io.to(socketId).emit(event, data);
    }
  }
}

// Make io and emitToUser available to routes
app.set("io", io);
app.set("emitToUser", emitToUser);

// ─── Middleware ───
app.set("trust proxy", 1); // Trust first proxy (Cloudflare/Railway) for X-Forwarded-For
app.use(cors());
app.use(require("cookie-parser")());
app.use("/api/auth/me/photo", express.json({ limit: "5mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(limitBodySize(100000));

// ─── Rate Limiting ───
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window
  message: { error: "Too many attempts — please try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
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
  validate: { trustProxy: false, xForwardedForHeader: false },
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
app.use("/api/sessions", require("./routes/offers"));
app.use("/api/caregivers", require("./routes/caregivers"));
app.use("/api/activity", require("./routes/activity"));
app.use("/api/dashboard", require("./routes/dashboard"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/notes", require("./routes/notes"));
app.use("/api/assignments", require("./routes/assignments"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/push", require("./routes/push"));
app.use("/api/photos", require("./routes/photos"));
app.use("/api/auth/2fa", require("./routes/twoFactor"));
app.use("/api/oauth", require("./routes/oauth"));
app.use("/api/care-teams", require("./routes/careTeams"));
app.use("/api/waitlist", require("./routes/waitlist"));
app.use("/api/password-reset", require("./routes/passwordReset"));
app.use("/api/availability", require("./routes/availability"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/admin/financials", require("./routes/financials"));
app.use("/api/platform-invites", require("./routes/platformInvites"));
app.use("/api/caregiver-onboarding", require("./routes/caregiveronboarding"));
app.use("/api/feedback", require("./routes/feedback"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/connections", require("./routes/connections"));
app.use("/api/help", require("./routes/help"));
app.use("/api/reports", require("./routes/reports"));

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

  // Initialize VAPID keys for push notifications (env → DB → auto-generate)
  const { initializeVapidKeys } = require("./routes/push");
  await initializeVapidKeys();

  // Auto-seed if database is empty OR demo data is stale
  const db = await getDb();
  const userCount = await db.prepare("SELECT COUNT(*) as count FROM users").get();
  const { seed, DEMO_SEED_VERSION } = require("./seed");

  try {
    if (parseInt(userCount.count) === 0) {
      console.log("  Empty database detected — running seed...");
      await seed({ force: true }); // Empty DB — safe to force
      console.log("  Seed complete");
    } else {
      // Check if demo data version is current — re-seed if stale
      const versionRow = await db.prepare(
        "SELECT name FROM waitlist WHERE email = '_seed_version@inplace.internal' LIMIT 1"
      ).get();
      const currentVersion = versionRow ? versionRow.name : null;
      if (currentVersion !== DEMO_SEED_VERSION) {
        // Always use demoOnly mode for auto-reseed — never risk real user data
        console.log(`  Demo data stale (${currentVersion || 'none'} → ${DEMO_SEED_VERSION}) — refreshing demo data only...`);
        await seed({ demoOnly: true });
        console.log("  Demo-only re-seed complete (real user data preserved)");
      }
    }
  } catch (seedErr) {
    console.error("  ⚠️  Seed failed — starting server anyway:", seedErr.message);
  }

  // ─── Demo data patch ───
  // Ensures key demo profile fields are correct even when full reseed is skipped
  try {
    const mariaUser = await db.prepare(
      "SELECT id FROM users WHERE email = 'maria@inplace.care' AND is_demo = 1"
    ).get();
    if (mariaUser) {
      // Ensure Maria has dual role (caregiver + family) for role-switching demo
      await db.prepare(`
        UPDATE users SET roles = '["caregiver","family"]' WHERE id = ? AND (roles IS NULL OR roles = '["caregiver"]')
      `).run(mariaUser.id);
      await db.prepare(`
        UPDATE caregiver_profiles SET
          onboarding_complete = 1,
          checkr_status = 'clear',
          legal_first_name = COALESCE(NULLIF(legal_first_name, ''), 'Maria'),
          legal_last_name = COALESCE(NULLIF(legal_last_name, ''), 'Santos'),
          date_of_birth = COALESCE(date_of_birth, '1992-03-15'),
          ssn_last4 = COALESCE(NULLIF(ssn_last4, ''), '4567'),
          dl_number = COALESCE(NULLIF(dl_number, ''), 'V12-34-5678'),
          dl_state = COALESCE(NULLIF(dl_state, ''), 'VA')
        WHERE user_id = ?
      `).run(mariaUser.id);
      // Ensure avatar is set
      await db.prepare(`
        UPDATE users SET avatar_url = COALESCE(avatar_url,
          'data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''120'' height=''120''%3E%3Crect width=''120'' height=''120'' fill=''%231b6b5a''/%3E%3Ctext x=''50%25'' y=''52%25'' font-family=''system-ui'' font-size=''48'' font-weight=''700'' fill=''white'' text-anchor=''middle'' dominant-baseline=''central''%3EMS%3C/text%3E%3C/svg%3E')
        WHERE id = ?
      `).run(mariaUser.id);
      // Ensure Carlos (Maria's brother) care recipient exists for family view
      const carlosExists = await db.prepare(
        "SELECT id FROM care_recipients WHERE family_user_id = ? AND first_name = 'Carlos'"
      ).get(mariaUser.id);
      if (!carlosExists) {
        const { v4: uuid } = require("uuid");
        const carlosId = uuid();
        await db.prepare(`
          INSERT INTO care_recipients
          (id, family_user_id, first_name, last_name, age,
           location_address, location_city, location_state, location_zip,
           latitude, longitude,
           health_conditions, medications, preferences,
           emergency_contact_name, emergency_contact_phone,
           pets, pet_allergies, food_allergies, medical_conditions)
          VALUES (?, ?, 'Carlos', 'Santos', 34,
                  '215 College Avenue', 'Blacksburg', 'VA', '24060',
                  37.2285, -80.4155,
                  ?, ?, ?,
                  'Maria Santos', '(540) 555-0201',
                  '1 dog — Luna (golden retriever, therapy dog, very gentle, 3 yrs)',
                  'None known', ?, ?)
        `).run(
          carlosId, mariaUser.id,
          JSON.stringify(["Traumatic brain injury — recovery phase", "Short-term memory difficulties", "Mild left-side weakness", "Anxiety in crowded environments"]),
          JSON.stringify(["Sertraline 50mg daily", "Gabapentin 300mg twice daily", "Melatonin 5mg at bedtime"]),
          "Needs patient, calm communication. Prefers structured routines. Loves soccer. Music helps him focus.",
          JSON.stringify(["Dairy (moderate — causes stomach cramps)"]),
          "Traumatic brain injury (recovery), short-term memory issues, mild left-side weakness, anxiety"
        );
        // Create Carlos's care team
        const teamId = uuid();
        await db.prepare(
          "INSERT INTO care_teams (id, name, care_recipient_id, created_by) VALUES (?, ?, ?, ?)"
        ).run(teamId, "Carlos Santos's Care Team", carlosId, mariaUser.id);
        await db.prepare(
          "INSERT INTO care_team_members (id, care_team_id, user_id, role, invited_by) VALUES (?, ?, ?, 'leader', ?)"
        ).run(uuid(), teamId, mariaUser.id, mariaUser.id);
        console.log("  Demo data patch: created Carlos care recipient + care team for Maria");
      }
      console.log("  Demo data patch applied (Maria dual-role + profile)");
    }
  } catch (patchErr) {
    console.error("  Demo patch failed:", patchErr.message);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  InPlace API v0.9.0 running on port ${PORT}\n`);
    console.log(`  WebSocket server ready`);
  });
}

// Only auto-start when run directly (not when imported by tests)
if (require.main === module) {
  start().catch(console.error);
}

module.exports = app;
