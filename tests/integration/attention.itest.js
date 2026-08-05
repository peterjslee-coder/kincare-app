/**
 * v1.105.40 — the attention count, against a REAL database.
 *
 * attentionCountFor() wraps every query in safe(), which returns 0 on any error. That is
 * right for production — a badge must never take down a push send — but it means a typo in
 * a column name produces a badge that is permanently zero and a log line nobody reads.
 * The unit tests use a fake db and cannot see it.
 *
 * So this file seeds real rows and asserts the counts are NON-ZERO. If any of the four
 * queries stops matching the schema, the number here drops to 0 and this fails.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");
const { attentionCountFor } = require("../../src/utils/attention");

jest.setTimeout(180000);

let h, db;
let leader, member, billing, outsider;
let teamId, recipientId;

beforeAll(async () => {
  h = await startHarness();
  db = h.db;
  leader = await h.createUser({ firstName: "Lea", lastName: "Der" });
  member = await h.createUser({ firstName: "Mem", lastName: "Ber" });
  billing = await h.createUser({ firstName: "Sara", lastName: "Payer" });
  outsider = await h.createUser({ firstName: "Out", lastName: "Sider" });
  const t = await h.createCareTeam({ familyUserId: leader.user.id, billingUserId: billing.user.id });
  teamId = t.teamId;
  recipientId = t.recipientId;
  await h.addTeamMember(teamId, member.user.id, "member");
  await h.addTeamMember(teamId, billing.user.id, "member");
});

afterAll(async () => { await stopHarness(h); });

describe("Sara's case, end to end", () => {
  test("a pending reimbursement badges the billing contact and nobody else", async () => {
    await h.request.post("/api/reimbursements")
      .set(h.auth(member.token))
      .send({ careTeamId: teamId, amount: 42.5, description: "Groceries", category: "groceries" });

    const sara = await attentionCountFor(db, billing.user.id);
    expect(sara.reimbursements).toBe(1);
    expect(sara.total).toBe(1);

    // The person who submitted it is not the blocker.
    expect((await attentionCountFor(db, member.user.id)).reimbursements).toBe(0);
    // Neither is the leader, once a billing contact exists.
    expect((await attentionCountFor(db, leader.user.id)).reimbursements).toBe(0);
    // Nor anyone outside the team.
    expect((await attentionCountFor(db, outsider.user.id)).total).toBe(0);
  });

  test("approving it clears the badge", async () => {
    const row = await db.prepare(
      `SELECT id FROM reimbursements WHERE care_team_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(teamId);
    await db.prepare(`UPDATE reimbursements SET status = 'approved' WHERE id = ?`).run(row.id);
    expect((await attentionCountFor(db, billing.user.id)).reimbursements).toBe(0);
  });

  test("with no billing contact the leader is the approver", async () => {
    const noBillLeader = await h.createUser({ firstName: "Solo", lastName: "Leader" });
    const t2 = await h.createCareTeam({ familyUserId: noBillLeader.user.id, name: "No Billing" });
    const submitter = await h.createUser({ firstName: "Sub", lastName: "Mitter" });
    await h.addTeamMember(t2.teamId, submitter.user.id, "member");
    await db.prepare(`
      INSERT INTO reimbursements (id, care_team_id, care_recipient_id, requested_by, payee_user_id,
                                  amount, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, 10, 'Pharmacy run', 'pending', NOW())
    `).run(uuid(), t2.teamId, t2.recipientId, submitter.user.id, submitter.user.id);
    expect((await attentionCountFor(db, noBillLeader.user.id)).reimbursements).toBe(1);
  });
});

describe("the other three queries actually match the schema", () => {
  // Each seeds a row directly, then asserts the count moves. A silent SQL error would
  // leave it at 0.
  test("a pending time-change proposal counts for the booking family", async () => {
    const sessionId = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, service_type, status,
                                 scheduled_date, scheduled_time, duration_hours, created_at)
      VALUES (?, ?, ?, 'companionship', 'confirmed', '2026-09-01', '10:00', 2, NOW())
    `).run(sessionId, recipientId, leader.user.id);

    const cg = await h.createUser({ firstName: "Care", lastName: "Giver", roles: ["caregiver"] });
    const profileId = uuid();
    await db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())
    `).run(profileId, cg.user.id);

    await db.prepare(`
      INSERT INTO time_proposals (id, session_id, caregiver_profile_id, caregiver_user_id,
                                  proposed_date, proposed_time, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, '2026-09-01', '14:00', 'pending', NOW() + INTERVAL '2 days', NOW())
    `).run(uuid(), sessionId, profileId, cg.user.id);

    expect((await attentionCountFor(db, leader.user.id)).timeChanges).toBe(1);

    // An expired one is not actionable.
    await db.prepare(`UPDATE time_proposals SET expires_at = NOW() - INTERVAL '1 day'`).run();
    expect((await attentionCountFor(db, leader.user.id)).timeChanges).toBe(0);
  });

  test("an overdue task assigned to me counts; an unassigned one counts for nobody", async () => {
    const taskId = uuid();
    await db.prepare(`
      INSERT INTO care_tasks (id, care_recipient_id, created_by, title, task_type,
                              due_time, start_date, assigned_user_id, created_at)
      VALUES (?, ?, ?, 'Evening check', 'other', '18:00', '2026-08-01', ?, NOW())
    `).run(taskId, recipientId, leader.user.id, member.user.id);
    await db.prepare(`
      INSERT INTO care_task_occurrences (id, task_id, due_date, due_at, status)
      VALUES (?, ?, '2026-08-01', NOW() - INTERVAL '2 hours', 'pending')
    `).run(uuid(), taskId);
    expect((await attentionCountFor(db, member.user.id)).careTasks).toBe(1);

    const orphanId = uuid();
    await db.prepare(`
      INSERT INTO care_tasks (id, care_recipient_id, created_by, title, task_type,
                              due_time, start_date, created_at)
      VALUES (?, ?, ?, 'Team task', 'other', '18:00', '2026-08-01', NOW())
    `).run(orphanId, recipientId, leader.user.id);
    await db.prepare(`
      INSERT INTO care_task_occurrences (id, task_id, due_date, due_at, status)
      VALUES (?, ?, '2026-08-01', NOW() - INTERVAL '2 hours', 'pending')
    `).run(uuid(), orphanId);
    // Still 1 — the unassigned occurrence badges nobody.
    expect((await attentionCountFor(db, member.user.id)).careTasks).toBe(1);
    expect((await attentionCountFor(db, leader.user.id)).careTasks).toBe(0);

    // Completing it clears.
    await db.prepare(`UPDATE care_task_occurrences SET status = 'completed'`).run();
    expect((await attentionCountFor(db, member.user.id)).careTasks).toBe(0);
  });

  test("an unread message counts for the reader, never the sender", async () => {
    const convId = uuid();
    await db.prepare(`INSERT INTO conversations (id, created_at) VALUES (?, NOW())`).run(convId);
    for (const u of [leader, member]) {
      await db.prepare(`
        INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at)
        VALUES (?, ?, ?, 'member', NOW())
      `).run(uuid(), convId, u.user.id);
    }
    await db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, recipient_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, 'hello', 0, NOW())
    `).run(uuid(), convId, member.user.id, leader.user.id);

    expect((await attentionCountFor(db, leader.user.id)).messages).toBe(1);
    expect((await attentionCountFor(db, member.user.id)).messages).toBe(0);

    await db.prepare(`UPDATE messages SET is_read = 1`).run();
    expect((await attentionCountFor(db, leader.user.id)).messages).toBe(0);
  });
});

describe("the shape the badge relies on", () => {
  test("a user with nothing waiting gets a real zero, not a null", async () => {
    const r = await attentionCountFor(db, outsider.user.id);
    expect(r).toEqual({ total: 0, reimbursements: 0, timeChanges: 0, careTasks: 0, messages: 0 });
    expect(Number.isFinite(r.total)).toBe(true);
  });
});
