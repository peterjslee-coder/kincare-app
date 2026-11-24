// The two job cards say the same thing, because they ask the same function. (v1.105.106)
//
// CaretakerHub renders the same job twice — the purple "Just for You" card and the Find Work
// card — and each one used to do the money and the countdown arithmetic inline. Two copies of
// a calculation is how they drift; this file pins them to the shared helpers.

const fs = require("fs");
const path = require("path");
const hub = fs.readFileSync(path.join(__dirname, "..", "public", "js", "components", "CaretakerHub.js"), "utf8");
const code = hub.split("\n").filter((l) => {
  const t = l.trim();
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}).join("\n");

describe("the money", () => {
  test("both cards use jobPay, neither computes it inline", () => {
    expect((code.match(/= jobPay\(job\)/g) || []).length).toBe(2);
    expect(code).not.toMatch(/Math\.round\(baseCost \/ hours\)/);
    expect(code).not.toMatch(/effectiveTotal\.toFixed\(0\)/);
  });

  test("every figure goes through formatMoney", () => {
    // A bare ${x} in a template was how a rate got rounded to the dollar in one place and a
    // total to the dollar in another.
    expect(code).not.toMatch(/\$\{basePerHour\}/);
    expect(code).not.toMatch(/\$\{effectivePerHour\}/);
    expect((code.match(/formatMoney\(/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  test("the big number says what it is", () => {
    // "$24/hr" next to a bare "$29" is the whole complaint: a rate and a total side by side,
    // one of them unexplained.
    expect((code.match(/formatMoney\(effectiveTotal\)\}<\/span><span[^>]*> total<\/span>/g) || []).length).toBe(2);
  });
});

describe("the exclusive window", () => {
  test("one now per render, held in state", () => {
    expect(code).toMatch(/const \[exclusiveNow, setExclusiveNow\] = useState\(\(\) => Date\.now\(\)\)/);
    expect(code).toMatch(/setInterval\(\(\) => setExclusiveNow\(Date\.now\(\)\), 30000\)/);
  });

  test("the tick counter that was never read is gone", () => {
    expect(code).not.toMatch(/exclusiveTick/);
  });

  test("both filters and both countdowns take that now", () => {
    expect((code.match(/isExclusiveExpired\(job, exclusiveNow\)/g) || []).length).toBe(3);
    expect((code.match(/exclusiveMinutesLeft\(job, exclusiveNow\)/g) || []).length).toBe(2);
  });

  test("nothing reads the wall clock while deciding which section a job is in", () => {
    // This is the bug: `new Date()` inside a render-time filter means an unrelated re-render
    // — tapping "Read more" — can move a card out of "Just for You" and into Find Work.
    const filters = code.slice(code.indexOf("const exclusiveOffers = openJobs.filter"));
    expect(filters.slice(0, 400)).not.toMatch(/new Date\(\)/);
    const other = code.slice(code.indexOf("const nonExclusiveJobs = openJobs.filter"));
    expect(other.slice(0, 400)).not.toMatch(/new Date\(\)/);
  });
});
