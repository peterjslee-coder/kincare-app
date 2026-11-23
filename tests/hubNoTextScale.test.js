// v1.153.1 — the InPlace Hub keeps its own text sizes under the Large/XL text setting.
// Betty's account has Large text on; `body.text-size-large div { font-size: inherit !important }`
// flattened her clock to the size of the date. Both halves must stay: the CSS exclusion, and the
// class on every Hub root (board, night screen, incoming call card).
const fs = require("fs");
const path = require("path");
const css = fs.readFileSync(path.join(__dirname, "../public/css/styles.css"), "utf8");
const src = fs.readFileSync(path.join(__dirname, "../public/js/components/RecipientPhone.js"), "utf8");

test("every inherit selector in the text-size blocks excludes .no-text-scale", () => {
  for (const size of ["large", "xlarge"]) {
    const m = css.match(new RegExp(`(body\\.text-size-${size} div[\\s\\S]*?)\\{\\s*font-size: inherit !important;`));
    expect(m).not.toBeNull();
    const selectors = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) expect(sel).toContain(":not(.no-text-scale):not(.no-text-scale *)");
  }
});

test("the board, the night screen and the call card all carry no-text-scale", () => {
  expect(src).toMatch(/className="simple-view hub-board no-text-scale"/);
  expect(src).toMatch(/data-testid="hub-night" className="no-text-scale"/);
  expect(src).toMatch(/data-testid="simple-incoming-call" className="no-text-scale"/);
});
