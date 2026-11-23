/**
 * v1.148.0 — a proposed time on top of the caregiver's own booked visit.
 *
 * Pete, Nov 22: Kay had Betty's 2:00–8:00 PM visit on Nov 29 confirmed, then proposed moving the
 * open 8:00 AM six-hour visit to 1:30 PM. A proposal keeps the visit's length, so accepting it
 * would have booked her 1:30–7:30 on top of her own 2:00. The accept route refused it (409) —
 * and the Needs-you card read every 409 as "already done", reloaded, and showed the same Accept
 * again. A second "Time Proposals" list showed the same proposal with its own Accept.
 *
 * What must now be true:
 *   1. She cannot send that proposal. The refusal goes to her, the one person who can fix it.
 *   2. An older one that already exists reaches the family as Decline only — no Accept that
 *      can never work.
 *   3. The accept refusal says `done: false`, so the card shows it instead of swallowing it.
 *   4. An ordinary proposal offers Accept AND Decline on the one card, and Decline clears it.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "proposal-own-visit-secret";

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { attentionItemsFor } = require("../../src/utils/attention");

jest.setTimeout(180000);

let h, db, family, kay, profileId, recipientId;

const day = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();

async function makeSession({ status = "open", time = "08:00", hours = 6, caregiverId = null } = {}) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions
      (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
       scheduled_date, scheduled_time, duration_hours, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, ?, ?, ?, 138, NOW())
  `).run(id, recipientId, family.user.id, caregiverId, status, day, time, hours);
  return id;
}

async function seedProposal(sessionId, time) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO time_proposals (id, session_id, caregiver_profile_id, caregiver_user_id,
                                proposed_date, proposed_time, message, status, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'church till 1', 'pending', NOW() + INTERVAL '2 hours', NOW())
  `).run(id, sessionId, profileId, kay.user.id, day, time);
  return id;
}

const offerItems = async () =>
  (await attentionItemsFor(db, family.user.id)).items.filter((i) => i.kind === "timeOffer");

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/sessions": "../../src/routes/sessions" } });
  db = h.db;
  family = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  kay = await h.createUser({ roles: ["caregiver"], firstName: "Kay", lastName: "ITest" });
  profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_background_checked, care_stoplight, created_at)
    VALUES (?, ?, 23, 1, 'green', NOW())
  `).run(profileId, kay.user.id);
  ({ recipientId } = await h.createCareTeam({ familyUserId: family.user.id }));
});

afterEach(async () => {
  await db.prepare("UPDATE time_proposals SET status = 'expired' WHERE status = 'pending'").run();
  await db.prepare("UPDATE care_sessions SET status = 'cancelled' WHERE status IN ('open', 'confirmed')").run();
});
afterAll(async () => { await stopHarness(h); });

describe("Kay's Nov 29 case", () => {
  test("she cannot propose a time that lands on her own booked visit", async () => {
    await makeSession({ status: "confirmed", time: "14:00", caregiverId: profileId });
    const open = await makeSession();

    const res = await h.request.post(`/api/sessions/${open}/propose-time`)
      .set(h.auth(kay.token))
      .send({ proposedDate: day, proposedTime: "13:30", message: "church till 1" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CAREGIVER_BOOKED");
    expect(res.body.error).toMatch(/6 hours/);
    expect(res.body.error).toMatch(/1:30 PM/);
    const n = await db.prepare("SELECT COUNT(*)::int AS n FROM time_proposals WHERE session_id = ?").get(open);
    expect(n.n).toBe(0);
  });

  test("a time that clears her visit still goes through", async () => {
    await makeSession({ status: "confirmed", time: "14:00", caregiverId: profileId });
    const open = await makeSession({ hours: 4 });
    const res = await h.request.post(`/api/sessions/${open}/propose-time`)
      .set(h.auth(kay.token))
      .send({ proposedDate: day, proposedTime: "09:00" }); // 9–1, ends before 2
    expect(res.status).toBe(200);
  });

  test("an existing clashing proposal reaches the family as Decline only", async () => {
    await makeSession({ status: "confirmed", time: "14:00", caregiverId: profileId });
    const open = await makeSession();
    const pid = await seedProposal(open, "13:30");

    const [item] = await offerItems();
    expect(item).toBeTruthy();
    expect(item.verb).toBe("Decline");
    expect(item.action.path).toBe(`/api/sessions/${open}/proposals/${pid}/decline`);
    expect(item.dismiss).toBeUndefined();
    expect(item.note).toMatch(/already has a visit booked/);
  });

  test("accepting it anyway is refused with done:false, so the card shows the reason", async () => {
    await makeSession({ status: "confirmed", time: "14:00", caregiverId: profileId });
    const open = await makeSession();
    const pid = await seedProposal(open, "13:30");

    const res = await h.request.put(`/api/sessions/${open}/proposals/${pid}/accept`)
      .set(h.auth(family.token)).send({});
    expect(res.status).toBe(409);
    expect(res.body.done).toBe(false);
    expect(res.body.code).toBe("CAREGIVER_BOOKED");
  });
});

describe("an ordinary proposal: one card, both answers", () => {
  test("Accept and Decline are both on the Needs-you card, with what it replaces", async () => {
    const open = await makeSession();
    const pid = await seedProposal(open, "10:00");

    const [item] = await offerItems();
    expect(item.verb).toBe("Accept");
    expect(item.action.path).toBe(`/api/sessions/${open}/proposals/${pid}/accept`);
    expect(item.dismiss).toEqual(expect.objectContaining({
      label: "Decline", method: "PUT", path: `/api/sessions/${open}/proposals/${pid}/decline`,
    }));
    expect(item.originalTime).toBe("08:00");
    expect(item.durationHours).toBe(6);
  });

  test("Decline clears it, and a second Decline is 'already done', not an error", async () => {
    const open = await makeSession();
    const pid = await seedProposal(open, "10:00");

    const first = await h.request.put(`/api/sessions/${open}/proposals/${pid}/decline`)
      .set(h.auth(family.token)).send({});
    expect(first.status).toBe(200);
    expect(await offerItems()).toHaveLength(0);

    const again = await h.request.put(`/api/sessions/${open}/proposals/${pid}/decline`)
      .set(h.auth(family.token)).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_RESPONDED");
    expect(again.body.done).toBeUndefined();
  });

  test("a proposal on a visit that is no longer open is not shown", async () => {
    const open = await makeSession();
    await seedProposal(open, "10:00");
    await db.prepare("UPDATE care_sessions SET status = 'cancelled' WHERE id = ?").run(open);
    expect(await offerItems()).toHaveLength(0);
  });
});
