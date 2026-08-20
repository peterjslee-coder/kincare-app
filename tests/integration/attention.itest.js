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

  // v1.105.62 — the SECOND proposal table. time_change_proposals is a change to an
  // already-booked session, and until now the badge ignored it entirely. It is the more
  // urgent of the two: it has no expires_at and nothing sweeps it, so it sits pending
  // forever while the visit stays on the calendar with a caregiver expecting to work it.
  // Pete's call to count it.
  test("a pending change to a BOOKED session counts for whoever must answer", async () => {
    const sessionId = uuid();
    const cg = await h.createUser({ firstName: "Book", lastName: "Ed", roles: ["caregiver"] });
    const profileId = uuid();
    await db.prepare(`
      INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())
    `).run(profileId, cg.user.id);
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type,
                                 status, scheduled_date, scheduled_time, duration_hours, created_at)
      VALUES (?, ?, ?, ?, 'companionship', 'confirmed', '2026-09-02', '10:00', 2, NOW())
    `).run(sessionId, recipientId, leader.user.id, profileId);

    const propId = uuid();
    await db.prepare(`
      INSERT INTO time_change_proposals (id, session_id, proposed_by, proposed_by_user_id,
        original_time, original_duration, proposed_time, proposed_duration, status, created_at)
      VALUES (?, ?, 'caregiver', ?, '10:00', 2, '13:00', 2, 'pending', NOW())
    `).run(propId, sessionId, cg.user.id);
    await db.prepare(`UPDATE care_sessions SET pending_time_change_id = ? WHERE id = ?`).run(propId, sessionId);

    // The caregiver proposed, so the family is the blocker.
    expect((await attentionCountFor(db, leader.user.id)).timeChanges).toBe(1);
    // You are never the blocker on your own proposal.
    expect((await attentionCountFor(db, cg.user.id)).timeChanges).toBe(0);
    // Nor is anyone outside it.
    expect((await attentionCountFor(db, outsider.user.id)).timeChanges).toBe(0);

    // The other direction: family proposes, caregiver answers.
    await db.prepare(`UPDATE time_change_proposals SET proposed_by = 'family', proposed_by_user_id = ? WHERE id = ?`)
      .run(leader.user.id, propId);
    expect((await attentionCountFor(db, cg.user.id)).timeChanges).toBe(1);
    expect((await attentionCountFor(db, leader.user.id)).timeChanges).toBe(0);

    // A change to a cancelled visit is not answerable, so it must not badge anyone.
    await db.prepare(`UPDATE care_sessions SET status = 'cancelled' WHERE id = ?`).run(sessionId);
    expect((await attentionCountFor(db, cg.user.id)).timeChanges).toBe(0);
    await db.prepare(`UPDATE care_sessions SET status = 'confirmed' WHERE id = ?`).run(sessionId);

    // And one the UI can no longer reach — the session's pointer cleared while the row stays
    // 'pending' — is unclearable by construction. Same rule as the orphaned care task below.
    await db.prepare(`UPDATE care_sessions SET pending_time_change_id = NULL WHERE id = ?`).run(sessionId);
    expect((await attentionCountFor(db, cg.user.id)).timeChanges).toBe(0);

    // Clean up so later assertions in this file start from zero.
    await db.prepare(`UPDATE time_change_proposals SET status = 'rejected' WHERE id = ?`).run(propId);
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
  });
});

// ─── v1.105.42 — the 78 ───
//
// Pete's icon read 78 and nothing he did moved it. The count used `messages.is_read`,
// which the app only ever writes for LEGACY direct messages (every UPDATE that sets it
// ends `AND conversation_id IS NULL`). Joined against conversation_members, the filter
// was vacuously true and the badge was "every message ever sent in any conversation you
// are in". The v1.105.40 unit tests passed throughout, because a fake db cannot tell you
// that a WHERE clause is always true.
//
// These tests are the ones that would have caught it: real rows, real reads, and the
// number has to come back DOWN.
describe("the 78 — reading a message must actually clear it", () => {
  let convId, reader, writer;

  beforeAll(async () => {
    reader = await h.createUser({ firstName: "Pete", lastName: "Reader" });
    writer = await h.createUser({ firstName: "Sara", lastName: "Writer" });
    convId = uuid();
    await db.prepare(`INSERT INTO conversations (id, created_at, updated_at) VALUES (?, NOW(), NOW())`).run(convId);
    for (const u of [reader, writer]) {
      await db.prepare(`
        INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at)
        VALUES (?, ?, ?, 'member', NOW() - INTERVAL '10 days')
      `).run(uuid(), convId, u.user.id);
    }
    // Ten days of conversation nobody has opened yet.
    for (let i = 0; i < 10; i++) {
      await db.prepare(`
        INSERT INTO messages (id, conversation_id, sender_id, recipient_id, content, is_read, created_at)
        VALUES (?, ?, ?, ?, 'hi', 0, NOW() - INTERVAL '1 day' * ?)
      `).run(uuid(), convId, writer.user.id, reader.user.id, i);
    }
  });

  test("before opening the thread, all ten count", async () => {
    expect((await attentionCountFor(db, reader.user.id)).messages).toBe(10);
  });

  test("opening the thread drops it to zero — THE regression", async () => {
    // This is what the app does when you open a conversation (routes/messages.js).
    // Under the old query this number stayed at 10 forever.
    await db.prepare(
      "UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?"
    ).run(convId, reader.user.id);
    expect((await attentionCountFor(db, reader.user.id)).messages).toBe(0);
  });

  test("a new message after that read counts again — exactly one", async () => {
    await db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, recipient_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, 'one more', 0, NOW() + INTERVAL '1 second')
    `).run(uuid(), convId, writer.user.id, reader.user.id);
    expect((await attentionCountFor(db, reader.user.id)).messages).toBe(1);
  });

  test("is_read is NOT what decides it — the flag the app never sets for conversations", async () => {
    // Pin the actual root cause: flipping is_read must change nothing, because the app
    // does not flip it for conversation messages and never did.
    await db.prepare("UPDATE messages SET is_read = 1 WHERE conversation_id = ?").run(convId);
    expect((await attentionCountFor(db, reader.user.id)).messages).toBe(1);
  });

  test("an archived conversation stops counting — you can't clear what you can't see", async () => {
    await db.prepare(
      "UPDATE conversation_members SET archived_at = NOW() WHERE conversation_id = ? AND user_id = ?"
    ).run(convId, reader.user.id);
    expect((await attentionCountFor(db, reader.user.id)).messages).toBe(0);
    await db.prepare(
      "UPDATE conversation_members SET archived_at = NULL WHERE conversation_id = ? AND user_id = ?"
    ).run(convId, reader.user.id);
  });

  test("Kindred relay messages don't badge — they're read in Kindred chat", async () => {
    const kindredId = uuid();
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, role, roles,
                         is_active, is_admin, account_approved, email_verified, created_at)
      VALUES (?, 'kindred@yourinplace.com', 'x', 'Kindred', 'Relay', 'family', '["family"]', 1, 0, 1, 1, NOW())
    `).run(kindredId);
    await db.prepare(`
      INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at)
      VALUES (?, ?, ?, 'member', NOW())
    `).run(uuid(), convId, kindredId);
    const before = (await attentionCountFor(db, reader.user.id)).messages;
    await db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, recipient_id, content, is_read, created_at)
      VALUES (?, ?, ?, ?, 'relayed', 0, NOW() + INTERVAL '2 seconds')
    `).run(uuid(), convId, kindredId, reader.user.id);
    expect((await attentionCountFor(db, reader.user.id)).messages).toBe(before);
  });

  test("the badge agrees with the app's own unread count, message for message", async () => {
    // The stated goal in v1.105.40 was that the icon, the push payload and the in-app
    // count can never disagree. That only holds if they run the SAME definition — so run
    // the conversations-list query here and compare.
    const cm = await db.prepare(
      "SELECT last_read_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?"
    ).get(convId, reader.user.id);
    const inApp = await db.prepare(`
      SELECT COUNT(*) AS count FROM messages
      WHERE conversation_id = ? AND sender_id != ?
        AND created_at > COALESCE(?::TIMESTAMPTZ, '1970-01-01'::TIMESTAMPTZ)
        AND sender_id NOT IN (SELECT id FROM users WHERE email = 'kindred@yourinplace.com')
    `).get(convId, reader.user.id, cm.last_read_at);
    expect((await attentionCountFor(db, reader.user.id)).messages)
      .toBe(parseInt(inApp.count, 10));
  });
});

describe("a task you can no longer see must not badge you", () => {
  test("occurrences of a deactivated task stop counting", async () => {
    // The nightly sweeper rolls yesterday's pending occurrences to 'missed', but only for
    // ACTIVE tasks. Pause or delete a task and its pending rows are orphaned: invisible in
    // the UI, permanently 'pending', and — before this version — permanently counted.
    const owner = await h.createUser({ firstName: "Task", lastName: "Owner" });
    const taskId = uuid();
    await db.prepare(`
      INSERT INTO care_tasks (id, care_recipient_id, created_by, title, task_type,
                              due_time, start_date, assigned_user_id, is_active, created_at)
      VALUES (?, ?, ?, 'Ghost task', 'other', '09:00', '2026-08-01', ?, 1, NOW())
    `).run(taskId, recipientId, leader.user.id, owner.user.id);
    await db.prepare(`
      INSERT INTO care_task_occurrences (id, task_id, due_date, due_at, status)
      VALUES (?, ?, '2026-08-02', NOW() - INTERVAL '3 hours', 'pending')
    `).run(uuid(), taskId);
    expect((await attentionCountFor(db, owner.user.id)).careTasks).toBe(1);

    await db.prepare("UPDATE care_tasks SET is_active = 0 WHERE id = ?").run(taskId);
    expect((await attentionCountFor(db, owner.user.id)).careTasks).toBe(0);
  });
});

describe("the shape the badge relies on", () => {
  test("a user with nothing waiting gets a real zero, not a null", async () => {
    const r = await attentionCountFor(db, outsider.user.id);
    expect(r).toEqual({ total: 0, reimbursements: 0, timeChanges: 0, timeChangeSessionId: null, careTasks: 0, messages: 0 });
    expect(Number.isFinite(r.total)).toBe(true);
  });
});


// ─── v1.105.105 ───
//
// Pete, 917f3787: five unread messages showed in the "Needs you" tile and should not — "I
// wanted to show up as the notifications over the message pill" — while Julia's time-change
// request, the thing that actually needed him, "doesn't do anything. It is a dead end."
describe("unread messages are counted but do not badge", () => {
  let reader, writer, convId;

  beforeAll(async () => {
    reader = await h.createUser({ firstName: "Pete", lastName: "Reader" });
    writer = await h.createUser({ firstName: "Jules", lastName: "Writer" });
    convId = uuid();
    await db.prepare("INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)")
      .run(convId, writer.user.id);
    for (const u of [reader, writer]) {
      await db.prepare(
        "INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, 'member', NOW() - INTERVAL '1 day')"
      ).run(uuid(), convId, u.user.id);
    }
    for (let i = 0; i < 5; i++) {
      await db.prepare(
        "INSERT INTO messages (id, conversation_id, sender_id, recipient_id, content, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())"
      ).run(uuid(), convId, writer.user.id, reader.user.id, `hello ${i}`);
    }
  });

  test("the five unread are reported", async () => {
    expect((await attentionCountFor(db, reader.user.id)).messages).toBe(5);
  });

  test("but the badge stays at zero — nothing is waiting on a decision from him", async () => {
    // The card and the app icon both read `total`. If messages left the card but stayed in
    // the total, the icon would sit permanently five higher than the list that itemises it.
    expect((await attentionCountFor(db, reader.user.id)).total).toBe(0);
  });
});

describe("the time-change row knows which visit to open", () => {
  let fam, cg, sessionId, propId;

  beforeAll(async () => {
    fam = await h.createUser({ firstName: "Fam", lastName: "Ily" });
    cg = await h.createUser({ firstName: "Care", lastName: "Giver", roles: ["caregiver"] });
    const t = await h.createCareTeam({ familyUserId: fam.user.id });
    const profileId = uuid();
    await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())")
      .run(profileId, cg.user.id);
    sessionId = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, scheduled_date, scheduled_time, duration_hours, status, created_at)
      VALUES (?, ?, ?, ?, 'companionship', CURRENT_DATE + 3, '09:00', 3, 'confirmed', NOW())
    `).run(sessionId, t.recipientId, fam.user.id, profileId);
    propId = uuid();
    await db.prepare(`
      INSERT INTO time_change_proposals (id, session_id, proposed_by, proposed_by_user_id,
        original_time, original_duration, proposed_time, proposed_duration, status, created_at)
      VALUES (?, ?, 'caregiver', ?, '09:00', 3, '11:00', 3, 'pending', NOW())
    `).run(propId, sessionId, cg.user.id);
    await db.prepare("UPDATE care_sessions SET pending_time_change_id = ? WHERE id = ?").run(propId, sessionId);
  });

  test("the counterparty gets the count AND the session id", async () => {
    const r = await attentionCountFor(db, fam.user.id);
    expect(r.timeChanges).toBe(1);
    expect(r.timeChangeSessionId).toBe(sessionId);   // a real id, not the number 0
  });

  test("the proposer gets neither — you are not the blocker on your own proposal", async () => {
    // The caregiver IS booked on this session, so the only reason she gets nothing is that
    // she is the one who proposed. Without the caregiver_id link above this would pass
    // vacuously.
    const r = await attentionCountFor(db, cg.user.id);
    expect(r.timeChanges).toBe(0);
    expect(r.timeChangeSessionId).toBeNull();
  });

  test("flip who proposed and the destination flips with it", async () => {
    await db.prepare("UPDATE time_change_proposals SET proposed_by = 'family', proposed_by_user_id = ? WHERE id = ?")
      .run(fam.user.id, propId);
    expect((await attentionCountFor(db, cg.user.id)).timeChangeSessionId).toBe(sessionId);
    expect((await attentionCountFor(db, fam.user.id)).timeChangeSessionId).toBeNull();
    await db.prepare("UPDATE time_change_proposals SET proposed_by = 'caregiver', proposed_by_user_id = ? WHERE id = ?")
      .run(cg.user.id, propId);
  });

  test("answering it takes the destination away too", async () => {
    await db.prepare("UPDATE care_sessions SET pending_time_change_id = NULL WHERE id = ?").run(sessionId);
    const r = await attentionCountFor(db, fam.user.id);
    expect(r.timeChanges).toBe(0);
    expect(r.timeChangeSessionId).toBeNull();
  });
});
