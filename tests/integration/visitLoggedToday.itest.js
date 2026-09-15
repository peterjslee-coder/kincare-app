/**
 * The dashboard remembers that a visit was logged. (v1.106.44)
 *
 * Pete: "I hit log this visit when it tagged me at mom's house. I left a note. The log visit
 * option is still remaining at the top of the screen. It should understand that I've logged a
 * visit and then not prompt me again."
 *
 * The client had a flag for this and the server never filled it in — it started false on every
 * load, so even after the render bug was fixed the nudge would have come back on his next
 * open, about a visit already in the record. The list of ids is what stops that, and this is
 * the test that it is the RIGHT list: today only, this person only, in the care recipient's
 * own timezone.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = { "/api/dashboard": "../../src/routes/dashboard" };

let h, pete, betty, other;

beforeAll(async () => {
  h = await startHarness({ routers: ROUTERS });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  betty = (await h.createCareTeam({ familyUserId: pete.user.id })).recipientId;
  other = (await h.createCareTeam({ familyUserId: pete.user.id })).recipientId;
  await h.db.prepare("UPDATE care_recipients SET timezone = 'America/New_York' WHERE id IN (?, ?)")
    .run(betty, other);
});

afterAll(async () => { await stopHarness(h); });

const clearVisits = () => h.db.prepare("DELETE FROM family_visits").run();

const logVisit = (recipientId, userId, agoMinutes) =>
  h.db.prepare(`
    INSERT INTO family_visits (id, care_recipient_id, user_id, visited_at, summary, logged_via, created_at)
    VALUES (?, ?, ?, NOW() - (? || ' minutes')::interval, 'Dropped in.', 'manual', NOW())
  `).run(uuid(), recipientId, userId, String(agoMinutes));

const loggedToday = async (who = pete) => {
  const res = await h.request.get("/api/dashboard").set(h.auth(who.token));
  expect(res.status).toBe(200);
  return res.body.visitLoggedToday;
};

beforeEach(clearVisits);

describe("which recipients already have a visit today", () => {
  test("the field exists and is a list, even when it is empty", async () => {
    expect(await loggedToday()).toEqual([]);
  });

  test("a visit logged a minute ago is there", async () => {
    await logVisit(betty, pete.user.id, 1);
    expect(await loggedToday()).toEqual([betty]);
  });

  test("it is per recipient — Betty's visit does not silence the other one", async () => {
    await logVisit(betty, pete.user.id, 1);
    const ids = await loggedToday();
    expect(ids).toContain(betty);
    expect(ids).not.toContain(other);
  });

  test("a second visit to the same person is still one entry", async () => {
    await logVisit(betty, pete.user.id, 1);
    await logVisit(betty, pete.user.id, 90);
    expect(await loggedToday()).toEqual([betty]);
  });

  test("somebody ELSE's visit to Betty is not Pete's visit", async () => {
    // The nudge is about what YOU did. A sibling logging a visit must not stop Pete being
    // asked about his own.
    const daniel = await h.createUser({ roles: ["family"], firstName: "Daniel" });
    await logVisit(betty, daniel.user.id, 1);
    expect(await loggedToday()).toEqual([]);
  });

  test("a visit from two days ago is not today", async () => {
    await logVisit(betty, pete.user.id, 60 * 48);
    expect(await loggedToday()).toEqual([]);
  });

  test("a visit 30 hours ago is inside the query window and still not today", async () => {
    // The SQL window is 36 hours precisely so this row is FETCHED and then rejected by the
    // timezone comparison. If the window were the filter, this would wrongly count.
    await logVisit(betty, pete.user.id, 30 * 60);
    expect(await loggedToday()).toEqual([]);
  });
});

describe("'today' is the recipient's day, not the server's", () => {
  test("a visit just after midnight in her zone counts as today", async () => {
    // Pinned to her timezone rather than UTC: at 21:00 in New York it is already tomorrow in
    // UTC, so a UTC date would drop a visit she had an hour ago.
    const tz = "America/New_York";
    const nowThere = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const minutesSinceMidnight = nowThere.getHours() * 60 + nowThere.getMinutes();
    if (minutesSinceMidnight < 5) return;              // ran within 5 minutes of midnight there
    await logVisit(betty, pete.user.id, Math.max(1, minutesSinceMidnight - 1));
    expect(await loggedToday()).toContain(betty);
  });

  test("a visit just BEFORE midnight in her zone is yesterday", async () => {
    const tz = "America/New_York";
    const nowThere = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const minutesSinceMidnight = nowThere.getHours() * 60 + nowThere.getMinutes();
    await logVisit(betty, pete.user.id, minutesSinceMidnight + 30);
    expect(await loggedToday()).not.toContain(betty);
  });

  test("two recipients in different zones are judged in their own", async () => {
    // Kiritimati is UTC+14 and Niue is UTC-11: 25 hours apart, so for a sizeable part of
    // every day these two are on different calendar dates and one query cannot serve both
    // unless it asks each recipient's own zone.
    await h.db.prepare("UPDATE care_recipients SET timezone = 'Pacific/Kiritimati' WHERE id = ?").run(betty);
    await h.db.prepare("UPDATE care_recipients SET timezone = 'Pacific/Niue' WHERE id = ?").run(other);
    await logVisit(betty, pete.user.id, 1);
    await logVisit(other, pete.user.id, 1);
    const ids = await loggedToday();
    // A visit one minute ago is "today" wherever you are; the point is that both resolve, and
    // neither throws on an unusual zone.
    expect(ids).toContain(betty);
    expect(ids).toContain(other);
    await h.db.prepare("UPDATE care_recipients SET timezone = 'America/New_York' WHERE id IN (?, ?)")
      .run(betty, other);
  });

  test("a recipient with no timezone set still resolves instead of throwing", async () => {
    await h.db.prepare("UPDATE care_recipients SET timezone = NULL WHERE id = ?").run(betty);
    await logVisit(betty, pete.user.id, 1);
    const ids = await loggedToday();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids).toContain(betty);
    await h.db.prepare("UPDATE care_recipients SET timezone = 'America/New_York' WHERE id = ?").run(betty);
  });
});
