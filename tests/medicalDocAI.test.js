// Documents Center — iPAi may only return items it can quote from the document.
const { _clean, SYSTEM_PROMPT, extractSuggestions } = require("../src/utils/medicalDocAI");

describe("medicalDocAI", () => {
  test("an item without a verbatim quote is dropped", () => {
    const out = _clean([
      { kind: "medication", title: "Lisinopril 10 mg daily", source_quote: "Lisinopril 10 mg PO daily" },
      { kind: "medication", title: "Aspirin", source_quote: "" },
      { kind: "diagnosis", title: "CHF", source_quote: "CHF" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Lisinopril 10 mg daily");
  });
  test("only appointments carry a date, and only a real YYYY-MM-DD", () => {
    const out = _clean([
      { kind: "appointment", title: "Cardiology", source_quote: "see cardiology 11/2", suggested_date: "next week" },
      { kind: "review_item", title: "Call if fever", source_quote: "call if fever", suggested_date: "2026-11-02" },
      { kind: "appointment", title: "PCP", source_quote: "PCP on 2026-11-09", suggested_date: "2026-11-09" },
    ]);
    expect(out.map((o) => o.suggested_date)).toEqual([null, null, "2026-11-09"]);
  });
  test("the prompt forbids outside knowledge, inference and dosing advice", () => {
    expect(SYSTEM_PROMPT).toMatch(/ONLY what is written/);
    expect(SYSTEM_PROMPT).toMatch(/outside medical knowledge/);
    expect(SYSTEM_PROMPT).toMatch(/doses/);
  });
  test("with no API key it degrades with a clear reason", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await extractSuggestions("data:image/png;base64,AAAA", "image/png");
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/isn't configured/);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });
});
