require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { initializeDatabase, getDb } = require("./models/database");
const { limitBodySize } = require("./middleware/validate");
const { getNowInZone, getTodayStringInZone, buildDateTimeInZone } = require("./utils/timezone");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is required. Set it in .env or environment.");
  process.exit(1);
}

// ─── Socket.io Setup ───
const ALLOWED_ORIGINS = process.env.NODE_ENV === "production"
  ? ["https://yourinplace.com", "https://www.yourinplace.com"]
  : ["http://localhost:3001", "http://localhost:3000", "http://127.0.0.1:3001"];
const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS, credentials: true } });

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

  // ─── Call signaling ───
  socket.on("call_invite", (data) => {
    // data: { targetUserId, roomName, callType, callerName }
    const targetSockets = connectedUsers.get(data.targetUserId);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_incoming", {
          roomName: data.roomName,
          callType: data.callType,
          callerId: userId,
          callerName: data.callerName,
        });
      }
    }
  });

  socket.on("call_accept", (data) => {
    // data: { callerId, roomName }
    const callerSockets = connectedUsers.get(data.callerId);
    if (callerSockets) {
      for (const sid of callerSockets) {
        io.to(sid).emit("call_accepted", { roomName: data.roomName });
      }
    }
  });

  socket.on("call_decline", (data) => {
    // data: { callerId, roomName }
    const callerSockets = connectedUsers.get(data.callerId);
    if (callerSockets) {
      for (const sid of callerSockets) {
        io.to(sid).emit("call_declined", { roomName: data.roomName });
      }
    }
  });

  socket.on("call_hangup", (data) => {
    // data: { targetUserId, roomName }
    const targetSockets = connectedUsers.get(data.targetUserId);
    if (targetSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_ended", { roomName: data.roomName });
      }
    }
  });

  // ─── Typing indicators ───
  socket.on("typing_start", (data) => {
    // data: { conversationId }
    // Broadcast to all members of the conversation except sender
    const convId = data.conversationId;
    if (!convId) return;
    // Get all connected users and check if they're in this conversation
    // For efficiency, broadcast to all connected users and let client filter
    for (const [uid, sockets] of connectedUsers) {
      if (uid === userId) continue;
      for (const sid of sockets) {
        io.to(sid).emit("typing_indicator", {
          conversationId: convId,
          userId: userId,
          userName: socket.user.email, // will be enriched client-side
        });
      }
    }
  });

  // ─── Read receipts ───
  socket.on("messages_read", (data) => {
    // data: { conversationId }
    const convId = data.conversationId;
    if (!convId) return;
    for (const [uid, sockets] of connectedUsers) {
      if (uid === userId) continue;
      for (const sid of sockets) {
        io.to(sid).emit("messages_read", {
          conversationId: convId,
          userId: userId,
          readAt: new Date().toISOString(),
        });
      }
    }
  });

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

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", "'unsafe-eval'", "'unsafe-inline'",  // Required for Babel client-side compilation
        "https://cdnjs.cloudflare.com", "https://unpkg.com", "https://cdn.socket.io",
        "https://js.stripe.com", "https://connect-js.stripe.com",
        "https://sdk.twilio.com", "https://plausible.io",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://plausible.io", "https://api.stripe.com", "wss:", "ws:"],
      frameSrc: ["https://js.stripe.com", "https://connect-js.stripe.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      mediaSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"],
    },
  },
  crossOriginEmbedderPolicy: false,   // Loads CDN scripts (React, Leaflet, etc.)
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// CORS — restrict to known origins
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Active-Role", "x-admin-api-key", "x-csrf-token"],
}));
app.use(require("cookie-parser")());
app.use("/api/auth/me/photo", express.json({ limit: "5mb" }));
app.use("/api/care-recipients", express.json({ limit: "5mb" }));
// Skip JSON parsing for webhooks that need raw body for signature verification
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payments/webhook' || req.originalUrl === '/api/checkr/webhook') return next();
  express.json({ limit: "100kb" })(req, res, next);
});
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
app.use("/api/auth/verify", authLimiter);
app.use("/api/auth/resend-verification", authLimiter);
app.use("/api/waitlist", authLimiter);

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
// Prevent browser from caching index.html so users always get fresh JS references
app.use((req, res, next) => {
  if (req.path === "/" || req.path === "/index.html") {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});
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

// ─── CSRF Protection ───
const { verifyCsrf } = require("./middleware/auth");
app.use("/api", verifyCsrf);

// ─── Audit Logging ───
const { auditLogMiddleware } = require("./middleware/auditLog");
app.use("/api", auditLogMiddleware);

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
app.use("/api/passkeys", require("./routes/passkeys"));
app.use("/api/oauth", require("./routes/oauth"));
app.use("/api/care-teams", require("./routes/careTeams"));
app.use("/api/waitlist", require("./routes/waitlist"));
app.use("/api/password-reset", require("./routes/passwordReset"));
app.use("/api/availability", require("./routes/availability"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/admin/financials", require("./routes/financials"));
app.use("/api/platform-invites", require("./routes/platformInvites"));
app.use("/api/caregiver-onboarding", require("./routes/caregiveronboarding"));
app.use("/api/onboarding-events", require("./routes/onboardingEvents"));
app.use("/api/feedback", require("./routes/feedback"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/connections", require("./routes/connections"));
app.use("/api/help", require("./routes/help"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/video", require("./routes/videoCall"));
app.use("/api/consent", require("./routes/consent"));
app.use("/api/documents", require("./routes/documents"));
app.use("/api/checkr", require("./routes/checkr"));
app.use("/api/accountability", require("./routes/accountability"));

// ─── App version check (lightweight, no auth) ───
const APP_VERSION = "1.42.3";
app.get("/api/version", (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json({ version: APP_VERSION });
});

// ─── Health check ───
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "InPlace API",
    version: APP_VERSION,
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
  // Retry DB connection up to 5 times (Railway internal DNS can be slow on cold start)
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await initializeDatabase();
      break; // success
    } catch (err) {
      console.error(`  DB init attempt ${attempt}/5 failed:`, err.message);
      if (attempt === 5) throw err;
      const delay = attempt * 2000; // 2s, 4s, 6s, 8s
      console.log(`  Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

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

  // ─── Daily demo data refresh ───
  // Re-seed demo data every 24 hours so relative dates stay fresh
  setInterval(async () => {
    try {
      console.log("🔄 Daily demo data refresh starting...");
      const { seed: dailySeed } = require("./seed");
      await dailySeed({ demoOnly: true });
      console.log("✅ Daily demo data refresh complete");
    } catch (err) {
      console.error("⚠️  Daily demo refresh failed:", err.message);
    }
  }, 24 * 60 * 60 * 1000); // 24 hours

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

  // ─── Session notification poller (every 60s) ───
  // Checks for upcoming sessions that need pre-check-in or pre-check-out reminders
  const { sendSessionReminders } = require("./routes/push");
  const NOTIFICATION_POLL_INTERVAL = 60 * 1000; // 1 minute
  const REMINDER_WINDOW_MINUTES = 15;
  const OVERDUE_GRACE_MINUTES = 5; // how long after session start before "you're late" fires
  const MAX_OVERDUE_WINDOW = 60;   // stop sending overdue alerts after 60 min

  setInterval(async () => {
    try {
      const pollDb = await getDb();
      // All session times are care-location times — use centralized timezone utility
      const etNow = getNowInZone();
      const todayStr = getTodayStringInZone();

      // ─── Pre-check-in reminders ───
      // Find confirmed sessions today that haven't had pre_check_in notification
      // Exclude demo sessions — demo data must never trigger real notifications
      const checkInCandidates = await pollDb.prepare(`
        SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.notifications_sent
        FROM care_sessions cs
        LEFT JOIN users u ON cs.family_user_id = u.id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        WHERE cs.status = 'confirmed'
          AND cs.scheduled_date = ?
          AND (cs.notifications_sent IS NULL OR cs.notifications_sent NOT LIKE '%pre_check_in%')
          AND (u.is_demo IS NULL OR u.is_demo = 0)
          AND (cu.is_demo IS NULL OR cu.is_demo = 0)
      `).all(todayStr);

      for (const s of checkInCandidates) {
        if (!s.scheduled_time) continue;
        const sessionStart = buildDateTimeInZone(s.scheduled_date, s.scheduled_time);
        const reminderTime = new Date(sessionStart.getTime() - REMINDER_WINDOW_MINUTES * 60000);
        // Send if we're within the notification window (up to session start)
        if (etNow >= reminderTime && etNow <= sessionStart) {
          await sendSessionReminders(s.id, "pre_check_in");
        }
      }

      // ─── Pre-check-out reminders ───
      // Find in_progress sessions today that haven't had pre_check_out notification
      const checkOutCandidates = await pollDb.prepare(`
        SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.notifications_sent
        FROM care_sessions cs
        LEFT JOIN users u ON cs.family_user_id = u.id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        WHERE cs.status = 'in_progress'
          AND cs.scheduled_date = ?
          AND (cs.notifications_sent IS NULL OR cs.notifications_sent NOT LIKE '%pre_check_out%')
          AND (u.is_demo IS NULL OR u.is_demo = 0)
          AND (cu.is_demo IS NULL OR cu.is_demo = 0)
      `).all(todayStr);

      for (const s of checkOutCandidates) {
        if (!s.scheduled_time || !s.duration_hours) continue;
        const sessionStart = buildDateTimeInZone(s.scheduled_date, s.scheduled_time);
        const sessionEnd = new Date(sessionStart.getTime() + s.duration_hours * 60 * 60000);
        const reminderTime = new Date(sessionEnd.getTime() - REMINDER_WINDOW_MINUTES * 60000);
        // Send if we're within the check-out notification window
        if (etNow >= reminderTime && etNow <= sessionEnd) {
          await sendSessionReminders(s.id, "pre_check_out");
        }
      }

      // ─── Overdue check-in alerts ───
      // Confirmed sessions today where start time + grace period has passed but caregiver hasn't checked in
      const overdueCandidates = await pollDb.prepare(`
        SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.notifications_sent
        FROM care_sessions cs
        LEFT JOIN users u ON cs.family_user_id = u.id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        WHERE cs.status = 'confirmed'
          AND cs.scheduled_date = ?
          AND (cs.notifications_sent IS NULL OR cs.notifications_sent NOT LIKE '%overdue_check_in%')
          AND (u.is_demo IS NULL OR u.is_demo = 0)
          AND (cu.is_demo IS NULL OR cu.is_demo = 0)
      `).all(todayStr);

      for (const s of overdueCandidates) {
        if (!s.scheduled_time) continue;
        const sessionStart = buildDateTimeInZone(s.scheduled_date, s.scheduled_time);
        const overdueTime = new Date(sessionStart.getTime() + OVERDUE_GRACE_MINUTES * 60000);
        const maxWindow = new Date(sessionStart.getTime() + MAX_OVERDUE_WINDOW * 60000);
        // Send if we're past grace period but within the overdue window
        if (etNow >= overdueTime && etNow <= maxWindow) {
          await sendSessionReminders(s.id, "overdue_check_in");
        }
      }
    } catch (err) {
      // Silent — don't crash server for notification polling failures
      if (err.message && !err.message.includes("relation") && !err.message.includes("column")) {
        console.error("  Notification poller error:", err.message);
      }
    }
  }, NOTIFICATION_POLL_INTERVAL);
  console.log(`  Session notification poller started (every ${NOTIFICATION_POLL_INTERVAL / 1000}s)`);

  // ─── Session Accountability Poller ───
  // Runs every 60s: payment authorizations (24hrs before), late check-ins, no-shows
  const {
    pollPaymentAuthorizations,
    pollLateCheckIns,
    pollCaregiverNoShows,
    pollLateResolutionDefaults,
    setEmitToUser: setAccountabilityEmit,
  } = require("./routes/accountability");
  setAccountabilityEmit(emitToUser);

  setInterval(async () => {
    try {
      await pollPaymentAuthorizations();
      await pollLateCheckIns();
      await pollCaregiverNoShows();
      await pollLateResolutionDefaults();
    } catch (err) {
      if (err.message && !err.message.includes("relation") && !err.message.includes("column")) {
        console.error("  Accountability poller error:", err.message);
      }
    }
  }, NOTIFICATION_POLL_INTERVAL);
  console.log("  Accountability poller started (payment auth, late check-ins, no-shows)");

  // ─── Backfill missing caregiver coordinates from zip/city/state ───
  // One-time pass on startup: geocode caregivers who have zip but no lat/lng
  (async () => {
    try {
      const { geocodeAddress, buildAddressString } = require("./utils/geocode");
      const missing = await db.prepare(`
        SELECT cp.user_id, cp.address_line1, cp.location_city, cp.location_state, cp.zip
        FROM caregiver_profiles cp
        WHERE cp.latitude IS NULL AND cp.longitude IS NULL
          AND (cp.zip IS NOT NULL OR cp.location_city IS NOT NULL)
      `).all();
      if (missing.length > 0) {
        console.log(`  Geocode backfill: ${missing.length} caregiver(s) missing coordinates`);
        for (const cg of missing) {
          const addrStr = buildAddressString({
            address: cg.address_line1,
            city: cg.location_city,
            state: cg.location_state,
            zip: cg.zip,
          });
          if (!addrStr) continue;
          const geo = await geocodeAddress(addrStr);
          if (geo) {
            await db.prepare(
              "UPDATE caregiver_profiles SET latitude = ?, longitude = ? WHERE user_id = ?"
            ).run(geo.lat, geo.lng, cg.user_id);
            console.log(`    Geocoded ${cg.location_city || cg.zip} → ${geo.lat}, ${geo.lng}`);
          }
          // Nominatim rate limit: 1 req/sec
          await new Promise(r => setTimeout(r, 1100));
        }
      }
    } catch (err) {
      console.log("  Geocode backfill skipped:", err.message);
    }
  })();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  InPlace API v0.9.0 running on port ${PORT}\n`);
    console.log(`  WebSocket server ready`);
    const { isSmsConfigured } = require("./utils/sms");
    console.log(`  SMS notifications: ${isSmsConfigured() ? "Twilio configured ✓" : "Twilio not configured (SMS reminders will be skipped)"}`);
  });
}

// Only auto-start when run directly (not when imported by tests)
if (require.main === module) {
  start().catch(console.error);
}

module.exports = app;
