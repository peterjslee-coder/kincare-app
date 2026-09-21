// ─── v1.109.5 — the profile save, for someone without a driver's licence ───
//
// The wizard used to require a licence number and a licence photo of everyone, which shut out
// lawful permanent residents and work-permit holders who do not drive. These run the real route
// against real Postgres, because the two things that broke here are both things only Postgres
// notices: a column that does not exist yet, and a parameter it cannot type.
const { startHarness, stopHarness } = require("./harness");

let h;
beforeAll(async () => {
  h = await startHarness({ routers: { "/api/caregivers": "../../src/routes/caregivers" } });
}, 120000);
afterAll(async () => { await stopHarness(h); });

test("an EAD holder creates a profile with no licence number at all", async () => {
  const { user, token } = await h.createUser({ roles: ["caregiver"] });
  const res = await h.request.post("/api/caregivers/profile").set(h.auth(token))
    .send({ hourlyRate: 25, idDocType: "ead", dlNumber: null, dlState: null });
  expect([200, 201]).toContain(res.status);

  const row = await h.db.prepare(
    "SELECT id_doc_type, dl_number, dl_state FROM caregiver_profiles WHERE user_id = ?"
  ).get(user.id);
  expect(row.id_doc_type).toBe("ead");
  expect(row.dl_number).toBeNull();
  expect(row.dl_state).toBeNull();
});

test("she can change which document she presented", async () => {
  const { user, token } = await h.createUser({ roles: ["caregiver"] });
  await h.request.post("/api/caregivers/profile").set(h.auth(token))
    .send({ hourlyRate: 25, idDocType: "drivers_license", dlNumber: "T123", dlState: "VA" });
  const upd = await h.request.post("/api/caregivers/profile").set(h.auth(token))
    .send({ hourlyRate: 25, idDocType: "permanent_resident_card" });
  expect(upd.status).toBe(200);
  const row = await h.db.prepare(
    "SELECT id_doc_type, dl_number FROM caregiver_profiles WHERE user_id = ?"
  ).get(user.id);
  expect(row.id_doc_type).toBe("permanent_resident_card");
  // COALESCE keeps the old number on file — clearing it is the client's job at the point
  // she switches, not something an unrelated profile edit should do behind her.
  expect(row.dl_number).toBe("T123");
});

test("a profile edit that sends no termsVersion does not 500", async () => {
  // The pre-existing bug this change surfaced: `? IS NOT NULL` left the parameter untyped, so
  // Postgres refused the whole statement — "could not determine data type of parameter $31" —
  // on every save that wasn't the wizard's last step. It reached the caregiver as
  // "Failed to save caregiver profile. Please try again." forever.
  const { token } = await h.createUser({ roles: ["caregiver"] });
  const create = await h.request.post("/api/caregivers/profile").set(h.auth(token)).send({ hourlyRate: 25 });
  expect([200, 201]).toContain(create.status);
  const edit = await h.request.post("/api/caregivers/profile").set(h.auth(token)).send({ bio: "I like gardening." });
  expect(edit.status).toBe(200);
  const empty = await h.request.post("/api/caregivers/profile").set(h.auth(token)).send({});
  expect(empty.status).toBe(200);
});

test("finishing the wizard still flips her to available", async () => {
  const { user, token } = await h.createUser({ roles: ["caregiver"] });
  await h.request.post("/api/caregivers/profile").set(h.auth(token)).send({ hourlyRate: 25 });
  await h.db.prepare("UPDATE caregiver_profiles SET is_available = 0 WHERE user_id = ?").run(user.id);
  await h.request.post("/api/caregivers/profile").set(h.auth(token))
    .send({ hourlyRate: 25, termsVersion: "2026-07-07", termsAcceptedAt: new Date().toISOString() });
  const row = await h.db.prepare("SELECT is_available FROM caregiver_profiles WHERE user_id = ?").get(user.id);
  expect(Number(row.is_available)).toBe(1);
});
