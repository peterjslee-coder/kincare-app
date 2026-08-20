// Done, not done, and not known yet — three states, not two. (v1.105.112)
//
// Pete on how onboarding feels:
//   "you finish...and it says you still haven't verified your ID (but you did) and it's like,
//    'when does this ever end?'"
//
// That is not a feeling, it is `done: idApproved`. While `idVerification` was still loading,
// `idApproved` was false, so the step drew UNTICKED — and v1.105.75 rightly suppresses the
// "take a photo of your ID" prompt while the answer is in flight, which left the row with no
// explanation at all. An unknown answer rendered identically to a negative one, which is the
// same family as "a broken feature and a switched-off feature look identical".

const fs = require("fs");
const path = require("path");
const hub = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "CaretakerHub.js"), "utf8");
const code = hub.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("{/*")).join("\n");

describe("the third state exists", () => {
  test("the identity step declares when it does not know", () => {
    expect(code).toMatch(/unknown: !idVerification\.loaded,/);
  });

  // v1.105.118 rewrote this checklist into a path: one open step with any weight, finished work
  // on a small struck-through line, the rest one quiet line of names. The three-state rule did
  // not soften — it got a stronger mechanism. It used to be "draw the unknown row differently";
  // it is now "an unknown row cannot be drawn as work at all".

  test("nothing is painted until every async answer is in", () => {
    // v1.105.82's gate, load-bearing again: identity and Stripe both resolve after first paint,
    // and a count that corrects itself is the flashing checklist Julia saw on every page change.
    expect(code).toMatch(/const firstStepsResolved = idVerification\.loaded && stripeStatus !== null;/);
    expect(code).toMatch(/const showFirstSteps = firstStepsResolved &&/);
  });

  test("the open step is chosen from the route, which never opens an unknown one", () => {
    // `resolveRoute().current` is the first item whose state is 'todo' and which is not blocked.
    // 'unknown' is not 'todo', so it can never be the thing she is asked to do next.
    // tests/onboardingRoute.test.js asserts that directly.
    expect(code).toMatch(/const open = hubRoute\.current;/);
  });

  test("an unknown step is never listed among the things left", () => {
    // Prompting for a photo she already sent is the complaint itself.
    expect(code).toMatch(/\.filter\(\(i\) => i\.state === 'todo' && \(!open \|\| i\.id !== open\.id\)\)/);
  });

  test("it does not draw as done either", () => {
    // The failure direction matters: claiming done while unsure would be worse. The struck line
    // is built from 'done' and nothing else.
    expect(code).toMatch(/hubRoute\.items\.filter\(\(i\) => i\.state === 'done'\)/);
  });
});

describe("the sentence that answers 'when does this ever end?'", () => {
  test("waiting on us is its own state, not a warning on an undone row", () => {
    // It used to render under `s.done && s.warning`, and that warning is ONLY ever set when the
    // document is submitted and not yet approved — i.e. when done is false. So "waiting on
    // review, you don't need to do anything else" had never once been visible to anyone.
    // v1.105.118 makes it a state: it renders in its own note, outside the list of things left.
    expect(code).not.toMatch(/\{s\.done && s\.warning && \(/);
    expect(code).toMatch(/i\.state === 'waiting'/);
  });

  test("and what is left never counts it", () => {
    // "How much is left?" has to mean "left for you", or the answer is wrong in the direction
    // that makes it feel endless.
    expect(code).toMatch(/\{hubRoute\.remaining\}/);
    expect(code).toMatch(/' with us'/);
  });

  test("and it reads like a person wrote it", () => {
    expect(hub).toMatch(/we\\u2019ll review it and reach out if we have any questions/);
    expect(hub).toMatch(/Nothing else for you to do/);
  });
});

describe("the copy is softer and true", () => {
  test("no shouting", () => {
    expect(hub).toMatch(/label: 'A photo of your licence'/);
    expect(hub).not.toMatch(/label: 'Verify your identity'/);
  });

  test("it no longer claims a person reviews it — it says WE will", () => {
    // The old copy said "A person reviews it." That was false in the common case: the AI
    // approved outright. v1.105.112 makes it true AND stops promising on the AI's behalf.
    expect(hub).not.toMatch(/A person reviews it\./);
    expect(hub).toMatch(/We\\u2019ll review it and reach out if we have any questions\./);
  });
});

describe("the wizard can count its own steps", () => {
  const wiz = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "CaregiverOnboarding.js"), "utf8");

  test("there is a label for every step", () => {
    const total = Number(/const TOTAL_STEPS = (\d+);/.exec(wiz)[1]);
    const block = wiz.slice(wiz.indexOf("const stepLabels = {"), wiz.indexOf("};", wiz.indexOf("const stepLabels = {")));
    const keys = (block.match(/^\s*(\d+):/gm) || []).map((k) => parseInt(k, 10));
    expect(keys.length).toBe(total);
    expect(Math.max(...keys)).toBe(total);
    expect(keys).toEqual([...Array(total)].map((_, i) => i + 1));
  });

  test("step 9 is not undefined", () => {
    expect(wiz).toMatch(/9: 'One last look',/);
  });

  test("the analytics map matches the wizard too", () => {
    // It carried a "Background Check Payment" step the wizard does not have, shifting every
    // name after it — so every onboarding event was filed under the wrong step name.
    expect(wiz).not.toMatch(/7: 'Background Check Payment'/);
    const block = wiz.slice(wiz.indexOf("const stepNames = {"), wiz.indexOf("};", wiz.indexOf("const stepNames = {")));
    const keys = (block.match(/(\d+): '/g) || []).map((k) => parseInt(k, 10));
    expect(keys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("finishing the wizard no longer claims the ID is verified", () => {
    expect(wiz).not.toMatch(/documents uploaded, and identity verified/);
    // v1.105.115 — the sentence moved into the handoff that replaced the celebration screen,
    // and gained the part that matters most: nothing else is hers to do while it sits with us.
    expect(wiz).toMatch(/Your ID is with us/);
    expect(wiz).toMatch(/ll review it and reach out if we have any questions/);
  });
});
