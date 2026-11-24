/**
 * Batch 4a — blobs out of Postgres, one column of record (v1.106.8).
 *
 * The Sept 2 outage was the Postgres volume filling with base64 images. storage.js has existed
 * since v1.91.0 to prevent exactly that, and five writers never used it. These tests are about
 * the two halves of making that stick: every writer stores by reference, and every reader can
 * read both shapes — because a half-migrated table has to serve every row correctly.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "batch4-storage-test-secret";

const fs = require("fs");
const path = require("path");
const { raw, code } = require("./helpers/source");

describe("S1 — every upload is stored by reference", () => {
  const WRITERS = {
    "src/routes/photos.js": "visit-photo",
    "src/routes/notes.js": "note-photo",
    "src/routes/familyVisits.js": "family-visit",
    "src/routes/careRecipients.js": "recipient-photo",
    "src/routes/messages.js": "message-photo",
    "src/routes/auth.js": "profile-photo",
    "src/routes/admin/userFlags.js": "profile-photo",
  };

  for (const [file, prefix] of Object.entries(WRITERS)) {
    test(`${file.replace("src/routes/", "")} stores through storage.storeFileData`, () => {
      expect(code(file)).toMatch(new RegExp(`storeFileData\\("${prefix}"`));
    });
  }

  test("family visits store EVERY photo, not just the lead one", () => {
    const f = code("src/routes/familyVisits.js");
    // `photos` is a JSON array of data URIs — a five-photo visit was five images in one column.
    expect(f).toMatch(/photoList = await Promise\.all\(photoList\.map\(\(p\) => storage\.storeFileData\("family-visit", p\)\)\)/);
  });

  test("the linter agrees: no blob column is written without going through storage", () => {
    const { execFileSync } = require("child_process");
    const out = execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "lint-blobs.js")],
      { encoding: "utf8" });
    expect(out).toMatch(/✓ every blob-column write routes through storage\.storeFileData/);
  });

  test("every linter exemption carries a written reason", () => {
    // A baseline entry with no reason is how a gate quietly stops being a gate.
    const { BASELINE } = require("../scripts/lint-blobs-baseline");
    expect(BASELINE.length).toBeGreaterThan(0);
    for (const entry of BASELINE) {
      expect(entry).toMatch(/ — /);                       // file — reason
      expect(entry.split(" — ")[1].trim().length).toBeGreaterThan(20);
    }
  });
});

describe("S2 — every reader can read both shapes", () => {
  test("resolving happens inside sendStoredFile, so a new reader is right by default", () => {
    const sm = code("src/utils/serveMedia.js");
    expect(sm).toMatch(/async function sendStoredFile/);
    expect(sm).toMatch(/await require\("\.\/storage"\)\.resolveFileData\(dataUrl\)/);
  });

  test("and every single caller awaits it", () => {
    const dirs = [path.join(__dirname, "..", "src", "routes"), path.join(__dirname, "..", "src", "routes", "admin")];
    const calls = [];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".js")) continue;
        const rel = path.relative(path.join(__dirname, ".."), path.join(dir, f));
        for (const m of code(rel).matchAll(/(\w*)\s*(sendStoredFile|sendDataUrl)\s*\(/g)) {
          if (m[1] === "function" || m[1] === "async") continue;
          calls.push({ rel, keyword: m[1] });
        }
      }
    }
    expect(calls.length).toBeGreaterThanOrEqual(6);
    expect(calls.filter((c) => c.keyword !== "await")).toEqual([]);
  });

  test("the message list strips an r2 marker as well as inline base64", () => {
    const m = code("src/routes/messages.js");
    const strippers = m.match(/regexp_replace\(m\.metadata[^)]*\)/g) || [];
    expect(strippers.length).toBe(4);
    for (const s of strippers) expect(s).toMatch(/\(data:\|r2:\)/);
  });

  test("a marker never reaches the client as an <img src>", () => {
    // Messages.js does `meta.photoUrl || /api/messages/:id/photo`. If a marker survived the
    // strip, that first branch would put "r2:message-photo/..." into an <img>.
    const m = code("src/routes/messages.js");
    expect(m).toMatch(/const \{ photoUrl, \.\.\.rest \} = meta;/);   // JS stripper drops it whatever the shape
  });
});

describe("S3 — one column of record for a user's photo", () => {
  test("nothing writes avatar_url and profile_photo together any more", () => {
    for (const f of ["src/routes/auth.js", "src/routes/admin/userFlags.js"]) {
      expect(code(f)).not.toMatch(/SET profile_photo = \?, avatar_url = \?/);
      expect(code(f)).toMatch(/SET profile_photo = \?, avatar_url = NULL/);
    }
  });

  test("/api/auth/me no longer ships the avatar bytes — twice — on every one of nine boot calls", () => {
    const a = code("src/routes/auth.js");
    const me = a.slice(a.indexOf('router.get("/me"'), a.indexOf('router.patch("/me/ui-prefs"'));
    expect(me).not.toMatch(/SELECT[^`"]*\bavatar_url\b[^`"]*FROM users/);
    expect(me).toMatch(/\$\{HAS_PHOTO_SQL\}/);
    expect(me).toMatch(/profile_photo: userPhotoUrl\(user\)/);
  });

  test("'has a photo' means one we can SERVE — a remote URL is not one", () => {
    const { userPhotoUrl, isServablePhoto } = require("../src/routes/media");
    expect(userPhotoUrl({ id: "u", profile_photo: "data:image/jpeg;base64,AA" })).toBe("/api/media/user/u/photo");
    expect(userPhotoUrl({ id: "u", profile_photo: "r2:profile-photo/x" })).toBe("/api/media/user/u/photo");
    // v1.106.3 removed the 302 branch, so a stored https URL cannot be served — counting it as
    // a photo produces a broken <img>, which is worse than showing the initials fallback.
    expect(userPhotoUrl({ id: "u", avatar_url: "https://lh3.googleusercontent.com/a" })).toBeNull();
    expect(userPhotoUrl({ id: "u" })).toBeNull();
    expect(isServablePhoto("https://x/y.png")).toBe(false);
  });

  test("the SQL flag and the JS helper agree about what counts", () => {
    const { hasPhotoSql } = require("../src/routes/media");
    const sql = hasPhotoSql("u");
    expect(sql).toMatch(/u\.profile_photo IS NOT NULL/);
    expect(sql).toMatch(/u\.avatar_url LIKE 'data:%'/);
    expect(sql).toMatch(/u\.avatar_url LIKE 'r2:%'/);
    expect(sql).not.toMatch(/u\.avatar_url IS NOT NULL/);   // that would count remote URLs
  });

  test("the caregiver completeness gate reads the column of record, not the old one", () => {
    const c = code("src/routes/caregivers.js");
    expect(c).toMatch(/if \(!userHasPhoto\(profile\)\) missing\.push\("Profile photo"\)/);
    expect(c).not.toMatch(/if \(!profile\.avatar_url\) missing\.push/);
    // and the query it reads from must actually select what the helper checks
    expect(c).toMatch(/SELECT cp\.\*, u\.avatar_url, u\.profile_photo/);
  });

  test("the conversation list stops pulling avatars it only wanted a boolean from", () => {
    const m = code("src/routes/messages.js");
    expect(m).not.toMatch(/SELECT[^`]*u\.profile_photo, u\.avatar_url/);
    expect((m.match(/hasPhotoSql\(/g) || []).length).toBeGreaterThanOrEqual(5);
  });
});

describe("S4 — the migration cannot lose an image", () => {
  const db = raw("src/models/database.js");
  const mig = db.slice(db.indexOf('id: "034_one_user_photo_column"'), db.indexOf('id: "033_geocode_cache"'));

  test("it fills the column of record BEFORE clearing the other one", () => {
    const fill = mig.indexOf("SET profile_photo = avatar_url");
    const clear = mig.indexOf("SET avatar_url = NULL");
    expect(fill).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(-1);
    expect(fill).toBeLessThan(clear);
  });

  test("it only clears avatar_url where it is byte-identical to profile_photo", () => {
    const clearStmt = mig.slice(mig.indexOf("SET avatar_url = NULL"));
    expect(clearStmt).toMatch(/profile_photo IS NOT NULL/);
    expect(clearStmt).toMatch(/avatar_url = profile_photo/);
  });

  test("it does not copy remote URLs into the column that means 'bytes we hold'", () => {
    const fillStmt = mig.slice(mig.indexOf("SET profile_photo = avatar_url"), mig.indexOf("SET avatar_url = NULL"));
    expect(fillStmt).toMatch(/avatar_url LIKE 'data:%' OR avatar_url LIKE 'r2:%'/);
  });
});

describe("S5 — the backfill is safe to run against production", () => {
  const b = code("scripts/backfill-blobs-to-r2.js");

  test("it reports by default and only writes with --apply", () => {
    expect(b).toMatch(/const APPLY = process\.argv\.includes\("--apply"\)/);
    expect(b).toMatch(/if \(!APPLY\) continue;/);
  });

  test("it uploads BEFORE it rewrites the row — the other order loses the image", () => {
    const loop = b.slice(b.indexOf("for (const row of rows)"));
    const upload = loop.indexOf("storeFileData");
    const write = loop.indexOf("UPDATE ${t.table}");
    // Both must EXIST: a missing one gives indexOf -1, which is less than everything, and the
    // ordering assertion then passes having verified nothing. Third time this shape has come up.
    expect(upload).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(upload).toBeLessThan(write);
    // Both branches upload — the JSON one (messages.metadata) and the plain-column one.
    expect((loop.match(/storage\.storeFileData\(/g) || []).length).toBe(2);
  });

  test("the rewrite is conditional on the row not having changed underneath it", () => {
    expect(b).toMatch(/UPDATE \$\{t\.table\} SET \$\{t\.column\} = \? WHERE \$\{t\.key\} = \? AND \$\{t\.column\} = \?/);
  });

  test("it is resumable — it selects only rows still holding base64", () => {
    expect(b).toMatch(/LIKE '%data:%;base64,%'/);
  });

  test("one row failing does not abandon the rest", () => {
    const loop = b.slice(b.indexOf("for (const row of rows)"));
    expect(loop).toMatch(/catch \(err\) \{[\s\S]{0,200}failed\+\+/);
  });

  test("it refuses to pretend when R2 is not configured", () => {
    expect(b).toMatch(/if \(!storage\.isEnabled\(\)\)/);
    expect(b).toMatch(/process\.exit\(1\)/);
  });

  test("it covers every table that holds a blob", () => {
    for (const t of ["visit_photos", "recipient_notes", "family_visits", "care_recipients",
                     "users", "messages", "verified_documents", "reimbursement_receipts"]) {
      expect(b).toContain(`table: "${t}"`);
    }
  });
});
