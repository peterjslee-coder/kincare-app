/**
 * v1.154.0 — the hand-off note.
 *
 * Pete, 11/23, the first day one caregiver handed over to another: "have the caretaker who's
 * leaving fill out notes before the other caretaker shows up or checks in." His rules: optional
 * (Skip is allowed, and the family sees it); only when the next visit starts within an hour of
 * this one's end; seen by the next caregiver and the family, not every caregiver on the team.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { nextVisitAfter, promptDue } = require("../../src/utils/handoff");

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
jest.setTimeout(180000);

let h, db, fam, tina, faith, other, recipientId;
const profile = {};

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/handoffs": "../../src/routes/handoffs" } });
  db = h.db;
  fam = await h.createUser({ roles: ["family"], firstName: "Sam" });
  ({ recipientId } = await h.createCareTeam({ familyUserId: fam.user.id }));
  for (const [k, name] of [["tina", "Jane"], ["faith", "Mia"], ["other", "Ava"]]) {
    const u = await h.createUser({ roles: ["caregiver"], firstName: name });
    profile[k] = uuid();
    await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(profile[k], u.user.id);
    if (k === "tina") tina = u; else if (k === "faith") faith = u; else other = u;
  }
});
afterAll(async () => { await stopHarness(h); });
beforeEach(async () => {
  await db.prepare("DELETE FROM visit_handoffs").run();
  await db.prepare("DELETE FROM care_sessions").run();
});

async function session(cg, time, hours, status = "confirmed", date = TODAY) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                               status, scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, ?, ?, ?, 100, NOW())
  `).run(id, recipientId, fam.user.id, profile[cg], status, date, time, hours);
  return id;
}
const get = (token, id) => h.request.get(`/api/handoffs/session/${id}`).set(h.auth(token));
const post = (token, id, body) => h.request.post(`/api/handoffs/session/${id}`).set(h.auth(token)).send(body);

test("the leaving caregiver writes it; the next one reads it; the family sees it was read", async () => {
  const out = await session("tina", "09:00", 8, "in_progress");
  const inn = await session("faith", "17:00", 3);

  const g = await get(tina.token, out);
  expect(g.status).toBe(200);
  expect(g.body.next).toMatchObject({ sessionId: inn, firstName: "Mia", time: "17:00" });

  const w = await post(tina.token, out, { condition: "napping", note: "Wake by 5:30." });
  expect(w.status).toBe(200);
  expect(w.body.handoff).toMatchObject({ condition: "napping", note: "Wake by 5:30.", toFirstName: "Mia" });

  const f = await get(faith.token, inn);
  expect(f.body.incoming).toMatchObject({ fromFirstName: "Jane", note: "Wake by 5:30.", readAt: null });
  const r = await h.request.post(`/api/handoffs/${f.body.incoming.id}/read`).set(h.auth(faith.token));
  expect(r.status).toBe(200);
  expect(r.body.readAt).toBeTruthy();

  const fam1 = await get(fam.token, out);
  expect(fam1.body.outgoing.readAt).toBeTruthy();
  expect(fam1.body.outgoing.skipped).toBe(false);
});

test("another caregiver can't read it, and only the one it is for can mark it read", async () => {
  const out = await session("tina", "09:00", 8, "in_progress");
  const inn = await session("faith", "17:00", 3);
  await session("other", "20:00", 2);
  const w = await post(tina.token, out, { note: "Back door sticks." });
  expect((await get(other.token, out)).status).toBe(404);
  expect((await get(other.token, inn)).status).toBe(404);
  expect((await h.request.post(`/api/handoffs/${w.body.handoff.id}/read`).set(h.auth(other.token))).status).toBe(404);
});

test("Skip is recorded for the family, never shown to the next caregiver, and a note can replace it", async () => {
  const out = await session("tina", "09:00", 8, "in_progress");
  const inn = await session("faith", "17:00", 3);
  await post(tina.token, out, { skip: true });
  expect((await get(fam.token, out)).body.outgoing.skipped).toBe(true);
  expect((await get(faith.token, inn)).body.incoming).toBeNull();
  await post(tina.token, out, { note: "Changed my mind." });
  expect((await get(faith.token, inn)).body.incoming.note).toBe("Changed my mind.");
  // and a Skip never wipes a note that was sent
  const again = await post(tina.token, out, { skip: true });
  expect(again.body.alreadySent).toBe(true);
});

test("no hand-off when nobody comes within the hour, or it's the same caregiver", async () => {
  const out = await session("tina", "09:00", 8, "in_progress");
  await session("faith", "18:30", 2);          // 90 minutes after the end
  await session("tina", "17:00", 2);           // herself
  const g = await get(tina.token, out);
  expect(g.body.next).toBeNull();
  expect((await post(tina.token, out, { note: "x" })).status).toBe(400);
});

test("overlaps and overnight count", async () => {
  const s = { id: "a", care_recipient_id: recipientId, caregiver_id: profile.tina, scheduled_date: TODAY, scheduled_time: "20:00", duration_hours: 5 };
  const tomorrow = new Date(Date.UTC(...TODAY.split("-").map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), 12) + 86400000).toISOString().slice(0, 10);
  const id = await session("faith", "00:30", 8, "confirmed", tomorrow);   // starts before Tina's 1:00 end
  const n = await nextVisitAfter(db, s);
  expect(n && n.sessionId).toBe(id);
});

test("promptDue: from fifteen minutes before the scheduled end", () => {
  const s = { scheduled_date: "2026-11-23", scheduled_time: "09:00", duration_hours: 8 };
  const tz = "America/New_York";
  const { buildDateTimeInZone } = require("../../src/utils/timezone");
  const at = (hhmm) => buildDateTimeInZone("2026-11-23", hhmm, tz);
  expect(promptDue(s, tz, at("16:44"))).toBe(false);
  expect(promptDue(s, tz, at("16:45"))).toBe(true);
  expect(promptDue(s, tz, at("17:30"))).toBe(true);
});
