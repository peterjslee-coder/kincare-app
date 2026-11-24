/**
 * v1.105.104 — the repair, run for real.
 *
 * Pete: "i just want her to see my messages from my personal account as Peter...not admin".
 *
 * This spawns scripts/repair-support-dm-split.js against the harness's real Postgres and then
 * asks the actual conversation-list endpoint what Julia sees. Testing the script's SQL by
 * re-typing it in the test would only prove I can type it twice.
 */
const { startHarness, stopHarness } = require("./harness");
const { execFileSync } = require("child_process");
const path = require("path");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "repair-support-dm-split.js");
let h, db;

const runRepair = (args = []) =>
  execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    encoding: "utf8",
  });

async function makeThread({ name, members, messages }) {
  const convId = uuid();
  await db.prepare(
    "INSERT INTO conversations (id, type, name, created_by, created_at) VALUES (?, 'direct', ?, ?, NOW() - INTERVAL '30 days')"
  ).run(convId, name, members[0]);
  for (const uid of members) {
    await db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', NOW() - INTERVAL '30 days')"
    ).run(uuid(), convId, uid);
  }
  let n = 0;
  for (const m of messages) {
    await db.prepare(
      `INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, sender_label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW() - INTERVAL '${20 - n} days')`
    ).run(uuid(), m.from, members.find(x => x !== m.from), m.text, convId, m.label || null);
    n++;
  }
  return convId;
}

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/messages": "../../src/routes/messages" } });
  db = h.db;
});
afterAll(async () => { await stopHarness(h); });

describe("a support thread that only ever held personal messages", () => {
  let pete, julia, convId;

  beforeAll(async () => {
    pete = await h.createUser({ firstName: "Pete", lastName: "Lee", isAdmin: true });
    julia = await h.createUser({ firstName: "Julia", lastName: "Huth", roles: ["caregiver"] });
    convId = await makeThread({
      name: "InPlace Support",
      members: [pete.user.id, julia.user.id],
      messages: [
        { from: pete.user.id, text: "Hi Julia, it's Pete" },
        { from: julia.user.id, text: "Hi Pete!" },
      ],
    });
  });

  test("the report says CLEAR and changes nothing", async () => {
    const out = runRepair();
    expect(out).toMatch(/MODE: report only/);
    expect(out).toMatch(/CLEAR/);
    const row = await db.prepare("SELECT name FROM conversations WHERE id = ?").get(convId);
    expect(row.name).toBe("InPlace Support");   // untouched
  });

  test("--apply retitles it to Pete, without moving a single message", async () => {
    const before = await db.prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?").get(convId);
    runRepair(["--apply"]);

    const after = await db.prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?").get(convId);
    expect(Number(after.c)).toBe(Number(before.c));

    const list = await h.request.get("/api/messages/conversations").set(h.auth(julia.token));
    const conv = list.body.conversations.find(c => c.id === convId);
    expect(conv.name).toBe("Pete Lee");
  });

  test("and both messages are still readable in it", async () => {
    const res = await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(julia.token));
    expect(res.body.messages.map(m => m.content)).toEqual(["Hi Julia, it's Pete", "Hi Pete!"]);
  });
});

describe("a thread that really does hold both", () => {
  let pete, julia, convId;

  beforeAll(async () => {
    pete = await h.createUser({ firstName: "Pete", lastName: "Lee", isAdmin: true });
    julia = await h.createUser({ firstName: "Jules", lastName: "H", roles: ["caregiver"] });
    convId = await makeThread({
      name: "InPlace Support",
      members: [pete.user.id, julia.user.id],
      messages: [
        { from: pete.user.id, text: "Your background check is waived.", label: "InPlace Support" },
        { from: julia.user.id, text: "Thank you!" },              // reply to support
        { from: pete.user.id, text: "Also — can you do Tuesday?" }, // Pete, as himself
        { from: julia.user.id, text: "Tuesday works" },            // reply to Pete
      ],
    });
  });

  test("--apply leaves the support half where it is and moves the personal half out", async () => {
    const out = runRepair(["--apply", "--only", convId]);
    expect(out).toMatch(/SPLIT/);

    const stayed = await db.prepare(
      "SELECT content FROM messages WHERE conversation_id = ? ORDER BY created_at"
    ).all(convId);
    expect(stayed.map(m => m.content)).toEqual(["Your background check is waived.", "Thank you!"]);
  });

  test("the moved half lands in a DM titled by the person", async () => {
    const list = await h.request.get("/api/messages/conversations").set(h.auth(julia.token));
    const names = list.body.conversations.map(c => c.name);
    expect(names).toContain("InPlace Support");
    expect(names).toContain("Pete Lee");

    const dm = list.body.conversations.find(c => c.name === "Pete Lee");
    const res = await h.request.get(`/api/messages/conversations/${dm.id}`).set(h.auth(julia.token));
    expect(res.body.messages.map(m => m.content)).toEqual(["Also — can you do Tuesday?", "Tuesday works"]);
  });

  test("the moved messages are VISIBLE, not below the history cut", async () => {
    // The trap: a thread's history starts at COALESCE(cm.joined_at, c.created_at) — v1.105.92.
    // A repair that created the DM today would have delivered 20-day-old messages into the
    // invisible half and reported success.
    const list = await h.request.get("/api/messages/conversations").set(h.auth(julia.token));
    const dm = list.body.conversations.find(c => c.name === "Pete Lee");
    const res = await h.request.get(`/api/messages/conversations/${dm.id}`).set(h.auth(julia.token));
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.hiddenBefore).toBe(0);
  });

  test("running it again is a no-op", async () => {
    const out = runRepair(["--apply", "--only", convId]);
    expect(out).toMatch(/OK|untouched/);
    const stayed = await db.prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?").get(convId);
    expect(Number(stayed.c)).toBe(2);
  });
});
