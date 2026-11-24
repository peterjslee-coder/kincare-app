/**
 * Stale-link sweep (after v1.111.2). A care recipient's linked_user_id counts as "her own
 * account" only if that account owns the record or is on her care team. v1.111.2 applied that
 * to medical records and legal documents; this extends it to every read that treats the
 * linked user as the person (care_for views, messages contacts, dashboard, profile), and adds
 * an admin check that lists — and can remove — the stale ones.
 */
const jwt = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, admin, pete, kit, fam2, gen, selfUser, staleRecipient, genuineRecipient, selfRecipient;

async function trustThisNetwork(as) {
  const probe = await h.request.get("/api/admin/overview").set(h.auth(as.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  const { registerTrustedIp } = require("../../src/utils/trustedIps");
  await registerTrustedIp(as.user.id, ip, { verifiedVia: "itest" });
}

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/admin": "../../src/routes/admin",
    "/api/sessions": "../../src/routes/sessions",
    "/api/messages": "../../src/routes/messages",
    "/api/dashboard": "../../src/routes/dashboard",
    "/api/care-recipients": "../../src/routes/careRecipients",
    "/api/assignments": "../../src/routes/assignments",
  } });
  db = h.db;
  admin = await h.createUser({ roles: ["family"], firstName: "Ada", lastName: "Admin", isAdmin: true });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete", lastName: "Leader" });
  kit = await h.createUser({ roles: ["care_for"], firstName: "Kit", lastName: "Conn" });
  fam2 = await h.createUser({ roles: ["family"], firstName: "Fran", lastName: "Owner" });
  gen = await h.createUser({ roles: ["care_for"], firstName: "Gen", lastName: "Uine" });
  selfUser = await h.createUser({ roles: ["care_for"], firstName: "Sally", lastName: "Self" });

  // Stale: Kit linked to Pete's recipient, on no team.
  staleRecipient = (await h.createCareTeam({ familyUserId: pete.user.id })).recipientId;
  await db.prepare("UPDATE care_recipients SET linked_user_id = ?, consent_method = 'self_signup' WHERE id = ?").run(kit.user.id, staleRecipient);
  // Genuine: Gen linked to Fran's recipient and on its team (accepted the invite).
  const g = await h.createCareTeam({ familyUserId: fam2.user.id });
  genuineRecipient = g.recipientId;
  await h.addTeamMember(g.teamId, gen.user.id);
  await db.prepare("UPDATE care_recipients SET linked_user_id = ? WHERE id = ?").run(gen.user.id, genuineRecipient);
  // Self-signup: owner === linked, trusted with no extra team row needed.
  selfRecipient = uuid();
  await db.prepare("INSERT INTO care_recipients (id, family_user_id, linked_user_id, first_name, last_name, created_at) VALUES (?, ?, ?, 'Sally', 'Self', NOW())")
    .run(selfRecipient, selfUser.user.id, selfUser.user.id);

  await trustThisNetwork(admin);
});
afterAll(async () => { await stopHarness(h); });

describe("a stale linked account gets nothing that belongs to the person", () => {
  test("care_for visit list: stale 404, genuine 200", async () => {
    expect((await h.request.get("/api/sessions").set(h.auth(kit.token))).status).toBe(404);
    expect((await h.request.get("/api/sessions").set(h.auth(gen.token))).status).toBe(200);
  });
  test("care_for request-care cannot target her", async () => {
    const r = await h.request.post("/api/sessions/request").set(h.auth(kit.token))
      .send({ serviceType: "companionship", scheduledDate: "2026-12-01", scheduledTime: "10:00" });
    expect([404]).toContain(r.status);
  });
  test("care-recipients list: stale sees none, genuine and self-signup see their own", async () => {
    expect((await h.request.get("/api/care-recipients").set(h.auth(kit.token))).body.careRecipients).toEqual([]);
    const g = await h.request.get("/api/care-recipients").set(h.auth(gen.token));
    expect(g.body.careRecipients.map((c) => c.id)).toEqual([genuineRecipient]);
    const s = await h.request.get("/api/care-recipients").set(h.auth(selfUser.token));
    expect(s.body.careRecipients.map((c) => c.id)).toEqual([selfRecipient]);
  });
  test("cared-for dashboard: stale gets the empty shell, genuine gets her record", async () => {
    const k = await h.request.get("/api/dashboard").set(h.auth(kit.token));
    expect(k.status).toBe(200);
    expect(k.body.careRecipientId).toBeUndefined();
    const g = await h.request.get("/api/dashboard").set(h.auth(gen.token));
    expect(g.body.careRecipientId).toBe(genuineRecipient);
  });
  test("messages contacts: the stale account is not handed the family owner", async () => {
    const k = await h.request.get("/api/messages/contacts").set(h.auth(kit.token));
    expect((k.body.contacts || []).map((c) => c.id)).not.toContain(pete.user.id);
    const g = await h.request.get("/api/messages/contacts").set(h.auth(gen.token));
    expect((g.body.contacts || []).map((c) => c.id)).toContain(fam2.user.id);
  });
  test("assignments: stale sees none", async () => {
    const k = await h.request.get("/api/assignments").set(h.auth(kit.token));
    expect(k.body.assignments || []).toEqual([]);
  });
  test("the owner's profile does not report the stale account as her own; genuine is reported", async () => {
    const p = await h.request.get(`/api/care-recipients/${staleRecipient}`).set(h.auth(pete.token));
    expect(p.status).toBe(200);
    expect(p.body.careRecipient.linked_user_id).toBeNull();
    const f = await h.request.get(`/api/care-recipients/${genuineRecipient}`).set(h.auth(fam2.token));
    expect(f.body.careRecipient.linked_user_id).toBe(gen.user.id);
  });
  test("the SQL fragment and the JS check agree", async () => {
    const { TRUSTED_LINK_SQL, trustedLinkedUserId } = require("../../src/utils/linkedAccount");
    for (const id of [staleRecipient, genuineRecipient, selfRecipient]) {
      const cr = await db.prepare(`SELECT cr.*, ${TRUSTED_LINK_SQL} AS trusted FROM care_recipients cr WHERE cr.id = ?`).get(id);
      expect(!!cr.trusted).toBe(!!(await trustedLinkedUserId(db, cr)));
    }
  });
});

describe("admin integrity check", () => {
  const url = "/api/admin/integrity/linked-accounts";
  test("non-admin is refused", async () => {
    expect((await h.request.get(url).set(h.auth(pete.token))).status).toBe(403);
    expect((await h.request.post(`${url}/${staleRecipient}/unlink`).set(h.auth(pete.token)).send({ linkedUserId: kit.user.id })).status).toBe(403);
  });
  test("lists only the stale link, with how it was made and who leads", async () => {
    const r = await h.request.get(url).set(h.auth(admin.token));
    expect(r.status).toBe(200);
    expect(r.body.staleLinks.map((s) => s.recipientId)).toEqual([staleRecipient]);
    const row = r.body.staleLinks[0];
    expect(row.linkedUserId).toBe(kit.user.id);
    expect(row.linkedUserName).toBe("Kit Conn");
    expect(row.linkedUserEmail).toBe(kit.user.email);
    expect(row.consentMethod).toBe("self_signup");
    expect(row.ownerName).toBe("Pete Leader");
    expect(row.leaderName).toBe("Pete Leader");
  });
  test("refused under impersonation", async () => {
    const tok = jwt.sign({ id: admin.user.id, email: admin.user.email, roles: ["family"], role: "family", impersonatedBy: uuid() }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const r = await h.request.post(`${url}/${staleRecipient}/unlink`).set(h.auth(tok)).send({ linkedUserId: kit.user.id });
    expect(r.status).toBe(403);
    const still = await db.prepare("SELECT linked_user_id FROM care_recipients WHERE id = ?").get(staleRecipient);
    expect(still.linked_user_id).toBe(kit.user.id);
  });
  test("a trusted link cannot be removed here, and a wrong id is a 409", async () => {
    expect((await h.request.post(`${url}/${genuineRecipient}/unlink`).set(h.auth(admin.token)).send({ linkedUserId: gen.user.id })).status).toBe(409);
    expect((await h.request.post(`${url}/${staleRecipient}/unlink`).set(h.auth(admin.token)).send({ linkedUserId: gen.user.id })).status).toBe(409);
    expect((await h.request.post(`${url}/${staleRecipient}/unlink`).set(h.auth(admin.token)).send({})).status).toBe(400);
  });
  test("unlink clears it and audits under the admin; a second unlink is 409", async () => {
    const r = await h.request.post(`${url}/${staleRecipient}/unlink`).set(h.auth(admin.token)).send({ linkedUserId: kit.user.id });
    expect(r.status).toBe(200);
    const cr = await db.prepare("SELECT linked_user_id FROM care_recipients WHERE id = ?").get(staleRecipient);
    expect(cr.linked_user_id).toBeNull();
    const audit = await db.prepare("SELECT actor_id, metadata FROM consent_audit_log WHERE care_recipient_id = ? AND event_type = 'linked_account_removed'").get(staleRecipient);
    expect(audit.actor_id).toBe(admin.user.id);
    expect(JSON.parse(audit.metadata).previous_linked_user_id).toBe(kit.user.id);
    expect((await h.request.post(`${url}/${staleRecipient}/unlink`).set(h.auth(admin.token)).send({ linkedUserId: kit.user.id })).status).toBe(409);
    expect((await h.request.get(url).set(h.auth(admin.token))).body.staleLinks).toEqual([]);
    // genuine untouched
    expect((await db.prepare("SELECT linked_user_id FROM care_recipients WHERE id = ?").get(genuineRecipient)).linked_user_id).toBe(gen.user.id);
  });
});
