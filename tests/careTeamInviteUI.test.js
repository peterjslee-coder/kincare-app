// The capability picker, and the search that feeds it. (v1.105.79)
//
// Pete: "it's not useful if I have to have you do it for me." Capabilities existed from
// v1.105.78 but only over the API, so adding Julia as a viewer meant asking me to run a query.

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const readCode = (p) =>
  read(p).split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("--") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

const ui = read("public/js/components/CareTeamManage.js");
const uiCode = readCode("public/js/components/CareTeamManage.js");
const route = readCode("src/routes/careTeams.js");
const caps = require("../src/utils/capabilities");

describe("the client vocabulary matches what the server enforces", () => {
  test("every capability the server knows has a label in the UI", () => {
    const labelled = [...ui.matchAll(/\['([a-z_]+)',\s*"?'?/g)].map((m) => m[1]);
    for (const cap of caps.ALL) {
      expect(labelled).toContain(cap);
    }
  });

  test("the presets agree with the server's", () => {
    for (const name of ["member", "viewer", "helper"]) {
      const m = ui.match(new RegExp(`${name}: \\[([^\\]]*)\\]`));
      expect(m).not.toBeNull();
      const listed = m[1].split(",").map((x) => x.trim().replace(/['"]/g, "")).filter(Boolean);
      if (name === "member") continue; // built from CAP_LABELS, not a literal list
      expect(listed.sort()).toEqual([...caps.PRESETS[name]].sort());
    }
  });

  test("the old untrue 'read-only, cannot make changes' copy is gone", () => {
    // A viewer could log visits and tick off medication the whole time that line was on screen.
    expect(ui).not.toMatch(/Read-only access: see the schedule and care notes, but cannot make changes/);
  });
});

describe("search is scoped, because this is the door to a health record", () => {
  test("it does NOT reuse the global people search", () => {
    expect(uiCode).not.toMatch(/api\/connections\/search/);
    expect(uiCode).toMatch(/api\/care-teams\/\$\{careTeamId\}\/invite-search/);
  });

  test("the endpoint requires a connection or a shared team", () => {
    const fn = route.slice(route.indexOf('router.get("/:id/invite-search"'), route.indexOf('router.post("/:id/invite"'));
    expect(fn).toMatch(/FROM connections c/);
    expect(fn).toMatch(/c\.status = 'accepted'/);
    expect(fn).toMatch(/FROM care_team_members mine/);
    // A name match alone must never be enough.
    expect(fn).toMatch(/AND \(\s*EXISTS/);
  });

  test("only the team leader can search", () => {
    const fn = route.slice(route.indexOf('router.get("/:id/invite-search"'), route.indexOf('router.post("/:id/invite"'));
    expect(fn).toMatch(/membership\.role !== "leader"/);
  });

  test("someone not on the app is still reachable by exact email", () => {
    const fn = route.slice(route.indexOf('router.get("/:id/invite-search"'), route.indexOf('router.post("/:id/invite"'));
    expect(fn).toMatch(/LOWER\(u\.email\) = \?/);
  });
});

describe("capabilities travel from the picker to the share", () => {
  test("the invite posts them", () => {
    expect(uiCode).toMatch(/body: JSON\.stringify\(\{ email: target, role: inviteRole, capabilities: inviteCaps \}\)/);
  });

  test("the server validates against the known set rather than trusting the client", () => {
    expect(route).toMatch(/capabilities\.filter\(\(c\) => ALL_CAPS\.includes\(c\)\)/);
  });

  test("an empty set is refused on both sides", () => {
    expect(uiCode).toMatch(/inviteCaps\.length === 0/);
    expect(route).toMatch(/clean\.length === 0/);
  });

  test("changing a member's access updates the existing share, never inserts a duplicate", () => {
    const fn = route.slice(route.indexOf('router.put("/:id/members/:userId"'));
    expect(fn).toMatch(/UPDATE care_recipient_shares SET capabilities = \? WHERE id = \?/);
    expect(fn).toMatch(/if \(existing\)/);
  });
});

describe("the promises the screen makes", () => {
  test("it warns that a different email means a separate account", () => {
    expect(ui).toMatch(/a different address makes a separate account/);
  });

  test("it says the privacy statement will be required", () => {
    // v1.105.78 enforces it server-side; the invite screen should not surprise anyone.
    expect(ui).toMatch(/privacy statement before they can join/);
  });
});

describe("the member badge says what they can actually do (v1.105.85)", () => {
  test("it is derived from capabilities, not the role word", () => {
    // Pete, looking at Julia after she accepted: "it said 'member'. do i need to change her to
    // view only or is she just a member with limited capabilities?" She was full access —
    // role 'member' gives share permission 'edit', which maps to all eight capabilities.
    //
    // The trap was the NEXT step: "Change access" writes capabilities and not the role word,
    // so a viewer would have kept reading "Member". One source of truth, and it is the
    // capability set.
    expect(ui).toMatch(/const memberAccessLabel = \(m\) => \{/);
    expect(ui).toMatch(/return capsLabel\(m\.capabilities, m\.role\);/);
  });

  test("the raw role word is no longer rendered as the access label", () => {
    expect(uiCode).not.toMatch(/\{roleLabels\[m\.role\] \|\| m\.role\}/);
  });

  test("a leader is still shown as the leader", () => {
    expect(ui).toMatch(/if \(m\.role === 'leader'\) return 'Team Leader';/);
  });

  test("the server sends each member's capabilities for it to use", () => {
    expect(route).toMatch(/capabilities: require\("\.\.\/utils\/capabilities"\)\.capabilitiesFor\(/);
  });
});
