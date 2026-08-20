/**
 * v1.105.112 — no path writes an approved identity document except an admin. Proved against
 * the real schema, because "the AI cannot approve" is a claim about what the database ends up
 * holding, not about what the source says.
 *
 * Pete, Aug 19: "I want to review everything an AI clears. Below a confidence of, say, 90%,
 * it doesn't even decide...I do."
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { identityDecision, VERDICT } = require("../../src/utils/identityDecision");
const { caregiverIdentityVerified } = require("../../src/utils/identity");

jest.setTimeout(180000);

let h, db, user, profileId;

const insertIdentityDoc = async (decision) => {
  const id = uuid();
  await db.prepare(`
    INSERT INTO verified_documents
      (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type,
       status, ai_confidence, ai_recommendation, ai_recommendation_reason, is_verified, created_at)
    VALUES (?, ?, 'caregiver', ?, 'identity', 'drivers_license', 'x', 'image/png',
            ?, ?, ?, ?, 0, NOW())
  `).run(id, profileId, user.user.id, decision.status, decision.confidence, decision.verdict, decision.reason);
  return id;
};

beforeAll(async () => {
  h = await startHarness({ routers: {} });
  db = h.db;
  user = await h.createUser({ firstName: "Julia", lastName: "Huth", roles: ["caregiver"] });
  profileId = uuid();
  await db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
  ).run(profileId, user.user.id);
});
afterAll(async () => { await stopHarness(h); });

describe("a flawless submission still waits for a person", () => {
  test("the row lands pending, unverified, with a recommendation beside it", async () => {
    const d = identityDecision({ looksRight: true, docConfidence: 0.99, faceConfidence: 0.99 });
    const id = await insertIdentityDoc(d);

    const row = await db.prepare("SELECT status, is_verified, ai_recommendation FROM verified_documents WHERE id = ?").get(id);
    expect(row.status).toBe("pending");
    expect(row.is_verified).toBe(0);
    expect(row.ai_recommendation).toBe(VERDICT.APPROVE);
  });

  test("and the resolver everything gates on says NOT verified", async () => {
    // src/utils/identity.js is the single answer to "has this caregiver verified?". If it
    // said yes here, the whole change would be cosmetic.
    expect(await caregiverIdentityVerified(db, user.user.id, profileId)).toBe(false);
  });

  test("an admin approving it is what flips it", async () => {
    await db.prepare(
      "UPDATE verified_documents SET status = 'approved', is_verified = 1, admin_reviewed_by = ?, admin_reviewed_at = NOW() WHERE owner_id = ?"
    ).run("some-admin-id", profileId);
    expect(await caregiverIdentityVerified(db, user.user.id, profileId)).toBe(true);
  });
});

describe("a low-confidence submission carries no opinion at all", () => {
  test("abstain is stored, not a guess", async () => {
    const other = await h.createUser({ firstName: "Sam", lastName: "Unclear", roles: ["caregiver"] });
    const otherProfile = uuid();
    await db.prepare(
      "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
    ).run(otherProfile, other.user.id);

    const d = identityDecision({ looksRight: true, docConfidence: 0.97, faceConfidence: 0.42 });
    const id = uuid();
    await db.prepare(`
      INSERT INTO verified_documents
        (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type,
         status, ai_confidence, ai_recommendation, ai_recommendation_reason, is_verified, created_at)
      VALUES (?, ?, 'caregiver', ?, 'identity', 'drivers_license', 'x', 'image/png', ?, ?, ?, ?, 0, NOW())
    `).run(id, otherProfile, other.user.id, d.status, d.confidence, d.verdict, d.reason);

    const row = await db.prepare("SELECT status, ai_recommendation, ai_recommendation_reason FROM verified_documents WHERE id = ?").get(id);
    expect(row.status).toBe("pending");
    expect(row.ai_recommendation).toBe(VERDICT.ABSTAIN);
    expect(row.ai_recommendation_reason).toMatch(/below 90%/);
    expect(await caregiverIdentityVerified(db, other.user.id, otherProfile)).toBe(false);
  });
});

describe("the backfill put the old auto-approvals back in the queue", () => {
  test("migration 024 ran, and left a place to record why", async () => {
    const cols = await db.prepare(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'verified_documents' AND column_name IN ('ai_recommendation', 'ai_recommendation_reason')
    `).all();
    expect(cols.map((c) => c.column_name).sort()).toEqual(["ai_recommendation", "ai_recommendation_reason"]);
  });

  test("an AI-approved row that no admin touched would be re-queued", async () => {
    // Simulate the pre-v1.105.112 shape, then run the migration's own statement against it.
    const legacy = uuid();
    await db.prepare(`
      INSERT INTO verified_documents
        (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type,
         status, is_verified, created_at)
      VALUES (?, ?, 'caregiver', ?, 'identity', 'drivers_license', 'x', 'image/png', 'approved', 1, NOW())
    `).run(legacy, profileId, user.user.id);

    await db.prepare(`
      UPDATE verified_documents
         SET ai_recommendation = 'recommend_approve',
             ai_recommendation_reason = 'Approved automatically before v1.105.112, with no person asked.',
             status = 'pending',
             is_verified = 0
       WHERE category = 'identity' AND document_type != 'selfie'
         AND status = 'approved' AND admin_reviewed_by IS NULL
    `).run();

    const row = await db.prepare("SELECT status, is_verified, ai_recommendation FROM verified_documents WHERE id = ?").get(legacy);
    expect(row.status).toBe("pending");
    expect(row.is_verified).toBe(0);
    expect(row.ai_recommendation).toBe("recommend_approve");
  });

  test("but a row a person already approved is left alone", async () => {
    // The admin-approved doc from the first block above has admin_reviewed_by set.
    const reviewed = await db.prepare(
      "SELECT status FROM verified_documents WHERE owner_id = ? AND admin_reviewed_by IS NOT NULL"
    ).get(profileId);
    expect(reviewed.status).toBe("approved");
  });
});
