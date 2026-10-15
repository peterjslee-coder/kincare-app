/**
 * v1.119.1 — a check or cash reimbursement can be closed by the person it paid, and the app
 * asks both sides when nothing has closed it (feedback bfbb79bd).
 *
 * Pete: "Some of these deposits are via check. And it needs to prompt me to go back and ask if
 * I ever received payment. So for the driveway repairs, Sara wrote me a check for that and I
 * have deposited it. But it still shows as awaiting payment."
 */
const { startHarness, stopHarness } = require("./harness");
const { attentionItemsFor } = require("../../src/utils/attention");

jest.setTimeout(180000);

let h, db;
let pete, sara, other;
let teamId;

beforeAll(async () => {
  h = await startHarness();
  db = h.db;
  pete = await h.createUser({ firstName: "Pete", lastName: "Payee" });
  sara = await h.createUser({ firstName: "Sara", lastName: "Payer" });
  other = await h.createUser({ firstName: "Other", lastName: "Member" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id, billingUserId: sara.user.id });
  teamId = t.teamId;
  await h.addTeamMember(teamId, sara.user.id, "member");
  await h.addTeamMember(teamId, other.user.id, "member");
});
afterAll(async () => { await stopHarness(h); });

async function request(amount = 340, description = "Driveway repairs") {
  const res = await h.request.post("/api/reimbursements").set(h.auth(pete.token))
    .send({ careTeamId: teamId, amount, description, category: "other" });
  expect(res.status).toBe(201);
  return res.body.id;
}
const row = (id) => db.prepare("SELECT * FROM reimbursements WHERE id = ?").get(id);
const ageApproval = (id, days) => db.prepare(
  `UPDATE reimbursements SET approved_at = NOW() - (? || ' days')::interval WHERE id = ?`
).run(String(days), id);

describe("approving says how it will be paid", () => {
  test("payMethod is stored as planned_method", async () => {
    const id = await request();
    const res = await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "check" });
    expect(res.status).toBe(200);
    expect((await row(id)).planned_method).toBe("check");
  });

  test("an unknown payMethod is ignored, not stored", async () => {
    const id = await request();
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "bitcoin" });
    expect((await row(id)).planned_method).toBeNull();
  });
});

describe("POST /:id/mark-received", () => {
  test("the payee closes an approved check reimbursement", async () => {
    const id = await request();
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "check" });
    const res = await h.request.post(`/api/reimbursements/${id}/mark-received`).set(h.auth(pete.token))
      .send({ reference: "1042" });
    expect(res.status).toBe(200);
    const r = await row(id);
    expect(r.status).toBe("paid");
    expect(r.paid_method).toBe("check"); // from planned_method when none is sent
    expect(r.paid_reference).toBe("1042");
    expect(r.received_confirmed_by).toBe(pete.user.id);
    expect(r.paid_by).toBe(pete.user.id);
  });

  test("a second confirm is 409, already done", async () => {
    const id = await request();
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "cash" });
    await h.request.post(`/api/reimbursements/${id}/mark-received`).set(h.auth(pete.token)).send({});
    const again = await h.request.post(`/api/reimbursements/${id}/mark-received`).set(h.auth(pete.token)).send({});
    expect(again.status).toBe(409);
  });

  test("nobody but the payee can confirm it — not the approver, not another member", async () => {
    const id = await request();
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "check" });
    for (const u of [sara, other]) {
      const res = await h.request.post(`/api/reimbursements/${id}/mark-received`).set(h.auth(u.token)).send({});
      expect(res.status).toBe(403);
    }
    expect((await row(id)).status).toBe("approved");
  });

  test("a pending request cannot be confirmed — that would be approving your own", async () => {
    const id = await request();
    const res = await h.request.post(`/api/reimbursements/${id}/mark-received`).set(h.auth(pete.token)).send({});
    expect(res.status).toBe(400);
    expect((await row(id)).status).toBe("pending");
  });

  test("not while an in-app transfer is moving", async () => {
    const id = await request();
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({});
    await db.prepare("UPDATE reimbursements SET payout_status = 'processing' WHERE id = ?").run(id);
    const res = await h.request.post(`/api/reimbursements/${id}/mark-received`).set(h.auth(pete.token)).send({});
    expect(res.status).toBe(409);
  });
});

describe("the nudges", () => {
  const kindsFor = async (u, id) => (await attentionItemsFor(db, u.user.id)).items
    .filter((i) => i.id.endsWith(id)).map((i) => i.kind);

  test("check: payee is asked (soft) at 3 days; the payer's Pay item (hard) appears at day 10", async () => {
    const id = await request(55, "Hardware store");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "check" });

    expect(await kindsFor(pete, id)).toEqual([]);          // fresh: nobody asked
    await ageApproval(id, 4);
    const peteItems = (await attentionItemsFor(db, pete.user.id)).items.filter((i) => i.id.endsWith(id));
    expect(peteItems.map((i) => i.kind)).toEqual(["paymentArrived"]);
    expect(peteItems[0].soft).toBe(true);
    expect(peteItems[0].title).toBe("Did Sara's check for $55.00 arrive?");
    expect(peteItems[0].action.path).toBe(`/api/reimbursements/${id}/mark-received`);
    expect(await kindsFor(sara, id)).toEqual([]);           // 4 days: the check may be in the mail

    const saraTotalBefore = (await attentionItemsFor(db, sara.user.id)).total;
    await ageApproval(id, 11);
    const saraItems = (await attentionItemsFor(db, sara.user.id)).items.filter((i) => i.id.endsWith(id));
    expect(saraItems.map((i) => i.kind)).toEqual(["reimbursementUnpaid"]);
    expect(saraItems[0].title).toBe("Pay $55.00 to Pete Payee");
    expect(saraItems[0].dismiss).toBeUndefined();          // no "Not now" on money owed
    // v1.120.1 — hard: the payer IS the blocker, so it counts.
    expect((await attentionItemsFor(db, sara.user.id)).total).toBe(saraTotalBefore + 1);
  });

  test("an old request approved with no method still asks (Pete's driveway case)", async () => {
    const id = await request(340, "Driveway repairs");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({});
    await ageApproval(id, 6);
    const it = (await attentionItemsFor(db, pete.user.id)).items.find((i) => i.id === `paymentArrived:${id}`);
    expect(it.title).toBe("Have you been paid the $340.00?");
  });

  test("Got it closes it and the nudge goes away", async () => {
    const id = await request(20, "Parking");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "cash" });
    await ageApproval(id, 12);
    const it = (await attentionItemsFor(db, pete.user.id)).items.find((i) => i.id === `paymentArrived:${id}`);
    const res = await h.request.post(it.action.path).set(h.auth(pete.token)).send(it.action.body || {});
    expect(res.status).toBe(200);
    expect(await kindsFor(pete, id)).toEqual([]);
    expect(await kindsFor(sara, id)).toEqual([]);
  });

  test("Not yet snoozes it for that person only", async () => {
    const id = await request(30, "Batteries");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "check" });
    await ageApproval(id, 12);
    await db.prepare(`
      INSERT INTO nudge_snoozes (id, user_id, kind, ref, snoozed_until)
      VALUES (gen_random_uuid()::text, ?, 'paymentArrived', ?, NOW() + interval '3 days')
    `).run(pete.user.id, id);
    expect(await kindsFor(pete, id)).toEqual([]);
    expect(await kindsFor(sara, id)).toEqual(["reimbursementUnpaid"]);
  });

  test("planned in-app: the payee is never asked; the payer has a Pay item from the start", async () => {
    const id = await request(15, "Stamps");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "inplace" });
    expect(await kindsFor(sara, id)).toEqual(["reimbursementUnpaid"]);
    await ageApproval(id, 12);
    expect(await kindsFor(pete, id)).toEqual([]);
  });

  // v1.120.1 — the October Starlink case: a recurring occurrence (no planned method) for a payee
  // who can be paid in the app. The payee's one-tap "Got it" would close it with no money moved.
  test("payee who can be paid in the app, no method given: no 'Got it' nudge; the payer is asked to Pay", async () => {
    await db.prepare("UPDATE users SET stripe_onboard_complete = 1 WHERE id = ?").run(pete.user.id);
    try {
      const id = await request(95, "Starlink Gatehouse (recurring — October 2026)");
      await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({});
      await ageApproval(id, 4);
      expect(await kindsFor(pete, id)).toEqual([]);
      const it = (await attentionItemsFor(db, sara.user.id)).items.find((i) => i.id === `reimbursementUnpaid:${id}`);
      expect(it.verb).toBe("Pay");
      expect(it.action).toBeNull();                         // opens the row; Pay has its own confirm
      expect(it.focus).toBe(`reimbursement:${id}`);
      expect(it.note).toMatch(/no money has moved/);
    } finally {
      await db.prepare("UPDATE users SET stripe_onboard_complete = 0 WHERE id = ?").run(pete.user.id);
    }
  });
});

describe("reminders until it's paid (poller 115)", () => {
  const { sendUnpaidReimbursementReminders } = require("../../src/utils/reimbursementReminders");
  // 2 PM Eastern on a fixed day: inside the 9 AM–7 PM window whatever day the suite runs.
  const at = (iso) => new Date(iso);
  const run = async (now) => {
    const calls = [];
    await sendUnpaidReimbursementReminders(db, async (uid, payload, type) => calls.push({ uid, payload, type }), now);
    return calls;
  };
  const setApproved = (id, iso) => db.prepare("UPDATE reimbursements SET approved_at = ? WHERE id = ?").run(iso, id);

  test("in-app: day 2, then every 2 days, to the payer, naming amount and payee only", async () => {
    const id = await request(95, "Starlink Gatehouse secret-description");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({});
    await setApproved(id, "2026-10-11T00:22:45Z");

    expect((await run(at("2026-10-12T18:00:00Z"))).filter((c) => c.payload.data.reimbursementId === id)).toHaveLength(0); // day 1
    const first = (await run(at("2026-10-13T18:00:00Z"))).filter((c) => c.payload.data.reimbursementId === id);
    expect(first).toHaveLength(1);
    expect(first[0].uid).toBe(sara.user.id);
    expect(first[0].type).toBe("reimbursement_unpaid");
    expect(first[0].payload.body).toContain("$95.00 to Pete");
    expect(first[0].payload.body).not.toContain("secret");
    expect(first[0].payload.data.focus).toBe(`reimbursement:${id}`);

    // Same hour again: claimed, not resent.
    expect((await run(at("2026-10-13T18:30:00Z"))).filter((c) => c.payload.data.reimbursementId === id)).toHaveLength(0);
    // The real clock stamped pay_reminder_last_at = NOW(); step it to the fake timeline.
    await db.prepare("UPDATE reimbursements SET pay_reminder_last_at = ? WHERE id = ?").run("2026-10-13T18:00:00Z", id);
    expect((await run(at("2026-10-14T18:00:00Z"))).filter((c) => c.payload.data.reimbursementId === id)).toHaveLength(0);
    expect((await run(at("2026-10-15T18:00:00Z"))).filter((c) => c.payload.data.reimbursementId === id)).toHaveLength(1);
  });

  test("never outside 9 AM–7 PM where the care happens", async () => {
    const id = await request(12, "Late night");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({});
    await setApproved(id, "2026-10-01T12:00:00Z");
    // 03:00 UTC = 11 PM Eastern
    expect((await run(at("2026-10-10T03:00:00Z"))).filter((c) => c.payload.data.reimbursementId === id)).toHaveLength(0);
  });

  test("check/cash: nothing before day 10", async () => {
    const id = await request(40, "By check");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({ payMethod: "check" });
    await setApproved(id, "2026-10-01T12:00:00Z");
    expect((await run(at("2026-10-08T18:00:00Z"))).filter((c) => c.payload.data.reimbursementId === id)).toHaveLength(0);
    const due = (await run(at("2026-10-11T18:00:00Z"))).filter((c) => c.payload.data.reimbursementId === id);
    expect(due).toHaveLength(1);
    expect(due[0].payload.body).toContain("isn't marked paid");
  });

  test("paid means silent", async () => {
    const id = await request(18, "Paid already");
    await h.request.post(`/api/reimbursements/${id}/approve`).set(h.auth(sara.token)).send({});
    await setApproved(id, "2026-10-01T12:00:00Z");
    await h.request.post(`/api/reimbursements/${id}/mark-paid`).set(h.auth(sara.token)).send({ method: "zelle" });
    expect((await run(at("2026-10-10T18:00:00Z"))).filter((c) => c.payload.data.reimbursementId === id)).toHaveLength(0);
  });
});
