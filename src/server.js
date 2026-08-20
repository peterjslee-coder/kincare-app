require("dotenv").config();

const { initSentry, setupSentryErrorHandler, captureException, tagRequestUser } = require("./utils/sentry");
initSentry();

const express = require("express");

// v1.105.37 — install BEFORE any route module is required. Route files register their
// handlers at require time, so anything loaded above this line would keep unwrapped
// handlers. Express 4 does not catch a rejected promise from an async handler: the request
// HANGS, with no status, no log and no Sentry event. The Aug 4 audit counted 87 handlers
// with an await outside try/catch. See src/utils/asyncRoutes.js for what is and is not
// wrapped, and why.
const { installAsyncRouteSafety } = require("./utils/asyncRoutes");
installAsyncRouteSafety(express);

const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { initializeDatabase, getDb } = require("./models/database");
const { createViewRegistry } = require("./utils/presence");
const { limitBodySize } = require("./middleware/validate");
const { withPollerLock } = require("./models/database");
// v1.82.0 (H5): every poller tick runs under a pg advisory lock so a second app
// instance can never double-fire (double auto-pay, duplicate reminders).
const guardedPoller = (lockKey, fn) => () =>
  withPollerLock(lockKey, fn).catch((e) => console.error(`[poller ${lockKey}]`, e.message));
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
// v1.105.3 — this used to read NODE_ENV, which is NOT set on Railway, so PRODUCTION
// was running with the localhost allowlist. Used by BOTH express cors() (below) and
// Socket.io. Nothing broke only because every caller is same-origin today; see
// utils/env.js for the derivation and for the App Store / Capacitor caveat.
const { allowedOrigins: ALLOWED_ORIGINS } = require("./utils/env");
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

// v1.105.103 — which conversation each socket currently has OPEN.
//
// Pete: "I am on the messaging interface messaging Julia and I get push notifications that
// Julia has sent a message, but I don't see it in the chat" (97783012). A push that tells you
// about a message you are reading is worse than no push: it trains the person to ignore the
// one that matters. The server had no way to know — it fanned out to every member.
//
// Deliberately socket-scoped, not user-scoped: the same person on a laptop and a phone is
// looking at one of them. A member is only skipped if the socket that has the thread open is
// still connected, and the client closes the thread on `visibilitychange` — a hidden page is
// not being read. Anything else (a lock, a crash, a network drop) disconnects the socket,
// which clears the entry below. The failure direction is therefore an EXTRA push, never a
// swallowed one.
const viewingConversation = createViewRegistry();

function isViewingConversation(userId, conversationId) {
  return viewingConversation.isViewing(connectedUsers.get(userId), conversationId);
}

// v1.66.0 (C1): resolve conversation membership for socket fan-out, with a
// short TTL cache so rapid typing events don't hammer the DB. Returns [] on error.
const _convMemberCache = new Map(); // convId -> { ids:[], exp:ms }
async function conversationMemberIds(conversationId) {
  const now = Date.now();
  const hit = _convMemberCache.get(conversationId);
  if (hit && hit.exp > now) return hit.ids;
  try {
    const db = await getDb();
    const rows = await db.prepare(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ?"
    ).all(conversationId);
    const ids = rows.map((r) => r.user_id);
    _convMemberCache.set(conversationId, { ids, exp: now + 15000 }); // 15s TTL
    return ids;
  } catch (err) {
    captureException(err);
    return [];
  }
}

io.on("connection", (socket) => {
  const userId = socket.user.id;
  if (!connectedUsers.has(userId)) connectedUsers.set(userId, new Set());
  connectedUsers.get(userId).add(socket.id);
  console.log(`WS connected: ${socket.user.email} (${connectedUsers.get(userId).size} sockets)`);

  // ─── Call signaling ───
  socket.on("call_invite", (data) => {
    // data: { targetUserId, roomName, callType, callerName }
    //
    // ─── v1.105.99: a call that only rings an app already on screen ───
    //
    // This was `if (targetSockets) { emit }` with no else. A socket exists only while the app
    // is open and foregrounded, so an incoming call reached exactly the person who did not need
    // telling — and if their phone was locked, backgrounded, or simply on the home screen, the
    // invite went nowhere at all. Silently. Pete: "Phone and video calls do not ring or notify
    // the user until I push notification after the call."
    //
    // Ringing someone who is not looking at their phone is the entire job of a call. So: emit
    // to any live socket, and if there is none, push.
    //
    // Push only when there is NO socket, deliberately — Pete's other report (97783012) is that
    // push while you are already in the app is noise. The socket IS the signal that they are
    // here; its absence is the signal that they are not.
    const targetSockets = connectedUsers.get(data.targetUserId);
    const liveSockets = targetSockets && targetSockets.size > 0;
    if (liveSockets) {
      for (const sid of targetSockets) {
        io.to(sid).emit("call_incoming", {
          roomName: data.roomName,
          callType: data.callType,
          callerId: userId,
          callerName: data.callerName,
        });
      }
    } else {
      const kind = data.callType === "video" ? "Video call" : "Call";
      const who = data.callerName || "Someone";
      // Fire and forget, but never silently: a push that fails is the difference between a
      // ringing phone and nothing at all, so it is logged and reported.
      (async () => {
        try {
          const { sendPushToUser } = require("./routes/push");
          await sendPushToUser(data.targetUserId, {
            title: `${kind} from ${who}`,
            body: "Tap to answer",
            data: {
              type: "call_incoming",
              page: "messages",
              roomName: data.roomName,
              callType: data.callType,
              callerId: userId,
              callerName: who,
            },
          }, "call_incoming");
        } catch (err) {
          console.error("call_invite push failed:", err.message);
          captureException(err, { where: "socket: call_invite push", targetUserId: data.targetUserId });
        }
      })();
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
  // v1.66.0 (C1 fix): emit ONLY to the other members of this conversation.
  // Previously this broadcast to every connected user (and leaked the sender's
  // email) then let the client filter — a privacy leak and O(users) per keystroke.
  socket.on("typing_start", async (data) => {
    try {
      const convId = data?.conversationId;
      if (!convId) return;
      const memberIds = await conversationMemberIds(convId);
      if (!memberIds.includes(userId)) return; // sender must be a member
      for (const memberId of memberIds) {
        if (memberId === userId) continue;
        const sockets = connectedUsers.get(memberId);
        if (!sockets) continue;
        for (const sid of sockets) {
          io.to(sid).emit("typing_indicator", { conversationId: convId, userId });
        }
      }
    } catch (err) { captureException(err); }
  });

  // ─── Read receipts ───
  socket.on("messages_read", async (data) => {
    try {
      const convId = data?.conversationId;
      if (!convId) return;
      const memberIds = await conversationMemberIds(convId);
      if (!memberIds.includes(userId)) return;
      const readAt = new Date().toISOString();
      for (const memberId of memberIds) {
        if (memberId === userId) continue;
        const sockets = connectedUsers.get(memberId);
        if (!sockets) continue;
        for (const sid of sockets) {
          io.to(sid).emit("messages_read", { conversationId: convId, userId, readAt });
        }
      }
    } catch (err) { captureException(err); }
  });

  // ─── Which thread is on screen (v1.105.103) ───
  // Membership is checked here rather than trusted: without it, claiming to be "viewing" any
  // conversation id would suppress that person's pushes for it.
  socket.on("conversation_open", async (data) => {
    try {
      const convId = data?.conversationId;
      if (!convId) return;
      const memberIds = await conversationMemberIds(convId);
      if (!memberIds.includes(userId)) return;
      viewingConversation.open(socket.id, convId);
    } catch (err) { captureException(err); }
  });

  socket.on("conversation_close", () => {
    viewingConversation.close(socket.id);
  });

  socket.on("disconnect", () => {
    viewingConversation.close(socket.id);
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
app.set("isViewingConversation", isViewingConversation);

// ─── Middleware ───
app.set("trust proxy", 1); // Trust first proxy (Cloudflare/Railway) for X-Forwarded-For

// v1.105.55 — a malformed percent-escape in the path (INPLACE-6: GET /%c0, an overlong
// UTF-8 sequence from a path-traversal scanner) makes Express's own router throw URIError
// out of decodeURIComponent, which lands in the error handler and Sentry as an application
// error. It isn't one: it is a garbage URL and the answer is 400. Catching it here keeps a
// scanner from writing noise into the same place real failures are reported — which is the
// only reason anyone would look there.
app.use((req, res, next) => {
  try {
    decodeURIComponent(req.path);
    return next();
  } catch {
    return res.status(400).json({ error: "Malformed URL" });
  }
});

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
        "https://static.cloudflareinsights.com",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "https://plausible.io", "https://api.stripe.com", "https://js.stripe.com", "https://connect-js.stripe.com", "https://static.cloudflareinsights.com", "https://*.tile.openstreetmap.org", "wss:", "ws:"],
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
// v1.104.1 — Sentry attribution: decode the JWT (cookie or Bearer) BEFORE the
// body parsers so even 413s thrown inside body-parser carry the user's UUID
// tag. Sentry answers "whose account failed?" with a UUID; names/emails/PHI
// still never leave the server (see utils/sentry.js beforeSend).
app.use((req, res, next) => {
  try {
    // v1.105.2 — token precedence MUST match middleware/auth.js:57, which reads the
    // Bearer header first and falls back to the cookie. This block had them the other
    // way round, so during admin "Test Mode" the request ran as the impersonated user
    // (Bearer) while Sentry tagged the admin (cookie). Every impersonated error was
    // filed against Pete: INPLACE-5 was tagged user_role=family on a caregiver-only
    // endpoint, which is impossible and is what gave the mismatch away.
    const header = req.headers.authorization || "";
    const raw = (header.startsWith("Bearer ") ? header.slice(7) : null)
      || req.cookies?.auth_token;
    if (raw) {
      const payload = require("jsonwebtoken").verify(raw, process.env.JWT_SECRET);
      tagRequestUser(payload.id, payload.role, payload.impersonatedBy);
    }
  } catch (_) { /* invalid/expired token — event just goes untagged */ }
  next();
});
app.use("/api/auth/me/photo", express.json({ limit: "5mb" }));
app.use("/api/care-recipients", express.json({ limit: "5mb" }));
app.use("/api/self-onboarding", express.json({ limit: "10mb" }));
app.use("/api/reimbursements", express.json({ limit: "10mb" })); // receipt photos/PDFs (base64)
// v1.103.2 — observation notes accept a photo (client resizes to ≤1600px, route
// enforces 5MB): the global 100kb JSON cap silently broke every photo note.
app.use("/api/notes", express.json({ limit: "8mb" }));
// v1.105.0 (Sentry INPLACE-1) — feedback accepts a base64 screenshot (v1.104.8
// added the client picker; the route enforces its own 2MB cap). It shipped
// without a route-scoped limit, so the global 100kb cap 413'd every screenshot.
// Same rule as notes above: BOTH this and a limitBodySize exemption are needed.
app.use("/api/feedback", express.json({ limit: "4mb" }));
// v1.105.35 — caregiver ID verification posts TWO base64 data URIs (government ID +
// selfie) in one body and had NEITHER half of the rule, so every submission 413'd against
// the global 100kb cap. Same failure as photo notes (v1.103.2) and feedback screenshots
// (v1.105.0), on the one flow a caregiver cannot skip and a store reviewer walks.
app.use("/api/caregiver-onboarding", express.json({ limit: "10mb" }));
// v1.105.74 — a family visit can carry one photo (client downscales to ≤1600px, the route
// enforces 5MB + magic bytes). Same rule as notes, feedback and caregiver-onboarding above:
// BOTH a route-scoped express.json limit AND a limitBodySize exemption, or the global 100kb
// cap 413s every photo. That has now been the same bug four times.
app.use("/api/family-visits", express.json({ limit: "8mb" }));
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
  if (req.path === "/" || req.path === "/index.html" || req.path.endsWith(".js") || req.path.endsWith(".css")) {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});
// Apple App Site Association — must serve as application/json (no file extension)
app.get("/.well-known/apple-app-site-association", (req, res) => {
  res.set("Content-Type", "application/json");
  res.sendFile(path.join(__dirname, "../public/.well-known/apple-app-site-association"));
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
// v1.104.4 — client-side crash beacon. The ErrorBoundary POSTs render/lifecycle
// throws here so a white-screen becomes a real Sentry event (the user_id tag is
// already attached upstream by the JWT-decode middleware). No auth required —
// a crash can happen before/around auth — but the payload is tiny and the
// global 100kb body cap + rate limiter bound abuse.
app.post("/api/client-error", (req, res) => {
  try {
    const b = req.body || {};
    const err = new Error(`[client] ${String(b.message || "unknown").slice(0, 300)}`);
    err.stack = String(b.stack || "").slice(0, 4000) || err.stack;
    captureException(err, {
      source: "client",
      page: b.page, url: b.url, version: b.version,
      standalone: b.standalone, userAgent: b.userAgent,
      componentStack: String(b.componentStack || "").slice(0, 4000),
    });
    console.error(`  [client-error] v${b.version} page=${b.page} standalone=${b.standalone}: ${String(b.message).slice(0, 200)}`);
  } catch (_) { /* never throw from the error sink */ }
  res.status(204).end();
});

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
const reimbursementsRouter = require("./routes/reimbursements");
const careTasksRouter = require("./routes/careTasks");
const careEventsRouter = require("./routes/careEvents");
app.use("/api/reimbursements", reimbursementsRouter);
app.use("/api/geocode", require("./routes/geocode"));
app.use("/api/waitlist", require("./routes/waitlist"));
app.use("/api/password-reset", require("./routes/passwordReset"));
app.use("/api/availability", require("./routes/availability"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/admin/financials", require("./routes/financials"));
app.use("/api/admin/treasury", require("./routes/treasury"));
app.use("/api/admin/tickets", require("./routes/tickets"));
app.use("/api/costs", require("./routes/costs"));
app.use("/api/platform-invites", require("./routes/platformInvites"));
app.use("/api/caregiver-onboarding", require("./routes/caregiveronboarding"));
app.use("/api/family-visits", require("./routes/familyVisits")); // v1.105.38
app.use("/api/onboarding-events", require("./routes/onboardingEvents"));
app.use("/api/feedback", require("./routes/feedback"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/self-onboarding", require("./routes/selfOnboarding"));
app.use("/api/connections", require("./routes/connections"));
app.use("/api/help", require("./routes/help"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/video", require("./routes/videoCall"));
app.use("/api/consent", require("./routes/consent"));
app.use("/api/documents", require("./routes/documents"));
app.use("/api/checkr", require("./routes/checkr"));
app.use("/api/accountability", require("./routes/accountability"));
app.use("/api/interviews", require("./routes/interviews"));
app.use("/api/matching", require("./routes/matching"));
app.use("/api/care-intelligence", require("./routes/careIntelligence"));
app.use("/api/scheduling", require("./routes/nlScheduling"));
app.use("/api/ipai", require("./routes/ipaiChat"));
app.use("/api/referrals", require("./routes/referrals"));
app.use("/api/kindred", require("./routes/kindred"));
app.use("/api/care-tasks", careTasksRouter);
app.use("/api/care-events", careEventsRouter);
app.use("/api/legal", require("./routes/legal"));
app.use("/api/media", require("./routes/media"));
app.use("/api/safety", require("./routes/safety"));

// ─── App version check (lightweight, no auth) ───
const APP_VERSION = "1.105.115";
app.get("/api/version", (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json({ version: APP_VERSION });
});

// ─── Health check ───
app.get("/api/health", (req, res) => {
  const { environment, cookiesSecure } = require("./utils/env");
  res.json({
    status: "ok",
    service: "InPlace API",
    version: APP_VERSION,
    // v1.105.3 — surfaced deliberately. The NODE_ENV bug went unnoticed for months
    // because the deployment's own idea of "am I production?" was invisible from
    // outside. These two booleans make it checkable in one request, forever.
    // Neither is a secret: `environment` is a label, `secureCookies` says whether
    // the Secure flag is being set — anyone can already observe that in DevTools.
    environment,
    secureCookies: cookiesSecure,
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

// ─── Kindred PWA (separate app for care recipients) ───
// Auth-gated: requires valid JWT + companion_access flag (admins always pass)
app.get("/kindred", async (req, res) => {
  const token = req.cookies?.auth_token || req.query.token;
  if (!token) {
    return res.redirect("/?redirect=kindred");
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const db = await getDb();
    const user = await db.prepare("SELECT companion_access, is_admin FROM users WHERE id = ?").get(decoded.id);
    if (!user || (!user.companion_access && !user.is_admin)) {
      return res.status(403).send("Access denied. Kindred access has not been enabled for your account.");
    }
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.sendFile(path.join(__dirname, "../kindred/index.html"));
  } catch {
    return res.redirect("/?redirect=kindred");
  }
});

// ─── Public legal pages (v1.105.4) ───
// /terms, /privacy, /caregiver-agreement, /client-services, /legal — rendered from
// the lawyer-reviewed `legal_documents` rows users already accept in-app. Both app
// stores need a policy URL a reviewer can open with no session.
//
// This REPLACES a static public/privacy.html last updated April 2 2026, which
// described the Kindred voice companion (killed in the July 7 review), named
// ElevenLabs, and omitted nearly every processor the platform actually uses. That
// stale page was the URL registered with Google Play. Mounted before the SPA
// catch-all; any type with no active document falls through to the app.
app.use(require("./routes/publicLegal"));

// ─── /business — a page a crawler can actually read (v1.105.56) ───
//
// Pete: "when someone signs up for the website and it says it can't reach the domain,
// something appears wrong." He's right, and the trust cost lands at the exact moment we're
// asking a caregiver for their bank details.
//
// Two separate faults produced that screen. The first was ours and is fixed in
// routes/payments.js — we handed Stripe a domain that has never resolved. The second is
// this: index.html is `<div id="root"></div>` and everything else is drawn by JavaScript.
// Stripe's verification fetches the URL and reads HTML. It sees an empty shell and a
// one-line meta description — indistinguishable from the "placeholder or under-construction
// site" its own task text says it will not accept. Pointing it at yourinplace.com alone
// would very likely have failed review a second time, and I'd have called it fixed.
//
// So: one server-rendered page, no JavaScript required, describing what the business is,
// what it sells, what it charges and how caregivers are paid. Every word is Pete's own
// copy from the splash page — a business-information page is the wrong place to invent
// claims about a business.
app.get("/business", (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.sendFile(path.join(__dirname, "../public/business.html"));
});

// ─── Catch-all: serve frontend for any non-API route ───
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ─── Error handling ───
setupSentryErrorHandler(app);
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  captureException(err);
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

      // Refresh the demo when the code version changed OR when there are no
      // upcoming demo sessions (dates drifted into the past, or the demo was
      // emptied). The 24h timer alone isn't enough — it resets on every Railway
      // restart, so a frequently-restarting process could otherwise show a demo
      // full of past dates. This makes the demo self-heal on boot.
      let demoStale = false;
      try {
        const fresh = await db.prepare(`
          SELECT COUNT(*) AS count FROM care_sessions
          WHERE scheduled_date::date >= CURRENT_DATE
            AND (caregiver_id IN (SELECT id FROM users WHERE is_demo = 1)
                 OR family_user_id IN (SELECT id FROM users WHERE is_demo = 1))
        `).get();
        demoStale = parseInt(fresh && fresh.count || 0) === 0;
      } catch (e) {
        // Older schema without care_sessions/scheduled_date — fall back to version check only
      }

      if (currentVersion !== DEMO_SEED_VERSION || demoStale) {
        const reason = currentVersion !== DEMO_SEED_VERSION
          ? `version ${currentVersion || 'none'} → ${DEMO_SEED_VERSION}`
          : 'no upcoming demo sessions (stale dates or emptied)';
        // Always use demoOnly mode for auto-reseed — never risk real user data
        console.log(`  Demo data needs refresh (${reason}) — refreshing demo data only...`);
        await seed({ demoOnly: true });
        console.log("  Demo-only re-seed complete (real user data preserved)");
      }
    }
  } catch (seedErr) {
    console.error("  ⚠️  Seed failed — starting server anyway:", seedErr.message);
  }

  // ─── Daily demo data refresh ───
  // Re-seed demo data every 24 hours so relative dates stay fresh
  setInterval(guardedPoller(101, async () => {
    try {
      console.log("🔄 Daily demo data refresh starting...");
      const { seed: dailySeed } = require("./seed");
      await dailySeed({ demoOnly: true });
      console.log("✅ Daily demo data refresh complete");
    } catch (err) {
      console.error("⚠️  Daily demo refresh failed:", err.message);
    }
  }), 24 * 60 * 60 * 1000); // 24 hours

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

  setInterval(guardedPoller(102, async () => {
    try {
      const pollDb = await getDb();
      // ─── Per-session timezone-aware notification logic ───
      // Each session uses its care recipient's timezone for all timing decisions.
      // We query sessions whose scheduled_date is "today" in ANY US timezone
      // (widened to yesterday..tomorrow to catch cross-timezone edge cases),
      // then compare using each session's specific care-location timezone.
      const eastNow = getTodayStringInZone('America/New_York');
      const westNow = getTodayStringInZone('Pacific/Honolulu');
      // Build a date range that covers "today" across all US timezones
      const dateRangeStart = eastNow < westNow ? eastNow : westNow;
      const dateRangeEnd = eastNow > westNow ? eastNow : westNow;

      // ─── Pre-check-in reminders ───
      // Find confirmed sessions that haven't had pre_check_in notification
      // Exclude demo sessions — demo data must never trigger real notifications
      const checkInCandidates = await pollDb.prepare(`
        SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.notifications_sent,
          cr.timezone AS care_timezone
        FROM care_sessions cs
        LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
        LEFT JOIN users u ON cs.family_user_id = u.id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        WHERE cs.status = 'confirmed'
          AND cs.scheduled_date BETWEEN ? AND ?
          AND (cs.notifications_sent IS NULL OR cs.notifications_sent NOT LIKE '%pre_check_in%')
          AND (u.is_demo IS NULL OR u.is_demo = 0)
          AND (cu.is_demo IS NULL OR cu.is_demo = 0)
      `).all(dateRangeStart, dateRangeEnd);

      for (const s of checkInCandidates) {
        if (!s.scheduled_time) continue;
        const tz = s.care_timezone || 'America/New_York';
        const careNow = getNowInZone(tz);
        const sessionStart = buildDateTimeInZone(s.scheduled_date, s.scheduled_time, tz);
        const reminderTime = new Date(sessionStart.getTime() - REMINDER_WINDOW_MINUTES * 60000);
        // Send if we're within the notification window (up to session start)
        if (careNow >= reminderTime && careNow <= sessionStart) {
          await sendSessionReminders(s.id, "pre_check_in");
        }
      }

      // ─── Arrival SMS reminders for care recipients (2hr, 1hr, 30min) ───
      // Sends friendly countdown texts to the care recipient's phone before each visit
      const { sendArrivalSms } = require("./routes/push");
      const arrivalCandidates = await pollDb.prepare(`
        SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.notifications_sent,
          cr.timezone AS care_timezone, cr.notification_channel, cr.sms_phone,
          cr.sms_reminder_intervals, cr.first_name AS recipient_first_name,
          cp.user_id AS caregiver_user_id
        FROM care_sessions cs
        LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
        LEFT JOIN users u ON cs.family_user_id = u.id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        WHERE cs.status = 'confirmed'
          AND cs.scheduled_date BETWEEN ? AND ?
          AND (u.is_demo IS NULL OR u.is_demo = 0)
          AND (cu.is_demo IS NULL OR cu.is_demo = 0)
      `).all(dateRangeStart, dateRangeEnd);

      for (const s of arrivalCandidates) {
        if (!s.scheduled_time || !s.sms_phone) continue;
        // Only send if channel includes SMS
        const channel = s.notification_channel || "push";
        if (!["sms", "both"].includes(channel)) continue;

        const tz = s.care_timezone || 'America/New_York';
        const careNow = getNowInZone(tz);
        const sessionStart = buildDateTimeInZone(s.scheduled_date, s.scheduled_time, tz);
        const minutesUntil = (sessionStart - careNow) / 60000;

        // Parse enabled intervals (default: all three)
        let intervals;
        try { intervals = JSON.parse(s.sms_reminder_intervals || '[120, 60, 30]'); } catch { intervals = [120, 60, 30]; }
        if (!Array.isArray(intervals) || intervals.length === 0) continue;

        const sent = s.notifications_sent || '';
        for (const mins of intervals) {
          const tag = `arrival_sms_${mins}`;
          if (sent.includes(tag)) continue; // already sent this tier
          // Send when we're within the window: (mins) to (mins - 2) minutes before
          // The 2-min buffer accounts for the 60s poll interval
          if (minutesUntil <= mins && minutesUntil > (mins - 2)) {
            await sendArrivalSms(s, mins);
          }
        }
      }

      // ─── Pre-check-out reminders ───
      // Find in_progress sessions that haven't had pre_check_out notification
      const checkOutCandidates = await pollDb.prepare(`
        SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.notifications_sent,
          cr.timezone AS care_timezone
        FROM care_sessions cs
        LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
        LEFT JOIN users u ON cs.family_user_id = u.id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        WHERE cs.status = 'in_progress'
          AND cs.scheduled_date BETWEEN ? AND ?
          AND (cs.notifications_sent IS NULL OR cs.notifications_sent NOT LIKE '%pre_check_out%')
          AND (u.is_demo IS NULL OR u.is_demo = 0)
          AND (cu.is_demo IS NULL OR cu.is_demo = 0)
      `).all(dateRangeStart, dateRangeEnd);

      for (const s of checkOutCandidates) {
        if (!s.scheduled_time || !s.duration_hours) continue;
        const tz = s.care_timezone || 'America/New_York';
        const careNow = getNowInZone(tz);
        const sessionStart = buildDateTimeInZone(s.scheduled_date, s.scheduled_time, tz);
        const sessionEnd = new Date(sessionStart.getTime() + s.duration_hours * 60 * 60000);
        const reminderTime = new Date(sessionEnd.getTime() - REMINDER_WINDOW_MINUTES * 60000);
        // Send if we're within the check-out notification window
        if (careNow >= reminderTime && careNow <= sessionEnd) {
          await sendSessionReminders(s.id, "pre_check_out");
        }
      }

      // ─── Overdue check-in alerts ───
      // Confirmed sessions where start time + grace period has passed but caregiver hasn't checked in
      const overdueCandidates = await pollDb.prepare(`
        SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.notifications_sent,
          cr.timezone AS care_timezone
        FROM care_sessions cs
        LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
        LEFT JOIN users u ON cs.family_user_id = u.id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        WHERE cs.status = 'confirmed'
          AND cs.scheduled_date BETWEEN ? AND ?
          AND (cs.notifications_sent IS NULL OR cs.notifications_sent NOT LIKE '%overdue_check_in%')
          AND (u.is_demo IS NULL OR u.is_demo = 0)
          AND (cu.is_demo IS NULL OR cu.is_demo = 0)
      `).all(dateRangeStart, dateRangeEnd);

      for (const s of overdueCandidates) {
        if (!s.scheduled_time) continue;
        const tz = s.care_timezone || 'America/New_York';
        const careNow = getNowInZone(tz);
        const sessionStart = buildDateTimeInZone(s.scheduled_date, s.scheduled_time, tz);
        const overdueTime = new Date(sessionStart.getTime() + OVERDUE_GRACE_MINUTES * 60000);
        const maxWindow = new Date(sessionStart.getTime() + MAX_OVERDUE_WINDOW * 60000);
        // Send if we're past grace period but within the overdue window
        if (careNow >= overdueTime && careNow <= maxWindow) {
          await sendSessionReminders(s.id, "overdue_check_in");
        }
      }
      // ─── Overdue check-out alerts ───
      // In-progress sessions past their scheduled end time where caregiver hasn't checked out
      const checkOutOverdueCandidates = await pollDb.prepare(`
        SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.duration_hours, cs.notifications_sent,
          cr.timezone AS care_timezone
        FROM care_sessions cs
        LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
        LEFT JOIN users u ON cs.family_user_id = u.id
        LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
        LEFT JOIN users cu ON cp.user_id = cu.id
        WHERE cs.status = 'in_progress'
          AND cs.scheduled_date BETWEEN ? AND ?
          AND (cs.notifications_sent IS NULL OR cs.notifications_sent NOT LIKE '%overdue_check_out%')
          AND (u.is_demo IS NULL OR u.is_demo = 0)
          AND (cu.is_demo IS NULL OR cu.is_demo = 0)
      `).all(dateRangeStart, dateRangeEnd);

      for (const s of checkOutOverdueCandidates) {
        if (!s.scheduled_time || !s.duration_hours) continue;
        const tz = s.care_timezone || 'America/New_York';
        const careNow = getNowInZone(tz);
        const sessionStart = buildDateTimeInZone(s.scheduled_date, s.scheduled_time, tz);
        const sessionEnd = new Date(sessionStart.getTime() + s.duration_hours * 60 * 60000);
        const overdueTime = new Date(sessionEnd.getTime() + REMINDER_WINDOW_MINUTES * 60000);
        const maxOverdueWindow = new Date(sessionEnd.getTime() + MAX_OVERDUE_WINDOW * 60000);
        // Send if 15 min past scheduled end but within 2h overdue window
        if (careNow >= overdueTime && careNow <= maxOverdueWindow) {
          await sendSessionReminders(s.id, "overdue_check_out");
        }
      }

      // ─── Interview reminders (48h, 24h, 2h before session) ───
      try {
        const pendingInterviews = await pollDb.prepare(`
          SELECT i.id, i.session_id, i.requested_by, i.requested_of,
            i.reminder_48h_sent, i.reminder_24h_sent, i.reminder_2h_sent,
            cs.scheduled_date, cs.scheduled_time, cs.care_recipient_id,
            cr.timezone AS care_timezone
          FROM interviews i
          JOIN care_sessions cs ON i.session_id = cs.id
          LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
          LEFT JOIN users u ON cs.family_user_id = u.id
          LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
          LEFT JOIN users cu ON cp.user_id = cu.id
          WHERE i.status IN ('pending', 'accepted')
            AND cs.status = 'confirmed'
            AND (u.is_demo IS NULL OR u.is_demo = 0)
            AND (cu.is_demo IS NULL OR cu.is_demo = 0)
        `).all();

        for (const iv of pendingInterviews) {
          if (!iv.scheduled_date || !iv.scheduled_time) continue;
          const ivTz = iv.care_timezone || 'America/New_York';
          const ivNow = getNowInZone(ivTz);
          const sessionStart = buildDateTimeInZone(iv.scheduled_date, iv.scheduled_time, ivTz);
          const hoursUntil = (sessionStart - ivNow) / (60 * 60000);

          // 48-hour reminder
          if (hoursUntil <= 48 && hoursUntil > 24 && !iv.reminder_48h_sent) {
            const { sendPushToUser: pushFn } = require("./routes/push");
            for (const uid of [iv.requested_by, iv.requested_of]) {
              pushFn(uid, { title: 'Interview reminder', body: `Your interview for the appointment on ${iv.scheduled_date} is coming up. Coordinate a time in chat.`, data: { type: 'interview_reminder', interviewId: iv.id, page: 'messages' } }, 'interview_reminder').catch(() => {});
            }
            await pollDb.prepare("UPDATE interviews SET reminder_48h_sent = 1 WHERE id = ?").run(iv.id);
          }
          // 24-hour reminder (also cancellation deadline)
          if (hoursUntil <= 24 && hoursUntil > 2 && !iv.reminder_24h_sent) {
            const { sendPushToUser: pushFn } = require("./routes/push");
            for (const uid of [iv.requested_by, iv.requested_of]) {
              pushFn(uid, { title: 'Interview — 24h deadline', body: `Last chance to cancel the interview without penalty. Appointment is on ${iv.scheduled_date}.`, data: { type: 'interview_reminder_24h', interviewId: iv.id, page: 'messages' } }, 'interview_reminder').catch(() => {});
            }
            await pollDb.prepare("UPDATE interviews SET reminder_24h_sent = 1 WHERE id = ?").run(iv.id);
          }
          // 2-hour final reminder
          if (hoursUntil <= 2 && hoursUntil > 0 && !iv.reminder_2h_sent) {
            const { sendPushToUser: pushFn } = require("./routes/push");
            for (const uid of [iv.requested_by, iv.requested_of]) {
              pushFn(uid, { title: 'Interview starting soon!', body: `The appointment is in 2 hours. If you haven't done the interview yet, connect now in chat.`, data: { type: 'interview_reminder_2h', interviewId: iv.id, page: 'messages' } }, 'interview_reminder').catch(() => {});
            }
            await pollDb.prepare("UPDATE interviews SET reminder_2h_sent = 1 WHERE id = ?").run(iv.id);
          }
        }
      } catch (ivErr) {
        // Don't crash — interview reminders are non-critical
        if (ivErr.message && !ivErr.message.includes("relation")) {
          console.error("  Interview reminder error:", ivErr.message);
        }
      }
    } catch (err) {
      // Silent — don't crash server for notification polling failures
      if (err.message && !err.message.includes("relation") && !err.message.includes("column")) {
        console.error("  Notification poller error:", err.message);
      }
    }
  }), NOTIFICATION_POLL_INTERVAL);
  console.log(`  Session notification poller started (every ${NOTIFICATION_POLL_INTERVAL / 1000}s)`);

  // ─── Session Accountability Poller ───
  // Runs every 60s: payment authorizations (24hrs before), late check-ins, no-shows
  const {
    pollPaymentAuthorizations,
    pollLateCheckIns,
    pollCaregiverNoShows,
    pollLateResolutionDefaults,
    pollCancellationFees,
    setEmitToUser: setAccountabilityEmit,
  } = require("./routes/accountability");
  setAccountabilityEmit(emitToUser);

  setInterval(guardedPoller(103, async () => {
    try {
      await pollPaymentAuthorizations();
      await pollLateCheckIns();
      await pollCaregiverNoShows();
      await pollLateResolutionDefaults();
      await pollCancellationFees();
    } catch (err) {
      if (err.message && !err.message.includes("relation") && !err.message.includes("column")) {
        console.error("  Accountability poller error:", err.message);
      }
    }
  }), NOTIFICATION_POLL_INTERVAL);
  console.log("  Accountability poller started (payment auth, late check-ins, no-shows)");

  // ─── Reimbursement push digest sweeper (v1.98.15) ───
  // Sends coalesced reimbursement pushes once their ~2-minute debounce window
  // elapses, so approve + pay + confirm in one sitting become a single push.
  const { sweepReimbursementDigests } = require("./services/reimbursementDigest");
  setInterval(guardedPoller(104, async () => {
    try {
      await sweepReimbursementDigests();
    } catch (err) {
      if (err.message && !err.message.includes("relation") && !err.message.includes("column")) {
        console.error("  Reimbursement digest sweeper error:", err.message);
      }
    }
  }), 30 * 1000); // every 30s (window is 2 min)
  console.log("  Reimbursement digest sweeper started (coalesces approve/pay/confirm pushes)");

  // ─── Kindred Reminder Delivery Poller ───
  // v1.105.50 — was ALSO lock key 104, the same key as the reimbursement digest sweeper
  // directly above. Two unrelated pollers competing for one lock: whichever ticked first
  // blocked the other, so Kindred reminders and reimbursement pushes were each silently
  // skipping turns, and a hang in either killed both. Its own key now.
  setInterval(guardedPoller(109, async () => {
    try {
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60000).toISOString();
      const nowISO = now.toISOString();

      // Find pending reminders whose scheduled_for is in the past (within 5 min window)
      const dueReminders = await db.prepare(`
        SELECT vr.*, cr.first_name AS recipient_name, cr.id AS recipient_id
        FROM voice_reminders vr
        LEFT JOIN care_recipients cr ON vr.care_recipient_id::text = cr.id
        WHERE vr.status = 'pending'
          AND vr.scheduled_for <= ?
          AND vr.scheduled_for >= ?
      `).all(nowISO, fiveMinAgo);

      for (const reminder of dueReminders) {
        // Mark as delivered
        await db.prepare("UPDATE voice_reminders SET status = 'delivered', delivered_at = ? WHERE id = ?")
          .run(nowISO, reminder.id);

        // If recurring, schedule the next occurrence
        if (reminder.recurrence && reminder.recurrence !== 'none') {
          const recTime = reminder.recurrence_time || '09:00';
          const recDays = (reminder.recurrence_days || 'mon,tue,wed,thu,fri,sat,sun').split(',');
          const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
          const reverseDayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

          // Find next valid day
          let nextDate = new Date(now);
          nextDate.setDate(nextDate.getDate() + 1); // start from tomorrow
          for (let attempt = 0; attempt < 8; attempt++) {
            const dayName = reverseDayMap[nextDate.getDay()];
            let validDay = false;
            if (reminder.recurrence === 'daily') validDay = true;
            else if (reminder.recurrence === 'weekdays') validDay = nextDate.getDay() >= 1 && nextDate.getDay() <= 5;
            else if (reminder.recurrence === 'weekends') validDay = nextDate.getDay() === 0 || nextDate.getDay() === 6;
            else if (reminder.recurrence === 'custom') validDay = recDays.includes(dayName);

            if (validDay) break;
            nextDate.setDate(nextDate.getDate() + 1);
          }

          const nextDateStr = nextDate.toISOString().split('T')[0];
          const nextScheduledFor = `${nextDateStr}T${recTime}:00`;
          const { v4: uuid } = require("uuid");
          await db.prepare(`
            INSERT INTO voice_reminders (id, care_recipient_id, message_text, scheduled_for, status, recurrence, recurrence_time, recurrence_days, label, source)
            VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
          `).run(uuid(), reminder.care_recipient_id, reminder.message_text, nextScheduledFor, reminder.recurrence, reminder.recurrence_time, reminder.recurrence_days, reminder.label, reminder.source || 'manual');
        }

        // Emit real-time event (family dashboard will show delivery status)
        if (emitToUser) {
          // Find the family user associated with this care recipient
          try {
            const family = await db.prepare("SELECT family_user_id FROM care_recipients WHERE id = ?::text").get(reminder.care_recipient_id);
            if (family?.family_user_id) {
              emitToUser(family.family_user_id, "reminder_delivered", {
                reminderId: reminder.id,
                recipientName: reminder.recipient_name,
                message: reminder.message_text,
              });
            }
          } catch (e) { captureException(e, { where: "reminders: emit reminder_delivered" }); }
        }
      }
    } catch (err) {
      if (err.message && !err.message.includes("no such table") && !err.message.includes("no such column")) {
        console.error("  Kindred reminder poller error:", err.message);
      }
    }
  }), 60000); // Check every minute
  console.log("  Kindred reminder delivery poller started");

  // ─── Auto-pay cron: charge overdue sessions ───
  // Runs every 5 minutes. If a completed session's payment_due_at has passed and no payment
  // exists, auto-charges the family's saved card. No tip (they missed the review window).
  setInterval(guardedPoller(105, async () => {
    try {
      const paymentRouter = require("./routes/payments");
      const { sendPushToUser } = require("./routes/push");
      // 1) Auto-charge overdue sessions
      if (paymentRouter.processOverduePayments) {
        await paymentRouter.processOverduePayments(sendPushToUser);
      }
      // 2) Hold future sessions for families with unpaid balance (after auto-pay fails)
      if (paymentRouter.holdSessionsForUnpaidFamilies) {
        await paymentRouter.holdSessionsForUnpaidFamilies(sendPushToUser);
      }
    } catch (err) {
      if (err.message && !err.message.includes("not configured")) {
        console.error("  Auto-pay cron error:", err.message);
      }
    }
  }), 5 * 60000); // Every 5 minutes
  console.log("  Auto-pay cron started (checks every 5 min for overdue payments + session holds)");

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

  // ─── One-time migration: merge Daniel Lee's duplicate Apple-relay account ───
  // Apple "Hide My Email" created v7vx2xsc8z@privaterelay.appleid.com instead of linking to danbecklee@me.com
  (async () => {
    try {
      const original = await db.prepare("SELECT id FROM users WHERE LOWER(email) = 'danbecklee@me.com' AND is_active = 1").get();
      const duplicate = await db.prepare("SELECT id FROM users WHERE LOWER(email) = 'v7vx2xsc8z@privaterelay.appleid.com'").get();
      if (original && duplicate && original.id !== duplicate.id) {
        // Move Apple OAuth link from duplicate → original
        await db.prepare("UPDATE oauth_accounts SET user_id = ? WHERE user_id = ? AND provider = 'apple'").run(original.id, duplicate.id);
        // Soft-delete the duplicate
        await db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(duplicate.id);
        console.log(`  [Migration] Merged Apple OAuth from duplicate ${duplicate.id} → original ${original.id} (danbecklee@me.com). Duplicate soft-deleted.`);
      }
    } catch (e) { console.log("  [Migration] Daniel merge skipped:", e.message); }
  })();

  // ─── Recurring reimbursements: generate due occurrences (v1.74.0) ───
  // Hourly + once shortly after boot. Generation is transactional with an
  // optimistic lock on next_run_date, so restarts/overlaps can't double-generate.
  setTimeout(guardedPoller(106, () => reimbursementsRouter.generateRecurringReimbursements()), 90 * 1000);
  setInterval(guardedPoller(106, () => reimbursementsRouter.generateRecurringReimbursements()), 60 * 60 * 1000);

  // ─── Care Tasks poller (v1.99.0) ───
  // Every 60s: materialize today's occurrences, push the assignee at due
  // time, escalate to the whole care team after the task's grace window,
  // and roll yesterday's still-pending occurrences to 'missed'. A missed
  // dose must never fail silently. Timezone-aware per recipient, same
  // pattern as the session reminder poller above.
  {
    const { sendPushToUser: careTaskPush } = require("./routes/push");
    setInterval(guardedPoller(107, async () => {
      try {
        await careTasksRouter.pollCareTasks(careTaskPush);
      } catch (err) {
        if (err.message && !err.message.includes("relation") && !err.message.includes("column")) {
          console.error("  Care tasks poller error:", err.message);
        }
      }
    }), 60 * 1000);
    console.log("  Care tasks poller started (materialize, remind, escalate, missed)");
  }

  // ─── Care Events poller (v1.100.0) ───
  // Every 60s: family-only day-before + same-day reminder pushes for
  // upcoming events (appointments, visits, outings). Events are awareness,
  // not obligations — no escalation, nothing goes "missed".
  {
    const { sendPushToUser: careEventPush } = require("./routes/push");
    setInterval(guardedPoller(108, async () => {
      try {
        await careEventsRouter.pollCareEvents(careEventPush);
      } catch (err) {
        if (err.message && !err.message.includes("relation") && !err.message.includes("column")) {
          console.error("  Care events poller error:", err.message);
        }
      }
    }), 60 * 1000);
    console.log("  Care events poller started (day-before + same-day notices, family-only)");
  }

  // v1.105.50 — bound the inbound side too. Node's defaults leave `server.timeout` at 0,
  // so a handler that never responds holds its socket, its worker slot and any pool client
  // it took, indefinitely, logging nothing. That is the same shape as the client-side hang
  // Pete hit, seen from the other end.
  server.headersTimeout = 20000;   // headers only — nothing legitimate is slow here
  // Generous on purpose: this bounds RECEIVING the whole request, and a caregiver
  // uploading an ID photo or a receipt over weak cellular legitimately needs minutes.
  // Cutting that to something tidy would trade one silent failure for another.
  server.requestTimeout = 180000;
  server.keepAliveTimeout = 65000;

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  InPlace v${APP_VERSION} running on port ${PORT}\n`);
    console.log(`  WebSocket server ready`);
    const { isSmsConfigured } = require("./utils/sms");
    console.log(`  SMS notifications: ${isSmsConfigured() ? "Twilio configured ✓" : "Twilio not configured (SMS reminders will be skipped)"}`);
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.stripe_webhook_secret || "";
    const baseUrl = process.env.BASE_URL || process.env.base_url || "https://yourinplace.com";
    console.log(`  Stripe webhook: ${baseUrl}/api/payments/webhook ${webhookSecret ? "(secret configured ✓)" : "⚠️  NO WEBHOOK SECRET — configure STRIPE_WEBHOOK_SECRET in Railway"}`);

    // ─── Startup diagnostic: list ALL Stripe webhook endpoints ───
    (async () => {
      try {
        const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.stripe_secret_key;
        if (stripeKey) {
          const stripe = require("stripe")(stripeKey);
          const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
          console.log(`\n  🔍 Stripe webhook endpoints found: ${endpoints.data.length}`);
          for (const ep of endpoints.data) {
            console.log(`    → ${ep.id} | ${ep.url} | status: ${ep.status} | events: ${(ep.enabled_events || []).length}`);
          }
          if (endpoints.data.length > 1) {
            console.warn(`  ⚠️  MULTIPLE webhook endpoints detected — this causes duplicate events and signature mismatches!`);
          }
        }
      } catch (diagErr) {
        console.log(`  (webhook endpoint check skipped: ${diagErr.message})`);
      }
    })();
  });
}

// Only auto-start when run directly (not when imported by tests)
if (require.main === module) {
  start().catch(console.error);
}

module.exports = app;
