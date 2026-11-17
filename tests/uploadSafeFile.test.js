// v1.127.5 — every multipart upload copies its file into memory first.
//
// Safari 26.5+ (WebKit bug 319985) uploads a disk-backed File as an EMPTY body. Ryan's driver's
// licence reached the server as zero bytes four times on 11/16 and he saw "Internal server
// error". The fix is window.uploadSafeFile() in utils.js; this test is the guardrail (Dev Rule 9)
// so the next upload a component adds can't quietly skip it.
//
// Rule: in any client file, every FormData `.append(<file field>, value[, filename])` must wrap
// the value in `await uploadSafeFile(...)`. File fields are the names multer listens on —
// document(s), photo(s), audio, file(s), image(s), attachment(s). A new upload field with a new
// name belongs in FILE_FIELDS too.

const fs = require("fs");
const path = require("path");
const { code, REPO } = require("./helpers/source");

const CLIENT = path.join(REPO, "public", "js");

function clientFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...clientFiles(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const FILE_FIELDS = /^['"](documents?|photos?|audio|files?|images?|attachments?)['"]$/;

describe("multipart uploads go through uploadSafeFile (WebKit bug 319985)", () => {
  const files = clientFiles(CLIENT).filter((f) => !f.includes(`${path.sep}js-compiled${path.sep}`));

  it("finds the client files that build a FormData", () => {
    const withFormData = files.filter((f) => /new FormData\(/.test(fs.readFileSync(f, "utf8")));
    expect(withFormData.length).toBeGreaterThanOrEqual(10);
  });

  it("utils.js defines window.uploadSafeFile from arrayBuffer()", () => {
    const src = code("public/js/utils.js");
    expect(src).toMatch(/const uploadSafeFile = window\.uploadSafeFile = async/);
    expect(src).toMatch(/await file\.arrayBuffer\(\)/);
  });

  for (const abs of files) {
    const rel = path.relative(REPO, abs);
    const src = code(rel);
    if (!/new FormData\(/.test(src)) continue;
    it(`${rel}: every appended file is wrapped`, () => {
      // Only appends on a FormData variable (form/formData/fd), not URLSearchParams etc.
      const re = /\b(formData|fd|form)\.append\(\s*(['"][^'"]+['"])\s*,\s*([^\n]+?)\)\s*;/g;
      const bad = [];
      let m;
      while ((m = re.exec(src))) {
        const value = m[3].trim();
        if (!FILE_FIELDS.test(m[2])) continue;
        if (/^await uploadSafeFile\(/.test(value)) continue;
        bad.push(`${m[1]}.append(${m[2]}, ${value})`);
      }
      expect(bad).toEqual([]);
    });
  }
});
