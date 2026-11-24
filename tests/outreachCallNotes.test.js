// v1.122.0 — recorded outreach calls: the consent rule is in the code, not in the model's mood.
const CN = require("../src/utils/outreachCallNotes");

test("a quote only counts if it is really in the transcript", () => {
  const t = "Pete: Is it OK if we text you? Dana: Yes, that's fine — text me!";
  expect(CN.quoteInTranscript("yes that's fine text me", t)).toBe(true);
  expect(CN.quoteInTranscript("Sure, text me", t)).toBe(false);
  expect(CN.quoteInTranscript("", t)).toBe(false);
});

test("v1.125.8 — the call asks if we may text, from which number, with rates and STOP", () => {
  const q = CN.CALL_SCRIPT.find((s) => s.consent);
  expect(q.say).toBe(CN.TEXT_ASK);
  expect(CN.TEXT_ASK).toMatch(/^Is it OK if I text you/);
  expect(CN.TEXT_ASK).toMatch(/540-835-5987/);
  expect(CN.TEXT_ASK).toMatch(/rates may apply/);
  expect(CN.TEXT_ASK).toMatch(/STOP/);
});

test("outcomes only move a contact forward from early states", () => {
  expect(CN.statusFor("interested", "new")).toBe("interested");
  expect(CN.statusFor("not_interested", "texted")).toBe("declined");
  expect(CN.statusFor("call_back", "new")).toBe("new");
  expect(CN.statusFor("not_interested", "invited")).toBe("invited");
  expect(CN.statusFor("interested", "opted_out")).toBe("opted_out");
});

test("no AI key: no notes, nothing marked", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  expect(await CN.analyzeCall("Dana: yes text me")).toBeNull();
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
});

test("the voicemail asks them to text JOIN to the outreach number, and comes first in the script", () => {
  expect(CN.VOICEMAIL_SCRIPT).toMatch(/text JOIN to this number, 540-835-5987/);
  expect(CN.VOICEMAIL_SCRIPT).toMatch(/InPlace Care/);
  expect(CN.CALL_SCRIPT[1].say).toBe(CN.VOICEMAIL_SCRIPT);
});
