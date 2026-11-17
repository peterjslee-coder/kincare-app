/**
 * v1.128.1 — "Certain days" for ONE week.
 *
 * Pete, 11/3 and 11/16 (feedback f9c5599f, 0c0a716a): "I want to set care for the week of
 * Thanksgiving … Monday Tuesday Wednesday … my only option is to have it repeat for two weeks."
 * The weeks floor was 2 in both the validator and the route. It is 1 for the days rule only;
 * weekly/biweekly keep 2 (one week of those is a one-time visit).
 */
const { generateRecurringDates } = require("../src/utils/recurrence");
const { validateSession } = require("../src/middleware/validate");
const { raw, code } = require("./helpers/source");

// 2026-11-23 is the Monday of Thanksgiving week.
const THANKSGIVING_MON = "2026-11-23";

function runValidator(body) {
  let status = 200, payload = null, nexted = false;
  const res = { status(s) { status = s; return this; }, json(p) { payload = p; return this; } };
  validateSession({ body }, res, () => { nexted = true; });
  return { status, payload, nexted };
}

const base = {
  careRecipientId: "00000000-0000-4000-8000-000000000000",
  serviceType: "companion",
  scheduledDate: "2099-11-23",
  scheduledTime: "09:00",
  durationHours: 4,
};

test("one week of Mon/Tue/Wed is exactly those three days", () => {
  expect(generateRecurringDates(THANKSGIVING_MON, "days", 1, "mon,tue,wed"))
    .toEqual(["2026-11-23", "2026-11-24", "2026-11-25"]);
});

test("the validator lets the days rule run for one week", () => {
  const r = runValidator({ ...base, recurrenceRule: "days", recurrenceDays: "mon,tue,wed", recurrenceWeeks: 1 });
  expect(r.payload).toBeNull();
  expect(r.nexted).toBe(true);
});

test("weekly and biweekly keep their floor of two weeks", () => {
  for (const rule of ["weekly", "biweekly"]) {
    const r = runValidator({ ...base, recurrenceRule: rule, recurrenceWeeks: 1 });
    expect(r.status).toBe(400);
    expect(r.payload.error).toMatch(/between 2 and 12/);
  }
});

test("the route's clamp uses a floor of 1 only for the days rule", () => {
  const src = code("src/routes/sessions.js");
  expect(src).toMatch(/const minWeeks = recurrenceRule === "days" \? 1 : 2;/);
  expect(src).toMatch(/Math\.max\(parseInt\(recurrenceWeeks\) \|\| 4, minWeeks\)/);
  expect(src).not.toMatch(/Math\.max\(parseInt\(recurrenceWeeks\) \|\| 4, 2\)/);
});

test("the form offers 'This week only' for certain days", () => {
  const src = raw("public/js/components/RequestCareModal.js");
  expect(src).toMatch(/recurrence === 'days' && <option value="1">This week only<\/option>/);
});
