/**
 * v1.105.41 — the digest sweep, against a REAL database.
 *
 * composeDigest() is now pure and unit-tested, but it can only be right if the sweeper
 * actually hands it the payee's name and the reader's id. That lookup is a JOIN added in
 * this version, and sweepReimbursementDigests() wraps each item in try/catch +
 * captureException — so a broken query means every reimbursement push silently stops,
 * with the digest rows marked sent. That is precisely the failure this file exists to
 * catch.
 */
const { startHarness, stopHarness } = require("./harness");
const {
  enqueueReimbursementDigest,
  sweepReimbursementDigests,
  composeDigest,
} = require("../../src/services/reimbursementDigest");

jest.setTimeout(180000);

let h, db;
let pete, daniel, sara;   // leader, payee, billing contact — the three-way fan-out
let teamId, reimbursementId;

beforeAll(async () => {
  h = await startHarness();
  db = h.db;
  pete = await h.createUser({ firstName: "Pete", lastName: "Lee" });
  daniel = await h.createUser({ firstName: "Daniel", lastName: "Ruiz" });
  sara = await h.createUser({ firstName: "Sara", lastName: "Payer" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id, billingUserId: sara.user.id });
  teamId = t.teamId;
  await h.addTeamMember(teamId, daniel.user.id, "member");
  await h.addTeamMember(teamId, sara.user.id, "member");

  // Daniel asks to be reimbursed for the sink.
  const res = await h.request.post("/api/reimbursements")
    .set(h.auth(daniel.token))
    .send({ careTeamId: teamId, amount: 655, description: "Plumber — replace kitchen sink", category: "home" });
  reimbursementId = res.body.id;

  // Sara approves it.
  await h.request.post(`/api/reimbursements/${reimbursementId}/approve`)
    .set(h.auth(sara.token));
});

afterAll(async () => { await stopHarness(h); });

describe("Sara approved Daniel's request", () => {
  test("approving fans a digest out to the other two, not to Sara", async () => {
    const rows = await db.prepare(
      "SELECT user_id FROM reimbursement_push_digests WHERE reimbursement_id = ? AND sent = 0"
    ).all(reimbursementId);
    const ids = rows.map((r) => r.user_id).sort();
    expect(ids).toEqual([daniel.user.id, pete.user.id].sort());
    expect(ids).not.toContain(sara.user.id);
  });

  test("the sweeper's lookup really returns the payee's first name", async () => {
    // The JOIN added in v1.105.41. If this comes back undefined, every body degrades to
    // "a team member's" — vague enough that nobody would report it as a bug.
    const r = await db.prepare(`
      SELECT rb.*, pu.first_name AS payee_first_name
      FROM reimbursements rb
      LEFT JOIN users pu ON pu.id = rb.payee_user_id
      WHERE rb.id = ?
    `).get(reimbursementId);
    expect(r.payee_first_name).toBe("Daniel");
    expect(r.status).toBe("approved");
    expect(r.approved_by).toBe(sara.user.id);
  });

  test("Pete's push says Daniel's name; Daniel's says 'your' — from real rows", async () => {
    const r = await db.prepare(`
      SELECT rb.*, pu.first_name AS payee_first_name
      FROM reimbursements rb LEFT JOIN users pu ON pu.id = rb.payee_user_id
      WHERE rb.id = ?
    `).get(reimbursementId);
    const actor = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(r.approved_by);

    const forPete = composeDigest(r, {
      actorFirstName: actor.first_name, actorId: r.approved_by,
      payeeFirstName: r.payee_first_name, recipientUserId: pete.user.id,
    });
    const forDaniel = composeDigest(r, {
      actorFirstName: actor.first_name, actorId: r.approved_by,
      payeeFirstName: r.payee_first_name, recipientUserId: daniel.user.id,
    });

    // The exact sentence Pete should have received on 8/6.
    expect(forPete.body).toBe("Sara approved Daniel's $655.00 — awaiting payment.");
    expect(forDaniel.body).toBe("Sara approved your $655.00 — awaiting payment.");
    // And neither one puts the sink on a lock screen.
    expect(forPete.body + forDaniel.body).not.toMatch(/sink|Plumber/i);
  });
});

describe("the sweep runs end to end", () => {
  test("due digests are claimed exactly once and the sweep does not throw", async () => {
    await db.prepare("UPDATE reimbursement_push_digests SET fire_at = NOW() - INTERVAL '1 minute'").run();
    const first = await sweepReimbursementDigests();
    expect(first).toBe(2);                       // Pete and Daniel
    const second = await sweepReimbursementDigests();
    expect(second).toBe(0);                      // no double-send
    const left = await db.prepare(
      "SELECT COUNT(*) AS count FROM reimbursement_push_digests WHERE sent = 0"
    ).get();
    expect(parseInt(left.count, 10)).toBe(0);
  });

  test("a digest whose reimbursement vanished doesn't wedge the sweep", async () => {
    await enqueueReimbursementDigest(db, {
      userId: pete.user.id, reimbursementId: "does-not-exist", careTeamId: teamId,
    });
    await db.prepare("UPDATE reimbursement_push_digests SET fire_at = NOW() - INTERVAL '1 minute' WHERE sent = 0").run();
    await expect(sweepReimbursementDigests()).resolves.toBe(1);
  });
});
