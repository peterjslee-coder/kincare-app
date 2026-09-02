// A thread must not download every photo in it. (v1.105.181)
//
// Pete: "we should probably resize photos in messages or something...loading is bad now."
//
// A photo message stores its image as a base64 data URI in `metadata.photoUrl`, and every list
// endpoint returned the metadata verbatim. Measured on production: the four biggest messages in
// one thread are 5-6 MB EACH, and the table is 24 MB across 433 rows — so opening that
// conversation downloaded ~24 MB before a single bubble appeared. It is also half of why the
// Postgres volume filled: boot snapshots copied all of it, five times over.

const { code } = require("./helpers/source");
const fs = require("fs");
const path = require("path");
const route = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "messages.js"), "utf8");
const client = code("public/js/components/Messages.js");

// stripPhotoBlob is pure; pull it out and run it rather than grepping for it.
const stripPhotoBlob = new Function(
  `${route.slice(route.indexOf("function stripPhotoBlob"), route.indexOf("function makeShouldPush"))}\nreturn stripPhotoBlob;`
)();

describe("the bytes stay out of the list", () => {
  const photoMsg = (extra = {}) => ({
    id: "m1", message_type: "photo",
    metadata: JSON.stringify({ photoUrl: "data:image/jpeg;base64,AAAA", caption: "Mom at lunch", originalName: "IMG_1.jpg", ...extra }),
  });

  test("photoUrl is removed", () => {
    const out = stripPhotoBlob(photoMsg());
    expect(JSON.parse(out.metadata).photoUrl).toBeUndefined();
    expect(out.metadata).not.toMatch(/base64/);
  });

  test("everything else about the photo survives", () => {
    // The caption renders in the bubble; losing it to save bytes would be a different bug.
    const meta = JSON.parse(stripPhotoBlob(photoMsg()).metadata);
    expect(meta.caption).toBe("Mom at lunch");
    expect(meta.originalName).toBe("IMG_1.jpg");
  });

  test("and it says a photo is there", () => {
    // The client needs to know to point an <img> somewhere.
    expect(JSON.parse(stripPhotoBlob(photoMsg()).metadata).hasPhoto).toBe(true);
  });

  test("a text message passes through untouched", () => {
    const text = { id: "m2", message_type: "text", metadata: null, content: "hello" };
    expect(stripPhotoBlob(text)).toBe(text);
  });

  test("malformed metadata does not throw or lose the message", () => {
    const bad = { id: "m3", message_type: "photo", metadata: "{not json" };
    expect(() => stripPhotoBlob(bad)).not.toThrow();
    expect(stripPhotoBlob(bad)).toBe(bad);
  });

  test("both list endpoints use it", () => {
    // The legacy direct-message path is a separate response and was just as heavy.
    expect((route.match(/enriched\.map\(stripPhotoBlob\)/g) || [])).toHaveLength(2);
  });
});

describe("and there is somewhere to get them from", () => {
  const handler = route.slice(route.indexOf('router.get("/:id/photo"'), route.indexOf("// ─── POST /api/messages/conversations/:id/photo"));

  test("one photo, by message id", () => {
    expect(route).toMatch(/router\.get\("\/:id\/photo"/);
  });

  test("membership is checked, and a stranger gets 404 not 403", () => {
    // Same convention as notes and family visits: "not yours" and "not there" look identical.
    expect(handler).toMatch(/FROM conversation_members WHERE conversation_id = \? AND user_id = \?/);
    expect(handler).toMatch(/if \(!allowed\) return res\.status\(404\)/);
    expect(handler).not.toMatch(/status\(403\)/);
  });

  test("legacy direct messages still work — they have no membership row", () => {
    expect(handler).toMatch(/msg\.sender_id === req\.user\.id \|\| msg\.recipient_id === req\.user\.id/);
  });

  test("it is cached privately — the bytes for an id never change", () => {
    expect(handler).toMatch(/private, max-age=86400/);
  });
});

describe("the client fetches instead of receiving", () => {
  test("it points at the endpoint", () => {
    expect(client).toMatch(/const src = meta\.photoUrl \|\| `\/api\/messages\/\$\{m\.id\}\/photo`/);
  });

  test("a just-sent photo still shows immediately", () => {
    // The local echo of a message you just sent has the real data URI; honouring it is what
    // stops your own photo flickering through a round trip.
    expect(client).toMatch(/meta\.photoUrl \|\|/);
  });

  test("scrolling past one costs nothing", () => {
    expect(client).toMatch(/loading: 'lazy'/);
  });

  test("and the space is reserved so the thread does not jump", () => {
    expect(client).toMatch(/minHeight: 120/);
  });

  test("the lightbox opens the same source", () => {
    expect(client).toMatch(/setLightboxPhoto\(\{ src, caption: meta\.caption \}\)/);
  });
});

describe("new photos are smaller to begin with", () => {
  test("chat photos downscale harder than the default", () => {
    // A chat photo renders at most 300px tall in a bubble. 1280 at 0.72 is indistinguishable
    // there and roughly a third of the bytes — and every one is stored base64 in Postgres.
    expect(client).toMatch(/downscaleImageFile\(file, \{ maxDim: 1280, quality: 0\.72 \}\)/);
  });
});
