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
    // The JSX explanatory blocks in these components span many lines.
    const good = code("public/js/components/Reimbursements.js");
    expect(good).not.toMatch(/collapse the settled tail/);
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
