// A photo on a family visit (v1.105.74).
//
// Pete, from his phone at his mother's house: "I need to be able to add a picture when I log a
// visit. There doesn't seem to be a way for me to add a picture when I am just quickly logging
// a visit." (Feedback e201c58c, mood "terrible".)
//
// The interesting part of this feature is not the column. It is that base64 upload paths in this
// codebase have broken FOUR times in the same way — photo notes (v1.103.2), feedback screenshots
// (v1.105.0), caregiver ID verification (v1.105.35), and each time the cause was having only ONE
// half of the body-limit rule. These tests pin both halves.

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const route = read("src/routes/familyVisits.js");
const server = read("src/server.js");
const validate = read("src/middleware/validate.js");
const schema = read("src/models/database.js");
const form = read("public/js/components/FamilyVisitLog.js");
const profile = read("public/js/components/CareProfile.js");

describe("the body-limit rule — both halves, or it 413s", () => {
  test("a route-scoped express.json limit exists", () => {
    expect(server).toMatch(/app\.use\("\/api\/family-visits", express\.json\(\{ limit: "8mb" \}\)\)/);
  });

  test("a limitBodySize exemption exists", () => {
    expect(validate).toMatch(/req\.originalUrl\?\.startsWith\("\/api\/family-visits"\)\) return next\(\)/);
  });

  test("the express.json limit is declared BEFORE the global 100kb catch-all", () => {
    // Order is the whole mechanism: the first matching express.json wins.
    const mine = server.indexOf('app.use("/api/family-visits", express.json');
    const globalCap = server.indexOf('express.json({ limit: "100kb" })');
    expect(mine).toBeGreaterThan(-1);
    expect(globalCap).toBeGreaterThan(-1);
    expect(mine).toBeLessThan(globalCap);
  });
});

describe("the photo is validated, not trusted", () => {
  test("a declared mime is a claim, so magic bytes are checked", () => {
    expect(route).toMatch(/validateMagicBytes/);
    expect(route).toMatch(/Photo content does not match its type/);
  });

  test("it enforces a data URI, an image allowlist and a 5MB cap", () => {
    expect(route).toMatch(/Photo must be a base64 data URI/);
    expect(route).toMatch(/PHOTO_MIMES = \["image\/jpeg", "image\/png", "image\/webp"\]/);
    expect(route).toMatch(/5 \* 1024 \* 1024/);
  });

  test("validation runs before the access lookup", () => {
    // A malformed photo should not cost a database round trip.
    const validated = route.indexOf("const bad = validatePhoto(photo)");
    const access = route.indexOf("await recipientAccess(db, careRecipientId, req.user.id)");
    expect(validated).toBeGreaterThan(-1);
    expect(validated).toBeLessThan(access);
  });
});

describe("a photo is a record on its own", () => {
  test("the server accepts a visit that has only a photo", () => {
    expect(route).toMatch(/!text && !moodRating && cleanActivities\(activities\)\.length === 0 && !photoData/);
  });

  test("the client agrees, rather than blocking the submit first", () => {
    // Two guards that disagree is how a feature looks broken on one path only.
    // v1.105.111 — `photo` became `photos`; the rule is unchanged.
    expect(form).toMatch(/!summary\.trim\(\) && acts\.length === 0 && photos\.length === 0/);
  });
});

describe("the list never carries the blob", () => {
  test("the query selects a flag, not the photo", () => {
    expect(route).toMatch(/\(fv\.photo IS NOT NULL\) AS has_photo/);
    // The blob must not appear in the list projection.
    const listQuery = route.slice(route.indexOf("SELECT fv.id, fv.care_recipient_id"), route.indexOf("ORDER BY fv.visited_at DESC"));
    expect(listQuery).not.toMatch(/fv\.photo,/);
  });

  test("shape() exposes hasPhoto and never the photo itself", () => {
    const shape = route.slice(route.indexOf("function shape(r)"), route.indexOf("// ─── The nudge back into the app ───"));
    expect(shape).toMatch(/hasPhoto:/);
    expect(shape).not.toMatch(/^\s*photo:/m);
  });
});

describe("fetching a photo is access-controlled the same as the visit", () => {
  test("the endpoint exists and goes through recipientAccess", () => {
    // v1.105.111 — the body moved into sendVisitPhoto(), shared by /:id/photo and
    // /:id/photo/:idx. Same rules, one implementation.
    const fn = route.slice(route.indexOf('async function sendVisitPhoto'), route.indexOf('router.delete("/:id"'));
    expect(fn).toMatch(/recipientAccess\(db, row\.care_recipient_id, req\.user\.id\)/);
  });

  test("'not yours' and 'not there' both answer 404", () => {
    // A 403 would confirm the id exists to someone probing.
    // v1.105.111 — the body moved into sendVisitPhoto(), shared by /:id/photo and
    // /:id/photo/:idx. Same rules, one implementation.
    const fn = route.slice(route.indexOf('async function sendVisitPhoto'), route.indexOf('router.delete("/:id"'));
    const notFounds = fn.match(/404/g) || [];
    expect(notFounds.length).toBeGreaterThanOrEqual(2);
    expect(fn).not.toMatch(/403/);
  });

  test("it is wrapped in try/catch — Express 4 does not catch async route errors", () => {
    // v1.105.111 — the body moved into sendVisitPhoto(), shared by /:id/photo and
    // /:id/photo/:idx. Same rules, one implementation.
    const fn = route.slice(route.indexOf('async function sendVisitPhoto'), route.indexOf('router.delete("/:id"'));
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch \(err\)/);
  });
});

describe("the client", () => {
  test("downscales on the device before sending", () => {
    // An untouched iPhone photo is 3–5MB and the route caps at 5MB. v1.105.111 downscales
    // harder because there can now be four of them in one body.
    expect(form).toMatch(/downscaleImage\(f, \{ maxDim: 1400, quality: 0\.82 \}\)/);
  });

  test("the failed-read path says something", () => {
    // Every fetch/read handler in this codebase needs a terminal else that tells the user.
    expect(form).toMatch(/That image could not be read/);
  });

  test("the picker does not force the camera", () => {
    // Pete's case is often a picture already in the roll; `capture` would force the camera.
    const input = form.slice(form.indexOf("ref={photoInputRef}"), form.indexOf("ref={photoInputRef}") + 300);
    expect(input).toMatch(/accept="image\/jpeg,image\/png,image\/webp"/);
    expect(input).not.toMatch(/capture/);
  });

  test("the feed renders it through AttachmentThumb, not a bare img src", () => {
    // v1.105.34: a plain src is an unauthenticated request and renders
    // "Authentication required" in the native app.
    // v1.105.111 — the condition became (v.photoCount > 0 || v.hasPhoto) so a row written
    // before the photos column still renders.
    const start = profile.indexOf("(v.photoCount > 0 || v.hasPhoto)");
    const block = profile.slice(start, start + 900);
    expect(block).toMatch(/AttachmentThumb/);
    expect(block).not.toMatch(/<img/);
  });
});

describe("the migration", () => {
  test("it is in MIGRATIONS_V2 and additive", () => {
    // Never the legacy `migrations` array — that baseline never replays on existing DBs.
    expect(schema).toMatch(/id: "020_family_visit_photo"/);
    expect(schema).toMatch(/ALTER TABLE family_visits ADD COLUMN IF NOT EXISTS photo TEXT/);
  });
});
