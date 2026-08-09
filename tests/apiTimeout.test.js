// v1.105.46 — every request gets a deadline.
//
// Pete, standing in Betty's kitchen with the nudge finally working: "I clicked ok, but it's
// just loading." Nothing in Sentry. Nothing in the server logs. Nothing in the database.
//
// Because the request never arrived. `fetch` has no default timeout — a phone on one bar
// opens a socket that never answers and the promise simply never settles. The spinner spins
// forever, no catch block runs, nothing is reported, and the person is left holding a phone
// that is doing nothing and saying nothing about it. Every save in this app could do that;
// the visit log is only where he happened to find it.
//
// The silence is the bug. A hang with no error is indistinguishable from a bug in the
// feature — which is exactly what we spent the last three versions discovering, twice.

const { code } = require("./helpers/source");

const utils = code("public/js/utils.js");
const route = code("src/routes/familyVisits.js");

describe("a request that never answers must still end", () => {
  test("there is a deadline, and an upload gets a longer one", () => {
    // A receipt photo on cellular legitimately takes a while; a JSON POST does not.
    expect(utils).toMatch(/const API_TIMEOUT_MS = 25000;/);
    expect(utils).toMatch(/const API_UPLOAD_TIMEOUT_MS = 120000;/);
    expect(utils).toMatch(/const timeoutMs = options\.timeoutMs \|\| \(isFormData \? API_UPLOAD_TIMEOUT_MS : API_TIMEOUT_MS\);/);
  });

  test("it aborts the actual request, not just the wait", () => {
    expect(utils).toMatch(/controller = new AbortController\(\);/);
    expect(utils).toMatch(/timer = setTimeout\(\(\) => controller\.abort\(\), timeoutMs\);/);
    expect(utils).toMatch(/signal: controller\.signal/);
  });

  test("a caller's own signal wins — we never stomp an explicit one", () => {
    expect(utils).toMatch(/if \(!options\.signal && typeof AbortController === 'function'\)/);
  });

  test("the timer is always cleared, on both paths", () => {
    // A leaked abort timer would fire mid-session and kill an unrelated request.
    const fn = utils.slice(utils.indexOf("const apiFetch"), utils.indexOf("// ─── IP Verification"));
    expect((fn.match(/clearTimeout\(timer\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("a timeout surfaces as a real, named error rather than a silent null", () => {
    // Existing catch blocks already say "check your connection and try again" — they just
    // never got the chance to run.
    expect(utils).toMatch(/err\?\.name === 'AbortError'/);
    expect(utils).toMatch(/e\.name = 'ApiTimeoutError';/);
    expect(utils).toMatch(/throw e;/);
  });

  test("and it reports itself, because a hang leaves no other trace", () => {
    expect(utils).toMatch(/reportClientError\(e, \{ page: url \}\)/);
    expect(utils).toMatch(/const reportClientError/);
  });

  test("the reporter does not route through apiFetch", () => {
    // Reporting a timeout through the thing that timed out is how you get no report.
    const rep = utils.slice(utils.indexOf("const reportClientError"), utils.indexOf("const apiFetch"));
    expect(rep).toMatch(/fetch\(API_BASE \+ '\/api\/client-error'/);
    expect(rep).not.toMatch(/apiFetch\(/);
    expect(rep).toMatch(/keepalive: true/);
  });
});

describe("and tapping Save twice does not log two visits", () => {
  test("same person, same recipient, same minute is one visit", () => {
    // Now that the client gives up at 25s, "I don't know if it landed" is a normal outcome
    // and the human response is to try again.
    expect(route).toMatch(/SELECT id FROM family_visits/);
    expect(route).toMatch(/WHERE care_recipient_id = \? AND user_id = \? AND visited_at = \?/);
    expect(route).toMatch(/created_at > NOW\(\) - INTERVAL '10 minutes'/);
  });

  test("the retry gets the ORIGINAL visit back, not an error", () => {
    // A 409 would be technically correct and useless: the person did what they wanted, and
    // the record exists. Hand them the record.
    expect(route).toMatch(/if \(dupe\) return res\.status\(201\)\.json\(\{ visit: await getOne\(db, dupe\.id\) \}\)/);
  });

  test("the check runs before the insert, not after", () => {
    expect(route.indexOf("SELECT id FROM family_visits")).toBeLessThan(route.indexOf("INSERT INTO family_visits"));
  });
});
