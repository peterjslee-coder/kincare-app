// Two screens that had grown into pages of scrolling. (v1.105.149)
//
// Pete: "let's talk collapsing screens. The reimbursement page...way too many. pages of
// scroll. collapse that thing pls. Care notes...same thing."
//
// Both already had a collapse, and both had it on the wrong axis:
//
//   Reimbursements (v1.105.31) folded the settled TAIL — fewer rows. But the length was never
//   the row COUNT, it was the row HEIGHT: every row rendered receipt thumbnails, attach and
//   ask buttons, decline reasons and payment detail whether anyone was looking or not, about
//   130 lines of JSX apiece.
//
//   Care Notes was collapsible as a whole section, which makes the choice "all of it or none
//   of it" on a record that grows forever.

const { code } = require("./helpers/source");
const reimb = code("public/js/components/Reimbursements.js");
const profile = code("public/js/components/CareProfile.js");

describe("a reimbursement is one line until you ask", () => {
  test("the detail is behind the expander, not rendered into every row", () => {
    expect(reimb).toMatch(/const open = expandedId === it\.id \|\| needsMe;/);
    expect(reimb).toMatch(/\{open && \(<React\.Fragment>/);
  });

  test("one row open at a time — 'expand all' is the page we started with", () => {
    expect(reimb).toMatch(/setExpandedId\(open \? null : it\.id\)/);
    expect(reimb).toMatch(/const \[expandedId, setExpandedId\] = useState\(null\);/);
  });

  test("a row that needs YOU is never collapsed", () => {
    // Tidying a screen by hiding the work gives you a shorter page that is worse. An approval
    // someone is waiting on, or a payment you are owed, stays open with its buttons.
    expect(reimb).toMatch(/const needsMe = meta\.isApprover && \['pending', 'approved'\]\.includes\(it\.status\);/);
    expect(reimb).toMatch(/cursor: needsMe \? 'default' : 'pointer'/);
    expect(reimb).toMatch(/onClick=\{needsMe \? undefined : \(\) => setExpandedId/);
  });

  test("the collapsed line still answers the question that decides an approval", () => {
    // Whether there IS a receipt is the fact you would otherwise open the row to learn, and
    // "no receipt" is not the same as a row that has not loaded.
    expect(reimb).toMatch(/\? `\$\{it\.receipts\.length\} receipt\$\{it\.receipts\.length === 1 \? '' : 's'\}`/);
    expect(reimb).toMatch(/: 'no receipt'\}<\/span>/);
  });

  test("the outcome banner survives collapsing", () => {
    // v1.98.12 made this durable because a vanishing toast was the original bug. Hiding it
    // behind a tap would be the same bug with more steps.
    const gateAt = reimb.indexOf("{open && (<React.Fragment>\n            {/* Approver: how to pay");
    const bannerAt = reimb.indexOf("{actionResult[it.id] && (");
    expect(bannerAt).toBeGreaterThan(-1);
    expect(bannerAt).toBeLessThan(gateAt === -1 ? reimb.length : gateAt);
  });

  test("the settled-tail collapse it already had is still there", () => {
    // Two collapses on different axes, both earning their place: fewer rows AND shorter rows.
    expect(reimb).toMatch(/const settled = rest\.filter\(\(x\) => SETTLED_STATUSES\.includes\(x\.status\)\)/);
    expect(reimb).toMatch(/showSettled \? settled : \[\]/);
  });
});

describe("care notes show the newest few", () => {
  test("a preview, not the whole history", () => {
    expect(profile).toMatch(/const NOTES_PREVIEW = 5;/);
    expect(profile).toMatch(/\(showAllNotes \? notes : notes\.slice\(0, NOTES_PREVIEW\)\)\.map/);
  });

  test("with a way to see all of them", () => {
    expect(profile).toMatch(/Show all \$\{notes\.length\} observations/);
    expect(profile).toMatch(/Show fewer/);
  });

  test("the button only exists when there is more to show", () => {
    expect(profile).toMatch(/notes\.length > NOTES_PREVIEW \? \[\(/);
  });

  test("the count in the header still tells the truth", () => {
    // Folding is not hiding: the header says how many there are either way.
    expect(profile).toMatch(/\{notes\.length\}/);
  });

  test("it is a 44px target", () => {
    const btn = profile.slice(profile.indexOf('key="__more"'), profile.indexOf('key="__more"') + 500);
    expect(btn).toMatch(/minHeight: 44/);
  });
});
