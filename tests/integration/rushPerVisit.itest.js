/**
 * v1.163.1 — the short-notice rush is decided per visit, in the recipient's zone.
 *
 * A Mon–Wed series booked Sunday afternoon charged ALL THREE visits +20%: POST /api/sessions
 * priced the first date once (read as UTC, so a 5pm Eastern visit 25h out looked 20h out) and
 * copied that cost onto every row. Asserted here through the real create endpoint.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "rush-per-visit-secret";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_rush_fake";

jest.mock("stripe", () => jest.fn(() => ({
  paymentMethods: { list: jest.fn(async ({ type }) => ({
    data: type === "card" ? [{ id: "pm_x", type: "card", card: { last4: "4242" } }] : [],
  })) },
  paymentIntents: { create: jest.fn(async () => ({ id: "pi_x", status: "requires_capture" })) },
})));

const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, family, recipientId;

// Wall clock in Eastern for an instant `hours` from now.
const eastern = (hours) => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date(Date.now() + hours * 3600e3)).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, wd: p.weekday.toLowerCase() };
};

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  await db.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run("cus_x", family.user.id);
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await db.prepare("UPDATE care_recipients SET consent_status = 'verified', timezone = 'America/New_York' WHERE id = ?").run(recipientId);
});

afterAll(async () => { await stopHarness(h); });

test("only the visit inside 24 hours carries the rush", async () => {
  const first = eastern(20);   // 20h out: a real rush
  const second = eastern(44);  // same wall clock next day: not
  const res = await h.request.post("/api/sessions").set(h.auth(family.token)).send({
    careRecipientId: recipientId,
    scheduledDate: first.date,
    scheduledTime: first.time,
    durationHours: 3,
    proposedRate: 22,
    serviceType: "companion",
    status: "open",
    recurrenceRule: "days",
    recurrenceWeeks: 1,
    recurrenceDays: [first.wd, second.wd],
  });
  expect(res.status).toBe(201);

  const rows = await db.prepare(`
    SELECT scheduled_date, estimated_cost, short_notice_surcharge
    FROM care_sessions WHERE care_recipient_id = ? ORDER BY scheduled_date
  `).all(recipientId);
  const byDate = Object.fromEntries(rows.map(r => [r.scheduled_date instanceof Date ? r.scheduled_date.toISOString().slice(0, 10) : String(r.scheduled_date).slice(0, 10), r]));

  const a = byDate[first.date], b = byDate[second.date];
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  expect(Number(a.short_notice_surcharge)).toBeGreaterThan(0);
  expect(Number(b.short_notice_surcharge)).toBe(0);
  expect(Number(b.estimated_cost)).toBeLessThan(Number(a.estimated_cost));
});
