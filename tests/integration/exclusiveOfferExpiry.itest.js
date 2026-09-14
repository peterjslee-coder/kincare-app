/**
 * v1.106.25 — a recurring "Just for You" offer expires as one thing.
 *
 * A recurring direct offer writes one care_sessions row per occurrence, each with its own
 * exclusive_until. If those values drift apart, poller 102 takes whichever have passed on any
 * given tick — so a caregiver deciding about week 1 can find week 7 already public, and
 * nobody is told. The family thinks they have offered a standing Tuesday to a specific
 * person; an hour later half of it is on the open market.
 *
 * It holds today because sessions.js writes the rows inside one db.transaction and Postgres
 * NOW() is the transaction timestamp. That is correct, and it is also ACCIDENTAL — it is a
 * property of where the loop sits, not of anything that says so. Moving the inserts out of
 * the transaction would break it by however long the loop takes, and the symptom would be a
 * rare half-released series that nobody could reproduce.
 *
 * So the property is asserted through the real create endpoint and the real poller code.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "offer-expiry-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_offer_fake";

// Booking has a payment wall in front of it. Dev Rule #7: nothing live, ever.
jest.mock("stripe", () => jest.fn(() => ({
  paymentMethods: { list: jest.fn(async ({ type }) => ({
    data: type === "card" ? [{ id: "pm_x", type: "card", card: { last4: "4242" } }] : [],
  })) },
  paymentIntents: { create: jest.fn(async () => ({ id: "pi_x", status: "requires_capture" })) },
})));

const { startHarness, stopHarness } = require("./harness");
const { cancelPassedPrivateOffers, releaseExpiredExclusiveOffers } = require("../../src/utils/exclusiveOffers");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, family, caregiverProfileId, recipientId;

const soon = (d = 7) => {
  const x = new Date(); x.setDate(x.getDate() + d);
  return x.toISOString().slice(0, 10);
};

const bookRecurring = (weeks) => h.request.post("/api/sessions").set(h.auth(family.token)).send({
  careRecipientId: recipientId,
  scheduledDate: soon(7),
  scheduledTime: "09:00",
  durationHours: 2,
  serviceType: "companion",
  recurrenceRule: "weekly",
  recurrenceWeeks: weeks,
  directOffer: true,
  caregiverId: caregiverProfileId,
});

const seriesRows = () => db.prepare(`
  SELECT id, scheduled_date, status, exclusive_until, offered_to_caregiver_id, recurrence_group_id
  FROM care_sessions WHERE care_recipient_id = ? AND recurrence_group_id IS NOT NULL
  ORDER BY scheduled_date
`).all(recipientId);

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;

  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run("cus_x", family.user.id);

  const cg = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  caregiverProfileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
    VALUES (?, ?, 25, 1, 'green', NOW())
  `).run(caregiverProfileId, cg.user.id);

  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await db.prepare("UPDATE care_recipients SET consent_status = 'verified' WHERE id = ?").run(recipientId);
});

afterEach(async () => {
  await db.prepare("DELETE FROM care_sessions WHERE care_recipient_id = ?").run(recipientId);
});
afterAll(async () => { await stopHarness(h); });

describe("a recurring exclusive offer", () => {
  test("creates one row per occurrence, all offered to her", async () => {
    const res = await bookRecurring(6);
    expect(res.status).toBeLessThan(300);
    const rows = await seriesRows();
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.offered_to_caregiver_id).toBe(caregiverProfileId);
    expect(new Set(rows.map((r) => r.recurrence_group_id)).size).toBe(1);
  });

  test("every occurrence shares ONE expiry — not one per row", async () => {
    // The assertion the whole file exists for. Distinct values here means the series can be
    // taken apart by the poller one tick at a time.
    await bookRecurring(8);
    const rows = await seriesRows();
    expect(rows).toHaveLength(8);
    const stamps = rows.map((r) => new Date(r.exclusive_until).getTime());
    // Guard the guard: when the offer fields were named wrong in this test, every
    // exclusive_until was NULL, every getTime() was NaN, and a Set of eight NaNs has size 1.
    // The assertion passed while measuring nothing. Prove they are real timestamps first.
    for (const t of stamps) expect(Number.isFinite(t)).toBe(true);
    expect(new Set(stamps).size).toBe(1);
  });

  test("the expiry is an hour out, not tied to each visit's own date", async () => {
    // Week 8 is eight weeks away; its window is still one hour, same as week 1. Pete chose
    // that deliberately over "recurring offers never auto-open".
    await bookRecurring(8);
    const rows = await seriesRows();
    const ms = new Date(rows[0].exclusive_until).getTime() - Date.now();
    expect(ms).toBeGreaterThan(50 * 60 * 1000);
    expect(ms).toBeLessThan(70 * 60 * 1000);
  });
});

describe("when the window passes", () => {
  test("the whole series is released in one go, never half of it", async () => {
    await bookRecurring(6);
    const rows = await seriesRows();
    // Wind every row past the line by the same amount, which is what a shared expiry means.
    await db.prepare("UPDATE care_sessions SET exclusive_until = NOW() - INTERVAL '1 minute' WHERE recurrence_group_id = ?")
      .run(rows[0].recurrence_group_id);

    const released = await releaseExpiredExclusiveOffers(db);
    expect(released).toBe(6);

    for (const r of await seriesRows()) {
      expect(r.offered_to_caregiver_id).toBeNull();
      expect(r.exclusive_until).toBeNull();
      expect(r.status).toBe("open");
    }
  });

  test("a series that drifted apart would be taken in pieces — which is why it must not drift", async () => {
    // Negative control for the assertion above. Skewing the stamps by hand reproduces the
    // failure the shared-expiry property prevents: one tick, half a series public.
    await bookRecurring(4);
    const rows = await seriesRows();
    await db.prepare("UPDATE care_sessions SET exclusive_until = NOW() - INTERVAL '1 minute' WHERE id IN (?, ?)")
      .run(rows[0].id, rows[1].id);
    await db.prepare("UPDATE care_sessions SET exclusive_until = NOW() + INTERVAL '1 hour' WHERE id IN (?, ?)")
      .run(rows[2].id, rows[3].id);

    expect(await releaseExpiredExclusiveOffers(db)).toBe(2);
    const after = await seriesRows();
    expect(after.filter((r) => r.offered_to_caregiver_id === null)).toHaveLength(2);
    expect(after.filter((r) => r.offered_to_caregiver_id === caregiverProfileId)).toHaveLength(2);
  });

  test("a visit she already accepted is left alone", async () => {
    await bookRecurring(4);
    const rows = await seriesRows();
    await db.prepare("UPDATE care_sessions SET status = 'confirmed', caregiver_id = ? WHERE id = ?")
      .run(caregiverProfileId, rows[0].id);
    await db.prepare("UPDATE care_sessions SET exclusive_until = NOW() - INTERVAL '1 minute' WHERE recurrence_group_id = ?")
      .run(rows[0].recurrence_group_id);

    expect(await releaseExpiredExclusiveOffers(db)).toBe(3);
    const after = await seriesRows();
    const kept = after.find((r) => r.id === rows[0].id);
    expect(kept.status).toBe("confirmed");
    expect(kept.offered_to_caregiver_id).toBe(caregiverProfileId);
  });

  test("an unexpired offer is not touched", async () => {
    await bookRecurring(3);
    expect(await releaseExpiredExclusiveOffers(db)).toBe(0);
    for (const r of await seriesRows()) expect(r.offered_to_caregiver_id).toBe(caregiverProfileId);
  });

  test("a private-only offer has no timer and is never released to the pool", async () => {
    await bookRecurring(3);
    const rows = await seriesRows();
    await db.prepare("UPDATE care_sessions SET private_only = 1, exclusive_until = NOW() - INTERVAL '1 hour' WHERE recurrence_group_id = ?")
      .run(rows[0].recurrence_group_id);

    expect(await releaseExpiredExclusiveOffers(db)).toBe(0);
    for (const r of await seriesRows()) expect(r.offered_to_caregiver_id).toBe(caregiverProfileId);
  });

  test("a private-only offer whose date has passed is cancelled, not left pending forever", async () => {
    await bookRecurring(2);
    const rows = await seriesRows();
    await db.prepare(`
      UPDATE care_sessions SET private_only = 1, scheduled_date = (CURRENT_DATE - INTERVAL '2 days')::text
      WHERE id = ?
    `).run(rows[0].id);

    expect(await cancelPassedPrivateOffers(db)).toBe(1);
    const after = await seriesRows();
    expect(after.find((r) => r.id === rows[0].id).status).toBe("cancelled");
    expect(after.find((r) => r.id === rows[1].id).status).not.toBe("cancelled");
  });
});

describe("a weekday arrangement (v1.106.33)", () => {
  // Pete: "Would it be easier for me to make an appointment for MTWThF from 9-5 for four
  // weeks instead of doing separate appointments for every day?" This is that, end to end:
  // one POST, one recurrence group, one exclusive window, twenty visits.
  const bookWeekdays = (days, weeks) => h.request.post("/api/sessions").set(h.auth(family.token)).send({
    careRecipientId: recipientId,
    scheduledDate: nextMonday(),
    scheduledTime: "09:00",
    durationHours: 8,
    serviceType: "companion",
    recurrenceRule: "days",
    recurrenceWeeks: weeks,
    recurrenceDays: days,
    directOffer: true,
    caregiverId: caregiverProfileId,
  });

  function nextMonday() {
    const d = new Date();
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); // the next Monday, never today
    return d.toISOString().slice(0, 10);
  }

  test("Mon–Fri for four weeks is ONE request and twenty visits", () => {
    return bookWeekdays("mon,tue,wed,thu,fri", 4).then(async (res) => {
      if (res.status >= 300) throw new Error(`booking failed ${res.status}: ${JSON.stringify(res.body)}`);
      const rows = await seriesRows();
      expect(rows).toHaveLength(20);
    });
  });

  test("...all in ONE recurrence group, so she gets one card", async () => {
    await bookWeekdays("mon,tue,wed,thu,fri", 4);
    const rows = await seriesRows();
    expect(new Set(rows.map((r) => r.recurrence_group_id)).size).toBe(1);
  });

  test("...offered to her, sharing one exclusive window", async () => {
    // The v1.106.25 property has to hold at twenty visits too: a month of Betty's care must
    // not come apart one poller tick at a time.
    await bookWeekdays("mon,tue,wed,thu,fri", 4);
    const rows = await seriesRows();
    for (const r of rows) expect(r.offered_to_caregiver_id).toBe(caregiverProfileId);
    const stamps = rows.map((r) => new Date(r.exclusive_until).getTime());
    for (const t of stamps) expect(Number.isFinite(t)).toBe(true);
    expect(new Set(stamps).size).toBe(1);
  });

  test("every visit is a weekday", async () => {
    await bookWeekdays("mon,tue,wed,thu,fri", 4);
    const rows = await seriesRows();
    // This passed while the booking was 400ing, because a for-loop over an empty array
    // asserts nothing. Third time this session — check the list is non-empty first.
    expect(rows.length).toBe(20);
    for (const r of rows) {
      const [y, m, d] = String(r.scheduled_date).slice(0, 10).split("-").map(Number);
      const day = new Date(y, m - 1, d, 12).getDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
    }
  });

  test("a run too long to read is refused rather than created", async () => {
    // 7 days x 12 weeks is 84 rows, 84 payment authorizations and a list she has to read
    // before accepting. A mis-tap must not commit a family to a quarter of care.
    const res = await bookWeekdays("mon,tue,wed,thu,fri,sat,sun", 12);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at a time/i);
    expect(await seriesRows()).toHaveLength(0);
  });

  test("no days picked is refused, not silently turned into one visit", async () => {
    const res = await bookWeekdays("", 4);
    // Falls back to the single start date rather than erroring — one visit, not zero, and
    // never a whole month by accident.
    expect(res.status).toBeLessThan(300);
    const all = await db.prepare(
      "SELECT id FROM care_sessions WHERE care_recipient_id = ?"
    ).all(recipientId);
    expect(all).toHaveLength(1);
  });
});
