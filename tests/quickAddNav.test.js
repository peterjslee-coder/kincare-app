/**
 * v1.133.0 — the + in the middle of the phone's bottom bar.
 *
 * Pete, 11/18: "I want to be able to add wherever I am, and don't mind losing caregivers... I
 * just don't wanna lose the functionality of being able to find people on the map."
 */
const { code, raw } = require("./helpers/source");

const app = code("public/js/app.js");
const quick = code("public/js/components/QuickAdd.js");
const profile = code("public/js/components/CareProfile.js");
const dash = code("public/js/components/Dashboard.js");
const messages = code("public/js/components/Messages.js");
const phone = code("public/js/components/RecipientPhone.js");
const routes = code("src/routes/careRecipients.js");
const build = raw("scripts/build-client.js");

const familyBottom = (() => {
  const m = app.match(/const familyBottom = \[([\s\S]*?)\];/);
  return m ? m[1] : "";
})();

describe("the family's phone bar", () => {
  test("is Home · Loved One · + · Messages, then Account", () => {
    const ids = [...familyBottom.matchAll(/id: '([^']+)'/g)].map((x) => x[1]);
    expect(ids).toEqual(["dashboard", "care-profile", "_quick_add", "messages"]);
    expect(app).toMatch(/familyBottom\.push\(\{ id: 'account'/);
  });

  test("Caregivers left the bar but not the app: a card on Loved One opens the same page", () => {
    expect(familyBottom).not.toMatch(/'caregivers'/);
    expect(profile).toMatch(/data-testid="open-caregivers" onClick=\{\(\) => onNavigate\('caregivers'\)\}/);
    expect(app).toMatch(/currentPage === 'caregivers'\) return <Caregivers/);
  });

  test("the + slot renders the real button, and the menu is mounted once, for family", () => {
    expect(app).toMatch(/item\.isQuickAdd \? \(\s*typeof QuickAddButton !== 'undefined' \? <QuickAddButton/);
    expect(app).toMatch(/role === 'family' && typeof QuickAdd !== 'undefined' && <QuickAdd \/>/);
    expect(build).toMatch(/"js\/components\/QuickAdd\.js"/);
  });

  test("the desktop sidebar's action opens the same menu", () => {
    expect(app).toMatch(/item\.id === '_request_care'\s*\? \(\) => \{ setSidebarOpen\(false\); if \(window\.__openQuickAdd\) window\.__openQuickAdd\(null\)/);
  });
});

describe("the menu opens what already exists", () => {
  test("Log visit, Add event, Message and Request care, in that order", () => {
    const keys = [...quick.matchAll(/key: '([a-z]+)', label/g)].map((x) => x[1]);
    expect(keys).toEqual(["visit", "event", "message", "request"]);
  });

  test("each choice reuses the existing sheet or page", () => {
    expect(quick).toMatch(/<LogVisitSheet /);
    expect(quick).toMatch(/<CareEventFormModal /);
    expect(quick).toMatch(/window\.__navigateTo\('schedule'\)/);
    expect(quick).toMatch(/window\.__navigateTo\('messages'\)/);
  });

  test("Add event and Message are offered only when the server says so", () => {
    expect(quick).toMatch(/if \(selected\.canAddEvent\)/);
    expect(quick).toMatch(/if \(selected\.messageConversationId\)/);
    expect(quick).toMatch(/apiFetch\('\/api\/care-recipients\/quick-add'\)/);
  });

  test("Message shows her photo, not a chat icon", () => {
    expect(quick).toMatch(/selected\.photo\s*\? <img src=\{selected\.photo\}/);
  });

  test("it sits above the bar and below every modal", () => {
    expect(quick).toMatch(/const QUICK_ADD_Z = 950;/);
  });

  test("Messages opens the conversation even when it is already on screen", () => {
    expect(messages).toMatch(/addEventListener\('inplace:open-conversation'/);
  });

  test("the dashboard pills are gone; Next Up re-reads after an add", () => {
    expect(dash).not.toMatch(/\+ Request Care<\/button>/);
    expect(dash).not.toMatch(/\+ Log Visit<\/button>/);
    expect(dash).toMatch(/addEventListener\('inplace:quick-added'/);
  });

  test("the quick-add route is registered before /:id", () => {
    expect(routes.indexOf('router.get("/quick-add"')).toBeGreaterThan(-1);
    expect(routes.indexOf('router.get("/quick-add"')).toBeLessThan(routes.indexOf('router.get("/:id"'));
  });
});

describe("Betty's screen", () => {
  test("a waiting message stays until Got it, and says who started it", () => {
    expect(phone).toMatch(/s\.text\.waiting\.length > 0/);
    expect(phone).toMatch(/w\.isReply \? `\$\{w\.from\} wrote back` : `Message from \$\{w\.from\}`/);
    expect(phone).toMatch(/simple-screen\/text-ack/);
    expect(phone).not.toMatch(/s\.text\.unread > 0 && s\.text\.replies\.length > 0/);
  });

  test("the family sees 'saw it' under the message", () => {
    expect(messages).toMatch(/\{m\.seenBy\} saw it/);
    expect(messages).toMatch(/onSocketEvent\('message_acknowledged'/);
  });
});
