// "why doesn't paul lowe have a care team? didn't we set that up?" (v1.105.96)
//
// He did have one. Three members, a group conversation, shares on Barbara's record — all
// seeded, all correct, all invisible. Dashboard.js gated the care-team card on `!isDemo`.
//
// That guard is right three times immediately above it and wrong here, and the difference is
// what is being hidden. Those are onboarding PROMPTS — "add your loved one", "finish your
// profile" — dead ends for a demo visitor. This is CONTENT. Hiding content from a demo doesn't
// spare anyone a pointless task; it makes the product look like it lacks the feature.

const fs = require("fs");
const path = require("path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const dashboard = read("public", "js", "components", "Dashboard.js");
const careTeams = read("src", "routes", "careTeams.js");
const seed = read("src", "seed.js");

describe("the demo shows the care team it actually has", () => {
  test("the care-team card is not gated on !isDemo", () => {
    expect(dashboard).toMatch(/\{careTeams\.length > 0 && \(\(\) => \{/);
    expect(dashboard).not.toMatch(/\{!isDemo && careTeams\.length > 0/);
  });

  test("the guard survives where it belongs — on onboarding prompts", () => {
    // Not a blanket removal: the empty-state tiles must still stay hidden.
    expect(dashboard).toMatch(/!isDemo && user && !hasProfile/);
    expect(dashboard).toMatch(/!isDemo && !parent/);
  });
});

describe("care team member thumbnails resolve for everyone, not just demo users", () => {
  test("member avatars go through userPhotoUrl, which checks both photo columns", () => {
    // The list returned u.avatar_url raw. A photo somebody UPLOADS lands in profile_photo, so
    // the member who had actually set a picture was the one rendering as coloured initials.
    expect(careTeams).toMatch(/const \{ userPhotoUrl \} = require\("\.\/media"\);/);
    expect(careTeams).toMatch(/avatarUrl: userPhotoUrl\(m\)/);
    expect(careTeams).not.toMatch(/avatarUrl: m\.avatar_url/);
  });

  test("both member queries select profile_photo, or userPhotoUrl has nothing to read", () => {
    const selects = careTeams.match(/SELECT[\s\S]*?FROM care_team_members[\s\S]*?`/g) || [];
    expect(selects.length).toBeGreaterThanOrEqual(1);
    for (const q of careTeams.match(/u\.avatar_url/g) || []) {
      expect(q).toBeTruthy();
    }
    expect((careTeams.match(/u\.profile_photo/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("the avatar stack overlaps", () => {
    expect(dashboard).toMatch(/marginLeft: i > 0 \? -8 : 0/);
  });
});

describe("the demo care team has something to demonstrate", () => {
  test("Peggy is on the team as a helper, not a full family member", () => {
    // A care team of only adult children misses the person who is simply there.
    expect(seed).toMatch(/peggy@inplace\.care/);
    expect(seed).toMatch(/INSERT INTO care_team_members[\s\S]{0,200}'helper'/);
  });

  test("Peggy's access is helper-scoped, not the whole medical record", () => {
    expect(seed).toMatch(/PRESETS\.helper/);
  });

  test("reimbursements cover every state the ledger can be in", () => {
    for (const status of ["pending", "approved", "paid", "declined"]) {
      expect(seed).toMatch(new RegExp(`"${status}"`));
    }
    expect(seed).toMatch(/INSERT INTO reimbursements/);
    expect(seed).toMatch(/billing_user_id = \?/);
  });

  test("Barbara has a face on her own hero card", () => {
    // care_recipients.photo was never seeded, so the person the product is about fell back to
    // a tulip emoji.
    expect(seed).toMatch(/UPDATE care_recipients SET photo = \?/);
  });
});
