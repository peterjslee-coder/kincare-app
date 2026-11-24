/**
 * v1.109.4 — the nudge when nothing is booked next week.
 *
 * Pete (7e3ff970): "There needs to be a reminder to set up appointments if there's nothing a
 * week out. No gate or anything just a nudge like a needs you card for Betty has no
 * appointments next week, make one now?"
 *
 * The two things that make it a nudge rather than a gate: it never reaches the app-icon count,
 * and "Not now" really puts it away.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

const ROUTERS = { "/api/push": "../../src/routes/push" };
const TZ = "America/New_York";
const dayIn = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
};

let h, db, family, recipientId;

const items = async (token) => {
  const res = await h.request.get("/api/push/attention/items").set(h.auth(token));
  expect(res.status).toBe(200);
  return res.body;
};
const nudge = (body) => (body.items || []).find((i) => i.kind === "emptyWeek");

const book = async (date, status = "confirmed") => {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, 'companionship', ?, ?, '09:00', 4, 88, NOW())
  `).run(id, recipientId, family.user.id, status, date);
  return id;
};

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  db = h.db;
  family = await h.createUser({ roles: ["family"], firstName: "Pete" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
  await db.prepare("UPDATE care_recipients SET first_name = 'Betty', timezone = ? WHERE id = ?").run(TZ, recipientId);
});
afterAll(async () => { await stopHarness(h); });

describe("nothing booked next week", () => {
  test("an empty calendar raises the nudge — and it is NOT on the app icon", async () => {
    const body = await items(family.token);
    const n = nudge(body);
    expect(n).toBeTruthy();
    expect(n.title).toBe("Betty has nothing booked next week");
    expect(n.soft).toBe(true);
    expect(n.page).toBe("schedule");
    expect(n.action).toBeNull();
    // The badge's definition is "you are the blocker". Nobody is blocked by an empty calendar.
    expect(body.total).toBe(0);
    expect(body.emptyWeeks).toBe(1);
  });

  test("a visit inside the week silences it; one outside the week does not", async () => {
    const far = await book(dayIn(20));
    expect(nudge(await items(family.token))).toBeTruthy();

    const near = await book(dayIn(3));
    expect(nudge(await items(family.token))).toBeFalsy();

    // Cancelling it brings the nudge back — a cancelled visit is not an appointment.
    await db.prepare("UPDATE care_sessions SET status = 'cancelled' WHERE id = ?").run(near);
    expect(nudge(await items(family.token))).toBeTruthy();

    // An OPEN request counts: he asked for care, and nudging him to ask again is the app not
    // reading its own calendar.
    await db.prepare("UPDATE care_sessions SET status = 'open' WHERE id = ?").run(near);
    expect(nudge(await items(family.token))).toBeFalsy();

    await db.prepare("DELETE FROM care_sessions WHERE id IN (?, ?)").run(near, far);
  });

  test("\"Not now\" puts it away for a week, and re-snoozing extends rather than stacks", async () => {
    const n = nudge(await items(family.token));
    expect(n.dismiss.path).toBe("/api/push/attention/snooze");

    const res = await h.request.post(n.dismiss.path).set(h.auth(family.token)).send(n.dismiss.body);
    expect(res.status).toBe(200);
    expect(res.body.snoozedDays).toBe(7);
    expect(nudge(await items(family.token))).toBeFalsy();

    await h.request.post(n.dismiss.path).set(h.auth(family.token)).send(n.dismiss.body);
    const rows = await db.prepare("SELECT COUNT(*)::int AS n FROM nudge_snoozes WHERE user_id = ?").get(family.user.id);
    expect(rows.n).toBe(1);

    // When it lapses it comes back — a snooze is not a dismissal.
    await db.prepare("UPDATE nudge_snoozes SET snoozed_until = NOW() - interval '1 hour' WHERE user_id = ?").run(family.user.id);
    expect(nudge(await items(family.token))).toBeTruthy();
  });

  test("only snoozable kinds can be snoozed", async () => {
    const res = await h.request.post("/api/push/attention/snooze")
      .set(h.auth(family.token)).send({ kind: "reimbursement", ref: "x" });
    expect(res.status).toBe(400);
  });

  test("someone with no recipients gets no nudge", async () => {
    const stranger = await h.createUser({ roles: ["family"] });
    expect(nudge(await items(stranger.token))).toBeFalsy();
  });
});
