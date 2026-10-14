// Feedback says WHERE you were, not just which area. (v1.116.2)
//
// Pete, 10/14: "the feedback tool is useful but it's not capturing the page i'm on. seems
// like no matter where i look it always identifies me as being on 'admin page - family'."
//
// currentPage is one word for a whole area — every Admin tab is 'admin' — and the role was
// the account's base role, not the one being used. Now the snapshot taken when the button is
// tapped carries `where`: page › sub-page a screen publishes (the Admin tab) › heading in view.
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const fb = read("public/js/components/FeedbackButton.js");
const admin = read("public/js/components/AdminPanel.js");
const app = read("public/js/app.js");

test("the snapshot taken on open records where, and the report sends it", () => {
  expect(fb).toMatch(/contextSnapshotRef\.current = \{\s*where: describeWhere\(\),/);
  expect(fb).toMatch(/where: snapshot\.where \|\| PAGE_LABEL\(currentPage\)/);
});

test("the 'Captured' hint shows the same thing that gets sent", () => {
  expect(fb).toMatch(/Captured: ', contextSnapshotRef\.current\?\.where/);
});

test("a sub-page only counts on the page that published it", () => {
  expect(fb).toMatch(/sub\.page === currentPage/);
});

test("Admin publishes its active tab, and withdraws it on the way out", () => {
  expect(admin).toMatch(/window\.__inplaceSubPage = \{ page: 'admin', label: t \? t\.label : activeTab \}/);
  expect(admin).toMatch(/delete window\.__inplaceSubPage/);
});

test("the role is the one being used, not the account's first", () => {
  expect(app).toMatch(/<FeedbackButton currentPage=\{currentPage\} userRole=\{activeRole \|\| currentUser\?\.role\}/);
});

test("the admin ledger shows the finer location", () => {
  expect(admin).toMatch(/Page: \{fb\.pageContext\.where \|\| fb\.pageContext\.page\}/);
});

test("PAGE_LABEL title-cases page ids", () => {
  const m = /const PAGE_LABEL = (\(p\) => [^\n]+);/.exec(fb);
  const PAGE_LABEL = eval(m[1]);
  expect(PAGE_LABEL("care-team")).toBe("Care Team");
  expect(PAGE_LABEL(undefined)).toBe("Unknown");
});
