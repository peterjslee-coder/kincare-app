// v1.109.0 — the rush surcharge splits 80/20, and the ledger describes a charge in English.
const { priceVisit, priceFromCaregiverCents, SURCHARGE_TO_CAREGIVER } = require("../src/utils/pricing");
const { SURCHARGE_CAREGIVER_SHARE, SURCHARGE_PLATFORM_SHARE } = require("../src/utils/rateCalculator");
const { describe: describeEntry } = require("../src/utils/ledger");

test("Pete's rule: 20% rush, and of that the caregiver gets 80 and InPlace 20", () => {
  expect(SURCHARGE_CAREGIVER_SHARE).toBe(0.8);
  expect(SURCHARGE_PLATFORM_SHARE).toBe(0.2);
  expect(SURCHARGE_TO_CAREGIVER).toBe(0.8);
  const p = priceVisit({ baseCents: 17600, surchargeCents: 3520, feePercent: 20 });
  expect(p).toEqual(expect.objectContaining({
    caregiverCents: 20416,      // 176.00 + 28.16
    platformFeeCents: 4224,     // 35.20 + 7.04
    familyTotalCents: 24640,    // 246.40
    surchargeToCaregiverCents: 2816,
    surchargeToPlatformCents: 704,
  }));
  expect(p.caregiverCents + p.platformFeeCents).toBe(p.familyTotalCents);
});

test("with no surcharge it is exactly the ordinary fee-on-top price", () => {
  for (const cents of [1000, 17600, 40325]) {
    const a = priceVisit({ baseCents: cents, surchargeCents: 0, feePercent: 20 });
    const b = priceFromCaregiverCents(cents, 20);
    expect([a.caregiverCents, a.platformFeeCents, a.familyTotalCents])
      .toEqual([b.caregiverCents, b.platformFeeCents, b.familyTotalCents]);
  }
});

test("nothing is lost to rounding, at any surcharge", () => {
  for (let s = 0; s <= 5000; s += 7) {
    const p = priceVisit({ baseCents: 12345, surchargeCents: s, feePercent: 20 });
    expect(p.surchargeToCaregiverCents + p.surchargeToPlatformCents).toBe(s);
    expect(p.caregiverCents + p.platformFeeCents).toBe(p.familyTotalCents);
  }
});

test("a ledger row reads as a receipt, adjustments as minus lines", () => {
  const d = describeEntry({
    id: "l1", session_id: "s1", kind: "capture", status: "succeeded",
    family_cents: 21120, caregiver_cents: 17600, platform_cents: 3520, card_fee_cents: 0,
    created_at: "2026-09-18T12:00:00Z",
    breakdown: JSON.stringify({
      hours: 8, hourlyCents: 2200, baseCents: 17600, overtimeMinutes: 15, overtimeCents: 550,
      breakMinutes: 30, breakDeductionCents: 1100, platformFeeCents: 3520, feePercent: 20,
    }),
  });
  expect(d.label).toBe("Visit");
  expect(d.charged).toBe(211.20);
  expect(d.toCaregiver).toBe(176);
  expect(d.lines).toEqual([
    { label: "Care — 8 h at $22.00/h", amount: 176 },
    { label: "Overtime — 15 min", amount: 5.5 },
    { label: "Unpaid breaks — 30 min", amount: -11 },
    { label: "InPlace fee (20%)", amount: 35.2 },
  ]);
});

test("a tip reads as the caregiver's, with the card fee named", () => {
  const d = describeEntry({
    id: "l2", session_id: "s1", kind: "tip", status: "succeeded",
    family_cents: 2091, caregiver_cents: 2000, platform_cents: 0, card_fee_cents: 91,
    created_at: "2026-09-18T12:00:00Z",
    breakdown: JSON.stringify({ tipCents: 2000, cardFeeCents: 91 }),
  });
  expect(d.label).toBe("Tip");
  expect(d.lines).toEqual([
    { label: "Card processing fee", amount: 0.91 },
    { label: "Tip", amount: 20 },
  ]);
  expect(d.toInPlace).toBe(0);
});
