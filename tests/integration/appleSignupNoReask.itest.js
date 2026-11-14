/**
 * App Review rejection, Nov 2026, Guideline 4: "users are required to provide their name and/or
 * email address after using Sign in with Apple even though that information is already
 * provided". The sign-up form asked for name, showed the email, and demanded a password —
 * and the server could not create the account without one (bcrypt.hash(undefined) throws).
 *
 * These run the real route against the real schema: an Apple sign-up completes with only what
 * InPlace itself needs (role, date of birth, phone) — no password, no name, no email re-asked.
 */
const { startHarness, stopHarness } = require("./harness");
const crypto = require("crypto");

jest.setTimeout(180000);

let h, db, pending;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/oauth": "../../src/routes/oauth" } });
  db = h.db;
  pending = require("../../src/routes/oauth")._pendingSignups;
});

afterAll(async () => { await stopHarness(h); });

function seed(over = {}) {
  const code = crypto.randomBytes(16).toString("hex");
  pending.set(code, {
    provider: "apple",
    providerId: "apple-sub-" + code.slice(0, 8),
    email: `relay-${code.slice(0, 8)}@privaterelay.appleid.com`,
    firstName: "", lastName: "",
    avatarUrl: null, accessToken: null, refreshToken: null, emailVerified: true,
    expiresAt: Date.now() + 5 * 60 * 1000,
    ...over,
  });
  return code;
}

const ADULT = "1980-05-01";

describe("Sign in with Apple never re-asks", () => {
  test("completes with no password at all", async () => {
    const code = seed({ firstName: "Jane", lastName: "Doe" });
    const res = await h.request.post("/api/oauth/complete-signup")
      .send({ code, role: "family", dateOfBirth: ADULT, phone: "5405550100" });
    expect(res.status).toBeLessThan(300);
    const u = await db.prepare("SELECT first_name, last_name, password_hash, email_verified FROM users WHERE email LIKE ?")
      .get(`relay-${code.slice(0, 8)}%`);
    expect(u).toBeTruthy();
    expect(u.first_name).toBe("Jane");
    expect(u.last_name).toBe("Doe");
    expect(u.password_hash).toMatch(/^\$2[aby]\$/); // an unguessable hash, never empty
    expect(!!u.email_verified).toBe(true);
  });

  test("Apple sent no name and the person typed none: the account is still made", async () => {
    const code = seed();
    const res = await h.request.post("/api/oauth/complete-signup")
      .send({ code, role: "caregiver", dateOfBirth: ADULT, phone: "5405550101" });
    expect(res.status).toBeLessThan(300);
    const u = await db.prepare("SELECT first_name, last_name FROM users WHERE email LIKE ?").get(`relay-${code.slice(0, 8)}%`);
    expect(u.first_name).toBe("InPlace");
    expect(u.last_name).toBe("Member");
  });

  test("a name the person chose to type wins over the placeholder", async () => {
    const code = seed();
    const res = await h.request.post("/api/oauth/complete-signup")
      .send({ code, role: "family", firstName: "  Sam ", lastName: "", dateOfBirth: ADULT, phone: "5405550102" });
    expect(res.status).toBeLessThan(300);
    const u = await db.prepare("SELECT first_name FROM users WHERE email LIKE ?").get(`relay-${code.slice(0, 8)}%`);
    expect(u.first_name).toBe("Sam");
  });

  test("the age gate still applies", async () => {
    const code = seed({ firstName: "Kid" });
    const res = await h.request.post("/api/oauth/complete-signup")
      .send({ code, role: "family", dateOfBirth: new Date(Date.now() - 5 * 365 * 864e5).toISOString().slice(0, 10), phone: "5405550103" });
    expect(res.status).toBe(400);
  });
});
