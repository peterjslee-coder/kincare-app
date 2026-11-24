// Julia's two reports, and they are the same bug seen from both ends. (v1.105.184)
//
// "When I click on notifications I can see the notes, but they don't 'live' anywhere in the
// platform for me. It takes me to the 'find work' tab to see the notes, but when I click out of
// them I can't go back to them."
//
// "My 'clear notifications' button has disappeared. Annoying, because I can't clear
// notifications that I click on but can't access."

const { code } = require("./helpers/source");
const app = code("public/js/app.js");
const hub = code("public/js/components/CaretakerHub.js");

describe("the Care Notes tab appears when access is granted, not only at login", () => {
  test("the count is re-checked, not asked once", () => {
    // The tab exists only when this is above zero, and it was asked EXACTLY once on login.
    // Julia had no read access at that moment, so she had no tab — and when Pete ticked "read
    // care notes", nothing in her running app ever found out. A push could still deep-link her
    // INTO the notes, which is exactly why she could see them and had no way back: the
    // destination existed, the door did not.
    expect(app).toMatch(/const check = async \(\) => \{/);
    expect(app).toMatch(/document\.addEventListener\('visibilitychange', onVisible\)/);
    expect(app).toMatch(/window\.addEventListener\('focus', onVisible\)/);
  });

  test("and the listeners are cleaned up with the effect", () => {
    const block = app.slice(app.indexOf("const [sharedNotesRecipients"), app.indexOf("const [currentPage"));
    expect(block).toMatch(/removeEventListener\('visibilitychange', onVisible\)/);
    expect(block).toMatch(/removeEventListener\('focus', onVisible\)/);
  });

  test("a caregiver with nothing shared still gets no tab", () => {
    // v1.105.153's rule stands: never show a tab that can only explain why it is empty.
    expect(app).toMatch(/if \(sharedNotesRecipients > 0\) \{/);
  });
});

describe("one stuck notification can be cleared", () => {
  test("the button appears for a single unread, not only for two", () => {
    // It was `> 1`. With one stuck notification — the commonest case, and the one where you
    // most want it gone — the only way to clear it did not exist.
    expect(hub).toMatch(/\{unread\.length > 0 && <button onClick=\{\(\) => markRead\(unread\.map\(n => n\.id\)\)\}/);
    expect(hub).not.toMatch(/\{unread\.length > 1 && <button/);
  });
});
