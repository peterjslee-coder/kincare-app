/**
 * Auth integration tests (real embedded PostgreSQL).
 *
 * Replaces the 7 mock-based unit tests quarantined in tests/auth.test.js and
 * tests/middleware.test.js — those relied on the in-memory SQL mock, which
 * drifted from reality when authenticate() gained the users.is_active check
 * (soft-deletes, v1.62). These run the same assertions against the real
 * router + real database.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h;
beforeAll(async () => {
  h = await startHarness({
    routers: { "/api/auth": "../../src/routes/auth" },
  });
});
afterAll(async () => { await stopHarness(h); });

const CREDS = {
  email: "authitest@itest.local",
  password: "SecurePass1!",
  firstName: "Auth",
  lastName: "ITest",
  // v1.105.8 — signup age gate (minimum 13). Required by validateRegister.
  dateOfBirth: "1985-06-15",
  role: "family",
};
let token;

describe("register + login", () => {
  test("registers a new user", async () => {
    const res = await h.request.post("/api/auth/register").send(CREDS);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(CREDS.email);
  });

  // v1.105.8 — the age gate against the real router and real database. The unit tests
  // cover the date maths; this covers the wiring.
  test("refuses a signup with no date of birth", async () => {
    const res = await h.request.post("/api/auth/register")
      .send({ ...CREDS, email: "nodob@itest.local", dateOfBirth: undefined });
    expect(res.status).toBe(400);
  });

  test("refuses a signup under 13", async () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 12);
    const res = await h.request.post("/api/auth/register")
      .send({ ...CREDS, email: "under13@itest.local", dateOfBirth: d.toISOString().slice(0, 10) });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("under_age");
  });

  test("accepts a signup at exactly 13", async () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 13);
    const res = await h.request.post("/api/auth/register")
      .send({ ...CREDS, email: "exactly13@itest.local", dateOfBirth: d.toISOString().slice(0, 10) });
    expect(res.status).toBe(201);
  });

  test("rejects login for non-existent email", async () => {
    const res = await h.request.post("/api/auth/login")
      .send({ email: "nobody@itest.local", password: "whatever123!" });
    expect(res.status).toBe(401);
  });

  test("rejects login with wrong password", async () => {
    const res = await h.request.post("/api/auth/login")
      .send({ email: CREDS.email, password: "WrongPass1!" });
    expect(res.status).toBe(401);
  });

  test("logs in with correct credentials", async () => {
    const res = await h.request.post("/api/auth/login")
      .send({ email: CREDS.email, password: CREDS.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    token = res.body.token;
  });
});

describe("authenticated profile (authenticate middleware, real is_active check)", () => {
  test("GET /me returns the current user with a valid token", async () => {
    const res = await h.request.get("/api/auth/me")
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.email || res.body.user?.email).toBe(CREDS.email);
  });

  test("GET /me rejects a missing token", async () => {
    const res = await h.request.get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  test("PUT /me updates the profile", async () => {
    const res = await h.request.put("/api/auth/me")
      .set({ Authorization: `Bearer ${token}` })
      .send({ firstName: "Updated" });
    expect(res.status).toBe(200);
    const row = await h.db.prepare("SELECT first_name FROM users WHERE email = ?").get(CREDS.email);
    expect(row.first_name).toBe("Updated");
  });

  test("PUT /me rejects an empty update", async () => {
    const res = await h.request.put("/api/auth/me")
      .set({ Authorization: `Bearer ${token}` })
      .send({});
    expect(res.status).toBe(400);
  });

  test("soft-deleted account is rejected even with a still-valid JWT", async () => {
    // The exact behavior the old mock couldn't model.
    await h.db.prepare("UPDATE users SET is_active = 0 WHERE email = ?").run(CREDS.email);
    const res = await h.request.get("/api/auth/me")
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    await h.db.prepare("UPDATE users SET is_active = 1 WHERE email = ?").run(CREDS.email);
  });
});
