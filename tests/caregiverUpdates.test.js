/**
 * v1.146.0 — updates from InPlace to every caregiver. The integration suite covers the flow
 * (tests/integration/caregiverUpdates.itest.js); these pin the rules a refactor could quietly
 * break: no message content in the push, onboarding caregivers still get the push, and the
 * card + history + admin tab are wired where Pete will look for them.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const { code } = require("./helpers/source");

describe("caregiver updates", () => {
  const { validate, KINDS } = require("../src/routes/caregiverUpdates")._test;

  test("validate needs a title and a message, and defaults an unknown kind to tip", () => {
    expect(validate({ title: "", body: "x" }).error).toBeTruthy();
    expect(validate({ title: "x", body: "" }).error).toBeTruthy();
    expect(validate({ kind: "spam", title: " Hi ", body: " There " })).toEqual({ kind: "tip", title: "Hi", body: "There" });
    expect(KINDS).toEqual(["tip", "news", "thanks"]);
  });

  test("the push never carries the title or the message", () => {
    const src = code("src/routes/caregiverUpdates.js");
    const push = src.slice(src.indexOf('title: "From InPlace"'), src.indexOf('"caregiver_update").catch'));
    expect(push.length).toBeGreaterThan(20);
    expect(push).not.toMatch(/v\.title|v\.body/);
  });

  test("it is an account push, so a caregiver still waiting on ID review gets it", () => {
    const src = code("src/utils/careAccess.js");
    const set = src.slice(src.indexOf("ACCOUNT_PUSH_TYPES = new Set"), src.indexOf("]);", src.indexOf("ACCOUNT_PUSH_TYPES = new Set")));
    expect(set).toContain('"caregiver_update"');
  });

  test("wired into Home, My Account, Admin and the build", () => {
    expect(code("public/js/components/CaretakerHub.js")).toContain("<CaregiverUpdateCard />");
    expect(code("public/js/components/MyAccount.js")).toContain("<CaregiverUpdatesHistory />");
    expect(code("public/js/components/AdminPanel.js")).toContain("AdminCaregiverUpdatesTab");
    const build = code("scripts/build-client.js");
    expect(build).toContain("js/components/CaregiverUpdates.js");
    expect(build).toContain("js/components/AdminCaregiverUpdates.js");
    expect(build.indexOf("js/components/CaregiverUpdates.js")).toBeLessThan(build.indexOf("js/components/CaretakerHub.js"));
  });
});
