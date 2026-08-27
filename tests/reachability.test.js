// "Would a call actually reach this person?" — asked properly, once. (v1.105.144)
//
// This question has been unanswerable all week, and every attempt to answer it was inference
// from a single field. Pete: "julia's definitely not on the PWA, but on the ios version" —
// while user_client_info.platform says "web" for her. One of those is wrong, and guessing
// which is how the last three wrong answers happened.
//
// The endpoint answers it from the only table that decides it: push_subscriptions.

const { code } = require("./helpers/source");
const src = code("src/routes/admin/maintenance.js");

describe("what it reports", () => {
  test("it reads the table that actually decides delivery", () => {
    expect(src).toMatch(/FROM push_subscriptions WHERE user_id = \?/);
  });

  test("a native token and a Web Push subscription are told apart by endpoint shape", () => {
    // subscribe-native writes native://ios/<token>; Web Push writes the browser's URL.
    expect(src).toMatch(/native:\\\/\\\/\(\[a-z\]\+\)\\\//i);
  });

  test("'registered' is not the same as 'has ever worked'", () => {
    // A subscription with no successful send is a subscription that does not exist, however
    // healthy the row looks.
    expect(src).toMatch(/everWorked: !!s\.last_success_at/);
    expect(src).toMatch(/d\.failCount < 5/);
  });

  test("the summary names the failure mode that matters here", () => {
    // A Web Push subscription inside the native iOS app is delivered to nothing at all — the
    // WebView has no push service. That is invisible from every other screen we have.
    expect(src).toMatch(/only Web Push is registered — inside the native iOS app that arrives nowhere/);
    expect(src).toMatch(/no devices registered/);
  });
});

describe("what it deliberately does NOT report", () => {
  test("no push tokens, no endpoints", () => {
    // A push token is a credential for someone's phone. The kind and the dates are what a
    // diagnosis needs; the token is what an attacker needs.
    const route = src.slice(src.indexOf('router.get("/users/:id/reachability"'), src.indexOf("GET /api/admin/client-versions"));
    expect(route).not.toMatch(/endpoint: s\.endpoint/);
    expect(route).not.toMatch(/token/);
    expect(route).toMatch(/ref: ep\.slice\(-6\)/);
  });

  test("it is admin-only, like everything else in this file", () => {
    expect(src).toMatch(/router\.get\("\/users\/:id\/reachability", authenticate, checkAdmin, requireAdmin/);
  });
});
