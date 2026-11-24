/**
 * v1.119.1 — lint:pronouns reads what a person sees, and only that (feedback 36b1a6cc).
 * A lint that cannot fail is worse than none, so this proves it fails.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { check, texts } = require("../scripts/lint-pronouns");

const tmp = (name, src) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pron-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, src);
  return p;
};

describe("lint:pronouns", () => {
  test("flags a string, a template and JSX text", () => {
    const p = tmp("a.js", [
      'const a = "She already has an account";',
      "const b = `Text ${x} her now`;",
      "const C = () => <div>How was she today?</div>;",
    ].join("\n"));
    expect(check([p])).toHaveLength(3);
  });

  test("never reads comments — including a /* inside a string, which used to swallow files", () => {
    const p = tmp("b.js", [
      "// she said so in a comment",
      "/* her block comment */",
      'const accept = "image/*";',
      'const later = "Her link";',
    ].join("\n"));
    const found = check([p]);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("Her link");
  });

  test("words that merely contain the letters are fine", () => {
    expect(texts('const a = "other shelf heroes ushered here";').length).toBe(1);
    const p = tmp("c.js", 'const a = "other shelf ushered there";');
    expect(check([p])).toEqual([]);
  });

  test("the app is clean today", () => {
    expect(check()).toEqual([]);
  });
});
