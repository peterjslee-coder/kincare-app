/**
 * v1.128.3 — one Identity card per person (src/utils/identityReview.js).
 *
 * Pete, 11/16: "Why do I get four different notifications for one ID approval. I don't want to
 * approve the back of somebody's ID." / "It just shows unknown recipient uploaded by Ryan."
 *
 * A caregiver's ID arrives as up to four rows from two routes. These pin: one card per owner,
 * named; one decision writes every row; a photo that arrives after the card was loaded is never
 * approved unseen; the single-photo route refuses identity rows; the queue counts people.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, admin, sam, family, cpId;

async function addIdRow({ ownerType, ownerId, uploadedBy, type, status = "pending" }) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type,
      file_data, file_name, file_size, mime_type, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'identity', ?, 'data:image/png;base64,AA==', 'x.png', 10, 'image/png', ?, NOW(), NOW())
  `).run(id, ownerType, ownerId, uploadedBy, type, status);
  return id;
}

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY; // analysis must degrade, never call out
  h = await startHarness({ routers: { "/api/documents": "../../src/routes/documents" } });
  db = h.db;
  admin = await h.createUser({ roles: ["family"], firstName: "Admin", isAdmin: true });
  sam = await h.createUser({ roles: ["caregiver"], firstName: "Sam", lastName: "Rivera", idVerified: false });
  family = await h.createUser({ roles: ["family"], firstName: "Jane", lastName: "Ellis", idVerified: false });
  cpId = uuid();
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(cpId, sam.user.id);
});

afterAll(async () => { await stopHarness(h); });

let samIds;

test("a caregiver's four identity rows are ONE named card; the queue counts people", async () => {
  samIds = [
    await addIdRow({ ownerType: "caregiver", ownerId: cpId, uploadedBy: sam.user.id, type: "DL_Front" }),
    await addIdRow({ ownerType: "caregiver", ownerId: cpId, uploadedBy: sam.user.id, type: "DL_Back" }),
    await addIdRow({ ownerType: "caregiver", ownerId: cpId, uploadedBy: sam.user.id, type: "drivers_license" }),
    await addIdRow({ ownerType: "caregiver", ownerId: cpId, uploadedBy: sam.user.id, type: "selfie" }),
  ];
  await addIdRow({ ownerType: "user", ownerId: family.user.id, uploadedBy: family.user.id, type: "passport" });

  const res = await h.request.get("/api/documents/admin/pending").set(h.auth(admin.token));
  expect(res.status).toBe(200);
  const cards = res.body.identityChecks;
  const samCard = cards.find((c) => c.key === `caregiver:${cpId}`);
  expect(samCard).toBeTruthy();
  expect(samCard.personName).toBe("Sam Rivera");
  expect(samCard.docIds.sort()).toEqual([...samIds].sort());
  expect(samCard.selfie && samCard.selfie.documentType).toBe("selfie");
  expect(samCard.back && samCard.back.documentType).toBe("DL_Back");
  expect(samCard.front).toBeTruthy();
  expect(cards.find((c) => c.key === `user:${family.user.id}`).personName).toBe("Jane Ellis");
  // No identity row leaks into the per-document list.
  expect(res.body.documents.some((d) => d.category === "identity")).toBe(false);
  expect(res.body.count).toBe(res.body.documents.length + cards.length);

  const count = await h.request.get("/api/documents/admin/count").set(h.auth(admin.token));
  expect(count.body.count).toBe(res.body.documents.length + cards.length);
});

test("the single-photo route refuses an identity row", async () => {
  const res = await h.request.post(`/api/documents/admin/${samIds[1]}/review`).set(h.auth(admin.token))
    .send({ action: "approve" });
  expect(res.status).toBe(409);
  const row = await db.prepare("SELECT status FROM verified_documents WHERE id = ?").get(samIds[1]);
  expect(row.status).toBe("pending");
});

test("analysis without an AI key is stored as 'unavailable', never as a verdict", async () => {
  const res = await h.request.post("/api/documents/admin/identity/analyze").set(h.auth(admin.token))
    .send({ key: `caregiver:${cpId}` });
  expect(res.status).toBe(200);
  expect(res.body.analysis.ok).toBe(false);
  expect(res.body.analysis.suggestion.verdict).toBe("abstain");
});

test("a photo that arrived after the card loaded blocks the decision (409), nothing written", async () => {
  const late = await addIdRow({ ownerType: "caregiver", ownerId: cpId, uploadedBy: sam.user.id, type: "DL_Back" });
  const res = await h.request.post("/api/documents/admin/identity/review").set(h.auth(admin.token))
    .send({ key: `caregiver:${cpId}`, docIds: samIds, action: "approve" });
  expect(res.status).toBe(409);
  const rows = await db.prepare(`SELECT status FROM verified_documents WHERE owner_type = 'caregiver' AND owner_id = ?`).all(cpId);
  expect(rows.every((r) => r.status === "pending")).toBe(true);
  samIds.push(late);
});

test("non-admins cannot decide", async () => {
  const res = await h.request.post("/api/documents/admin/identity/review").set(h.auth(sam.token))
    .send({ key: `caregiver:${cpId}`, docIds: samIds, action: "approve" });
  expect(res.status).toBe(403);
});

test("one approve writes every photo in the set, as a human decision", async () => {
  const res = await h.request.post("/api/documents/admin/identity/review").set(h.auth(admin.token))
    .send({ key: `caregiver:${cpId}`, docIds: samIds, action: "approve", notes: "Seen at welcome call" });
  expect(res.status).toBe(200);
  expect(res.body.count).toBe(samIds.length);
  const rows = await db.prepare(`SELECT status, admin_reviewed_by, is_verified FROM verified_documents WHERE owner_type = 'caregiver' AND owner_id = ?`).all(cpId);
  expect(rows).toHaveLength(samIds.length);
  for (const r of rows) {
    expect(r.status).toBe("approved");
    expect(r.admin_reviewed_by).toBe(admin.user.id);
    expect(Number(r.is_verified)).toBe(1);
  }
  const after = await h.request.get("/api/documents/admin/pending").set(h.auth(admin.token));
  expect(after.body.identityChecks.find((c) => c.key === `caregiver:${cpId}`)).toBeUndefined();
});

test("asking for a new photo rejects the set and keeps the note", async () => {
  const pending = await h.request.get("/api/documents/admin/pending").set(h.auth(admin.token));
  const jane = pending.body.identityChecks.find((c) => c.key === `user:${family.user.id}`);
  const res = await h.request.post("/api/documents/admin/identity/review").set(h.auth(admin.token))
    .send({ key: jane.key, docIds: jane.docIds, action: "request_new", notes: "passport photo is blurry" });
  expect(res.status).toBe(200);
  const row = await db.prepare("SELECT status, admin_notes FROM verified_documents WHERE id = ?").get(jane.docIds[0]);
  expect(row.status).toBe("rejected");
  expect(row.admin_notes).toMatch(/Asked for a new photo: passport photo is blurry/);
});
