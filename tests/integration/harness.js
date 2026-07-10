/**
 * Integration test harness (infra #6, v1.86.0)
 *
 * Boots a REAL embedded PostgreSQL, runs the app's actual schema
 * initialization (baseline + MIGRATIONS_V2 + per-boot statements), and mounts
 * the real routers on a plain express app — the same pattern used for ad-hoc
 * testing during the July 2026 hardening runs, now checked in.
 *
 * Why not boot src/server.js? It starts six pollers, sockets, and Kindred —
 * none of which we want under jest (and it stalls in sandboxes). The routers
 * ARE the behavior under test; the harness gives them a real DB over HTTP.
 *
 * Usage in a test file:
 *   const { startHarness, stopHarness } = require("./harness");
 *   let h; beforeAll(async () => { h = await startHarness(); }, 120000);
 *   afterAll(async () => { await stopHarness(h); });
 *   // h.request  → supertest instance
 *   // h.db       → DatabaseWrapper (prepare/get/all/run/exec)
 *   // h.createUser({ roles, isAdmin, ... }) → { user, token }
 */
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFileSync } = require("child_process");
const express = require("express");
const supertest = require("supertest");
const { v4: uuid } = require("uuid");

// Env must be in place BEFORE any src/ module is required.
process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret";
process.env.NODE_ENV = "test";
delete process.env.SENTRY_DSN; // never report test errors

const ROUTERS = {
  "/api/reimbursements": "../../src/routes/reimbursements",
  "/api/messages": "../../src/routes/messages",
  "/api/payments": "../../src/routes/payments",
  "/api/sessions": "../../src/routes/sessions",
  "/api/feedback": "../../src/routes/feedback",
  "/api/care-intelligence": "../../src/routes/careIntelligence",
};

async function startHarness({ routers = ROUTERS } = {}) {
  // The embedded-postgres wrapper is ESM-only (jest here is CJS), so we drive
  // the platform binaries it installs (@embedded-postgres/<platform>) directly.
  const platDir = fs.readdirSync(path.join(__dirname, "../../node_modules/@embedded-postgres"))[0];
  if (!platDir) throw new Error("@embedded-postgres platform binaries not installed — run npm install");
  const bin = path.join(__dirname, "../../node_modules/@embedded-postgres", platDir, "native", "bin");

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "inplace-itest-pg-"));
  const port = 5500 + Math.floor(process.pid % 400); // stable per-process, avoids collisions
  execFileSync(path.join(bin, "initdb"), [
    "-D", dataDir, "-U", "itest", "--auth=trust", "--no-sync", "-E", "UTF8",
  ], { stdio: "pipe" });
  execFileSync(path.join(bin, "pg_ctl"), [
    "-D", dataDir, "-w", "-t", "60",
    "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c unix_socket_directories='${dataDir}'`,
    "-l", path.join(dataDir, "pg.log"),
    "start",
  ], { stdio: "pipe" });
  const pg = {
    stop: () => execFileSync(path.join(bin, "pg_ctl"), ["-D", dataDir, "-w", "-m", "immediate", "stop"], { stdio: "pipe" }),
  };
  process.env.DATABASE_URL = `postgresql://itest@127.0.0.1:${port}/postgres`;

  // Now (and only now) load app modules — they read DATABASE_URL at first use.
  const { getDb, initializeDatabase } = require("../../src/models/database");
  await initializeDatabase(); // real baseline + MIGRATIONS_V2 + per-boot statements
  const db = await getDb();

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  for (const [mount, mod] of Object.entries(routers)) {
    app.use(mount, require(mod));
  }

  const { generateToken } = require("../../src/middleware/auth");

  /** Insert a user and mint a real JWT for them. */
  async function createUser(overrides = {}) {
    const id = overrides.id || uuid();
    const roles = overrides.roles || ["family"];
    const email = overrides.email || `${id.slice(0, 8)}@itest.local`;
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, role, roles,
                         is_active, is_admin, account_approved, email_verified, created_at)
      VALUES (?, ?, 'x', ?, ?, ?, ?, 1, ?, 1, 1, NOW())
    `).run(
      id, email,
      overrides.firstName || "Test", overrides.lastName || "User",
      roles[0], JSON.stringify(roles),
      overrides.isAdmin ? 1 : 0
    );
    const user = { id, email, roles, role: roles[0] };
    return { user, token: generateToken(user) };
  }

  /** Create recipient + care team (+ optional billing contact), return ids. */
  async function createCareTeam({ familyUserId, billingUserId = null, name = "ITest Team" } = {}) {
    const recipientId = uuid();
    await db.prepare(`
      INSERT INTO care_recipients (id, family_user_id, first_name, last_name, created_at)
      VALUES (?, ?, 'Betty', 'ITest', NOW())
    `).run(recipientId, familyUserId);
    const teamId = uuid();
    await db.prepare(`
      INSERT INTO care_teams (id, care_recipient_id, name, created_by, billing_user_id, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `).run(teamId, recipientId, name, familyUserId, billingUserId);
    await db.prepare(`
      INSERT INTO care_team_members (id, care_team_id, user_id, role, created_at)
      VALUES (?, ?, ?, 'leader', NOW())
    `).run(uuid(), teamId, familyUserId);
    return { recipientId, teamId };
  }

  async function addTeamMember(teamId, userId, role = "member") {
    await db.prepare(`
      INSERT INTO care_team_members (id, care_team_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `).run(uuid(), teamId, userId, role);
  }

  return {
    pg, dataDir, db, app,
    request: supertest(app),
    createUser, createCareTeam, addTeamMember,
    auth: (token) => ({ Authorization: `Bearer ${token}` }),
  };
}

async function stopHarness(h) {
  if (!h) return;
  try {
    const { closeDb } = require("../../src/models/database");
    if (closeDb) await closeDb(); // close the app's pool before stopping PG
  } catch (_) { /* noop */ }
  try { h.pg.stop(); } catch (_) { /* noop */ }
  try { fs.rmSync(h.dataDir, { recursive: true, force: true }); } catch (_) { /* noop */ }
}

module.exports = { startHarness, stopHarness };
