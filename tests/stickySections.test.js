// Sections stay how you left them. (v1.105.171)
//
// Pete: "make all the menus collapsible on the care team and betty pages. it should stick,
// too...if I minimize the reimbursements because i don't really look at that...the next time
// i log in i want it minimized too. if I leave the care notes open because I return to that a
// lot, I want it to remain up."
//
// "The next time I log in" is the requirement, and it is the whole reason this is on the
// account rather than in localStorage: he uses the phone and the Mac.

const { code } = require("./helpers/source");
const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const prefs = code("public/js/uiPrefs.js");
const app = code("public/js/app.js");
const auth = read("src/routes/auth.js");
const db = read("src/models/database.js");

describe("it follows the account, not the device", () => {
  test("there is a column for it, added in MIGRATIONS_V2 and not the frozen list", () => {
    // The early `migrations` array explicitly says new statements there never execute on an
    // existing database.
    const v2 = db.slice(db.indexOf("const MIGRATIONS_V2 = ["));
    expect(v2).toMatch(/id: "027_ui_prefs"/);
    expect(v2).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_prefs TEXT/);
  });

  test("GET /api/auth/me actually returns it", () => {
    // A column missing from the explicit SELECT list never reaches the client, and the
    // feature fails silently by always looking like a fresh account.
    const selects = auth.match(/SELECT id, email, role, roles[^"]+FROM users WHERE id = \?/g) || [];
    expect(selects.length).toBeGreaterThanOrEqual(2);
    for (const sel of selects) expect(sel).toMatch(/ui_prefs/);
  });

  test("the app seeds it from the user at every place the user arrives", () => {
    // Four sites read accessibility_prefs from /me; a fifth that forgot this would leave
    // sections resetting on one login path only — the hardest kind of bug to be told about.
    const seeds = (app.match(/window\.__setUiPrefs\(data\.user\.ui_prefs\)/g) || []).length;
    const a11y = (app.match(/data\.user\.accessibility_prefs \? JSON\.parse/g) || []).length;
    expect(seeds).toBe(a11y);
    expect(seeds).toBeGreaterThanOrEqual(4);
  });

  test("nothing about this uses localStorage", () => {
    // A preference that only exists on the device he set it on is one he has to set twice.
    expect(prefs).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("the write is a background detail, never the interaction", () => {
  test("the toggle updates local state first and queues the save", () => {
    expect(prefs).toMatch(/setOpenLocal/);
    expect(prefs).toMatch(/queue\(key, value\)/);
  });

  test("rapid toggles coalesce into one request", () => {
    expect(prefs).toMatch(/setTimeout\(flush, 600\)/);
    expect(prefs).toMatch(/if \(timer\) clearTimeout\(timer\)/);
  });

  test("closing the app flushes what is pending", () => {
    // "Collapse a section, close the app" must not silently do nothing — the same lesson as
    // the one-tap attention cards in v1.105.129.
    expect(prefs).toMatch(/addEventListener\('pagehide'/);
    expect(prefs).toMatch(/keepalive: true/);
  });

  test("a failed save costs the preference, never the fold", () => {
    expect(prefs).toMatch(/\.catch\(\(\) =>/);
  });
});

describe("the server merges rather than overwrites", () => {
  const route = auth.slice(auth.indexOf('router.patch("/me/ui-prefs"'), auth.indexOf("// ─── PUT /api/auth/me ───"));

  test("it takes a patch of keys, not the whole blob", () => {
    // Sending the whole blob means the phone overwriting what the Mac just changed. Merging
    // per key makes two devices additive instead.
    expect(route).toMatch(/req\.body && req\.body\.patch/);
    expect(route).toMatch(/for \(const k of keys\) \{\s*\n\s*if \(patch\[k\] === null\) delete current\[k\];/);
  });

  test("a malformed stored blob does not lock the feature", () => {
    expect(route).toMatch(/catch \{ current = \{\}; \}/);
  });

  test("it is bounded — this is not a general key-value store on the users table", () => {
    expect(route).toMatch(/keys\.length > 50/);
    expect(route).toMatch(/k\.length > 80/);
    expect(route).toMatch(/Values must be primitives/);
  });

  test("it is its own route, not a profile update", () => {
    // PUT /api/auth/me validates a profile and returns the whole user. A chevron tap should
    // cost the smallest request the app makes.
    expect(auth).toMatch(/router\.patch\("\/me\/ui-prefs", authenticate/);
  });
});

describe("the app opening a section is not the same as a person choosing to", () => {
  test("there is a way to open one without remembering it", () => {
    expect(prefs).toMatch(/opts\.remember !== false/);
  });

  test("and the note deep-link uses it", () => {
    // He followed a push to a note. That is the app deciding to unfold the section, not him
    // choosing to keep it unfolded.
    const profile = code("public/js/components/CareProfile.js");
    expect(profile).toMatch(/setNotesOpen\(true, \{ remember: false \}\)/);
  });
});

describe("every section Pete named, plus the rest of both pages", () => {
  const profile = code("public/js/components/CareProfile.js");
  const team = code("public/js/components/CareTeamManage.js");
  const reimb = code("public/js/components/Reimbursements.js");
  const tasks = code("public/js/components/CareTasks.js");
  const events = code("public/js/components/CareEvents.js");

  const keys = {
    "lovedOne.notes": profile,       // "I want it to remain up"
    "lovedOne.preferences": profile,
    "lovedOne.kindred": profile,
    "lovedOne.health": profile,
    "lovedOne.permissions": profile,
    "lovedOne.careTasks": tasks,
    "lovedOne.careEvents": events,
    "careTeam.members": team,
    "careTeam.billing": team,
    "careTeam.caregivers": team,
    "careTeam.recentVisits": team,
    "careTeam.accessibility": team,
    "careTeam.reimbursements": reimb, // "if I minimize the reimbursements"
  };

  for (const [key, src] of Object.entries(keys)) {
    test(`${key} is remembered`, () => {
      expect(src).toContain(`useStickySection('${key}'`);
    });
  }

  test("no SECTION on these pages still uses a plain useState for its fold", () => {
    // The point of converting them all at once: one that remembers and one that does not,
    // side by side, reads as a bug in the one that does not.
    //
    // `doctorReportOpen` is deliberately exempt. It is not a section — it is a panel INSIDE
    // Health & Medications that clears its own contents every time it opens, so restoring it
    // open would restore an empty form nobody asked for.
    const folds = (src) =>
      (src.match(/const \[(\w*(?:Open|Expanded)\w*), set\w+\] = useState\(/g) || []);
    expect(folds(team)).toEqual([]);
    expect(folds(profile)).toEqual([
      "const [doctorReportOpen, setDoctorReportOpen] = useState(",
    ]);
  });

  test("keys are namespaced by page, so two sections cannot collide", () => {
    const all = Object.keys(keys);
    expect(new Set(all).size).toBe(all.length);
    for (const k of all) expect(k).toMatch(/^(lovedOne|careTeam)\./);
  });

  test("each default matches what the section did before, so nothing moves on upgrade", () => {
    // Converting a section must be invisible until he folds it.
    expect(profile).toContain("useStickySection('lovedOne.notes', true)");
    expect(profile).toContain("useStickySection('lovedOne.preferences', false)");
    expect(profile).toContain("useStickySection('lovedOne.kindred', false)");
    expect(team).toContain("useStickySection('careTeam.accessibility', false)");
  });
});

describe("every chevron sits at the end of its row", () => {
  // Pete: "i want to standardize where the collapse button is. in some places its at the end
  // of the text, in others it end-justified. I prefer end-justified."
  //
  // Four headers had it tucked in after the title, because those rows also carry buttons
  // ("+ Add task", "+ Assign", and Reimbursements' six) and the safe thing was to make the
  // title the control. That was the wrong trade: the chevron can be last in the row AND be
  // its own click target, which is what these assert.
  const files = [
    "public/js/components/CareTasks.js",
    "public/js/components/CareEvents.js",
    "public/js/components/Reimbursements.js",
    "public/js/components/CareTeamManage.js",
    "public/js/components/CareProfile.js",
  ];

  test("no chevron is glued to the end of the title text", () => {
    // `marginLeft: 8` on the chevron is the shape of "right after the words".
    for (const f of files) {
      const src = code(f);
      expect(src).not.toMatch(/marginLeft: 8, fontSize: 15[^}]*transform: \w+ \? 'rotate\(180deg\)'/);
    }
  });

  test("every fold header is a flex row that pushes the chevron right", () => {
    for (const f of files) {
      const src = code(f);
      const chevrons = (src.match(/transform: [\w.]+ \? 'rotate\(180deg\)' : 'rotate\(0\)'/g) || []).length;
      expect(chevrons).toBeGreaterThan(0);
      // Either the header is space-between, or the chevron carries marginLeft: auto.
      const pushers = (src.match(/justifyContent: 'space-between'/g) || []).length
        + (src.match(/marginLeft: 'auto'/g) || []).length;
      expect(pushers).toBeGreaterThanOrEqual(1);
    }
  });

  test("the buttons beside it still do their own job", () => {
    // A chevron at the far right is only an improvement if pressing "+ Add" does not fold the
    // section on the way past.
    expect(code("public/js/components/CareTasks.js")).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); setEditing\(null\); setShowForm\(true\); \}\}/);
    expect(code("public/js/components/CareEvents.js")).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); setEditing\(null\); setShowForm\(true\); \}\}/);
  });

  test("a collapsed section hides its own actions", () => {
    // They act on things you cannot see.
    for (const f of ["CareTasks", "CareEvents"]) {
      expect(code(`public/js/components/${f}.js`)).toMatch(/\{sectionOpen && canManage && \(/);
    }
    expect(code("public/js/components/CareTeamManage.js")).toMatch(/\{caregiversOpen && isLeader && \(/);
  });
});

describe("folding never destroys work", () => {
  test("bodies are hidden with display, not unmounted", () => {
    // Reopening must not refetch the ledger or lose a half-typed request.
    for (const f of ["Reimbursements", "CareTasks", "CareEvents"]) {
      expect(code(`public/js/components/${f}.js`)).toMatch(/display: sectionOpen \? 'block' : 'none'/);
    }
  });

  test("Health & Medications cannot fold away while it is being edited", () => {
    const profile = code("public/js/components/CareProfile.js");
    expect(profile).toMatch(/display: \(healthOpen \|\| editing\) \? 'block' : 'none'/);
  });

  test("a header full of buttons folds from its title and its chevron — not from the row", () => {
    // Reimbursements carries up to six buttons; Care Tasks and Events carry "+ Add". Making
    // the whole row the control would fold the section when you meant to press one of those.
    // v1.105.172 moved the chevron to the end of the row without giving the row the click.
    for (const f of ["CareTasks.js", "CareEvents.js", "Reimbursements.js"]) {
      const src = code(`public/js/components/${f}`);
      expect(src).toMatch(/aria-expanded=\{sectionOpen\}/);
      expect(src).toMatch(/onClick=\{\(\) => setSectionOpen\(!sectionOpen\)\}/);
    }
  });
});
