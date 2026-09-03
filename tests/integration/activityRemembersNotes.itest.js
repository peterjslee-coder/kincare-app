/**
 * A note has to still be in Activity after you have read it. (v1.105.182)
 *
 * Pete, twice: "i don't see debbie's added note anywhere on activity. why does this keep
 * dropping?"
 *
 * The Activity card renders UNREAD notifications plus a tail from activity_feed. A note wrote a
 * notification and never an activity_feed row — so it appeared only while unread and vanished
 * the moment he opened it. Reading the thing was what deleted the record of it. v1.105.176
 * grouped message notifications so notes were not crowded out of the FETCH; that was the wrong
 * layer, because no amount of room keeps a row that is deleted on read.
 *
 * Integration, because the whole claim is "a durable row exists afterwards", and that is only
 * true against a real table.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/notes": "../../src/routes/notes",
  "/api/family-visits": "../../src/routes/familyVisits",
};

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

// The harness db is promise-based — every one of these must be awaited.
const rows = async (type) => h.db.prepare(
  "SELECT * FROM activity_feed WHERE care_recipient_id = ? AND event_type = ? ORDER BY created_at DESC"
).all(recipientId, type);

describe("a note leaves a durable trace", () => {
  test("posting a note writes an activity_feed row", async () => {
    const res = await h.request.post("/api/notes").set(h.auth(member.token)).send({
      careRecipientId: recipientId, content: "She ate a full dinner tonight.", noteType: "observation",
    });
    expect(res.status).toBe(201);

    const found = await rows("team_note");
    expect(found.length).toBe(1);
    expect(found[0].title).toMatch(/Deborah/);
    expect(found[0].family_user_id).toBe(owner.user.id);
  });

  test("it is keyed on the RECIPIENT, so the author sees it too", async () => {
    // The notification path can never do this — you are never pushed your own note — and Pete
    // asked for it by name: "Including my own."
    const before = (await rows("team_note")).length;
    const res = await h.request.post("/api/notes").set(h.auth(owner.token)).send({
      careRecipientId: recipientId, content: "Called the clinic.", noteType: "observation",
    });
    expect(res.status).toBe(201);
    const after = await rows("team_note");
    expect(after.length).toBe(before + 1);
    expect(after[0].care_recipient_id).toBe(recipientId);
  });

  test("it carries a deep link to the note itself", async () => {
    const meta = JSON.parse((await rows("team_note"))[0].metadata);
    expect(meta.type).toBe("team_note");
    expect(meta.noteId).toBeTruthy();
    expect(meta.page).toBe("care-profile");
  });

  test("it carries no excerpt — the content is PHI", async () => {
    // Same rule as the push (v1.105.39): the title says a note exists, tapping it shows it.
    const row = (await rows("team_note"))[0];
    expect(row.message).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/full dinner|Called the clinic/);
  });

  test("an urgent note is marked as one", async () => {
    await h.request.post("/api/notes").set(h.auth(member.token)).send({
      careRecipientId: recipientId, content: "She fell.", noteType: "observation", needsAttention: true,
    });
    const urgent = await rows("observation_attention");
    expect(urgent.length).toBe(1);
    expect(JSON.parse(urgent[0].metadata).type).toBe("observation_attention");
  });
});

describe("and so does a visit", () => {
  test("logging a visit writes its own row", async () => {
    const res = await h.request.post("/api/family-visits").set(h.auth(member.token)).send({
      careRecipientId: recipientId, visitedAt: new Date().toISOString(), summary: "Sat with her a while.",
    });
    expect([200, 201]).toContain(res.status);

    const found = await rows("family_visit");
    expect(found.length).toBe(1);
    expect(JSON.parse(found[0].metadata).visitId).toBeTruthy();
  });

  test("a VISIT does not call itself a note", async () => {
    // This is what cost three rounds of the same conversation with Julia. She has READ_VISITS
    // and not READ_NOTES, so she correctly got visit pushes and no note pushes — but the visit
    // push said "added a note about Betty", so "I'm told about notes I can't read" was an exact
    // description of what the app said. Both fan-outs were right; the WORD was wrong.
    const row = (await rows("family_visit"))[0];
    expect(row.title).toMatch(/logged a visit/);
    expect(row.title).not.toMatch(/note/i);
  });
});
