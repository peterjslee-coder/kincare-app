/**
 * docsTruth — the agent-facing docs must not lie.
 *
 * Sep 13 2026: a review found CLAUDE.md wrong on 13 of ~22 checkable structural claims. It
 * described in-browser Babel compilation (there is a build step), a `src/routes/admin.js` that
 * had been split ten months earlier, "16 tables" against 89, and "53 tests" against ~1,750.
 * Every session reads that file first, so each wrong line cost real time in every session after
 * it was written.
 *
 * These assertions are deliberately narrow: they check things that can never become true again,
 * and things that are cheap to keep true. They do NOT assert live counts — those live in
 * docs/ARCHITECTURE.md, which is generated and separately checked by
 * `npm run gen:architecture -- --check`.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const AGENT_DOCS = ["CLAUDE.md", "README.md"];

// Claims that were true once and can never be true again. If someone reintroduces one, they are
// almost certainly copying from an old doc.
const RETIRED_CLAIMS = [
  { pattern: /no build step/i, why: "There IS a build step — scripts/build-client.js runs Babel + terser before the server starts." },
  { pattern: /babel\s+standalone/i, why: "Babel-standalone is not loaded; the client is a prebuilt bundle." },
  { pattern: /compiles?\s+JSX\s+in[-\s]browser/i, why: "JSX is compiled at build time, not in the browser." },
  { pattern: /in-browser\s+(?:JSX\s+)?transpilation/i, why: "JSX is compiled at build time, not in the browser." },
  { pattern: /src\/routes\/admin\.js/, why: "admin.js was split into src/routes/admin/ at v1.92.0." },
  { pattern: /React 18[^.\n]{0,40}via CDN/i, why: "React is self-hosted from /vendor/, not a CDN." },
];

describe("agent-facing docs do not carry retired claims", () => {
  for (const doc of AGENT_DOCS) {
    for (const { pattern, why } of RETIRED_CLAIMS) {
      test(`${doc} does not claim: ${pattern}`, () => {
        const src = read(doc);
        const hit = src.match(pattern);
        expect(hit ? `${doc} line ${src.slice(0, hit.index).split("\n").length}: "${hit[0]}" — ${why}` : null).toBeNull();
      });
    }
  }
});

describe("agent-facing docs only point at files that exist", () => {
  for (const doc of AGENT_DOCS) {
    test(`${doc} has no dangling path references`, () => {
      const src = read(doc);
      // Only backticked things that look like PATHS (contain a slash) — bare filenames such as
      // `utils.js` are prose, and checking them produced false positives.
      const refs = [...new Set((src.match(/`[A-Za-z0-9_.@/-]+\.(?:js|md|json|css|html)`/g) || [])
        .map((s) => s.slice(1, -1))
        .filter((s) => s.includes("/") && !s.startsWith("http") && !s.startsWith("@")))];
      const missing = refs.filter((r) => !fs.existsSync(path.join(ROOT, r)));
      expect(missing).toEqual([]);
    });
  }
});

describe("the demo account table matches the seed", () => {
  const seeded = new Set((read("src/seed.js").match(/[a-z][a-z.]*@inplace\.care/g) || []));

  test("every demo email in CLAUDE.md is actually seeded", () => {
    const documented = new Set((read("CLAUDE.md").match(/[a-z][a-z.]*@inplace\.care/g) || []));
    const ghosts = [...documented].filter((e) => !seeded.has(e));
    // README once advertised pete@ / betty@ / david.lee@ — none of which the seed had created
    // for months. A screenshot run went down the wrong path before anyone noticed.
    expect(ghosts).toEqual([]);
  });

  test("every seeded account is documented in CLAUDE.md", () => {
    const documented = new Set((read("CLAUDE.md").match(/[a-z][a-z.]*@inplace\.care/g) || []));
    const undocumented = [...seeded].filter((e) => !documented.has(e));
    expect(undocumented).toEqual([]);
  });
});

describe("the architecture doc exists and is wired to its generator", () => {
  test("docs/ARCHITECTURE.md is present", () => {
    expect(fs.existsSync(path.join(ROOT, "docs/ARCHITECTURE.md"))).toBe(true);
  });

  test("package.json exposes gen:architecture", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["gen:architecture"]).toBeTruthy();
  });

  test("CLAUDE.md sends the reader to it", () => {
    expect(read("CLAUDE.md")).toMatch(/docs\/ARCHITECTURE\.md/);
  });
});
