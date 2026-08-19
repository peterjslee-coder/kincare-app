// The demo chats were empty for a week and the messages were in the table the whole time.
// (v1.105.95)
//
// Pete: "there are no persisting messages in the chat from maria or james...there should
// always be messages."
//
// v1.105.92 gave conversations a start line: you see a conversation from the day you joined it,
// so a neighbour added to Betty's care team doesn't inherit months of family discussion about
// her health. Right rule. But GET /conversations/:id implements it as
// `WHERE m.created_at >= conversation_members.joined_at`, and the seed wrote members at NOW()
// while writing every message backdated — "-5 days", "-3 days", "-45 minutes". Every seeded
// message sorted BEFORE the seeded membership, so all four demo conversations rendered empty
// while /api/messages/:partnerId (which has no such cut) happily returned all 13.
//
// The fix is not to loosen the privacy rule. These people really were in the conversation when
// those messages were sent, so the seed says so.

const fs = require("fs");
const path = require("path");

const seed = fs.readFileSync(path.join(__dirname, "..", "src", "seed.js"), "utf8");
const messagesRoute = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "messages.js"), "utf8");

describe("seeded demo messages are visible to the people in the conversation", () => {
  test("the joined_at cut is still enforced — this is a seed bug, not a reason to drop the rule", () => {
    expect(messagesRoute).toMatch(/AND m\.created_at >= \?/);
    expect(messagesRoute).toMatch(/membership\.joined_at/);
  });

  test("every seeded conversation_members row sets joined_at explicitly", () => {
    const inserts = seed.match(/INSERT INTO conversation_members[^"`]*/g) || [];
    expect(inserts.length).toBeGreaterThan(0);
    for (const stmt of inserts) {
      expect(stmt).toMatch(/joined_at/);
    }
  });

  test("joined_at is older than the oldest backdated demo message", () => {
    const m = seed.match(/const DEMO_MEMBER_JOINED_AT = "-(\d+) days";/);
    expect(m).not.toBeNull();
    const joinedDaysAgo = parseInt(m[1], 10);

    // Every backdated message offset in the seed, e.g. "-5 days".
    const dayOffsets = [...seed.matchAll(/"-(\d+) days"/g)].map((x) => parseInt(x[1], 10));
    const oldestMessageDaysAgo = Math.max(...dayOffsets.filter((d) => d !== joinedDaysAgo));

    expect(joinedDaysAgo).toBeGreaterThan(oldestMessageDaysAgo);
  });
});

describe("the demo's own service worker was breaking its avatars", () => {
  test("cross-origin images are handed back to the browser, not re-fetched by the worker", () => {
    // A service worker's fetch() is a connect, judged by connect-src; an <img> is judged by
    // img-src, which allows https:. Re-issuing the request turned an allowed load into a
    // blocked one for every cross-origin image in the app.
    const sw = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
    expect(sw).toMatch(/event\.request\.destination === 'image' && url\.origin !== self\.location\.origin/);
  });

  test("demo avatars are stored on our own origin, not borrowed from an image host at runtime", () => {
    expect(seed).toMatch(/fetchAvatarDataUrl/);
    expect(seed).toMatch(/data:\$\{type\};base64,/);
    // No avatar_url is written pointing at a third-party host.
    expect(seed).not.toMatch(/avatar_url = '?https?:/);
    expect(seed).not.toMatch(/i\.pravatar\.cc\/\d/);
  });
});
