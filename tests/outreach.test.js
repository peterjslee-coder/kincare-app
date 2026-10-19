// v1.113.0 — caregiver outreach helpers. Names and numbers below are made up; the line SHAPES
// are copied from the NRV Agency on Aging sitter list the feature was built for.
const O = require("../src/utils/outreach");

describe("parseList", () => {
  test("reads the agency list's dotted-leader shape, with notes after the number", () => {
    const { contacts, skipped } = O.parseList([
      "Doe, Jane……………………..540-555-0101",
      "Roe, Mary ............ 540-555-0102 (CNA, Christiansburg, Radford)",
      "Poe, Ann ..................... 540-555-0103 Pulaski Co – willing to clean too",
      "Lee, Kim ..................... 540 555 0104 (NRV)",
    ].join("\n"));
    expect(skipped).toEqual([]);
    expect(contacts).toEqual([
      { first_name: "Jane", last_name: "Doe", phone: "+15405550101", notes: null },
      { first_name: "Mary", last_name: "Roe", phone: "+15405550102", notes: "CNA, Christiansburg, Radford" },
      { first_name: "Ann", last_name: "Poe", phone: "+15405550103", notes: "Pulaski Co – willing to clean too" },
      { first_name: "Kim", last_name: "Lee", phone: "+15405550104", notes: "NRV" },
    ]);
  });

  test("a second number stays in notes; the first is the thread", () => {
    const { contacts } = O.parseList("Hill, Sue ............... 540-555-0105 or 540-555-0106");
    expect(contacts[0].phone).toBe("+15405550105");
    expect(contacts[0].notes).toBe("or 540-555-0106");
  });

  test("two names on one number become ONE contact that greets both", () => {
    const { contacts } = O.parseList([
      "Sample, Emmett………………..540-555-0107 (CNA)",
      "Sample, Rocky……………………540-555-0107 (PCA)",
    ].join("\n"));
    expect(contacts).toHaveLength(1);
    expect(contacts[0].first_name).toBe("Emmett & Rocky");
    expect(contacts[0].notes).toMatch(/Also listed at this number: Rocky Sample \(PCA\)/);
    expect(O.renderTemplate("Hi {first},", contacts[0])).toBe("Hi Emmett & Rocky,");
  });

  test("first-last order and headings without a number", () => {
    const { contacts, skipped } = O.parseList("NEW RIVER VALLEY ADULT DAY CENTERS\nJane Q Public, 540-555-0108, nights");
    expect(skipped).toEqual(["NEW RIVER VALLEY ADULT DAY CENTERS"]);
    expect(contacts[0]).toMatchObject({ first_name: "Jane", last_name: "Q Public", phone: "+15405550108" });
  });

  test("a nickname in quotes is what the greeting uses", () => {
    const { contacts } = O.parseList("Gray, Rebecca “Becky” ...... 540-555-0109 (Pulaski Co & Town)");
    expect(O.greetingName(contacts[0])).toBe("Becky");
  });
});

describe("classifyInbound", () => {
  test.each(["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "Cancel", "quit", "END"])("%s is an opt-out", (b) => {
    expect(O.classifyInbound(b).kind).toBe("opt_out");
  });
  test("START opts back in", () => expect(O.classifyInbound("Start").kind).toBe("opt_in"));
  test("INFO is NOT a join word — Twilio answers it as HELP", () => expect(O.classifyInbound("info").kind).toBe("message"));
  test.each(["JOIN", "join", "Join.", "Join InPlace"])("%s is the keyword opt-in", (b) => expect(O.classifyInbound(b).kind).toBe("join"));
  test("the JOIN answer names InPlace, asks for email, and carries the carrier disclosures", () => {
    expect(O.JOIN_REPLY).toMatch(/InPlace/);
    expect(O.JOIN_REPLY).toMatch(/email/);
    expect(O.JOIN_REPLY).toMatch(/Msg & data rates may apply/);
    expect(O.JOIN_REPLY).toMatch(/STOP to opt out/);
    expect(O.JOIN_REPLY).toMatch(/HELP for help/);
    expect(O.JOIN_REPLY).toMatch(/^InPlace Care: /); // v1.124.3 — brand first
    expect(O.JOIN_REPLY).toMatch(/You're signed up/); // confirmation of enrollment
    expect(O.JOIN_REPLY).toMatch(/Msg frequency varies/);
    expect(O.JOIN_REPLY.length).toBeLessThanOrEqual(320); // the registered opt-in message limit
  });
  test("an email anywhere is interest, lowercased, trailing punctuation dropped", () => {
    expect(O.classifyInbound("Sure! it's Jane.Doe@Example.com.")).toEqual({ kind: "email", email: "jane.doe@example.com" });
  });
  test("a sentence that merely contains 'stop' is a message, not an opt-out", () => {
    expect(O.classifyInbound("I can stop by tomorrow").kind).toBe("message");
  });
  test("anything else is a message for a person", () => expect(O.classifyInbound("Who is this?").kind).toBe("message"));
});

describe("introWindow", () => {
  // 2026-10-13 is a Tuesday; 2026-10-18 a Sunday. EDT = UTC-4.
  test("open at 10am Eastern on a weekday", () => expect(O.introWindow(new Date("2026-10-13T14:00:00Z")).open).toBe(true));
  test("closed at 8:30am Eastern", () => expect(O.introWindow(new Date("2026-10-13T12:30:00Z")).open).toBe(false));
  test("closed at 8pm Eastern", () => expect(O.introWindow(new Date("2026-10-14T00:00:00Z")).open).toBe(false));
  test("closed on Sunday", () => expect(O.introWindow(new Date("2026-10-18T16:00:00Z")).open).toBe(false));
});

describe("the default intro", () => {
  test("names InPlace, says how to opt out, and fits in three texts", () => {
    const text = O.renderTemplate(O.DEFAULT_INTRO, { first_name: "Jane" });
    expect(text).toMatch(/^Hi Jane, /);
    expect(text).toMatch(/InPlace/);
    expect(text).toMatch(/Reply STOP to opt out/);
    expect(O.segmentCount(text)).toBeLessThanOrEqual(3);
  });

  test("carries her own link (v1.118.0), and still fits in three texts with it", () => {
    expect(O.hasLinkToken(O.DEFAULT_INTRO)).toBe(true);
    const text = O.renderTemplate(O.DEFAULT_INTRO, { first_name: "Jane" }, "yourinplace.com/i/Ab3xYz");
    expect(text).toContain("(yourinplace.com/i/Ab3xYz)");
    expect(O.segmentCount(text)).toBeLessThanOrEqual(3);
  });
});

describe("phone helpers", () => {
  test("phoneKey takes 10 or 11 digits only", () => {
    expect(O.phoneKey("(540) 555-0101")).toBe("5405550101");
    expect(O.phoneKey("+1 540 555 0101")).toBe("5405550101");
    expect(O.phoneKey("555-0101")).toBeNull();
  });
});

describe("outreach number never borrows the reminder number", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; jest.resetModules(); });
  test("unset TWILIO_OUTREACH_NUMBER means no outreach number, even with TWILIO_FROM_NUMBER set", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC1"; process.env.TWILIO_AUTH_TOKEN = "t"; process.env.TWILIO_FROM_NUMBER = "+15405550199";
    delete process.env.TWILIO_OUTREACH_NUMBER;
    expect(require("../src/utils/sms").outreachNumber()).toBeNull();
    process.env.TWILIO_OUTREACH_NUMBER = "540-555-0198";
    jest.resetModules();
    expect(require("../src/utils/sms").outreachNumber()).toBe("+15405550198");
  });
});

describe("dialableUsNumber — the browser can never call 911", () => {
  test.each(["911", "1-911", "+1911", "933", "112", "988", "411", "+1 911 555 0101", "0005550101", "1115550101", "540-911-0000"])("%s is refused", (n) => {
    expect(O.dialableUsNumber(n)).toBeNull();
  });
  test("a normal local number is dialable", () => expect(O.dialableUsNumber("(540) 555-0101")).toBe("+15405550101"));
});
