/**
 * v1.114.3 — the Schedule calendar stopped at Nov 4 for Pete's account.
 *
 * GET /api/sessions sorts oldest-first. A caller that asks for "?limit=N" with no date range
 * gets the account's first N visits EVER, so once a family has more history than N, the
 * calendar (and the Request Care overlap warning that reads the same kind of list) silently
 * loses everything after some date in the future. Callers that show upcoming or monthly care
 * must say which dates they mean.
 */
const fs = require("fs");
const path = require("path");

const read = (f) => fs.readFileSync(path.join(__dirname, "..", "public/js/components", f), "utf8");

describe("calendar-style callers ask for a date range", () => {
  test("Schedule fetches the month it is showing", () => {
    const src = read("Schedule.js");
    expect(src).not.toMatch(/\/api\/sessions\?limit=100/);
    expect(src).toMatch(/\/api\/sessions\?from=\$\{from\}&to=\$\{to\}/);
    // and re-fetches when the month changes
    expect(src).toMatch(/\[currentMonth\.year, currentMonth\.month\]/);
  });

  test("Request Care's overlap check reads upcoming visits, not the oldest ones", () => {
    const src = read("RequestCareModal.js");
    expect(src).not.toMatch(/apiFetch\('\/api\/sessions\?limit=100'\)/);
    expect(src).toMatch(/\/api\/sessions\?from=\$\{TimezoneHelper\.getToday\(\)\}/);
  });
});
