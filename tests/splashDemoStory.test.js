// The marketing story and the product were about different families. (v1.105.97)
//
// "See It In Action" followed the Rivera family — Maria in DC, her mother Elena, 78, in
// Richmond, a caregiver called Sarah, a podiatrist looking at Elena's left ankle. The live demo
// two clicks later is the Lowe family: Paul in DC, his mother Barbara, 78, in Blacksburg, and a
// caregiver named Maria Santos. A visitor met a different family with a different illness, and a
// "Maria" who had changed role and generation on the way through the door.
//
// A story about keeping an accurate care record should at least be internally consistent, so the
// walkthrough now uses the seeded cast, town, conditions and medications — including the left
// knee that Maria really does raise in Barbara's seeded messages.

const fs = require("fs");
const path = require("path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const story = read("public", "js", "components", "CareStoryWalkthrough.js");
const picker = read("public", "js", "components", "DemoPickerPage.js");
const seed = read("src", "seed.js");

// Strip the header comment — it names the old cast on purpose, to explain the change.
const storyBody = story.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("the walkthrough and the live demo are about the same people", () => {
  test("nobody from the old cast survives in what a visitor reads", () => {
    for (const ghost of ["Elena", "Rivera", "Richmond", "richmondpodiatry"]) {
      expect(storyBody).not.toMatch(new RegExp(ghost));
    }
  });

  test("it uses the demo's family", () => {
    expect(storyBody).toMatch(/Barbara Lowe/);
    expect(storyBody).toMatch(/Blacksburg/);
    expect(storyBody).toMatch(/Paul/);
    expect(storyBody).toMatch(/Maria Santos/i);
  });

  test("the caregiver in the story is a caregiver in the seed, and Paul is family", () => {
    expect(seed).toMatch(/"Maria", "Santos"/);
    expect(seed).toMatch(/"Paul", "Lowe"/);
    expect(seed).toMatch(/"Barbara", "Lowe", 78/);
  });

  test("the conditions and medications match the seeded care profile", () => {
    // If these drift apart again the story stops describing the app.
    expect(storyBody).toMatch(/Early-stage dementia/);
    expect(seed).toMatch(/Early-stage dementia \(diagnosed 2024\)/);
    expect(storyBody).toMatch(/Donepezil 10mg/);
    expect(seed).toMatch(/Donepezil 10mg daily \(evening\)/);
    expect(storyBody).toMatch(/Lisinopril 10mg/);
    expect(seed).toMatch(/Lisinopril 10mg daily \(morning\)/);
  });

  test("the complaint is the knee Maria actually raises in the seeded messages", () => {
    expect(storyBody).toMatch(/left knee/i);
    expect(seed).toMatch(/rubbing her left knee/);
    expect(storyBody).not.toMatch(/ankle/i);
  });

  test("Dr. Patel is the doctor the seed already sends her to", () => {
    expect(storyBody).toMatch(/Dr\. Patel/);
    expect(seed).toMatch(/Dr\. Patel/);
  });
});

describe("'View Live Demo' opens the live demo", () => {
  // Pete: "on the splash there's a 'view the live demo' but that only takes you to the 'see it
  // in action' page in which you can click (again) on 'view the live demo'...which is confusing."
  // Both pages opened with the same heading and the same seven-step story, so the button looked
  // like it had done nothing. The persona cards were real, and below the fold.
  test("the demo picker leads with the personas, not with the walkthrough", () => {
    const headingAt = picker.indexOf("Try the Live Demo");
    const walkthroughAt = picker.indexOf("<CareStoryWalkthrough");
    expect(headingAt).toBeGreaterThan(-1);
    expect(walkthroughAt).toBeGreaterThan(-1);
    expect(headingAt).toBeLessThan(walkthroughAt);
  });

  test("the walkthrough is still there, just after the thing the visitor asked for", () => {
    expect(picker).toMatch(/<CareStoryWalkthrough onNavigate=\{onNavigate\} compact=\{true\} \/>/);
  });
});
