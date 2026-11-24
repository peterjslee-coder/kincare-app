/**
 * v1.109.1 — viewing as someone changes nothing.
 *
 * Pete, 9/18: "View as user should be read only ... It is intended to allow me to help
 * troubleshoot what other roles are seeing when they log in, not to change anything."
 *
 * Seventeen routes carried a guard; there were 314 write routes. This asserts the rule at the
 * door, the hole that made every guard pointless (GET /api/auth/me handing out a clean token),
 * and — the half that matters just as much — that the person herself is untouched.
 */
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, pete, sara, recipientId;
const asAdmin = (user) => jwt.sign(
  { id: user.user.id, email: user.user.email, roles: ["family"], role: "family", impersonatedBy: pete.user.id },
  process.env.JWT_SECRET, { expiresIn: "2h" },
);

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/auth": "../../src/routes/auth",
    "/api/notes": "../../src/routes/notes",
    "/api/sessions": "../../src/routes/sessions",
  } });
  db = h.db;
  pete = await h.createUser({ firstName: "Peter", roles: ["family"] });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(pete.user.id);
  sara = await h.createUser({ firstName: "Sara", roles: ["family"] });
  ({ recipientId } = await h.createCareTeam({ familyUserId: sara.user.id }));
});
afterAll(async () => { await stopHarness(h); });

const viewing = () => asAdmin(sara);

describe("while viewing as Sara", () => {
  test("reads work — that is the whole point of it", async () => {
    const me = await h.request.get("/api/auth/me").set(h.auth(viewing()));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(sara.user.email);
    const notes = await h.request.get("/api/notes/mine/recipients").set(h.auth(viewing()));
    expect(notes.status).toBe(200);
  });

  test("/api/auth/me hands out no token — the hole that made every guard pointless", async () => {
    const me = await h.request.get("/api/auth/me").set(h.auth(viewing()));
    expect(me.body.token).toBeFalsy();
    // ...and for Sara herself it still does, because the socket needs one.
    const hers = await h.request.get("/api/auth/me").set(h.auth(sara.token));
    expect(typeof hers.body.token).toBe("string");
    expect(jwt.verify(hers.body.token, process.env.JWT_SECRET).impersonatedBy).toBeUndefined();
  });

  test("writes are refused wherever they live, not only on the guarded routes", async () => {
    const writes = [
      ["post", "/api/notes", { careRecipientId: recipientId, content: "written by an admin" }],
      ["put", "/api/auth/me", { firstName: "Renamed" }],
      ["post", "/api/sessions", { careRecipientId: recipientId, serviceType: "companionship", scheduledDate: "2030-02-01", scheduledTime: "09:00", durationHours: 2 }],
      ["patch", "/api/auth/me/ui-prefs", { patch: { notesOpen: true } }],
      ["delete", "/api/auth/me/photo", {}],
    ];
    for (const [method, path, body] of writes) {
      const res = await h.request[method](path).set(h.auth(viewing())).send(body);
      expect([res.status, path]).toEqual([403, path]);
      expect(res.body.code).toBe("IMPERSONATION_BLOCKED");
    }
    expect((await db.prepare("SELECT COUNT(*)::int AS n FROM recipient_notes WHERE care_recipient_id = ?").get(recipientId)).n).toBe(0);
    expect((await db.prepare("SELECT first_name FROM users WHERE id = ?").get(sara.user.id)).first_name).toBe("Sara");
  });

  test("every refusal is logged against the admin, not against her", async () => {
    await h.request.post("/api/notes").set(h.auth(viewing())).send({ careRecipientId: recipientId, content: "nope" });
    const row = await db.prepare(
      "SELECT details, severity FROM audit_log WHERE action = 'impersonation_blocked_write' ORDER BY created_at DESC LIMIT 1"
    ).get();
    const details = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
    expect(details.impersonatedBy).toBe(pete.user.id);
    expect(row.severity).toBe("warning");
  });

  test("ending the session is still allowed", async () => {
    const out = await h.request.post("/api/auth/logout").set(h.auth(viewing()));
    expect(out.status).toBe(200);
  });
});

describe("Sara herself", () => {
  test("can still do all of it — a guard that only ever refuses is an outage", async () => {
    const note = await h.request.post("/api/notes").set(h.auth(sara.token))
      .send({ careRecipientId: recipientId, content: "her own note" });
    expect(note.status).toBe(201);
    const rename = await h.request.put("/api/auth/me").set(h.auth(sara.token)).send({ firstName: "Sara" });
    expect(rename.status).toBe(200);
    const prefs = await h.request.patch("/api/auth/me/ui-prefs").set(h.auth(sara.token)).send({ patch: { notesOpen: true } });
    expect([200, 204]).toContain(prefs.status);
  });
});

test("a socket will not connect with an impersonation token", () => {
  // The handshake is a pure jwt.verify + a check; asserted at the source it is written in,
  // because standing up socket.io in-process here would test the harness, not the rule.
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "server.js"), "utf8");
  const handshake = src.slice(src.indexOf("io.use((socket, next)"), src.indexOf("// Track connected users"));
  expect(handshake).toMatch(/if \(decoded\.impersonatedBy\) return next\(new Error/);
  expect(handshake.indexOf("impersonatedBy")).toBeLessThan(handshake.indexOf("socket.user = decoded"));
});
