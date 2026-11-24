// v1.105.31 — the test helper that reads source, tested.
//
// Found while writing the collapse test. The obvious implementation —
//
//     src.replace(/\/\*[\s\S]*?\*\//g, "")
//
// — is wrong on real code, and wrong in the direction that hides failures rather than
// causing them. Reimbursements.js contains `accept="image/*,application/pdf"`. The `/*`
// inside that STRING opens a block comment as far as the regex is concerned, and the match
// runs to the next `*/`, deleting about nine thousand characters of real code.
//
// A positive assertion fails loudly when that happens, which is how it was caught. A
// NEGATIVE assertion — "this call must not appear" — passes silently, because the code it
// was meant to forbid had already been deleted. A test that cannot fail is worse than no
// test: it reports a safety property it never checked.

const { raw, code } = require("./helpers/source");

describe("code() does not treat string contents as comments", () => {
  test("the actual regression: accept=\"image/*\" does not eat the file", () => {
    const src = raw("public/js/components/Reimbursements.js");
    const naive = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const good = code("public/js/components/Reimbursements.js");

    // The string that causes it is really there.
    expect(src).toContain('accept="image/*,application/pdf"');
    // The naive version loses a lot of real code; ours does not.
    expect(good.length - naive.length).toBeGreaterThan(5000);
    // And specifically: a constant the collapse test asserts on survives.
    // v1.105.32 — the canary moved, and the move is the lesson. It used to be `const SETTLED`,
    // declared inside the swallowed region. That declaration got hoisted to the top of the
    // component so the card header could share the count, which put it BEFORE the
    // accept="image/*" string and therefore outside the damage — the assertion then failed
    // loudly, which is the correct behaviour for a canary that has wandered out of the mine.
    // `const ordered` sits between that string and the next `*/`, which is where it must be.
    expect(good).toContain("const ordered");
    expect(naive).not.toContain("const ordered");
  });

  test("line-owning comments ARE removed — that is the whole job", () => {
    const good = code("public/js/components/Reimbursements.js");
    expect(good).not.toMatch(/^\s*\/\/ /m);
  });

  test("a multi-line block comment is removed entirely", () => {
    // v1.105.36 — this asserted on "collapse the settled tail", which lives in a `//` LINE
    // comment. Breaking code()'s BLOCK-comment branch left the test green, so the branch
    // every migrated negative assertion depends on had no coverage at all. Verified by
    // mutation. These two phrases sit inside multi-line `{/* … */}` JSX blocks; the first
    // is on the block's OPENING line, the second several lines in, so a strip that only
    // drops the opener would still fail.
    const good = code("public/js/components/Reimbursements.js");
    const raw_ = raw("public/js/components/Reimbursements.js");
    expect(raw_).toMatch(/\{\/\* v1\.105\.30 — the two halves of the same problem/);
    expect(good).not.toMatch(/the two halves of the same problem/);
    expect(good).not.toMatch(/an itemised till roll and the card slip are often two photos/);
  });

  test("code sharing a line with a trailing comment is kept", () => {
    // `const x = 1; // why` must not lose `const x = 1;`.
    const good = code("public/js/components/Reimbursements.js");
    expect(good).toMatch(/const \[receipts, setReceipts\] = useState\(\[\]\);/);
  });

  test("raw() is untouched, for 'is it on the page' assertions", () => {
    expect(raw("public/js/components/Reimbursements.js")).toMatch(/^\s*\/\//m);
  });
});
