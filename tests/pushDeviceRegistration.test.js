// "Why don't I get push notifications?" — answered with data, not settings advice.
// (v1.105.151)
//
// Pete: "why don't i get push notifications when i don't get messages in app… i know the other
// people get notifications, but I don't."
//
// The reachability endpoint (v1.105.144) said it outright. He had three registered devices:
//
//     web ref…DlBS-h    fails=0  everWorked=true
//     android ref…PkOYQc fails=0 everWorked=true
//     web ref…kvqehU    fails=0  everWorked=true
//
// and NO ios token, while testing on an iPhone. Julia, who does get notifications, has one:
// `ios ref…4E7F0F`. So every message push he was owed went out successfully — to a laptop and
// an Android build he was not holding.
//
// The self-repair in checkPushHealth exists to catch precisely this, and could never fire.

const { code } = require("./helpers/source");
const utils = code("public/js/utils.js");
const push = code("src/routes/push.js");
const devices = code("src/utils/pushDevices.js");
const { deviceKind } = require("../src/utils/pushDevices");

describe("what kind of device a subscription is", () => {
  test("a native token names its platform", () => {
    expect(deviceKind("native://ios/abc123")).toBe("ios");
    expect(deviceKind("native://android/abc123")).toBe("android");
  });

  test("anything else is Web Push", () => {
    expect(deviceKind("https://web.push.apple.com/QDf...")).toBe("web");
    expect(deviceKind("https://fcm.googleapis.com/fcm/send/x")).toBe("web");
  });

  test("nothing at all does not throw or claim a platform", () => {
    expect(deviceKind(null)).toBe("web");
    expect(deviceKind("")).toBe("web");
  });

  test("it is defined once", () => {
    // Three readers now — the admin reachability view, /api/push/status, and the client's
    // self-repair. Three copies of this regex is three chances to disagree about whether
    // someone's phone is registered.
    expect(devices).toMatch(/function deviceKind\(endpoint\)/);
    expect(push).toMatch(/require\("\.\.\/utils\/pushDevices"\)/);
    expect(code("src/routes/admin/maintenance.js")).toMatch(/utils\/pushDevices"\)\.deviceKind/);
  });
});

describe("the health check asks about THIS device", () => {
  test("status reports which platforms are registered, not just how many", () => {
    expect(push).toMatch(/const platforms = \[\.\.\.new Set\(rows\.map\(\(r\) => deviceKind\(r\.endpoint\)\)\)\]/);
    expect(push).toMatch(/platforms,/);
  });

  test("the old question — any device at all — is gone from the native branch", () => {
    // It was `status.userSubscriptions === 0`. His was 3, so the more devices he had, the more
    // certain the check was that everything was fine.
    expect(utils).toMatch(/const missing = platforms \? \(mine \? !platforms\.includes\(mine\) : platforms\.length === 0\)/);
  });

  test("it registers when this platform is missing", () => {
    expect(utils).toMatch(/if \(missing && typeof subscribeNativePush === 'function'\)/);
  });

  test("an older server still gets the old behaviour rather than nothing", () => {
    // A client that ships before the server does must not stop repairing itself.
    expect(utils).toMatch(/: status\.userSubscriptions === 0; \/\/ older server/);
  });
});

describe("and the thing he suspected was not it", () => {
  const messages = code("src/routes/messages.js");

  test("the sender is excluded from the push loop by the query itself", () => {
    // "possibly because i started the chat?" — a fair guess, and the reason it is not the
    // answer: members is already everyone BUT you, so starting a thread cannot suppress the
    // pushes for messages sent to you in it.
    expect(messages).toMatch(/SELECT user_id FROM conversation_members WHERE conversation_id = \? AND user_id != \?/);
  });

  test("nor is it the notification preference", () => {
    // sendPushToUser only consults push_<eventType> when an eventType is passed, and the
    // message path passes none.
    const send = messages.slice(messages.indexOf("const shouldPush = makeShouldPush(req);"));
    expect(send.slice(0, 700)).toMatch(/data: \{ type: "message", senderId: userId, conversationId: convId \},\s*\n\s*\}\)\.catch/);
  });
});

// ─── v1.105.154 — the prompt was silenced by a flag, not by the truth ───
//
// Pete, still, weeks on: "I have yet to get a single push notification from messages… other
// people get them, but I dont."
//
// The reachability view: his account has two web subscriptions and an android one, and NO ios
// token, while he uses an iPhone. Julia, who does get them, has `ios`. So the notifications
// are real and going to devices he is not holding.
//
// NotificationPrompt exists to notice exactly this and offer the fix, and it was returning
// early on `localStorage.native_push_registered` — a memory that registration happened once,
// on this device, at some point. A token pruned after repeated failures, rotated by iOS, or
// never saved at all leaves that flag set and the prompt hidden forever.
describe("the notification prompt trusts the server, not this browser's memory", () => {
  const prompt = code("public/js/components/NotificationPrompt.js");

  test("it asks whether a device is registered for THIS platform", () => {
    expect(prompt).toMatch(/const res = await apiFetch\('\/api\/push\/status'\)/);
    expect(prompt).toMatch(/registeredHere = mine \? status\.platforms\.includes\(mine\) : status\.platforms\.length > 0;/);
  });

  test("no device registered → it shows, whatever the flag says", () => {
    expect(prompt).toMatch(/localStorage\.removeItem\('native_push_registered'\)/);
    expect(prompt).toMatch(/if \(registeredHere === false\) \{/);
  });

  test("registered → it stays quiet and the flag is brought back in step", () => {
    expect(prompt).toMatch(/if \(registeredHere === true\) \{/);
    expect(prompt).toMatch(/localStorage\.setItem\('native_push_registered', '1'\); \/\/ keep the two in step/);
  });

  test("a dismissal does not outrank a phone that cannot receive anything", () => {
    // A dismissal was about a prompt, not a promise to stay silent while notifications are
    // broken. The dismissal check only applies on the path where we could not ask the server.
    // helpers/source strips own-line comments, so the slice is bounded by code.
    const start = prompt.indexOf("if (registeredHere === false)");
    const branch = prompt.slice(start, prompt.indexOf("const nativeRegistered", start));
    expect(branch).not.toMatch(/push_prompt_dismissed/);
  });

  test("if the server cannot be asked, the old behaviour stands", () => {
    // Offline, or an older server: fall back to what the device remembers rather than
    // nagging someone whose push works fine.
    expect(prompt).toMatch(/let registeredHere = null; \/\/ null = could not ask/);
    expect(prompt).toMatch(/const dismissedOffline = localStorage\.getItem\('push_prompt_dismissed'\);/);
  });

  test("the disabled branch it replaced is gone, not left switched off", () => {
    expect(prompt).not.toMatch(/if \(false\)/);
  });
});
