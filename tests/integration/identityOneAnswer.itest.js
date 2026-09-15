/**
 * One answer to "has this person verified their identity?" (v1.106.39)
 *
 * Pete, about Tina: "Tina is verified. Her id is in, a person reviewed it, and it's in her
 * documents. This shouldn't be asking her again. We went through this with Julia earlier."
 *
 * He is right that we went through it with Julia. There were four copies of this lookup.
 * v1.105.80 found three faults in the /api/auth/me copy and fixed them in that copy only,
 * leaving utils/identity.js — the one the onboarding checklist and the completion gate read
 * — with the first fault intact: newest-document-wins.
 *
 * That produces Tina exactly. The app asks her to verify; she does it again; the second
 * submission sits at 'pending' on top of her approved one; /api/auth/me prefers the approval
 * and lights her blue check, and the resolver takes the newest and keeps asking. Same person,
 * same documents, two answers, forever.
 *
 * These tests are written against the two surfaces a caregiver actually sees — GET
 * /api/auth/me (the blue check) and GET /api/caregiver-onboarding/identity-status (the
 * checklist) — because the bug was never visible in either one alone. The last test in each
 * block is the one that matters: the two must agree.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/auth": "../../src/routes/auth",
  "/api/caregiver-onboarding": "../../src/routes/caregiveronboarding",
};

let h, admin;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  admin = await h.createUser({ roles: ["family"], firstName: "Admin" });
  await h.db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
});

afterAll(async () => { await stopHarness(h); });

// A caregiver with a profile, fresh for each scenario so no two share documents.
const makeCaregiver = async (firstName) => {
  const u = await h.createUser({ roles: ["caregiver"], firstName });
  const profileId = uuid();
  await h.db.prepare(
    "INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())"
  ).run(profileId, u.user.id);
  return { ...u, profileId };
};

const putDoc = async ({ ownerType, ownerId, uploadedBy, status, docType = "drivers_license", category = "identity", ageDays = 0 }) => {
  const id = uuid();
  await h.db.prepare(
    `INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type,
                                     file_data, status, is_verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, NOW() - (? || ' days')::interval)`
  ).run(id, ownerType, ownerId, uploadedBy, category, docType, status, status === "approved" ? 1 : 0, String(ageDays));
  return id;
};

// The blue check.
const meStatus = async (who) => {
  const res = await h.request.get("/api/auth/me").set(h.auth(who.token));
  expect(res.status).toBe(200);
  return { verified: res.body.user.identityVerified, status: res.body.user.identityStatus };
};

// The First Steps checklist, and the same resolver the completion gate uses.
const checklistStatus = async (who) => {
  const res = await h.request.get("/api/caregiver-onboarding/identity-status").set(h.auth(who.token));
  expect(res.status).toBe(200);
  return { submitted: !!res.body.submitted, status: res.body.status };
};

describe("Tina: approved, then asked again, then re-submitted", () => {
  let tina;

  beforeAll(async () => {
    tina = await makeCaregiver("Tina");
    // The real one, reviewed by a person, four days ago.
    await putDoc({ ownerType: "caregiver", ownerId: tina.profileId, uploadedBy: tina.user.id, status: "approved", ageDays: 4 });
    // What the app's own nagging produced: she did it again this morning.
    await putDoc({ ownerType: "user", ownerId: tina.user.id, uploadedBy: tina.user.id, status: "pending", ageDays: 0 });
  });

  test("both documents are really there — the scenario is not a typo", async () => {
    const rows = await h.db.prepare(
      "SELECT status FROM verified_documents WHERE uploaded_by = ? ORDER BY created_at DESC"
    ).all(tina.user.id);
    expect(rows.map((r) => r.status)).toEqual(["pending", "approved"]);
  });

  test("the blue check says verified", async () => {
    expect(await meStatus(tina)).toEqual({ verified: true, status: "verified" });
  });

  test("the checklist stops asking — an approval is not undone by a resubmission", async () => {
    expect(await checklistStatus(tina)).toEqual({ submitted: true, status: "approved" });
  });

  test("and the two agree, which is the whole point", async () => {
    const me = await meStatus(tina);
    const list = await checklistStatus(tina);
    expect(me.verified).toBe(list.status === "approved");
  });
});

describe("an admin filed it for her — the owner is the subject, not the operator", () => {
  let peggy;

  beforeAll(async () => {
    peggy = await makeCaregiver("Peggy");
    // Filed under the user shape by someone else. This was invisible before: the user branch
    // carried `AND uploaded_by = <her>`, which the caregiver branch never did.
    await putDoc({ ownerType: "user", ownerId: peggy.user.id, uploadedBy: admin.user.id, status: "approved" });
  });

  test("the checklist counts it", async () => {
    expect(await checklistStatus(peggy)).toEqual({ submitted: true, status: "approved" });
  });

  test("so does the blue check", async () => {
    expect((await meStatus(peggy)).verified).toBe(true);
  });
});

describe("what must NOT count", () => {
  let maria, recipientId;

  beforeAll(async () => {
    maria = await makeCaregiver("Maria");
    const fam = await h.createUser({ roles: ["family"], firstName: "Fam" });
    const t = await h.createCareTeam({ familyUserId: fam.user.id });
    recipientId = t.recipientId;
  });

  test("a care recipient's ID that SHE uploaded is not her own identity verification", async () => {
    // documents.js lets a caregiver upload for entities she can access. The old auth.js
    // matched a bare `uploaded_by = <you>` with no owner_type, so this read as her own.
    await putDoc({ ownerType: "care_recipient", ownerId: recipientId, uploadedBy: maria.user.id, status: "approved" });
    expect((await meStatus(maria)).verified).toBe(false);
    expect(await checklistStatus(maria)).toEqual({ submitted: false, status: null });
  });

  test("a selfie alone is not an ID", async () => {
    const solo = await makeCaregiver("Solo");
    await putDoc({ ownerType: "caregiver", ownerId: solo.profileId, uploadedBy: solo.user.id, status: "approved", docType: "selfie" });
    expect(await checklistStatus(solo)).toEqual({ submitted: false, status: null });
    expect((await meStatus(solo)).verified).toBe(false);
  });

  test("an approved document in another category is not an ID", async () => {
    const cred = await makeCaregiver("Cred");
    await putDoc({ ownerType: "caregiver", ownerId: cred.profileId, uploadedBy: cred.user.id, status: "approved", category: "credential" });
    expect(await checklistStatus(cred)).toEqual({ submitted: false, status: null });
  });

  test("another caregiver's approved ID does not verify this one", async () => {
    const a = await makeCaregiver("A");
    const b = await makeCaregiver("B");
    await putDoc({ ownerType: "caregiver", ownerId: a.profileId, uploadedBy: a.user.id, status: "approved" });
    expect((await meStatus(b)).verified).toBe(false);
    expect(await checklistStatus(b)).toEqual({ submitted: false, status: null });
  });

  test("pending is pending on both surfaces — nothing here makes unreviewed documents pass", async () => {
    const p = await makeCaregiver("Pending");
    await putDoc({ ownerType: "caregiver", ownerId: p.profileId, uploadedBy: p.user.id, status: "pending" });
    expect((await meStatus(p)).status).toBe("pending");
    expect((await checklistStatus(p)).status).toBe("pending");
  });
});

describe("rejection still wins when there is nothing approved", () => {
  test("rejected then re-submitted reads as pending, not approved", async () => {
    const r = await makeCaregiver("Rejected");
    await putDoc({ ownerType: "caregiver", ownerId: r.profileId, uploadedBy: r.user.id, status: "rejected", ageDays: 3 });
    await putDoc({ ownerType: "user", ownerId: r.user.id, uploadedBy: r.user.id, status: "pending", ageDays: 0 });
    expect((await meStatus(r)).status).toBe("pending");
    expect((await checklistStatus(r)).status).toBe("pending");
  });

  test("rejected alone reads as rejected", async () => {
    const r = await makeCaregiver("OnlyRejected");
    await putDoc({ ownerType: "caregiver", ownerId: r.profileId, uploadedBy: r.user.id, status: "rejected" });
    expect(await meStatus(r)).toEqual({ verified: false, status: "rejected" });
    expect((await checklistStatus(r)).status).toBe("rejected");
  });

  test("an admin revoking flips it back — approved-first cannot make an approval permanent", async () => {
    const v = await makeCaregiver("Revoked");
    const docId = await putDoc({ ownerType: "caregiver", ownerId: v.profileId, uploadedBy: v.user.id, status: "approved" });
    expect((await meStatus(v)).verified).toBe(true);
    // Exactly what the admin toggle does: rejects the document the resolver returns.
    await h.db.prepare("UPDATE verified_documents SET status = 'rejected', is_verified = 0 WHERE id = ?").run(docId);
    expect(await meStatus(v)).toEqual({ verified: false, status: "rejected" });
    expect((await checklistStatus(v)).status).toBe("rejected");
  });
});

describe("nobody has submitted anything", () => {
  test("not_started, on both", async () => {
    const n = await makeCaregiver("Nothing");
    expect(await meStatus(n)).toEqual({ verified: false, status: "not_started" });
    expect(await checklistStatus(n)).toEqual({ submitted: false, status: null });
  });
});
