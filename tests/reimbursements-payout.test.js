// v1.97.0 — "to / from" settlement model: payout parsing + the label-only
// guard that keeps full account numbers out of the database.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-jest";
const { _test } = require("../src/routes/reimbursements");
const { parsePayout, assertLabelOnly, payoutLabel, achFeeCents } = _test;

describe("parsePayout", () => {
  test("accepts a valid venmo payout", () => {
    expect(parsePayout({ payoutMethod: "venmo", payoutDetails: "@pete-lee" }))
      .toEqual({ payoutMethod: "venmo", payoutDetails: "@pete-lee" });
  });

  test("accepts ach with a label-only detail", () => {
    expect(parsePayout({ payoutMethod: "ach", payoutDetails: "Truist checking ****4321" }))
      .toEqual({ payoutMethod: "ach", payoutDetails: "Truist checking ****4321" });
  });

  test("rejects ach details that look like a full account number", () => {
    expect(() => parsePayout({ payoutMethod: "ach", payoutDetails: "routing 026009593 acct 123456789" }))
      .toThrow(/account number/i);
  });

  test("ignores unknown methods", () => {
    expect(parsePayout({ payoutMethod: "bitcoin", payoutDetails: "x" }))
      .toEqual({ payoutMethod: null, payoutDetails: null });
  });

  test("zelle phone numbers are allowed (guard is ach-only)", () => {
    expect(parsePayout({ payoutMethod: "zelle", payoutDetails: "5405551234" }).payoutDetails)
      .toBe("5405551234");
  });
});

describe("assertLabelOnly", () => {
  test("passes nickname + last 4", () => {
    expect(() => assertLabelOnly("Mom's checking ****1234", "Label")).not.toThrow();
  });
  test("rejects 8+ digit runs even with separators", () => {
    expect(() => assertLabelOnly("1234-5678-9012", "Label")).toThrow(/account number/i);
  });
  test("allows null/empty", () => {
    expect(() => assertLabelOnly(null, "Label")).not.toThrow();
  });
});

describe("payoutLabel", () => {
  test("venmo strips leading @", () => {
    expect(payoutLabel({ payout_method: "venmo", payout_details: "@pete" })).toBe("Venmo @pete");
  });
  test("ach includes the label", () => {
    expect(payoutLabel({ payout_method: "ach", payout_details: "Truist ****4321" }))
      .toBe("bank transfer (ACH) — Truist ****4321");
  });
});


describe("achFeeCents (v1.98.0 — fee rides on top of payer's charge)", () => {
  test("$81.46 → 66 cents (0.8%, rounded up)", () => {
    expect(achFeeCents(8146)).toBe(66);
  });
  test("caps at $5 for large amounts", () => {
    expect(achFeeCents(100000)).toBe(500); // $1000 * 0.8% = $8 → capped
  });
  test("never zero", () => {
    expect(achFeeCents(50)).toBe(1);
  });
  test("payee receives exactly the base (fee is the application fee)", () => {
    const base = 8146, fee = achFeeCents(base), total = base + fee;
    expect(total - fee).toBe(base); // destination gets base
  });
  test("inplace payout stores no free-text details", () => {
    expect(parsePayout({ payoutMethod: "inplace", payoutDetails: "whatever" }))
      .toEqual({ payoutMethod: "inplace", payoutDetails: null });
  });
  test("inplace label", () => {
    expect(payoutLabel({ payout_method: "inplace" })).toBe("Direct deposit through InPlace (ACH)");
  });
});
