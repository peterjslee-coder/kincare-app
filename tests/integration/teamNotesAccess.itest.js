/**
 * Who may read a care recipient's notes — asked of the database, not of a role. (v1.105.153)
 *
 * Pete, on the rule: "not all caregivers should get it...it's just that Julia IS on Betty's
 * care team AND she's a caregiver", and "not all caregivers will be on the care team."
 *
 * So the notes screen cannot be "the caregiver page". It is driven by GET
 * /api/notes/mine/recipients, which asks which care recipients have granted THIS person
 * READ_NOTES across the three places access comes from — being the family owner, being on the
 * care team, or holding a share. A caregiver who is merely assigned to a session appears in
 * none of them.
 *
 * Integration rather than unit, because the whole question is what the capability layer says
 * against a real schema. A mocked db would answer whatever the mock was told to.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/notes": "../../src/routes/notes",
  "/api/family-visits": "../../src/routes/familyVisits",
};

let h, family, teamCaregiver, otherCaregiver, recipientId, teamId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  // Julia: a caregiver AND on Betty's care team.
  teamCaregiver = await h.createUser({ roles: ["caregiver"], firstName: "Julia" });
  // A caregiver who has never been added to this team — the majority case.
  otherCaregiver = await h.createUser({ roles: ["caregiver"], firstName: "Maria" });
  const t = await h.createCareTeam({ familyUserId: family.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, teamCaregiver.user.id, "member");
});

afterAll(async () => { await stopHarness(h); });

const mine = async (who) => {
  const res = await h.request.get("/api/notes/mine/recipients").set(h.auth(who.token));
  expect(res.status).toBe(200);
  return res.body.recipients || [];
};

describe("which recipients' notes are shared with me", () => {
  test("a caregiver ON the care team sees that recipient", async () => {
    const list = await mine(teamCaregiver);
    expect(list.map((r) => r.id)).toContain(recipientId);
  });

  test("a caregiver NOT on the care team sees nothing", async () => {
    // The rule Pete stated, encoded: role does not grant this, membership does.
    const list = await mine(otherCaregiver);
    expect(list.map((r) => r.id)).not.toContain(recipientId);
  });

  test("the family owner is included too — one rule, not a special case per role", async () => {
    const list = await mine(family);
    expect(list.map((r) => r.id)).toContain(recipientId);
  });

  test("it returns a name to show and no more than that", async () => {
    const [r] = await mine(teamCaregiver);
    // v1.105.156 — plus whether visits are readable, so the client never asks for a history
    // it would be refused and then has to handle a 403.
    expect(Object.keys(r).sort()).toEqual(["canReadVisits", "firstName", "id", "lastName", "timezone"]);
    expect(typeof r.canReadVisits).toBe("boolean");
  });
});

describe("and reading them", () => {
  let noteId;

  test("the family writes a note", async () => {
    const res = await h.request.post("/api/notes").set(h.auth(family.token)).send({
      careRecipientId: recipientId,
      content: "Slept badly, off her food at lunch.",
      noteType: "observation",
    });
    expect(res.status).toBe(201);
    noteId = res.body.note.id;
  });

  test("the caregiver on the team can read it", async () => {
    const res = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(teamCaregiver.token));
    expect(res.status).toBe(200);
    expect(res.body.notes.map((n) => n.id)).toContain(noteId);
  });

  test("the caregiver who is not on the team is refused", async () => {
    // 403 — and it is the SAME answer whether or not any notes exist, so the refusal does not
    // tell her anything about a family she has no business with.
    const res = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(otherCaregiver.token));
    expect(res.status).toBe(403);
  });

  test("reading is all she gets — the note stays the family's to write", async () => {
    const res = await h.request.delete(`/api/notes/${noteId}`).set(h.auth(teamCaregiver.token));
    expect([403, 404]).toContain(res.status);
  });
});

// ─── v1.105.156 — a visit report is announced to everyone who may read it ───
//
// v1.105.154 narrowed this fan-out to people who could reach the family's care profile,
// because Julia was being notified about visits with nowhere to open them. Pete corrected it:
// "Julia is on the care team...she should be able to see the notes, or I should be able to
// select it at least."
//
// He is right, and the capability already said so. The missing piece was a screen, and the
// answer to a missing screen is a screen, not a quieter app. Care Notes shows visits now, so
// the audience goes back to whoever holds READ_VISITS — and a family who wants someone
// excluded withholds that capability on the invitation, which is their decision to make
// rather than one hard-coded in the notifier.
describe("who a family visit log is announced to", () => {
  test("a caregiver on the care team may read visits", async () => {
    const { usersWithCapability } = require("../../src/utils/access");
    const { CAP } = require("../../src/utils/capabilities");
    const readers = await usersWithCapability(h.db, recipientId, CAP.READ_VISITS);
    expect(readers).toContain(teamCaregiver.user.id);
  });

  test("and can fetch them — the API always allowed this", async () => {
    const res = await h.request.get(`/api/family-visits/${recipientId}`).set(h.auth(teamCaregiver.token));
    expect(res.status).toBe(200);
  });

  test("someone not on the team can do neither", async () => {
    const { usersWithCapability } = require("../../src/utils/access");
    const { CAP } = require("../../src/utils/capabilities");
    expect(await usersWithCapability(h.db, recipientId, CAP.READ_VISITS))
      .not.toContain(otherCaregiver.user.id);
    const res = await h.request.get(`/api/family-visits/${recipientId}`).set(h.auth(otherCaregiver.token));
    expect(res.status).toBe(404); // same answer as "no such recipient" — tells her nothing
  });

  test("the notifier no longer second-guesses the capability", async () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "routes", "familyVisits.js"), "utf8");
    expect(src).not.toMatch(/usersWithProfileAccess/);
  });
});
