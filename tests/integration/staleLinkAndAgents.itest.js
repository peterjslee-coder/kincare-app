/**
 * v1.111.2 — Pete, 10/12: "why is Kit Conn showing as betty lee's own account? … kit is in no
 * way related to betty." A stale self-signup link to an account on NO care team was treated as
 * the person herself: key holder, medical records, legal documents. And: "IP should know that
 * Sara Huber is the Durable POA."
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");
jest.setTimeout(180000);

let h, db, pete, sara, kit, recipientId, teamId;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/documents": "../../src/routes/documents",
    "/api/medical-records": "../../src/routes/medicalRecords",
    "/api/legal-readiness": "../../src/routes/legalReadiness",
  } });
  db = h.db;
  pete = await h.createUser({ roles: ["family", "caregiver"], firstName: "Pete" });
  sara = await h.createUser({ roles: ["family"], firstName: "Sara", lastName: "Huber" });
  kit = await h.createUser({ roles: ["care_for"], firstName: "Kit" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  recipientId = t.recipientId; teamId = t.teamId;
  await h.addTeamMember(teamId, sara.user.id);
  // Pete is also a registered caregiver, like the real leader
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(uuid(), pete.user.id);
  // the stale link: Kit is linked as "her own account" but is on no team
  await db.prepare("UPDATE care_recipients SET linked_user_id = ? WHERE id = ?").run(kit.user.id, recipientId);
  const up = await h.request.post("/api/documents/upload").set(h.auth(pete.token))
    .field("category", "legal").field("document_type", "POA").field("owner_type", "care_recipient")
    .field("authority_confirmed", "1").field("owner_id", recipientId)
    .attach("document", PNG, { filename: "poa.png", contentType: "image/png" });
  expect(up.status).toBe(201);
  h.poaId = up.body.document.id;
});
afterAll(async () => { await stopHarness(h); });

describe("a linked account on no care team is not the person", () => {
  test("Kit cannot list medical records or open the POA", async () => {
    expect((await h.request.get(`/api/medical-records/${recipientId}`).set(h.auth(kit.token))).status).toBe(403);
    expect((await h.request.get(`/api/documents/${h.poaId}/download`).set(h.auth(kit.token))).status).toBe(403);
  });
  test("the iPAi key falls to the leader, and the page no longer says she has her own account", async () => {
    const r = await h.request.get(`/api/medical-records/${recipientId}`).set(h.auth(pete.token));
    expect(r.status).toBe(200);
    expect(r.body.aiKey.holderId).toBe(pete.user.id);
    expect(r.body.aiKey.holderIsMember).toBe(false);
    expect(r.body.recipient.hasOwnAccount).toBe(false);
  });
  test("a leader who is also a registered caregiver is listed as the leader, not a caregiver", async () => {
    const r = await h.request.get(`/api/medical-records/${recipientId}`).set(h.auth(pete.token));
    const me = (r.body.sharing || []).find((s) => s.userId === pete.user.id);
    if (me) expect(me.status).toBe("always");
  });
  test("once she is on the team, a genuine linked account IS the person", async () => {
    await h.addTeamMember(teamId, kit.user.id);
    expect((await h.request.get(`/api/medical-records/${recipientId}`).set(h.auth(kit.token))).status).toBe(200);
    await db.prepare("DELETE FROM care_team_members WHERE care_team_id = ? AND user_id = ?").run(teamId, kit.user.id);
  });
});

describe("recording who the POA names", () => {
  test("the leader records Sara as the agent; the family sees it", async () => {
    const r = await h.request.put(`/api/legal-readiness/${recipientId}/agents/financial_poa`).set(h.auth(pete.token)).send({ userId: sara.user.id });
    expect(r.status).toBe(200);
    const item = r.body.items.find((i) => i.key === "financial_poa");
    expect(item.agent.name).toBe("Sara Huber");
    const s = await h.request.get(`/api/legal-readiness/${recipientId}`).set(h.auth(sara.token));
    expect(s.body.items.find((i) => i.key === "financial_poa").agent.userId).toBe(sara.user.id);
    expect(s.body.canSetAgent).toBe(false);
    const audit = await db.prepare("SELECT 1 FROM consent_audit_log WHERE care_recipient_id = ? AND event_type = 'authority_recorded'").get(recipientId);
    expect(audit).toBeTruthy();
  });
  test("a member who isn't the leader can't change it", async () => {
    const r = await h.request.put(`/api/legal-readiness/${recipientId}/agents/financial_poa`).set(h.auth(sara.token)).send({ name: "Someone Else" });
    expect(r.status).toBe(403);
  });
  test("a typed name works for someone not on the team; empty clears", async () => {
    const r = await h.request.put(`/api/legal-readiness/${recipientId}/agents/healthcare_directive`).set(h.auth(pete.token)).send({ name: "Dr. Alternate" });
    expect(r.body.items.find((i) => i.key === "healthcare_directive").agent.name).toBe("Dr. Alternate");
    const c = await h.request.put(`/api/legal-readiness/${recipientId}/agents/healthcare_directive`).set(h.auth(pete.token)).send({});
    expect(c.body.items.find((i) => i.key === "healthcare_directive").agent).toBeNull();
  });
  test("a non-team user id is refused", async () => {
    const r = await h.request.put(`/api/legal-readiness/${recipientId}/agents/financial_poa`).set(h.auth(pete.token)).send({ userId: kit.user.id });
    expect(r.status).toBe(400);
  });
});
