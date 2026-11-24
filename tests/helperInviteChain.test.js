// The chain that turns a Helper invite into a helper account. (v1.105.94)
//
// v1.105.93 shipped the `helper` role and HelperHub, and NOTHING could reach them:
// RegisterPage hardcoded `setTrack('family')` for every care-team invite, so Peggy would have
// signed up as family and landed on a dashboard built around requesting care, payments and
// scheduling — none of it hers.
//
// That is the "working feature on a screen nobody sees" class, which is on the Up Next sweep
// list. I logged it in the morning and introduced another instance of it in the evening.
//
// Four links, all of which have to be right. These tests pin each one, because a break in any
// single link is silent — the person just ends up with the wrong kind of account.

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const careTeams = read("src/routes/careTeams.js");
const manage = read("public/js/components/CareTeamManage.js");
const app = read("public/js/app.js");
const register = read("public/js/components/RegisterPage.js");
const auth = read("src/routes/auth.js");

describe("link 1 — the invite may say 'helper'", () => {
  test("the server accepts it", () => {
    expect(careTeams).toMatch(/\["member", "viewer", "care_recipient", "helper"\]/);
  });

  test("the Helper preset sends it", () => {
    expect(manage).toMatch(/name === 'helper' \? 'helper'/);
  });
});

describe("link 2 — the invite role reaches the registration page", () => {
  test("app.js passes it as prefilledRole", () => {
    expect(app).toMatch(/inviteInfo\?\.role === 'helper' \? 'helper' : null/);
  });
});

describe("link 3 — registration selects the helper track", () => {
  test("it no longer hardcodes family for every invite", () => {
    expect(register).not.toMatch(/if \(isInviteFlow && !track\) \{\s*setTrack\('family'\);/);
    expect(register).toMatch(/setTrack\(prefilledRole === 'helper' \? 'helper' : 'family'\)/);
  });
});

describe("link 4 — the role actually posted is 'helper'", () => {
  test("the track maps through to the request body", () => {
    expect(register).toMatch(/track === 'helper' \? 'helper'/);
  });

  test("and the server accepts that role on register", () => {
    // Checked by line, because "Role must be..." appears three times in auth.js and an earlier
    // edit landed on the wrong one.
    const lines = auth.split("\n");
    const registerGuards = lines.filter((l) => l.includes('["family", "caregiver", "care_for", "helper"]'));
    expect(registerGuards.length).toBeGreaterThanOrEqual(2); // signup-intent AND register
  });
});

describe("the fallback if a capability set were ever missing", () => {
  test("a helper's share defaults to view-shaped, not edit-shaped", () => {
    // Capabilities override this, but a helper defaulting to 'edit' would hand a neighbour the
    // run of the record if one were ever absent.
    expect(careTeams).toMatch(/\["viewer", "helper"\]\.includes\(invite\.role\)/);
  });
});
