/**
 * The wall: who may bring a caregiver into the house. (v1.105.165)
 *
 * Pete: "separate. appoitment and tasks? great. But there needs to be a wall where the team
 * leader controls who can bring caregivers (and spend betty's money in doing so) into the
 * home."
 *
 * There wasn't one. POST /api/sessions found the recipient via the owner, ANY
 * care_recipient_shares row at any level, or ANY care_team_members row — and then booked. So
 * every member of Betty's team, including a helper invited to bring dinner, could raise a
 * request that puts a stranger in her house and charges the billing contact's card. Nothing
 * anywhere asked whether they were allowed to.
 *
 * Integration, because the whole question is what the capability layer says against real rows.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = { "/api/sessions": "../../src/routes/sessions" };

let h, owner, member, recipientId, teamId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  owner = await h.createUser({ roles: ["family"], firstName: "Pete" });
  member = await h.createUser({ roles: ["family"], firstName: "Deborah" });
  const t = await h.createCareTeam({ familyUserId: owner.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, member.user.id, "member");
});

afterAll(async () => { await stopHarness(h); });

const tomorrow = () => {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

const book = (who) => h.request.post("/api/sessions").set(h.auth(who.token)).send({
  careRecipientId: recipientId,
  scheduledDate: tomorrow(),
  scheduledTime: "10:00",
  durationHours: 2,
  serviceType: "companion",
});

describe("booking paid care", () => {
  test("a care team member is refused, and told whose decision it is", async () => {
    // She can see the care plan. Spending Betty's money is not the same permission, and until
    // now it was the same permission by accident.
    const res = await book(member);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/care team leader/i);
  });

  test("the owner is never blocked by this", async () => {
    const res = await book(owner);
    expect([201, 403]).toContain(res.status);
    // A 403 here would have to come from the CONSENT gate, never from the booking wall.
    if (res.status === 403) expect(res.body.error).not.toMatch(/care team leader/i);
  });
});

describe("the capability itself", () => {
  const { CAP, PRESETS, capabilitiesFor, can } = require("../../src/utils/capabilities");

  test("BOOK_CARE is not something a share picks up by default", () => {
    expect(can(capabilitiesFor(null, "view"), CAP.BOOK_CARE)).toBe(false);
    expect(can(capabilitiesFor(null, "member"), CAP.BOOK_CARE)).toBe(false);
    expect(PRESETS.member.includes(CAP.BOOK_CARE)).toBe(false);
    expect(PRESETS.helper.includes(CAP.BOOK_CARE)).toBe(false);
  });

  test("but someone given everything keeps it", () => {
    // The levels that meant "you have all of it" still do. This is the only place in
    // capabilities.js that deliberately narrows what a legacy level granted, and it narrows it
    // for view/member only.
    expect(can(capabilitiesFor(null, "edit"), CAP.BOOK_CARE)).toBe(true);
    expect(can(capabilitiesFor(null, "owner"), CAP.BOOK_CARE)).toBe(true);
    expect(can(capabilitiesFor(null, "admin"), CAP.BOOK_CARE)).toBe(true);
  });

  test("and it is separate from managing the record", () => {
    // Conflating "runs the care plan" with "spends the money" is how the gap happened.
    expect(can([CAP.MANAGE], CAP.BOOK_CARE)).toBe(false);
  });

  test("scheduling an appointment does NOT imply booking paid care", () => {
    expect(can([CAP.SCHEDULE_EVENTS], CAP.BOOK_CARE)).toBe(false);
  });

  test("but managing the record still implies scheduling — nobody loses what they had", () => {
    const { canScheduleEvents } = require("../../src/routes/careTasks")._shared;
    expect(canScheduleEvents([CAP.MANAGE])).toBe(true);
    expect(canScheduleEvents([CAP.SCHEDULE_EVENTS])).toBe(true);
    expect(canScheduleEvents([CAP.READ_NOTES])).toBe(false);
    expect(canScheduleEvents("owner")).toBe(true); // legacy string
  });
});
