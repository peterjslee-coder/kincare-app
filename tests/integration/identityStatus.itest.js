/**
 * v1.105.80 — what /api/auth/me says about your own identity documents.
 *
 * Julia's My Account read "Not Verified" through v1.105.70 (client dropped the field),
 * v1.105.76 (five more places dropped it) and v1.105.79. Pete confirmed she uploaded the
 * documents herself and can see them in admin — which rules out the client and rules out
 * uploaded_by. What was left was this query.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);
let h, getDb;

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/auth": "../../src/routes/auth" } });
  ({ getDb } = require("../../src/models/database"));
});
afterAll(async () => { await stopHarness(h); });

async function addIdentityDoc(userId, { status, ownerType = "user", ownerId, uploadedBy, createdAt, docType = "drivers_license" }) {
  const db = await getDb();
  await db.prepare(`
    INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type, status, is_verified, created_at)
    VALUES (?, ?, ?, ?, 'identity', ?, 'x', 'image/jpeg', ?, ?, ?)
  `).run(uuid(), ownerId || userId, ownerType, uploadedBy || userId, docType, status, status === "approved" ? 1 : 0, createdAt);
}

const me = (token) => h.request.get("/api/auth/me").set(h.auth(token));

describe("an approval is not undone by a later resubmission", () => {
  test("approved first, then a newer pending — still verified", async () => {
    // EXACTLY Julia's shape: the app told her she was unverified and offered to redo it.
    // If she took that offer, the newest row is 'pending'.
    const { user, token } = await h.createUser({ roles: ["caregiver"] });
    await addIdentityDoc(user.id, { status: "approved", createdAt: "2026-08-01T10:00:00Z" });
    await addIdentityDoc(user.id, { status: "pending", createdAt: "2026-08-15T10:00:00Z" });

    const res = await me(token);
    expect(res.status).toBe(200);
    expect(res.body.user.identityStatus).toBe("verified");
    expect(res.body.user.identityVerified).toBe(true);
  });

  test("rejecting a NEWER document does not revoke an existing approval", async () => {
    // A deliberate call, and the safer of the two readings. If someone verified in June
    // uploads a renewed licence in August and the AI rejects the photo, they have not
    // become unverified — they have one approved document and one bad upload. Telling
    // them otherwise is the same whiplash the v1.105.6x saga was made of.
    const { user, token } = await h.createUser({ roles: ["caregiver"] });
    await addIdentityDoc(user.id, { status: "approved", createdAt: "2026-08-01T10:00:00Z" });
    await addIdentityDoc(user.id, { status: "rejected", createdAt: "2026-08-15T10:00:00Z" });
    expect((await me(token)).body.user.identityStatus).toBe("verified");
  });

  test("...but an admin CAN revoke, by rejecting the approved document itself", async () => {
    // The escape hatch that makes the rule above safe. Without this, an approval would be
    // permanent and unrevokable, which would be a much worse bug than the one being fixed.
    const db = await getDb();
    const { user, token } = await h.createUser({ roles: ["caregiver"] });
    await addIdentityDoc(user.id, { status: "approved", createdAt: "2026-08-01T10:00:00Z" });
    expect((await me(token)).body.user.identityStatus).toBe("verified");

    await db.prepare(
      "UPDATE verified_documents SET status = 'rejected', is_verified = 0 WHERE uploaded_by = ? AND category = 'identity'"
    ).run(user.id);
    expect((await me(token)).body.user.identityStatus).toBe("rejected");
  });

  test("only pending documents read as pending", async () => {
    const { user, token } = await h.createUser({ roles: ["caregiver"] });
    await addIdentityDoc(user.id, { status: "pending", createdAt: "2026-08-15T10:00:00Z" });
    expect((await me(token)).body.user.identityStatus).toBe("pending");
  });

  test("nothing submitted is not_started", async () => {
    const { token } = await h.createUser({ roles: ["caregiver"] });
    expect((await me(token)).body.user.identityStatus).toBe("not_started");
  });
});

describe("both storage shapes count, as utils/identity.js has said since v1.105.64", () => {
  test("a doc filed against the caregiver PROFILE is found", async () => {
    const db = await getDb();
    const { user, token } = await h.createUser({ roles: ["caregiver"] });
    const profileId = uuid();
    await db.prepare(
      "INSERT INTO caregiver_profiles (id, user_id, hourly_rate) VALUES (?, ?, 25)"
    ).run(profileId, user.id);
    // uploaded_by someone else entirely — the shape the old uploaded_by-only query missed.
    const other = await h.createUser({ roles: ["family"] });
    await addIdentityDoc(user.id, {
      status: "approved", ownerType: "caregiver", ownerId: profileId,
      uploadedBy: other.user.id, createdAt: "2026-08-01T10:00:00Z",
    });

    expect((await me(token)).body.user.identityStatus).toBe("verified");
  });
});

describe("a selfie is never mistaken for the ID", () => {
  test("an approved selfie alone does not make you verified", async () => {
    const { user, token } = await h.createUser({ roles: ["caregiver"] });
    await addIdentityDoc(user.id, { status: "approved", docType: "selfie", createdAt: "2026-08-01T10:00:00Z" });
    expect((await me(token)).body.user.identityStatus).toBe("not_started");
  });
});
