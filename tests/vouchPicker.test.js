// Choosing a family is a choice, not a transcription exercise. (v1.105.109)
//
// Pete: "i don't like the vouch picker, the 'type a number that corresponds with a name'…
// there needs to be a cleaner picker, like when you search for contacts in messages."
//
// It was three browser dialogs in a row: a prompt() holding a numbered list you had to read
// and retype as an index, a second prompt() for the note, and a confirm() carrying the
// honesty warning. Transcribing an index fails SILENTLY — pick the wrong number and you have
// vouched a caregiver into a stranger's family, which is the most consequential thing an admin
// can do on this screen.
//
// It was also quietly capped at the first 100 families, filtered in the browser.

const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const picker = read("public/js/components/VouchPicker.js");
const admin = read("public/js/components/AdminPanel.js");
const build = read("scripts/build-client.js");
const overview = read("src/routes/admin/overview.js");

const adminCode = admin.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("the numbered prompt is gone", () => {
  test("no prompt() picks a family any more", () => {
    expect(adminCode).not.toMatch(/Enter number:/);
    expect(adminCode).not.toMatch(/const pickFamily/);
  });

  test("and the browser confirm() no longer carries the honesty warning", () => {
    // A warning inside a confirm() arrives after the choice. This one is on screen while
    // you choose.
    expect(adminCode).not.toMatch(/confirm\(`Vouch for/);
    expect(adminCode).not.toMatch(/confirm\(`Convert /);
    expect(picker).toMatch(/This is <strong>not<\/strong> a background check/);
  });

  test("all three entry points open the same picker", () => {
    // People tab, BG Checks "Vouch for family", BG Checks "Convert to family vouch".
    expect((adminCode.match(/setVouchPicker\(\{/g) || []).length).toBe(3);
    expect(adminCode).toMatch(/mode: 'convert'/);
  });
});

describe("the cap is gone", () => {
  test("the picker searches on the server", () => {
    expect(picker).toMatch(/\?role=family&limit=25\$\{query\.trim\(\) \? `&search=\$\{encodeURIComponent\(query\.trim\(\)\)\}` : ''\}/);
  });

  test("nothing fetches 100 families and filters them in the browser", () => {
    expect(adminCode).not.toMatch(/role=family&limit=100/);
  });

  test("a multi-role user's family is still findable", () => {
    // Someone who signed up as a caregiver and later added a family profile has
    // role='caregiver' and roles=["caregiver","family"]. `?role=family` used to miss them.
    expect(overview).toMatch(/sql \+= ` AND \(role = \? OR roles LIKE \?\)`/);
    expect(overview).toMatch(/params\.push\(role, `%"\$\{role\}"%`\)/);
  });
});

describe("the picker itself", () => {
  test("it searches by name or email, like the contact search", () => {
    expect(picker).toMatch(/placeholder="Search families by name or email"/);
    expect(picker).toMatch(/inputRef\.current\.focus\(\)/);
  });

  test("the search is debounced but opens with results already listed", () => {
    // An empty box that shows nothing reads as broken.
    expect(picker).toMatch(/\}, query \? 250 : 0\);/);
  });

  test("a stale search cannot overwrite a newer one", () => {
    expect(picker).toMatch(/let cancelled = false;/);
    expect(picker).toMatch(/return \(\) => \{ cancelled = true; clearTimeout\(t\); \};/);
  });

  test("you cannot submit without choosing", () => {
    expect(picker).toMatch(/if \(!selected \|\| submitting\) return;/);
    expect(picker).toMatch(/disabled=\{!selected \|\| submitting\}/);
  });

  test("the button names the family you picked", () => {
    // The old flow's last chance to catch a mis-typed index was a confirm() full of text.
    expect(picker).toMatch(/`Vouch for \$\{famName\(selected\)\}`/);
  });

  test("a failure keeps the choice instead of throwing the work away", () => {
    expect(picker).toMatch(/if \(!ok\) \{ setSubmitting\(false\); setError/);
  });

  test("a failed load says so rather than showing an empty list", () => {
    // An empty list and a broken request must not look the same — the recurring lesson.
    expect(picker).toMatch(/setError\('Could not load families\.'\)/);
  });
});

describe("wiring", () => {
  test("one write path for all three entry points", () => {
    expect(adminCode).toMatch(/const submitVouch = async \(family, note\) => \{/);
    expect(adminCode).toMatch(/mode === 'convert'/);
  });

  test("it is in the admin bundle, before AdminPanel renders it", () => {
    const list = build.slice(build.indexOf("const ADMIN_SCRIPTS"), build.indexOf("];", build.indexOf("const ADMIN_SCRIPTS")));
    expect(list.indexOf("VouchPicker.js")).toBeGreaterThan(-1);
    expect(list.indexOf("VouchPicker.js")).toBeLessThan(list.indexOf("AdminPanel.js"));
  });

  test("a missing component cannot white-screen the admin panel", () => {
    expect(adminCode).toMatch(/vouchPicker && typeof VouchPicker !== 'undefined' &&/);
  });
});
