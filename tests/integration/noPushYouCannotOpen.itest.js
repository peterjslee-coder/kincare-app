/**
 * You are not told about things you may not open. (v1.105.185)
 *
 * Pete: "either way, she should not get push notifications that lead her to dead ends. if her
 * permissions are wrong, she shouldn't get pushs for things she's not allowed to view."
 *
 * The rule existed — notes checked READ_NOTES, visits checked READ_VISITS — but it lived in 78
 * separate call sites, so it held only until somebody added a 79th. This is the floor
 * underneath all of them, and it is tested against real capability rows because that is the
 * only thing that can tell you whether the floor is actually there.
 */
const { startHarness, stopHarness } = require("./harness");
const { mayBeNotified, REQUIRED_CAPABILITY } = require("../../src/utils/pushPermission");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, owner, reader, writerOnly, stranger, recipientId, teamId;

beforeAll(async () => {
  h = await startHarness({ routers: {} });
  owner = await h.createUser({ roles: ["family"], firstName: "Pete" });
  reader = await h.createUser({ roles: ["caregiver"], firstName: "Julia" });
  writerOnly = await h.createUser({ roles: ["caregiver"], firstName: "Peggy" });
  stranger = await h.createUser({ roles: ["caregiver"], firstName: "Nobody" });

  const t = await h.createCareTeam({ familyUserId: owner.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;

  // Julia as she is today: read notes AND visits, granted explicitly.
  await h.db.prepare(`
    INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, shared_by_user_id, permission, capabilities, created_at)
    VALUES (?, ?, ?, ?, 'view', ?, NOW())
  `).run(uuid(), recipientId, reader.user.id, owner.user.id,
    JSON.stringify(["read_notes", "write_notes", "read_visits", "write_visits", "read_tasks"]));

  // Peggy the helper: may WRITE a note and a visit, may read neither.
  await h.db.prepare(`
    INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, shared_by_user_id, permission, capabilities, created_at)
    VALUES (?, ?, ?, ?, 'view', ?, NOW())
  `).run(uuid(), recipientId, writerOnly.user.id, owner.user.id, JSON.stringify(["write_notes", "write_visits"]));
});

afterAll(async () => { await stopHarness(h); });

const note = { type: "team_note", careRecipientId: null, noteId: "n1", page: "care-profile" };
const visit = { type: "family_visit", careRecipientId: null, visitId: "v1", page: "care-profile" };
const withRecipient = (d) => ({ ...d, careRecipientId: recipientId });

describe("someone who may read is told", () => {
  test("Julia gets note pushes", async () => {
    const v = await mayBeNotified(h.db, reader.user.id, withRecipient(note));
    expect(v.allowed).toBe(true);
  });

  test("and visit pushes", async () => {
    expect((await mayBeNotified(h.db, reader.user.id, withRecipient(visit))).allowed).toBe(true);
  });

  test("the owner is always told about their own person", async () => {
    expect((await mayBeNotified(h.db, owner.user.id, withRecipient(note))).allowed).toBe(true);
  });
});

describe("someone who may not read is not told", () => {
  test("a write-only helper gets no note push", async () => {
    // She can leave a note and cannot read one. Telling her a note exists is the dead end.
    const v = await mayBeNotified(h.db, writerOnly.user.id, withRecipient(note));
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("missing_read_notes");
  });

  test("nor a visit push", async () => {
    const v = await mayBeNotified(h.db, writerOnly.user.id, withRecipient(visit));
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("missing_read_visits");
  });

  test("and a stranger gets neither", async () => {
    expect((await mayBeNotified(h.db, stranger.user.id, withRecipient(note))).allowed).toBe(false);
    expect((await mayBeNotified(h.db, stranger.user.id, withRecipient(visit))).allowed).toBe(false);
  });
});

describe("it fails OPEN, everywhere it is unsure", () => {
  // The cost of a wrong "allow" is a notification someone did not need. The cost of a wrong
  // "deny" is silence about their mother. These are not symmetric.
  test("a push with no care recipient is untouched", async () => {
    const v = await mayBeNotified(h.db, stranger.user.id, { type: "message", conversationId: "c1" });
    expect(v.allowed).toBe(true);
    expect(v.reason).toBe("not_record_scoped");
  });

  test("a type nobody has mapped is untouched", async () => {
    const v = await mayBeNotified(h.db, stranger.user.id, withRecipient({ type: "something_new" }));
    expect(v.allowed).toBe(true);
    expect(v.reason).toBe("type_not_gated");
  });

  test("no data at all is untouched", async () => {
    expect((await mayBeNotified(h.db, stranger.user.id, null)).allowed).toBe(true);
    expect((await mayBeNotified(h.db, stranger.user.id, undefined)).allowed).toBe(true);
  });

  test("a broken lookup does not silence a care notification", async () => {
    const brokenDb = { prepare: () => { throw new Error("db is down"); } };
    const v = await mayBeNotified(brokenDb, reader.user.id, withRecipient(note));
    expect(v.allowed).toBe(true);
    expect(v.reason).toBe("check_failed_open");
  });
});

describe("the table says what it covers", () => {
  test("every gated type maps to a real capability", () => {
    const { CAP } = require("../../src/utils/capabilities");
    const real = new Set(Object.values(CAP));
    for (const [type, cap] of Object.entries(REQUIRED_CAPABILITY)) {
      expect(real.has(cap)).toBe(true);
      expect(typeof type).toBe("string");
    }
  });

  test("notes and visits are both covered, in both their type spellings", () => {
    // observation_attention is the urgent variant of a note and was easy to miss.
    expect(REQUIRED_CAPABILITY.team_note).toBe("read_notes");
    expect(REQUIRED_CAPABILITY.observation_attention).toBe("read_notes");
    expect(REQUIRED_CAPABILITY.family_visit).toBe("read_visits");
  });
});
