// Three contracts in front of a demo. (v1.105.98)
//
// Pete: "It's laborious to click and drag through three separate pages of disclosure for a
// demo. No one is reading it... this would only be for the demo, to get them past the legalese
// that they aren't reading or even subject to."
//
// "Or even subject to" is the load-bearing part. Paul Lowe is not a person, nobody browsing the
// demo is a client of Cedar Rock Holdings, no services are provided and no money moves — so the
// old flow collected consent that would be void if given, and wrote it into
// user_legal_acceptances, a table whose entire value is that it records a named human accepting
// a named version. Rows from a shared fictional login make that record worse, not fuller.

const fs = require("fs");
const path = require("path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const auth = read("src", "routes", "auth.js");
const legal = read("src", "routes", "legal.js");
const orientation = read("public", "js", "components", "DemoOrientation.js");
const app = read("public", "js", "app.js");
const build = read("scripts", "build-client.js");

describe("a demo account is not asked to agree to anything", () => {
  test("the server returns no pending legal docs for a demo user", () => {
    expect(auth).toMatch(/if \(user\.is_demo\) pendingLegalDocs = \[\];/);
    expect(legal).toMatch(/if \(me && me\.is_demo\) pending = \[\];/);
  });

  test("the gate is users.is_demo, so real users are untouched", () => {
    // If this ever keys off anything looser — a role, a flag, an env — real acceptances stop
    // being collected and the audit trail silently goes empty.
    expect(auth).toMatch(/if \(user\.is_demo\) pendingLegalDocs = \[\];/);
    expect(legal).toMatch(/SELECT is_demo FROM users WHERE id = \?/);
    expect(legal).toMatch(/if \(me && me\.is_demo\)/);
  });
});

describe("what the demo visitor is shown instead", () => {
  test("it is one screen with one button and no scroll gate", () => {
    expect(orientation).toMatch(/Got it/);
    expect(orientation).not.toMatch(/scrolledToBottom/);
    expect(orientation).not.toMatch(/setCurrentIdx/);
    // exactly one acknowledgement control
    expect((orientation.match(/<button/g) || []).length).toBe(1);
  });

  test("it says plainly that it is a summary and that nothing is being signed", () => {
    expect(orientation).toMatch(/Nothing here is an agreement/);
    expect(orientation).toMatch(/summary written for the demo, not the agreements themselves/);
  });

  test("it links the real documents rather than replacing them", () => {
    expect(orientation).toMatch(/\/legal\/terms\.html/);
    expect(orientation).toMatch(/\/legal\/privacy\.html/);
  });

  test("it carries the points Pete asked for, and each one traces to a signed document", () => {
    expect(orientation).toMatch(/Scheduling, payments, messaging and visit logs/); // Terms s2
    expect(orientation).toMatch(/not our employees/);                              // Caregiver Agmt II.1
    expect(orientation).toMatch(/set their own hours/);                            // Caregiver Agmt II.1(c)
    expect(orientation).toMatch(/not a home health agency/);                       // Terms s2
    expect(orientation).toMatch(/never administer it/);                            // Client Svcs s2
    expect(orientation).toMatch(/calls 911/);                                      // Client Svcs, Emergencies
    expect(orientation).toMatch(/never sell/i);                                    // Privacy, Plain English
    expect(orientation).toMatch(/Virginia/);                                       // Terms, Governing Law
    expect(orientation).toMatch(/limited early access/i);
  });

  test("it is wired into the bundle and shown once per session", () => {
    expect(build).toMatch(/js\/components\/DemoOrientation\.js/);
    expect(app).toMatch(/showDemoOrientation && <DemoOrientation/);
    expect(app).toMatch(/sessionStorage\.setItem\('inplace_demo_oriented', '1'\)/);
    // keyed on the user, not bolted onto each of the eight setShowDisclaimer call sites
    expect(app).toMatch(/currentUser && currentUser\.isDemo\]/);
  });
});

describe("dark mode has a gate now, because 'again' meant it kept coming back", () => {
  test("the contrast linter exists and is wired into CI", () => {
    expect(fs.existsSync(path.join(__dirname, "..", "scripts", "lint-contrast.js"))).toBe(true);
    expect(read(".github", "workflows", "ci.yml")).toMatch(/npm run lint:contrast/);
    expect(read("package.json")).toMatch(/"lint:contrast"/);
  });

  test("the prompt Pete could not read no longer hardcodes its colour", () => {
    const hub = read("public", "js", "components", "CaretakerHub.js");
    expect(hub).not.toMatch(/color: '#b45309'/);
    expect(hub).not.toMatch(/color: '#92400e'/);
  });

  test("filled chips use a fill colour dark enough for white text in both themes", () => {
    expect(read("public", "css", "styles.css")).toMatch(/--color-success-fill/);
    expect(read("public", "css", "styles.css")).toMatch(/--color-error-fill/);
  });
});
