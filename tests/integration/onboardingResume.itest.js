/**
 * v1.134.0 — coming back to the caregiver signup on another browser, or in the app.
 *
 * Pete, 11/18: "the app acted like it never heard of her, even though she logged in. And then
 * after that, it kept asking for the same information over again." And: "It is requiring ID
 * pictures twice."
 *
 * Against the real schema and routes:
 *   1. the resume endpoint returns what she already saved, never the SSN, and the right step
 *   2. once her ID front is uploaded, step 8 can verify with it instead of a second photo
 *   3. nobody else's document can be used that way
 */
const express = require("express");
const supertest = require("supertest");
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, req;

beforeAll(async () => {
  delete process.env.ANTHROPIC_API_KEY; // the AI checks skip; the route still records the attempt
  h = await startHarness({ routers: {} });
  db = h.db;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/caregivers", require("../../src/routes/caregivers"));
  req = supertest(app);
});

afterAll(async () => { await stopHarness(h); });

async function savedThroughStep4() {
  const cg = await h.createUser({ firstName: "Kay", lastName: "Tester", roles: ["caregiver"], idVerified: false });
  await db.prepare("UPDATE users SET phone = '5405550100', food_allergies = 'nuts', pets = 'comfortable' WHERE id = ?").run(cg.user.id);
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, terms_accepted_at, address_line1, location_city, location_state, zip,
      legal_first_name, legal_last_name, date_of_birth, ssn_last4, id_doc_type, background_check_consent, created_at)
    VALUES (?, ?, 24, NOW(), '1 Hill Rd', 'Smalltown', 'VA', '24000', 'Kay', 'Tester', '1960-04-02', '9876', 'state_id', 1, NOW())
  `).run(profileId, cg.user.id);
  return { cg, profileId };
}

test("her saved answers come back, the SSN does not, and she lands past what she has done", async () => {
  const { cg } = await savedThroughStep4();
  const r = await req.get("/api/caregivers/me/onboarding-resume").set(h.auth(cg.token));
  expect(r.status).toBe(200);
  expect(r.body.prefill).toMatchObject({
    phone: "5405550100", addressLine1: "1 Hill Rd", city: "Smalltown", state: "VA", zip: "24000",
    foodAllergies: "nuts", comfortableWithPets: true, legalFirstName: "Kay", idDocType: "state_id",
  });
  expect(JSON.stringify(r.body)).not.toContain("9876");
  expect(r.body.done.ssnOnFile).toBe(true);
  expect(r.body.resumeStep).toBe(5);
});

test("ID front and back uploaded: she resumes at the selfie, with that ID", async () => {
  const { cg } = await savedThroughStep4();
  const front = uuid();
  await db.prepare("INSERT INTO caregiver_documents (id, user_id, document_type, file_data, file_name) VALUES (?, ?, 'id_front', 'data:image/jpeg;base64,AAAA', 'f.jpg')").run(front, cg.user.id);
  await db.prepare("INSERT INTO caregiver_documents (id, user_id, document_type, file_data, file_name) VALUES (?, ?, 'id_back', 'data:image/jpeg;base64,BBBB', 'b.jpg')").run(uuid(), cg.user.id);
  const r = await req.get("/api/caregivers/me/onboarding-resume").set(h.auth(cg.token));
  expect(r.body.resumeStep).toBe(8);
  expect(r.body.idFrontDocumentId).toBe(front);
});

test("ID verified in person: neither ID step is asked again", async () => {
  const { cg } = await savedThroughStep4();
  await db.prepare("UPDATE users SET id_verified_in_person_at = NOW() WHERE id = ?").run(cg.user.id);
  const r = await req.get("/api/caregivers/me/onboarding-resume").set(h.auth(cg.token));
  expect(r.body.resumeStep).toBe(9);
});

test("only a caregiver may ask", async () => {
  const fam = await h.createUser({ firstName: "Fam", lastName: "Ily", roles: ["family"] });
  const r = await req.get("/api/caregivers/me/onboarding-resume").set(h.auth(fam.token));
  expect([401, 403]).toContain(r.status);
});

test("an ID a person already approved: no ID steps at all", async () => {
  const cg = await h.createUser({ firstName: "Ann", lastName: "Approved", roles: ["caregiver"] }); // harness approves her ID
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, terms_accepted_at, address_line1, location_city, location_state, zip,
      legal_first_name, legal_last_name, date_of_birth, ssn_last4, id_doc_type, background_check_consent, created_at)
    VALUES (?, ?, 24, NOW(), '2 Hill Rd', 'Smalltown', 'VA', '24000', 'Ann', 'Approved', '1970-01-01', '1111', 'passport', 1, NOW())
  `).run(uuid(), cg.user.id);
  await db.prepare("UPDATE users SET phone = '5405550101' WHERE id = ?").run(cg.user.id);
  const r = await req.get("/api/caregivers/me/onboarding-resume").set(h.auth(cg.token));
  expect(r.body.resumeStep).toBe(9);
});
