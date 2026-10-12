/**
 * Documents Center Phase 1 — medical records (migration 050).
 * Who sees them, the passkey step-up, the iPAi key, the admin queue, and revocation.
 */
const { v4: uuid } = require("uuid");
const jwt = require("jsonwebtoken");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, pete, sister, julia, admin, recipientId, teamId, docId;
let stepUp;

// A minimal PNG (signature + IHDR start) — enough for validateMagicBytes.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

const base = () => `/api/medical-records/${recipientId}`;
async function giveStepUp(who) {
  const decoded = jwt.decode(who.token);
  await db.prepare(`
    INSERT INTO medical_step_ups (user_id, session_key, verified_at, expires_at)
    VALUES (?, ?, NOW(), NOW() + INTERVAL '10 minutes')
    ON CONFLICT (user_id, session_key) DO UPDATE SET expires_at = EXCLUDED.expires_at
  `).run(who.user.id, stepUp.sessionKeyFor(decoded));
}
async function giveFakePasskey(who) {
  await db.prepare(`
    INSERT INTO user_passkeys (id, user_id, credential_id, public_key, counter, created_at)
    VALUES (?, ?, ?, 'x', 0, NOW())
  `).run(uuid(), who.user.id, `cred-${who.user.id}`);
}

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY; // the iPAi review must degrade, not call out
  h = await startHarness({ routers: {
    "/api/documents": "../../src/routes/documents",
    "/api/medical-records": "../../src/routes/medicalRecords",
  } });
  db = h.db;
  stepUp = require("../../src/utils/medicalStepUp");
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  sister = await h.createUser({ roles: ["family"], firstName: "Sis" });
  julia = await h.createUser({ roles: ["caregiver"], firstName: "Julia" });
  admin = await h.createUser({ roles: ["family"], firstName: "Admin", isAdmin: true });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  teamId = t.teamId; recipientId = t.recipientId;
  await h.addTeamMember(teamId, sister.user.id);
  await h.addTeamMember(teamId, julia.user.id);
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(uuid(), julia.user.id);
});

afterAll(async () => {
  if (stepUp && stepUp._setVerifierForTests) stepUp._setVerifierForTests(null);
  await stopHarness(h);
});

describe("upload", () => {
  test("the leader uploads a medical record: stored, never queued", async () => {
    const res = await h.request.post("/api/documents/upload").set(h.auth(pete.token))
      .field("category", "medical").field("document_type", "Discharge_Summary")
      .field("owner_type", "care_recipient").field("owner_id", recipientId)
      .attach("document", PNG, { filename: "discharge.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.document.status).toBe("stored");
    docId = res.body.document.id;
    const audit = await db.prepare("SELECT event_type FROM medical_record_audit WHERE document_id = ?").all(docId);
    expect(audit.map((a) => a.event_type)).toContain("uploaded");
  });
  test("a caregiver on the team cannot upload one", async () => {
    const res = await h.request.post("/api/documents/upload").set(h.auth(julia.token))
      .field("category", "medical").field("document_type", "Lab_Result")
      .field("owner_type", "care_recipient").field("owner_id", recipientId)
      .attach("document", PNG, { filename: "lab.png", contentType: "image/png" });
    expect(res.status).toBe(403);
  });
});

describe("who can see", () => {
  test("a caregiver on the care team gets 403 on list and open", async () => {
    expect((await h.request.get(base()).set(h.auth(julia.token))).status).toBe(403);
    await giveStepUp(julia);
    expect((await h.request.get(`${base()}/docs/${docId}/open`).set(h.auth(julia.token))).status).toBe(403);
    expect((await h.request.get(`/api/documents/${docId}`).set(h.auth(julia.token))).status).toBe(403);
    expect((await h.request.get(`/api/documents/${docId}/download`).set(h.auth(julia.token))).status).toBe(403);
  });
  test("the generic owner list never carries medical records", async () => {
    const res = await h.request.get(`/api/documents/owner/care_recipient/${recipientId}`).set(h.auth(pete.token));
    expect(res.status).toBe(200);
    expect(res.body.documents.find((d) => d.id === docId)).toBeUndefined();
  });
  test("a family member not yet allowed gets 403", async () => {
    expect((await h.request.get(base()).set(h.auth(sister.token))).status).toBe(403);
  });
  test("the leader cannot allow a caregiver", async () => {
    await giveStepUp(pete);
    const res = await h.request.put(`${base()}/access/${julia.user.id}`).set(h.auth(pete.token)).send({ allowed: true });
    expect(res.status).toBe(400);
  });
  test("a non-leader cannot change sharing", async () => {
    const res = await h.request.put(`${base()}/access/${sister.user.id}`).set(h.auth(sister.token)).send({ allowed: true });
    expect(res.status).toBe(403);
  });
  test("once allowed, the member can list titles", async () => {
    await giveStepUp(pete);
    const g = await h.request.put(`${base()}/access/${sister.user.id}`).set(h.auth(pete.token)).send({ allowed: true });
    expect(g.status).toBe(200);
    const res = await h.request.get(base()).set(h.auth(sister.token));
    expect(res.status).toBe(200);
    expect(res.body.documents.map((d) => d.id)).toContain(docId);
    expect(res.body.sharing).toBeNull(); // the sharing list is the leader's
    const p = await h.request.get(base()).set(h.auth(pete.token));
    expect(p.body.sharing.find((s) => s.userId === julia.user.id).status).toBe("caregiver");
    expect(p.body.sharing.find((s) => s.userId === sister.user.id).status).toBe("allowed");
  });
});

describe("passkey step-up", () => {
  test("opening without a step-up is refused", async () => {
    const res = await h.request.get(`${base()}/docs/${docId}/open`).set(h.auth(sister.token));
    expect(res.status).toBe(401);
    expect(res.body.needsStepUp).toBe(true);
  });
  test("with a step-up the file opens and the open is audited", async () => {
    await giveStepUp(sister);
    const res = await h.request.get(`${base()}/docs/${docId}/open`).set(h.auth(sister.token));
    expect(res.status).toBe(200);
    const audit = await db.prepare("SELECT event_type, actor_id FROM medical_record_audit WHERE document_id = ? AND event_type = 'viewed'").all(docId);
    expect(audit.map((a) => a.actor_id)).toContain(sister.user.id);
  });
  test("a step-up challenge without a passkey says to add one", async () => {
    const res = await h.request.post("/api/medical-records/step-up/challenge").set(h.auth(sister.token)).send({ purpose: "open" });
    expect(res.status).toBe(403);
    expect(res.body.needsPasskey).toBe(true);
    expect(res.body.error).toMatch(/Account → Security/);
  });
  test("Test Mode cannot open a record even with a step-up", async () => {
    const decoded = jwt.decode(sister.token);
    const imp = jwt.sign({ id: sister.user.id, email: sister.user.email, roles: ["family"], role: "family", impersonatedBy: admin.user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    await db.prepare(`
      INSERT INTO medical_step_ups (user_id, session_key, verified_at, expires_at)
      VALUES (?, ?, NOW(), NOW() + INTERVAL '10 minutes') ON CONFLICT DO NOTHING
    `).run(sister.user.id, stepUp.sessionKeyFor(jwt.decode(imp)));
    expect(decoded.id).toBe(sister.user.id);
    const res = await h.request.get(`${base()}/docs/${docId}/open`).set(h.auth(imp));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("IMPERSONATION_BLOCKED");
  });
});

describe("admins", () => {
  test("the admin pending queue and count exclude medical records", async () => {
    // Even a medical row in a queued status must not appear.
    await db.prepare("UPDATE verified_documents SET status = 'pending' WHERE id = ?").run(docId);
    const res = await h.request.get("/api/documents/admin/pending").set(h.auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.documents.find((d) => d.id === docId)).toBeUndefined();
    const before = (await h.request.get("/api/documents/admin/count").set(h.auth(admin.token))).body.count;
    expect(before).toBe(res.body.documents.length);
    expect((await h.request.post(`/api/documents/admin/${docId}/review`).set(h.auth(admin.token)).send({ action: "approve" })).status).toBe(404);
    await db.prepare("UPDATE verified_documents SET status = 'stored' WHERE id = ?").run(docId);
  });
  test("an admin has no blanket read", async () => {
    expect((await h.request.get(base()).set(h.auth(admin.token))).status).toBe(403);
    expect((await h.request.get(`/api/documents/${docId}`).set(h.auth(admin.token))).status).toBe(403);
  });
});

describe("the iPAi key", () => {
  test("a non-holder cannot change it", async () => {
    const res = await h.request.put(`${base()}/ai-consent`).set(h.auth(sister.token)).send({ granted: true });
    expect(res.status).toBe(403);
  });
  test("the holder with no passkey is told to add one", async () => {
    const res = await h.request.put(`${base()}/ai-consent`).set(h.auth(pete.token)).send({ granted: true });
    expect(res.status).toBe(403);
    expect(res.body.needsPasskey).toBe(true);
    expect(res.body.error).toMatch(/Account → Security/);
  });
  test("the holder with a passkey but no assertion is refused", async () => {
    await giveFakePasskey(pete);
    const res = await h.request.put(`${base()}/ai-consent`).set(h.auth(pete.token)).send({ granted: true });
    expect(res.status).toBe(401);
  });
  test("review is refused while the key is off", async () => {
    await giveStepUp(pete);
    const res = await h.request.post(`${base()}/docs/${docId}/review`).set(h.auth(pete.token)).send({ acknowledged: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AI_KEY_OFF");
  });
  test("granting with a verified passkey turns it on", async () => {
    stepUp._setVerifierForTests(async () => true);
    const key = stepUp._issueChallengeForTests(pete.user.id, "ai_consent");
    const res = await h.request.put(`${base()}/ai-consent`).set(h.auth(pete.token)).send({ granted: true, id: `cred-${pete.user.id}`, _challengeKey: key });
    expect(res.status).toBe(200);
    expect(res.body.on).toBe(true);
    // a used challenge cannot be replayed
    const again = await h.request.put(`${base()}/ai-consent`).set(h.auth(pete.token)).send({ granted: false, _challengeKey: key });
    expect(again.status).toBe(401);
  });
  test("review needs the acknowledgment, then degrades cleanly with no AI key", async () => {
    await giveStepUp(pete);
    const noAck = await h.request.post(`${base()}/docs/${docId}/review`).set(h.auth(pete.token)).send({});
    expect(noAck.status).toBe(400);
    expect(noAck.body.code).toBe("ACK_REQUIRED");
    const res = await h.request.post(`${base()}/docs/${docId}/review`).set(h.auth(pete.token)).send({ acknowledged: true });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_UNAVAILABLE");
    const acks = await db.prepare("SELECT user_id FROM medical_ai_acks WHERE document_id = ?").all(docId);
    expect(acks.map((a) => a.user_id)).toContain(pete.user.id);
  });
  test("accepting an appointment suggestion puts it on the calendar — only on a tap", async () => {
    const sid = uuid();
    await db.prepare(`
      INSERT INTO medical_doc_suggestions (id, document_id, care_recipient_id, kind, title, source_quote, suggested_date, status)
      VALUES (?, ?, ?, 'appointment', 'Cardiology follow-up', 'Follow up with cardiology on 11/02/2026', '2026-11-02', 'pending')
    `).run(sid, docId, recipientId);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM care_events WHERE care_recipient_id = ?").get(recipientId)).n).toBe("0");
    const res = await h.request.post(`${base()}/suggestions/${sid}/decide`).set(h.auth(pete.token)).send({ action: "accept" });
    expect(res.status).toBe(200);
    const ev = await db.prepare("SELECT title, category, event_date, source FROM care_events WHERE id = ?").get(res.body.careEventId);
    expect(ev).toEqual(expect.objectContaining({ title: "Cardiology follow-up", category: "medical", event_date: "2026-11-02", source: "medical_record" }));
  });
  test("revoking deletes pending suggestions", async () => {
    for (let i = 0; i < 2; i++) {
      await db.prepare(`
        INSERT INTO medical_doc_suggestions (id, document_id, care_recipient_id, kind, title, source_quote, status)
        VALUES (?, ?, ?, 'review_item', 'Call if fever', 'Call if fever over 101', 'pending')
      `).run(uuid(), docId, recipientId);
    }
    const key = stepUp._issueChallengeForTests(pete.user.id, "ai_consent");
    const res = await h.request.put(`${base()}/ai-consent`).set(h.auth(pete.token)).send({ granted: false, id: `cred-${pete.user.id}`, _challengeKey: key });
    expect(res.status).toBe(200);
    expect(res.body.on).toBe(false);
    const left = await db.prepare("SELECT status FROM medical_doc_suggestions WHERE care_recipient_id = ?").all(recipientId);
    expect(left.filter((r) => r.status === "pending")).toHaveLength(0);
    expect(left.filter((r) => r.status === "accepted")).toHaveLength(1); // decided history stays
  });
  test("when the member has her own account, she holds the key", async () => {
    const betty = await h.createUser({ roles: ["care_for"], firstName: "Betty" });
    await db.prepare("UPDATE care_recipients SET linked_user_id = ? WHERE id = ?").run(betty.user.id, recipientId);
    const mine = await h.request.get(base()).set(h.auth(betty.token));
    expect(mine.status).toBe(200);
    expect(mine.body.me.isKeyHolder).toBe(true);
    expect(mine.body.aiKey.holderIsMember).toBe(true);
    const res = await h.request.put(`${base()}/ai-consent`).set(h.auth(pete.token)).send({ granted: true });
    expect(res.status).toBe(403);
    const audit = await h.request.get(`${base()}/audit`).set(h.auth(betty.token));
    expect(audit.status).toBe(200);
    expect(audit.body.entries.map((e) => e.eventType)).toEqual(expect.arrayContaining(["uploaded", "viewed", "access_granted", "ai_consent_granted", "ai_consent_revoked", "ai_read"]));
    expect((await h.request.get(`${base()}/audit`).set(h.auth(sister.token))).status).toBe(403);
  });
});
