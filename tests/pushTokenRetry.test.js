/**
 * A push token that failed to save is tried again. (v1.106.48)
 *
 * Pete's iPhone logged five of these in one session, riding along with a feedback submission:
 *   "NativePush: failed to save refreshed token: ApiTimeoutError"
 *
 * He had patchy internet at the time and has not noticed a missing notification, so the
 * likeliest reading is the boring one. That is not the point. Both save paths gave up after a
 * single attempt and logged, and that is wrong whatever caused the failure: APNs hands the
 * device a NEW token when it rotates, the server keeps the old one, and every push after that
 * goes to an address nobody is at — with nothing on the phone or the server saying so. A
 * caregiver stops being reachable and finds out by missing a visit.
 */
const { code } = require("./helpers/source");

// The module is a browser bundle, so the function is exercised through a small harness rather
// than required: what matters is the retry behaviour, and that is testable directly.
const src = code("public/js/utils.js");

/** Rebuild saveNativePushToken in isolation with a stubbed apiFetch and no real waiting. */
function loadSaver({ responses, throws = [] }) {
  const calls = [];
  const logs = [];
  const body = src.slice(src.indexOf("const saveNativePushToken"), src.indexOf("// on app startup (after login)"));
  const factory = new Function("apiFetch", "setTimeout", "console", "window", `
    ${body.replace("const saveNativePushToken = window.saveNativePushToken =", "const saveNativePushToken =")}
    return saveNativePushToken;
  `);
  const apiFetch = async (url, opts) => {
    const i = calls.length;
    calls.push({ url, body: JSON.parse(opts.body) });
    if (throws[i]) throw new Error(throws[i]);
    return responses[i] !== undefined ? responses[i] : responses[responses.length - 1];
  };
  // Waiting is the one thing not worth doing for real in a test.
  const fastTimeout = (fn) => fn();
  const fakeConsole = { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) };
  return { save: factory(apiFetch, fastTimeout, fakeConsole, {}), calls, logs };
}

const OK = { ok: true, status: 200 };
const SERVER_ERR = { ok: false, status: 503 };
const REFUSED = { ok: false, status: 401 };

describe("saving the token", () => {
  test("one attempt when it works", async () => {
    const { save, calls } = loadSaver({ responses: [OK] });
    await expect(save("tok", "ios")).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ token: "tok", platform: "ios" });
  });

  test("a timeout is retried, and the second attempt can succeed", async () => {
    // Pete's exact case: ApiTimeoutError on a patchy connection.
    const { save, calls } = loadSaver({ responses: [null, OK], throws: ["ApiTimeoutError: Request timed out"] });
    await expect(save("tok", "ios")).resolves.toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("three attempts, then it gives up and says so", async () => {
    const { save, calls, logs } = loadSaver({ responses: [], throws: ["ApiTimeoutError", "ApiTimeoutError", "ApiTimeoutError"] });
    await expect(save("tok", "android")).resolves.toBe(false);
    expect(calls).toHaveLength(3);
    expect(logs.join("\n")).toMatch(/gave up saving .* after 3 attempts/);
  });

  test("a 5xx is retried too — that is a blip, not an answer", async () => {
    const { save, calls } = loadSaver({ responses: [SERVER_ERR, OK] });
    await expect(save("tok", "ios")).resolves.toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("a 4xx is NOT retried — the server decided, and asking twice repeats the answer", async () => {
    const { save, calls } = loadSaver({ responses: [REFUSED] });
    await expect(save("tok", "ios")).resolves.toBe(false);
    expect(calls).toHaveLength(1);
  });

  test("a non-ok response counts as a failure, not a save", async () => {
    // apiFetch resolves for a 4xx/5xx as well, so `await` alone proves nothing. The original
    // code only caught THROWS, which is the other half of the same gap.
    const { save } = loadSaver({ responses: [SERVER_ERR, SERVER_ERR, SERVER_ERR] });
    await expect(save("tok", "ios")).resolves.toBe(false);
  });

  test("it reports which attempt worked, so a flaky link is visible in the log", async () => {
    const { save, logs } = loadSaver({ responses: [SERVER_ERR, OK] });
    await save("tok", "ios");
    expect(logs.join("\n")).toMatch(/saved on attempt 2/);
  });
});

describe("both callers use it", () => {
  test("the first registration does", () => {
    const first = src.slice(src.indexOf("PushNotifications.addListener('registration'"), src.indexOf("// Listen for registration errors"));
    expect(first).toMatch(/saveNativePushToken\(token\.value/);
    expect(first).not.toMatch(/failed to save token to server/);
  });

  test("and so does the refresh — the path that actually logged five failures", () => {
    // v1.107.7 — a rotated token arrives on the ONE registration listener, which retries.
    const listeners = src.slice(src.indexOf("const ensureNativePushListeners"), src.indexOf("const subscribeNativePush"));
    expect(listeners).toMatch(/addListener\('registration'[\s\S]*?saveNativePushToken\(token\.value/);
    const refresh = src.slice(src.indexOf("const initNativeTokenRefresh"));
    expect(refresh).toMatch(/ensureNativePushListeners\(PushNotifications\)/);
    expect(src).not.toMatch(/failed to save refreshed token/);
  });

  test("neither one still posts to the endpoint directly", () => {
    // One implementation: a second inline post is how one of them stops retrying later.
    const after = src.slice(src.indexOf("const saveNativePushToken"));
    expect((after.match(/'\/api\/push\/subscribe-native'/g) || []).length).toBe(1);
  });
});
