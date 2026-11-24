// The picker takes more than one picture, and says what happened to the rest. (v1.105.111)
//
// Pete, 40ad8896. A visit is often several things worth recording — the fridge, the pill
// organiser, her in the garden — and one slot forced a choice between them.
//
// The compatibility shape matters more than the feature: `photos` is a new column ALONGSIDE
// `photo`, not instead of it, so every row written before today and every client that has not
// reloaded keeps working. tests/integration/visitPhotos.itest.js proves that against a real
// database; this file pins the client and the caps.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const log = read("public/js/components/FamilyVisitLog.js");
const route = read("src/routes/familyVisits.js");
const profile = read("public/js/components/CareProfile.js");
const db = read("src/models/database.js");

describe("the picker", () => {
  test("it takes more than one file", () => {
    expect(log).toMatch(/type="file" accept="image\/jpeg,image\/png,image\/webp" multiple/);
    expect(log).toMatch(/onChange=\{\(e\) => pickPhotos\(e\.target\.files\)\}/);
  });

  test("the camera is still not forced", () => {
    // v1.105.74's note: `capture` would force the camera, and Pete's case is often a picture
    // already in the roll.
    expect(log).not.toMatch(/capture=/);
  });

  test("each one can be removed individually", () => {
    expect(log).toMatch(/const removePhoto = \(i\) =>/);
    expect(log).toMatch(/aria-label=\{`Remove photo \$\{i \+ 1\}`\}/);
  });

  test("the count is on screen", () => {
    expect(log).toMatch(/\$\{photos\.length\} of \$\{MAX_PHOTOS\}/);
  });

  test("the Add button disappears once the cap is reached", () => {
    expect(log).toMatch(/photos\.length < MAX_PHOTOS &&/);
  });

  test("a photo that could not be read is REPORTED, not dropped", () => {
    // Silently discarding a picture someone chose is the same class as a swallowed save.
    expect(log).toMatch(/could not be read — the rest were added/);
    expect(log).toMatch(/the first \$\{taking\.length\} were added/);
  });

  test("they are downscaled on the device before they hit the wire", () => {
    // Four untouched iPhone photos would exceed the route's body limit and be rejected by
    // middleware BEFORE the handler could explain why.
    expect(log).toMatch(/downscaleImage\(f, \{ maxDim: 1400, quality: 0\.82 \}\)/);
  });

  test("a photo alone is still a whole visit", () => {
    expect(log).toMatch(/!summary\.trim\(\) && acts\.length === 0 && photos\.length === 0/);
  });

  test("the single-photo field is still sent alongside the list", () => {
    // So a server that has not been redeployed yet records something rather than nothing.
    expect(log).toMatch(/body\.photos = photos; body\.photo = photos\[0\];/);
  });
});

describe("the server", () => {
  test("the column is additive and nullable", () => {
    expect(db).toMatch(/id: "023_family_visit_photos"/);
    expect(db).toMatch(/ALTER TABLE family_visits ADD COLUMN IF NOT EXISTS photos TEXT/);
  });

  test("the client's and the server's caps are the same number", () => {
    const clientCap = /const MAX_PHOTOS = (\d+);/.exec(log)[1];
    const serverCap = /const MAX_PHOTOS = (\d+);/.exec(route)[1];
    expect(clientCap).toBe(serverCap);
  });

  test("count AND total are both capped", () => {
    // Per-photo alone is not enough: four 5MB images would blow the route's body limit and
    // 413 before the handler runs.
    expect(route).toMatch(/const MAX_PHOTOS_BYTES = 8 \* 1024 \* 1024/);
    expect(route).toMatch(/too large together/);
  });

  test("a photos value we cannot read is refused, not ignored", () => {
    expect(route).toMatch(/if \(photos != null && !Array\.isArray\(photos\)\)/);
  });

  test("the first photo is still written to the old column", () => {
    expect(route).toMatch(/const photoData = photoList\[0\] \|\| null;/);
  });

  test("a single photo does not write a redundant JSON array", () => {
    expect(route).toMatch(/photoList\.length > 1 \? JSON\.stringify\(photoList\) : null/);
  });

  test("the feed sends a count, never the images", () => {
    expect(route).toMatch(/photoCount: \(\(\) => \{/);
    const shape = route.slice(route.indexOf("photoCount: (() => {"), route.indexOf("photoCount: (() => {") + 400);
    expect(shape).not.toMatch(/photos: r\.photos/);
  });

  test("index 0 keeps its own URL, unchanged", () => {
    expect(route).toMatch(/router\.get\("\/:id\/photo", \(req, res\) => sendVisitPhoto\(req, res, 0\)\)/);
    expect(route).toMatch(/router\.get\("\/:id\/photo\/:idx"/);
  });

  test("a bad index cannot reach the database", () => {
    expect(route).toMatch(/if \(!Number\.isInteger\(idx\) \|\| idx < 0 \|\| idx >= MAX_PHOTOS\)/);
  });

  test("'not yours' and 'not there' still answer identically", () => {
    // Probing ids must tell you nothing — the rule the single-photo route already followed.
    const fn = route.slice(route.indexOf("async function sendVisitPhoto"), route.indexOf("router.get(\"/:id/photo\","));
    expect((fn.match(/404\).json\(\{ error: "Photo not found" \}\)/g) || []).length).toBe(3);
  });
});

describe("the feed shows all of them", () => {
  test("one thumbnail per photo, not just the first", () => {
    expect(profile).toMatch(/const n = v\.photoCount \|\| 1;/);
    expect(profile).toMatch(/Array\.from\(\{ length: n \}/);
  });

  test("a row from before today still renders", () => {
    expect(profile).toMatch(/\(v\.photoCount > 0 \|\| v\.hasPhoto\)/);
  });

  test("the lightbox opens on the one you tapped", () => {
    expect(profile).toMatch(/setViewingAttachments\(\{ list, index: i \}\)/);
  });
});
