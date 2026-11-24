// The decline button only appears where declining is possible. (v1.105.100)
//
// Julia pressed "Can't make it" and got "Care request not found". Twice — she reported it on
// Aug 18 and again on Aug 19 after I said it was fixed.
//
// v1.105.91 fixed the SERVER to recognise offered_to_caregiver_id. What it did not fix is that
// the button rendered on every job that was not your own, including open-pool jobs where nobody
// was named. The server correctly refuses those: you decline an open job by not claiming it,
// and declining a job you were never offered has nothing to tell a family.
//
// Compounding it, dashboard.js expires an exclusive offer by clearing offered_to_caregiver_id
// and reverting the session to 'open' — so a request that WAS hers becomes an open job when the
// window lapses, and the button that worked yesterday silently stops working.

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const readCode = (p) =>
  read(p).split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

const hub = read("public/js/components/CaretakerHub.js");
const hubCode = readCode("public/js/components/CaretakerHub.js");
const dash = readCode("src/routes/dashboard.js");

describe("the server says whether a job is yours to answer", () => {
  test("isDirectedAtMe is computed from both columns", () => {
    // offered_to_caregiver_id is what booking a specific caregiver sets; caregiver_id is what a
    // claim sets. Either means she was named.
    expect(dash).toMatch(/isDirectedAtMe: s\.offered_to_caregiver_id === profile\.id \|\| s\.caregiver_id === profile\.id/);
  });
});

describe("the button appears only where it can work", () => {
  test("Can't make it requires isDirectedAtMe", () => {
    const guards = hubCode.match(/!job\.isOwnRequest && job\.isDirectedAtMe &&/g) || [];
    expect(guards.length).toBe(2);   // both job-card sites
  });

  test("an open job offers 'Not for me' instead", () => {
    const alts = hubCode.match(/!job\.isOwnRequest && !job\.isDirectedAtMe &&/g) || [];
    expect(alts.length).toBe(2);
    expect(hub).toMatch(/Not for me/);
  });

  test("the two are mutually exclusive — never both, never neither", () => {
    // Every job that is not your own gets exactly one of them.
    const canDecline = (hubCode.match(/(?<!!)job\.isDirectedAtMe &&/g) || []).length;
    const notForMe = (hubCode.match(/!job\.isDirectedAtMe &&/g) || []).length;
    expect(canDecline).toBe(notForMe);
  });
});

describe("'Not for me' is a local preference, not a message to anyone", () => {
  test("it does not call the decline endpoint", () => {
    const fn = hubCode.slice(hubCode.indexOf("const hideOpenJob"), hubCode.indexOf("const hideOpenJob") + 500);
    expect(fn).not.toMatch(/apiFetch/);
  });

  test("it is stored on the device", () => {
    // A family should not be told that a caregiver they never approached passed on their job.
    expect(hubCode).toMatch(/localStorage\.setItem\('inplace\.hiddenOpenJobs'/);
  });

  test("storage failures cannot break the hub", () => {
    // localStorage throws in private mode and locked-down webviews — v1.105.35.
    const init = hubCode.slice(hubCode.indexOf("const [hiddenJobIds"), hubCode.indexOf("const hideOpenJob"));
    expect(init).toMatch(/catch \{ return new Set\(\); \}/);
  });

  test("a job directed at her is NEVER hidden this way", () => {
    // That one needs an answer; quietly removing it would turn a family's request into silence.
    expect(hubCode).toMatch(/j\.isDirectedAtMe \|\| !hiddenJobIds\.has\(j\.id\)/);
  });
});
