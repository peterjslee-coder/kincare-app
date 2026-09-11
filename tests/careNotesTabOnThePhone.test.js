// v1.105.190 — the Care Notes tab exists on the phone.
//
// Pete, Sep 11 2026: "julia still can't see care notes." Third report of the same thing.
// v1.105.153 built the tab and gated it on what the server says she may read. v1.105.184
// re-asked the server on foreground so a granted permission lands without a re-login. Both
// were right, and both edited getNavItems — the desktop sidebar. Julia's share row carries
// read_notes; /api/notes/mine/recipients lists Betty for her; her client was current. The
// caregiver BOTTOM bar was a fixed four items, so on the iPhone she uses the tab had never
// existed. Two fixes against a door on the other building.

const { code } = require("./helpers/source");
const app = code("public/js/app.js");

const bottom = app.slice(app.indexOf("const getBottomNavItems = () => {"), app.indexOf("const familyBottom = ["));

test("the caregiver bottom bar carries Care Notes when the server says there is something to read", () => {
  expect(bottom).toContain("if (sharedNotesRecipients > 0) cgBottom.push({ id: 'care-notes', icon: '📝', label: 'Care Notes' });");
});

test("it is gated on the same server answer as the sidebar, never on role", () => {
  const side = app.slice(app.indexOf("const getNavItems = () => {"), app.indexOf("const getBottomNavItems = () => {"));
  expect(side).toContain("if (sharedNotesRecipients > 0) {");
  expect(bottom).not.toMatch(/care-notes[^\n]*role ===/);
});

test("Account stays last, and the bar never exceeds five", () => {
  expect(bottom).toMatch(/cgBottom\.push\(\{ id: 'account'[^\n]*\);\s*return cgBottom;/);
  const cg = bottom.slice(bottom.indexOf("const cgBottom = ["), bottom.indexOf("return cgBottom;"));
  const items = (cg.match(/\{ id: '[a-z-]+', icon:/g) || []).length;
  expect(items).toBe(5);
});
