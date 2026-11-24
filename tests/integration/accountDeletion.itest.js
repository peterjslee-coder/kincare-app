/**
 * v1.105.48 — "Delete my account" against a real database.
 *
 * The route referenced `authorization_documents.uploaded_by_user_id`, a column that has
 * never existed. Because the statement sits inside the delete TRANSACTION, it threw, rolled
 * everything back, and answered 500 — so self-service account deletion has never once
 * worked, for anyone, and no PII was ever anonymised. That is a legal obligation quietly
 * failing since the day it was written.
 *
 * Source-matching the column name would not have caught it and would not catch the next
 * one. This runs the actual transaction against the actual schema.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/auth": "../../src/routes/auth" } });
  db = h.db;
});

afterAll(async () => { await stopHarness(h); });

describe("deleting your account", () => {
  test("succeeds, and retains the documents it promises to retain", async () => {
    const user = await h.createUser({ firstName: "Gone", lastName: "Soon" });
    const t = await h.createCareTeam({ familyUserId: user.user.id });

    // An authorization document they submitted — the row the broken statement was aiming at.
    const docId = uuid();
    await db.prepare(`
      INSERT INTO authorization_documents
        (id, care_recipient_id, submitted_by, document_type, file_data, created_at)
      VALUES (?, ?, ?, 'poa', 'data:application/pdf;base64,AAAA', NOW())
    `).run(docId, t.recipientId, user.user.id);

    const res = await h.request.delete("/api/auth/me")
      .set(h.auth(user.token))
      .send({ confirm: "DELETE" });

    // The whole point: this used to be 500 every single time.
    expect(res.status).toBe(200);

    // Retained for fraud/audit, flagged, and tied to the deleted address.
    const doc = await db.prepare(
      "SELECT retained_from_deleted, deleted_user_email FROM authorization_documents WHERE id = ?"
    ).get(docId);
    expect(doc).toBeTruthy();
    expect(Number(doc.retained_from_deleted)).toBe(1);
    expect(doc.deleted_user_email).toBe(user.user.email);
  });

  test("the account is actually deactivated afterwards", async () => {
    const user = await h.createUser({ firstName: "Also", lastName: "Gone" });
    const res = await h.request.delete("/api/auth/me")
      .set(h.auth(user.token))
      .send({ confirm: "DELETE" });
    expect(res.status).toBe(200);

    const row = await db.prepare("SELECT is_active, email FROM users WHERE id = ?").get(user.user.id);
    // Soft-deleted: the row survives for referential integrity, but it must not be usable
    // and must not still carry the person's address.
    expect(Number(row.is_active)).toBe(0);
    expect(row.email).not.toBe(user.user.email);
  });
});
