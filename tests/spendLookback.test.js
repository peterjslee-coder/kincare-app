const { summarize, spendLast30 } = require("../src/utils/spendLookback");

describe("30-day all-in spend (v1.136.0)", () => {
  const rows = [
    { session_id: "a", kind: "authorization", status: "succeeded", family_cents: 99999, caregiver_cents: 0, platform_cents: 0 },
    { session_id: "a", kind: "capture", status: "succeeded", family_cents: 12000, caregiver_cents: 10000, platform_cents: 2000, card_fee_cents: 380 },
    { session_id: "a", kind: "tip", status: "succeeded", family_cents: 5180, caregiver_cents: 5000, platform_cents: 0, card_fee_cents: 180 },
    { session_id: "b", kind: "capture", status: "succeeded", family_cents: 7200, caregiver_cents: 6000, platform_cents: 1200,
      breakdown: JSON.stringify({ mileageCents: 800 }) },
    { session_id: "c", kind: "capture", status: "failed", family_cents: 5000, caregiver_cents: 4000, platform_cents: 1000 },
  ];
  test("total is what was charged; the lines add up to it; authorizations and failures don't count", () => {
    const s = summarize(rows);
    expect(s.total).toBe(243.8);
    expect(s.wages).toBe(152);
    expect(s.tips).toBe(50);
    expect(s.mileage).toBe(8);
    expect(s.fees).toBe(33.8);
    expect(+(s.wages + s.tips + s.mileage + s.fees).toFixed(2)).toBe(s.total);
    expect(s.visits).toBe(2);
  });
  test("no recipients, no query, zeros", async () => {
    const db = { prepare: () => { throw new Error("should not query"); } };
    const s = await spendLast30(db, []);
    expect(s.total).toBe(0);
  });
  test("queries the last 30 days for exactly the given recipients", async () => {
    let sql, args;
    const db = { prepare: (q) => { sql = q; return { all: async (...a) => { args = a; return rows; } }; } };
    const now = new Date("2026-11-20T12:00:00Z");
    const s = await spendLast30(db, ["r1", "r2"], now);
    expect(sql).toMatch(/care_recipient_id IN \(\?,\?\)/);
    expect(args).toEqual(["r1", "r2", "2026-10-21T12:00:00.000Z"]);
    expect(s.total).toBe(243.8);
  });
});
