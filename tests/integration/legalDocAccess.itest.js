/**
 * v1.110.1 — Pete, 10/12: "Caregivers should not be able to open any legal documents unless
 * the careteam explicitly allows it. Legal docs and medical records are strictly for care teams."
 *
 * Before: documents.js canAccessOwner said yes to ANY care-team member, caregivers included.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, pete, sister, julia, tina, outsider, admin, recipientId, teamId, poaId, hcpoaId;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

async function upload(who, type, category = "legal") {
  return h.request.post("/api/documents/upload").set(h.auth(who.token))
    .field("category", category).field("document_type", type)
    .field("owner_type", "care_recipient").field("owner_id", recipientId)
    .attach("document", PNG, { filename: `${type}.png`, contentType: "image/png" });
}

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  h = await startHarness({ routers: { "/api/documents": "../../src/routes/documents" } });
  db = h.db;
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  sister = await h.createUser({ roles: ["family"], firstName: "Sis" });
  julia = await h.createUser({ roles: ["caregiver"], firstName: "Julia" });
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina" });
  outsider = await h.createUser({ roles: ["caregiver"], firstName: "Stranger" });
  admin = await h.createUser({ roles: ["family"], firstName: "Admin", isAdmin: true });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  teamId = t.teamId; recipientId = t.recipientId;
  await h.addTeamMember(teamId, sister.user.id);
  await h.addTeamMember(teamId, julia.user.id);
  await h.addTeamMember(teamId, tina.user.id);
  for (const u of [julia, tina, outsider]) {
    await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(uuid(), u.user.id);
  }
  const a = await upload(pete, "POA");
  expect(a.status).toBe(201);
  poaId = a.body.document.id;
  const b = await upload(pete, "Healthcare_POA");
  hcpoaId = b.body.document.id;
});

afterAll(async () => { await stopHarness(h); });

describe("default: the family's care team only", () => {
  test("a caregiver ON the care team cannot list, read or download a POA", async () => {
    const list = await h.request.get(`/api/documents/owner/care_recipient/${recipientId}`).set(h.auth(julia.token));
    expect(list.status).toBe(200);
    expect(list.body.documents).toEqual([]);
    expect((await h.request.get(`/api/documents/${poaId}`).set(h.auth(julia.token))).status).toBe(403);
    expect((await h.request.get(`/api/documents/${poaId}/download`).set(h.auth(julia.token))).status).toBe(403);
  });
  test("a family member on the team can", async () => {
    const list = await h.request.get(`/api/documents/owner/care_recipient/${recipientId}`).set(h.auth(sister.token));
    expect(list.body.documents.map((d) => d.id).sort()).toEqual([poaId, hcpoaId].sort());
    expect((await h.request.get(`/api/documents/${poaId}/download`).set(h.auth(sister.token))).status).toBe(200);
  });
  test("a caregiver cannot file a document into the record", async () => {
    expect((await upload(julia, "Living_Will")).status).toBe(403);
  });
  test("a caregiver cannot read the consent audit trail", async () => {
    expect((await h.request.get(`/api/documents/audit/${recipientId}`).set(h.auth(julia.token))).status).toBe(403);
  });
});

describe("the leader shares one document with one caregiver", () => {
  test("a non-leader family member cannot share", async () => {
    const r = await h.request.put(`/api/documents/${hcpoaId}/shares/${julia.user.id}`).set(h.auth(sister.token)).send({ allow: true });
    expect(r.status).toBe(403);
  });
  test("a caregiver not on the team and never booked is not eligible", async () => {
    const r = await h.request.put(`/api/documents/${hcpoaId}/shares/${outsider.user.id}`).set(h.auth(pete.token)).send({ allow: true });
    expect(r.status).toBe(400);
  });
  test("the leader shares the healthcare POA with Julia — only that one, only her", async () => {
    const list = await h.request.get(`/api/documents/${hcpoaId}/shares`).set(h.auth(pete.token));
    expect(list.status).toBe(200);
    expect(list.body.caregivers.map((c) => c.userId).sort()).toEqual([julia.user.id, tina.user.id].sort());
    const r = await h.request.put(`/api/documents/${hcpoaId}/shares/${julia.user.id}`).set(h.auth(pete.token)).send({ allow: true });
    expect(r.status).toBe(200);
    expect((await h.request.put(`/api/documents/${hcpoaId}/shares/${julia.user.id}`).set(h.auth(pete.token)).send({ allow: true })).status).toBe(409);

    const jl = await h.request.get(`/api/documents/owner/care_recipient/${recipientId}`).set(h.auth(julia.token));
    expect(jl.body.documents.map((d) => d.id)).toEqual([hcpoaId]);
    expect((await h.request.get(`/api/documents/${hcpoaId}/download`).set(h.auth(julia.token))).status).toBe(200);
    expect((await h.request.get(`/api/documents/${poaId}/download`).set(h.auth(julia.token))).status).toBe(403);
    expect((await h.request.get(`/api/documents/${hcpoaId}/download`).set(h.auth(tina.token))).status).toBe(403);
    const audit = await db.prepare("SELECT event_type FROM consent_audit_log WHERE care_recipient_id = ?").all(recipientId);
    expect(audit.map((a) => a.event_type)).toContain("document_shared_caregiver");
  });
  test("a shared caregiver still cannot delete it", async () => {
    expect((await h.request.delete(`/api/documents/${hcpoaId}`).set(h.auth(julia.token))).status).toBe(403);
  });
  test("removing access closes it again", async () => {
    const r = await h.request.put(`/api/documents/${hcpoaId}/shares/${julia.user.id}`).set(h.auth(pete.token)).send({ allow: false });
    expect(r.status).toBe(200);
    expect((await h.request.get(`/api/documents/${hcpoaId}/download`).set(h.auth(julia.token))).status).toBe(403);
    expect((await h.request.put(`/api/documents/${hcpoaId}/shares/${julia.user.id}`).set(h.auth(pete.token)).send({ allow: false })).status).toBe(409);
  });
});

describe("admin", () => {
  test("an admin can still open a POA for verification", async () => {
    expect((await h.request.get(`/api/documents/${poaId}/download`).set(h.auth(admin.token))).status).toBe(200);
  });
  test("admin approve/reject now writes its audit row", async () => {
    const r = await h.request.post(`/api/documents/admin/${poaId}/review`).set(h.auth(admin.token)).send({ action: "approve" });
    expect(r.status).toBe(200);
    const row = await db.prepare("SELECT 1 FROM consent_audit_log WHERE care_recipient_id = ? AND event_type = 'document_approved'").get(recipientId);
    expect(row).toBeTruthy();
  });
});
