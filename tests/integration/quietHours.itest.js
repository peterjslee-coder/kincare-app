/**
 * v1.107.3 — quiet hours through the real push path and the real summary sweep.
 */
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, push, qh;

// A window around "now" in Eastern time, so the test does not depend on when it runs.
const hhmm = (mins) => {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const nowEt = () => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
};
const around = () => ({ enabled: true, start: hhmm(nowEt() - 60), end: hhmm(nowEt() + 60), tz: "America/New_York" });
const later = () => ({ enabled: true, start: hhmm(nowEt() + 120), end: hhmm(nowEt() + 180), tz: "America/New_York" });

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/auth": "../../src/routes/auth" } });
  db = h.db;
  push = require("../../src/routes/push");
  qh = require("../../src/utils/quietHours");
});
afterAll(async () => { await stopHarness(h); });

async function userWith(quiet) {
  const u = await h.createUser({ roles: ["family"], firstName: "Quiet" });
  await db.prepare("UPDATE users SET notification_prefs = ? WHERE id = ?")
    .run(JSON.stringify({ quiet_hours: quiet }), u.user.id);
  return u;
}
const held = async (id) => Number((await db.prepare("SELECT held_count FROM quiet_hours_held WHERE user_id = ?").get(id))?.held_count || 0);
const inApp = async (id) => Number((await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?").get(id)).n);

describe("during quiet hours", () => {
  test("an ordinary push is held, but still recorded in Activity", async () => {
    const u = await userWith(around());
    const r = await push.sendPushToUser(u.user.id, { title: "New note", body: "x", data: { type: "team_note" } }, "team_note");
    expect(r.reason).toBe("quiet_hours");
    expect(await held(u.user.id)).toBe(1);
    expect(await inApp(u.user.id)).toBe(1);
  });

  test("a call is held too", async () => {
    const u = await userWith(around());
    const r = await push.sendPushToUser(u.user.id, { title: "Call", body: "x", data: { type: "call_incoming" } });
    expect(r.reason).toBe("quiet_hours");
  });

  test("safety, visit problems and payment action still go through", async () => {
    const u = await userWith(around());
    for (const t of ["safety_flag", "overdue_check_in", "caregiver_no_show", "payment_method_needed"]) {
      const r = await push.sendPushToUser(u.user.id, { title: t, body: "x", data: { type: t } }, t);
      expect(r.reason).not.toBe("quiet_hours");
    }
    expect(await held(u.user.id)).toBe(0);
  });
});

describe("outside quiet hours", () => {
  test("nothing is held", async () => {
    const u = await userWith(later());
    const r = await push.sendPushToUser(u.user.id, { title: "New note", body: "x", data: { type: "team_note" } }, "team_note");
    expect(r.reason).not.toBe("quiet_hours");
    expect(await held(u.user.id)).toBe(0);
  });

  test("with quiet hours switched off, nothing is held", async () => {
    const u = await userWith({ ...around(), enabled: false });
    const r = await push.sendPushToUser(u.user.id, { title: "n", body: "x" }, "team_note");
    expect(r.reason).not.toBe("quiet_hours");
  });
});

describe("the summary", () => {
  test("is sent once, with the count, only after the window ends", async () => {
    const u = await userWith(around());
    for (let i = 0; i < 3; i++) await push.sendPushToUser(u.user.id, { title: "n", body: "x" }, "team_note");
    expect(await held(u.user.id)).toBe(3);

    const calls = [];
    const fake = async (uid, payload, type) => { calls.push({ uid, payload, type }); };

    // Still quiet: nothing sent, nothing cleared.
    await qh.sendQuietHourSummaries(db, fake);
    expect(calls.filter((c) => c.uid === u.user.id)).toHaveLength(0);
    expect(await held(u.user.id)).toBe(3);

    // Window over (move it into the future): one summary, count cleared.
    await db.prepare("UPDATE users SET notification_prefs = ? WHERE id = ?")
      .run(JSON.stringify({ quiet_hours: later() }), u.user.id);
    await qh.sendQuietHourSummaries(db, fake);
    const mine = calls.filter((c) => c.uid === u.user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].payload.body).toBe("3 updates came in during quiet hours.");
    expect(mine[0].type).toBe("quiet_hours_summary");
    expect(await held(u.user.id)).toBe(0);

    // And not again.
    await qh.sendQuietHourSummaries(db, fake);
    expect(calls.filter((c) => c.uid === u.user.id)).toHaveLength(1);
  });

  test("a user who switched quiet hours off still gets what was held", async () => {
    const u = await userWith(around());
    await push.sendPushToUser(u.user.id, { title: "n", body: "x" }, "team_note");
    await db.prepare("UPDATE users SET notification_prefs = ? WHERE id = ?")
      .run(JSON.stringify({ quiet_hours: { ...around(), enabled: false } }), u.user.id);
    const calls = [];
    await qh.sendQuietHourSummaries(db, async (uid, p) => calls.push({ uid, p }));
    expect(calls.filter((c) => c.uid === u.user.id)).toHaveLength(1);
    expect(calls.find((c) => c.uid === u.user.id).p.body).toBe("1 update came in during quiet hours.");
  });
});

describe("the setting is saved through the account route", () => {
  test("PUT /api/auth/me stores quiet_hours with the rest of the prefs", async () => {
    const u = await h.createUser({ roles: ["family"], firstName: "Setter" });
    const res = await h.request.put("/api/auth/me").set(h.auth(u.token))
      .send({ notificationPrefs: { push_messages: true, quiet_hours: { enabled: true, start: "22:00", end: "07:00", tz: "America/Chicago" } } });
    expect(res.status).toBe(200);
    const row = await db.prepare("SELECT notification_prefs FROM users WHERE id = ?").get(u.user.id);
    expect(JSON.parse(row.notification_prefs).quiet_hours).toEqual({ enabled: true, start: "22:00", end: "07:00", tz: "America/Chicago" });
  });
});
