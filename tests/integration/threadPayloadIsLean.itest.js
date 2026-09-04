/**
 * The photo blob must never leave Postgres. (v1.105.183)
 *
 * Pete: "messages are taking a long time to load when i load the app. it spins, loading, for
 * about 20 seconds before any messages show up."
 *
 * v1.105.181 stripped metadata.photoUrl from the RESPONSE, which fixed the payload and not the
 * wait: the query was still SELECT m.*, so all 24 MB of base64 came out of the database into
 * Node on every thread load just to be thrown away. Fixing the wire and not the read.
 *
 * This has to be an integration test. The claim is about what a real Postgres returns for a
 * regexp_replace over a real TOASTed row, and no amount of source-matching can check that.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = { "/api/messages": "../../src/routes/messages" };

// A recognisable data URI, big enough that a leak is unmistakable in a length check.
const BIG = "data:image/jpeg;base64," + "A".repeat(300000);

let h, a, b, convId, photoId;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  a = await h.createUser({ roles: ["family"], firstName: "Pete" });
  b = await h.createUser({ roles: ["family"], firstName: "Deborah" });

  convId = uuid();
  await h.db.prepare(
    "INSERT INTO conversations (id, type, name, created_at) VALUES (?, 'group', 'Betty Core', NOW())"
  ).run(convId);
  for (const u of [a, b]) {
    await h.db.prepare(
      "INSERT INTO conversation_members (id, conversation_id, user_id, joined_at) VALUES (?, ?, ?, NOW() - INTERVAL '1 day')"
    ).run(uuid(), convId, u.user.id);
  }

  photoId = uuid();
  await h.db.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, message_type, metadata, created_at)
    VALUES (?, ?, ?, '\u{1F4F7} Photo', ?, 'photo', ?, NOW())
  `).run(photoId, b.user.id, a.user.id, convId,
    JSON.stringify({ photoUrl: BIG, caption: "Mom at lunch", originalName: "IMG_1.jpg" }));

  await h.db.prepare(`
    INSERT INTO messages (id, sender_id, recipient_id, content, conversation_id, message_type, created_at)
    VALUES (?, ?, ?, 'Just a text message', ?, 'text', NOW())
  `).run(uuid(), b.user.id, a.user.id, convId);
});

afterAll(async () => { await stopHarness(h); });

describe("a thread load does not carry the image", () => {
  let body, raw;
  beforeAll(async () => {
    const res = await h.request.get(`/api/messages/conversations/${convId}`).set(h.auth(a.token));
    expect(res.status).toBe(200);
    body = res.body;
    raw = JSON.stringify(body);
  });

  test("no base64 anywhere in the response", () => {
    expect(raw).not.toMatch(/base64/);
    expect(raw).not.toMatch(/AAAAAAAAAA/);
  });

  test("and the response is small — this is the 20 seconds", () => {
    // The blob alone is 300 KB; the whole response should be a rounding error next to it.
    expect(raw.length).toBeLessThan(20000);
  });

  test("the caption survives — it renders under the photo", () => {
    // Which is why this is a surgical replace rather than dropping metadata for photo rows.
    const photo = body.messages.find((m) => m.id === photoId);
    const meta = JSON.parse(photo.metadata);
    expect(meta.caption).toBe("Mom at lunch");
    expect(meta.originalName).toBe("IMG_1.jpg");
  });

  test("and it still says a photo is there", () => {
    const photo = body.messages.find((m) => m.id === photoId);
    expect(JSON.parse(photo.metadata).hasPhoto).toBe(true);
  });

  test("ordinary messages are untouched", () => {
    const text = body.messages.find((m) => m.content === "Just a text message");
    expect(text).toBeTruthy();
    expect(text.metadata).toBeFalsy();
  });

  test("every column the client needs is still selected", () => {
    // The query names columns explicitly now instead of m.*, so a forgotten one silently
    // disappears from the client rather than failing anywhere.
    const photo = body.messages.find((m) => m.id === photoId);
    for (const k of ["id", "sender_id", "content", "created_at", "conversation_id",
                     "message_type", "is_read", "senderName", "type"]) {
      expect(photo).toHaveProperty(k);
    }
  });
});

describe("the bytes are still there when actually asked for", () => {
  test("GET /:id/photo returns the real image", async () => {
    const res = await h.request.get(`/api/messages/${photoId}/photo`).set(h.auth(a.token));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
    expect(res.body.length).toBeGreaterThan(200000);
  });

  test("a stranger still cannot fetch it", async () => {
    const stranger = await h.createUser({ roles: ["family"], firstName: "Nobody" });
    const res = await h.request.get(`/api/messages/${photoId}/photo`).set(h.auth(stranger.token));
    expect(res.status).toBe(404);
  });
});
