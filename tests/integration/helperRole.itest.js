/**
 * v1.105.93 — enrolling a neighbour who just wants to leave notes.
 *
 * Pete, on Peggy: "someone I can add to the care team. They don't need stripe, it's all
 * vouch-for-neighbor type of approval. Basically, they sign up with their name/email and phone
 * number, and get granted rights based on the invite... She won't use the app much, definitely
 * won't give any info to me, but may leave notes. Probably great notes, honestly."
 *
 * The point of these tests is that a helper meets NONE of the gates built for paid caregivers,
 * and that the approval step Pete wants already exists rather than being invented.
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

const register = (body) => h.request.post("/api/auth/register").send(body);

const peggy = (over = {}) => ({
  email: `peggy-${uuid().slice(0, 8)}@neighbour.test`,
  password: "Neighbour1!",
  firstName: "Peggy",
  lastName: "Huber",
  phone: "+15405550123",
  // v1.105.93 — date of birth is NOT optional and was not dropped for helpers. src/utils/age.js
  // sets 13 as the floor for COPPA and Google Play's Families policy on a product holding health
  // data, and "is a 13-17 year old care-team member with visibility into an adult's health
  // record a problem" is already an open question on the lawyer agenda. So the form is name,
  // email, phone, date of birth, password — one field more than Pete described, for a reason
  // worth keeping.
  dateOfBirth: "1958-04-11",
  role: "helper",
  ...over,
});

describe("she can sign up as a helper", () => {
  test("name, email, phone, date of birth and a password is the whole form", async () => {
    const res = await register(peggy());
    expect([200, 201]).toContain(res.status);
  });

  test("her phone is required — Pete's call, for recovery and 2FA", async () => {
    const res = await register(peggy({ phone: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone number is required/i);
  });

  test("the role is accepted alongside the existing three", async () => {
    for (const role of ["family", "caregiver", "care_for", "helper"]) {
      const res = await register(peggy({ role, phone: "+15405550123" }));
      expect(res.status).not.toBe(400);
    }
  });

  test("an invented role is still refused", async () => {
    const res = await register(peggy({ role: "administrator" }));
    expect(res.status).toBe(400);
  });
});

describe("the age gate still applies to her", () => {
  test("a helper under 13 is refused, like everyone else", async () => {
    const res = await register(peggy({ dateOfBirth: "2020-01-01" }));
    expect(res.status).toBe(400);
  });
});

describe("she meets none of the caregiver gates", () => {
  test("no caregiver profile, so no Stripe, no background check, no ID", async () => {
    const db = await getDb();
    const body = peggy();
    const res = await register(body);
    expect([200, 201]).toContain(res.status);

    const user = await db.prepare("SELECT id, role, phone FROM users WHERE email = ?").get(body.email.toLowerCase());
    expect(user.role).toBe("helper");
    expect(user.phone).toBeTruthy();

    const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(user.id);
    expect(profile).toBeFalsy();   // the whole point: none of that applies to her
  });
});

describe("the approval step Pete wants already exists", () => {
  test("she lands unapproved and waits for him", async () => {
    // "then it comes to me to grant them access" — account_approved defaults to 0 and the app
    // shows "Your account is being reviewed by our team" until an admin flips it.
    const db = await getDb();
    const body = peggy();
    await register(body);
    const user = await db.prepare("SELECT account_approved FROM users WHERE email = ?").get(body.email.toLowerCase());
    expect(!!user.account_approved).toBe(false);
  });
});
