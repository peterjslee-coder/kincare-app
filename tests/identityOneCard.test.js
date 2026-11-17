/**
 * v1.128.3 — date-of-birth comparison and the one-card analysis rules.
 *
 * Pete, 11/16 (2cbb633c): "Keeps saying that the DOB mismatch is because of leading zeros on
 * the dates. This is not a mismatch." The old code compared "3/5/1990" with "03/05/1990" as text.
 */
const { sameBirthDate, parseDateParts, formatUS } = require("../src/utils/dateMatch");
const { buildChecks, suggestionFrom, slotFor } = require("../src/utils/identityReview");
const { isRealIdNoise } = require("../src/utils/documentAI");
const { code } = require("./helpers/source");

describe("sameBirthDate", () => {
  test("leading zeros are not a mismatch", () => {
    expect(sameBirthDate("1990-03-05", "03/05/1990")).toBe(true);
    expect(sameBirthDate("1990-03-05", "3/5/1990")).toBe(true);
    expect(sameBirthDate("03/05/1990", "3/5/1990")).toBe(true);
  });
  test("a DATE column value (pg builds local midnight) compares by its calendar day", () => {
    expect(sameBirthDate(new Date(1990, 2, 5), "03/05/1990")).toBe(true);
  });
  test("written-out months (passports)", () => {
    expect(sameBirthDate("1990-03-05", "05 MAR 1990")).toBe(true);
    expect(sameBirthDate("1990-09-05", "5 Sept 1990")).toBe(true);
    expect(sameBirthDate("1990-03-05", "March 5, 1990")).toBe(true);
  });
  test("a real difference is a mismatch", () => {
    expect(sameBirthDate("1990-03-05", "03/06/1990")).toBe(false);
    expect(sameBirthDate("1990-03-05", "03/05/1991")).toBe(false);
  });
  test("unreadable is NOT KNOWN, never a mismatch", () => {
    expect(sameBirthDate("1990-03-05", "")).toBeNull();
    expect(sameBirthDate("1990-03-05", "smudged")).toBeNull();
    expect(sameBirthDate(null, "03/05/1990")).toBeNull();
  });
  test("formatUS pads", () => {
    expect(formatUS("1990-3-5")).toBe("03/05/1990");
    expect(parseDateParts("1990-03-05T00:00:00.000Z")).toEqual({ y: 1990, m: 3, d: 5 });
  });
});

test("neither ID route compares dates as text any more", () => {
  for (const f of ["src/routes/caregiveronboarding.js", "src/routes/selfOnboarding.js"]) {
    const src = code(f);
    expect(src).not.toMatch(/date_of_birth\)\.toLocaleDateString/);
    expect(src).toMatch(/sameBirthDate\(/);
  }
});

test("REAL ID remarks are filtered out of concerns", () => {
  expect(isRealIdNoise("Not REAL ID compliant (no star)")).toBe(true);
  expect(isRealIdNoise("Card says Federal Limits Apply")).toBe(true);
  expect(isRealIdNoise("Photo is blurry")).toBe(false);
});

test("slots", () => {
  expect(slotFor("selfie")).toBe("selfie");
  expect(slotFor("DL_Back")).toBe("back");
  expect(slotFor("ID_Back")).toBe("back");
  expect(slotFor("DL_Front")).toBe("front");
  expect(slotFor("drivers_license")).toBe("front");
  expect(slotFor("passport")).toBe("front");
  expect(slotFor("Other")).toBe("other");
});

describe("checks and the suggestion", () => {
  const facts = { firstName: "Sam", lastName: "Rivera", dob: "1990-03-05" };
  const has = { selfie: true, front: true, back: true };
  const good = {
    samePerson: { answer: "yes", confidence: 0.95 },
    document: { type: "drivers_license", issuer: "Virginia", looksGenuine: "yes", confidence: 0.96 },
    frontBack: { answer: "yes" },
    editing: { answer: "none_seen" },
    readFromId: { name: "SAM RIVERA", dateOfBirth: "03/05/1990", expirationDate: "03/05/2030" },
  };
  const today = new Date(2026, 10, 16);

  test("all pass → may suggest approve (still pending; a person decides)", () => {
    const checks = buildChecks(good, facts, has, today);
    expect(checks.every((c) => c.state === "pass")).toBe(true);
    expect(suggestionFrom(checks, good, has).verdict).toBe("recommend_approve");
  });
  test("leading zeros do not fail the DOB check", () => {
    const checks = buildChecks({ ...good, readFromId: { ...good.readFromId, dateOfBirth: "3/5/1990" } }, facts, has, today);
    expect(checks.find((c) => c.key === "dob").state).toBe("pass");
  });
  test("no back of the ID → not confirmed → no opinion, not a reject", () => {
    const noBack = { ...has, back: false };
    const checks = buildChecks(good, facts, noBack, today);
    expect(checks.find((c) => c.key === "frontBack").state).toBe("unknown");
    expect(suggestionFrom(checks, good, noBack).verdict).toBe("abstain");
  });
  test("expired ID fails", () => {
    const checks = buildChecks({ ...good, readFromId: { ...good.readFromId, expirationDate: "01/01/2020" } }, facts, has, today);
    expect(checks.find((c) => c.key === "expiry").state).toBe("fail");
  });
  test("below 90% the AI offers nothing even when everything passes", () => {
    const shaky = { ...good, samePerson: { answer: "yes", confidence: 0.7 } };
    const checks = buildChecks(shaky, facts, has, today);
    expect(suggestionFrom(checks, shaky, has).verdict).toBe("abstain");
  });
});
