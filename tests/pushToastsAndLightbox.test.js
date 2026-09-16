// v1.107.7 — two client bugs from Pete's feedback, pinned at the source.
const fs = require("fs");
const path = require("path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "public", "js", f), "utf8");

describe("native push listeners are installed once", () => {
  const src = read("utils.js");
  test("exactly one place adds the four push listeners", () => {
    expect((src.match(/addListener\('pushNotificationReceived'/g) || []).length).toBe(1);
    expect((src.match(/addListener\('registration'/g) || []).length).toBe(1);
  });
  test("subscribe and token-refresh both go through ensureNativePushListeners", () => {
    const sub = src.slice(src.indexOf("const subscribeNativePush"), src.indexOf("const saveNativePushToken"));
    expect(sub).toMatch(/await ensureNativePushListeners\(PushNotifications\)/);
    const refresh = src.slice(src.indexOf("const initNativeTokenRefresh"), src.indexOf("// Check push subscription health"));
    expect(refresh).toMatch(/ensureNativePushListeners\(PushNotifications\)/);
    expect(refresh).not.toMatch(/addListener/);
  });
  test("a badge-only push shows no toast, and a repeat is shown once", () => {
    const fn = src.slice(src.indexOf("addListener('pushNotificationReceived'"), src.indexOf("addListener('pushNotificationActionPerformed'"));
    expect(fn).toMatch(/if \(!text\) return;/);
    expect(fn).toMatch(/lastToast\.text === text/);
    expect(fn).not.toMatch(/'New notification'/);
  });
});

describe("the chat photo viewer keeps its zoom", () => {
  const src = read("components/Messages.js");
  test("the lightbox is a top-level component, not one declared inside render", () => {
    const top = src.indexOf("const MessagePhotoLightbox = ");
    const messages = src.indexOf("const Messages = ");
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(messages);
    expect(src).not.toMatch(/const LightboxInner = /);
    expect(src).toMatch(/React\.createElement\(MessagePhotoLightbox,/);
  });
});

describe("the caregiver map", () => {
  const src = read("components/Caregivers.js");
  const block = src.slice(src.indexOf("const isAssigned = cg.isAssigned"), src.indexOf("markersRef.current.push(marker);"));
  test("shows a quick bio on the pin", () => {
    expect(block).toMatch(/quickBio/);
    expect(block).toMatch(/\$\{esc\(quickBio\)\}/);
  });
  test("escapes every caregiver-typed value it puts into Leaflet HTML", () => {
    expect(block).toMatch(/const displayName = esc\(privacyName/);
    expect(block).not.toMatch(/\$\{\(cg\.specialties \|\| \[\]\)\.join/);
    expect(block).not.toMatch(/\$\{cg\.bio/);
  });
});
