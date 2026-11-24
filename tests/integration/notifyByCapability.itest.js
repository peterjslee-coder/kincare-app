/**
 * v1.105.81 — you are only told about what you could go and read.
 *
 * Pete: "I want to make sure that viewers I add aren't getting all the push notifications
 * that care team members are. Like observations, etc."
 *
 * The note, care-task and family-visit fan-outs each selected every care_team_member and
 * pushed to all of them. With per-invitation capabilities that means Peggy — on the team to
 * leave a note and record a visit, deliberately denied the care record — received
 * "New note — Betty" about a note she cannot open.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { CAP, PRESETS } = require("../../src/utils/capabilities");

jest.setTimeout(180000);
let h, getDb, usersWithCapability;

beforeAll(async () => {
  h = await startHarness({ routers: {} });
  ({ getDb } = require("../../src/models/database"));
  ({ usersWithCapability } = require("../../src/utils/access"));
});
afterAll(async () => { await stopHarness(h); });

let db, owner, julia, peggy, recipientId, teamId;

beforeAll(async () => {
  db = await getDb();
  owner = (await h.createUser({ firstName: "Pete", roles: ["family"] })).user;
  julia = (await h.createUser({ firstName: "Julia", roles: ["caregiver"] })).user;
  peggy = (await h.createUser({ firstName: "Peggy", roles: ["family"] })).user;

  recipientId = uuid(); teamId = uuid();
  await db.prepare("INSERT INTO care_recipients (id, family_user_id, first_name, last_name) VALUES (?, ?, 'Betty', 'T')").run(recipientId, owner.id);
  await db.prepare("INSERT INTO care_teams (id, care_recipient_id, name, created_by) VALUES (?, ?, 'Betty', ?)").run(teamId, recipientId, owner.id);
  for (const u of [owner, julia, peggy]) {
    await db.prepare("INSERT INTO care_team_members (id, care_team_id, user_id, role) VALUES (?, ?, ?, ?)")
      .run(uuid(), teamId, u.id, u.id === owner.id ? "leader" : "member");
  }
  // Julia: viewer. Peggy: helper — writes only, no sight of the record.
  await db.prepare("INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, capabilities, shared_by_user_id) VALUES (?, ?, ?, 'view', ?, ?)")
    .run(uuid(), recipientId, julia.id, JSON.stringify(PRESETS.viewer), owner.id);
  await db.prepare("INSERT INTO care_recipient_shares (id, care_recipient_id, shared_with_user_id, permission, capabilities, shared_by_user_id) VALUES (?, ?, ?, 'view', ?, ?)")
    .run(uuid(), recipientId, peggy.id, JSON.stringify(PRESETS.helper), owner.id);
});

describe("notes", () => {
  test("Julia is told, Peggy is not", async () => {
    const ids = await usersWithCapability(db, recipientId, CAP.READ_NOTES);
    expect(ids).toContain(julia.id);
    expect(ids).not.toContain(peggy.id);   // the whole point
    expect(ids).toContain(owner.id);       // the owner always sees everything
  });
});

describe("care tasks — medication", () => {
  test("neither Julia nor Peggy is told a medication is due", async () => {
    // Julia's preset withholds tasks; Peggy's does too until Pete grants it.
    const ids = await usersWithCapability(db, recipientId, CAP.READ_TASKS);
    expect(ids).not.toContain(julia.id);
    expect(ids).not.toContain(peggy.id);
    expect(ids).toContain(owner.id);
  });

  test("granting Peggy the medication tasks also starts notifying her", async () => {
    await db.prepare("UPDATE care_recipient_shares SET capabilities = ? WHERE care_recipient_id = ? AND shared_with_user_id = ?")
      .run(JSON.stringify([...PRESETS.helper, CAP.READ_TASKS, CAP.CHECK_TASKS]), recipientId, peggy.id);
    const ids = await usersWithCapability(db, recipientId, CAP.READ_TASKS);
    expect(ids).toContain(peggy.id);
    // ...and she still cannot read the notes.
    expect(await usersWithCapability(db, recipientId, CAP.READ_NOTES)).not.toContain(peggy.id);
  });
});

describe("family visits", () => {
  test("Peggy can log a visit but is not pushed about other people's", async () => {
    const canWrite = await usersWithCapability(db, recipientId, CAP.WRITE_VISITS);
    const toldAbout = await usersWithCapability(db, recipientId, CAP.READ_VISITS);
    expect(canWrite).toContain(peggy.id);
    expect(toldAbout).not.toContain(peggy.id);
  });
});

describe("the who-did-it picker is NOT filtered", () => {
  test("Peggy stays selectable as the person who gave the medication", async () => {
    // careTasks.js teamUserIds() feeds both the escalation push and the picker. Only the
    // push is capability-filtered; filtering the shared helper would have quietly removed
    // her from the list, which is the opposite of what Pete asked for.
    const src = require("fs").readFileSync(require("path").join(__dirname, "../../src/routes/careTasks.js"), "utf8");
    const fn = src.slice(src.indexOf("async function teamUserIds"), src.indexOf("async function teamUserIds") + 900);
    expect(fn).not.toMatch(/usersWithCapability/);
    // and the push site does filter
    expect(src).toMatch(/canSee\.has\(u\.id\)/);
  });
});
