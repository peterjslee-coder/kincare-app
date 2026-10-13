/**
 * v1.114.0 — care tools come with care booked through InPlace.
 *
 * Pete, 10/13: "until your commission fees to IP has passed about $20/mo, no video/voice, no
 * care notes, no scheduling, no reimbursement, no hours, tasks... basically they get messaging
 * and visits logged." Rolling 30 days; locked = read-only; medication reminders, medical
 * records and legal documents stay free; his own family is exempt. And for caregivers: "only
 * sessions that are booked and paid in app get the checkin/notes/etc."
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, admin;

const todayStr = () => new Date().toISOString().slice(0, 10);

async function caregiverWithProfile(name) {
  const cg = await h.createUser({ roles: ["caregiver"], firstName: name, lastName: "Cg", careToolsOpen: false });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_available, created_at)
    VALUES (?, ?, 22, 1, NOW())
  `).run(profileId, cg.user.id);
  return { ...cg, profileId };
}

async function lockedFamily(name) {
  const fam = await h.createUser({ firstName: name, lastName: "Fam", careToolsOpen: false });
  const { recipientId, teamId } = await h.createCareTeam({ familyUserId: fam.user.id });
  return { fam, recipientId, teamId };
}

async function earn(recipientId, platformCents, daysAgo = 1) {
  await db.prepare(`
    INSERT INTO ledger_entries (id, care_recipient_id, kind, status, family_cents, caregiver_cents, platform_cents, created_at)
    VALUES (?, ?, 'capture', 'succeeded', ?, ?, ?, NOW() - (? || ' days')::interval)
  `).run(uuid(), recipientId, platformCents * 6, platformCents * 5, platformCents, String(daysAgo));
}

const note = (token, recipientId) => h.request.post("/api/notes").set(h.auth(token))
  .send({ careRecipientId: recipientId, content: "Ate lunch, walked to the mailbox.", noteType: "general" });

const task = (token, recipientId, type) => h.request.post("/api/care-tasks").set(h.auth(token)).send({
  care_recipient_id: recipientId, title: type === "medication" ? "Evening pill" : "Water the kitchen plant",
  task_type: type, recurrence: "daily", due_time: "19:00", start_date: todayStr(),
});

beforeAll(async () => {
  h = await startHarness({
    routers: {
      "/api/notes": "../../src/routes/notes",
      "/api/care-tasks": "../../src/routes/careTasks",
      "/api/care-tools": "../../src/routes/careTools",
      "/api/admin/financials": "../../src/routes/financials",
    },
  });
  db = h.db;
  admin = await h.createUser({ firstName: "Pete", lastName: "Admin", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
});
afterAll(async () => { await stopHarness(h); });

describe("a family that has not booked care", () => {
  test("care notes and non-medication tasks are refused with CARE_TOOLS_LOCKED; reading is not", async () => {
    const { fam, recipientId } = await lockedFamily("Locked");
    const n = await note(fam.token, recipientId);
    expect(n.status).toBe(403);
    expect(n.body.code).toBe("CARE_TOOLS_LOCKED");
    expect(n.body.feature).toBe("notes");
    expect(n.body.careNeededCents).toBe(10000); // $20 at 20% = $100 of care

    const t = await task(fam.token, recipientId, "custom");
    expect(t.status).toBe(403);
    expect(t.body.feature).toBe("tasks");

    const read = await h.request.get(`/api/notes/${recipientId}`).set(h.auth(fam.token));
    expect(read.status).toBe(200);
  });

  test("medication reminders stay free — create and check off", async () => {
    const { fam, recipientId } = await lockedFamily("Meds");
    const t = await task(fam.token, recipientId, "medication");
    expect(t.status).toBe(201);
    const occ = await db.prepare("SELECT id FROM care_task_occurrences WHERE task_id = ?").get(t.body.task.id);
    expect(occ).toBeTruthy(); // a test that cannot fail is worse than none
    {
      const chk = await h.request.post(`/api/care-tasks/occurrences/${occ.id}/check`).set(h.auth(fam.token)).send({});
      expect(chk.body.code).not.toBe("CARE_TOOLS_LOCKED");
    }
  });

  test("status says locked and how much care opens it", async () => {
    const { fam } = await lockedFamily("Status");
    const s = await h.request.get("/api/care-tools/status").set(h.auth(fam.token));
    expect(s.status).toBe(200);
    expect(s.body.locked).toBe(true);
    expect(s.body.careNeededCents).toBe(10000);
    expect(s.body.commissionCents).toBeUndefined(); // InPlace's take is not shown to families
  });
});

describe("the $20 / rolling 30 days rule", () => {
  test("$20 of commission in the last 30 days opens the tools", async () => {
    const { fam, recipientId } = await lockedFamily("Paid");
    await earn(recipientId, 2000, 3);
    expect((await note(fam.token, recipientId)).status).toBeLessThan(300);
    expect((await task(fam.token, recipientId, "custom")).status).toBe(201);
  });

  test("$19.99 does not", async () => {
    const { fam, recipientId } = await lockedFamily("Short");
    await earn(recipientId, 1999, 3);
    expect((await note(fam.token, recipientId)).status).toBe(403);
  });

  test("commission from 31 days ago does not count", async () => {
    const { fam, recipientId } = await lockedFamily("Stale");
    await earn(recipientId, 5000, 31);
    expect((await note(fam.token, recipientId)).status).toBe(403);
  });

  test("a sibling on the team is opened by the family's bookings", async () => {
    const { recipientId, teamId } = await lockedFamily("Sib");
    const sib = await h.createUser({ firstName: "Sib", lastName: "Ling", careToolsOpen: false });
    await h.addTeamMember(teamId, sib.user.id, "member");
    await earn(recipientId, 2500, 2);
    const s = await h.request.get("/api/care-tools/status").set(h.auth(sib.token));
    expect(s.body.locked).toBe(false);
  });
});

describe("exemptions", () => {
  test("Pete's own family: a recipient an admin is on the team of", async () => {
    const { fam, recipientId, teamId } = await lockedFamily("Founder");
    await h.addTeamMember(teamId, admin.user.id, "leader");
    expect((await note(fam.token, recipientId)).status).toBeLessThan(300);
  });

  test("the admin switch opens a family by hand", async () => {
    const { fam, recipientId } = await lockedFamily("Comped");
    await db.prepare("UPDATE users SET care_tools_open_at = NOW() WHERE id = ?").run(fam.user.id);
    expect((await note(fam.token, recipientId)).status).toBeLessThan(300);
  });
});

describe("caregivers — tools ride on a paid visit", () => {
  async function teamWithCaregiver(name) {
    const f = await lockedFamily(name);
    await earn(f.recipientId, 3000, 2); // the family itself is open; that is not what opens her
    const cg = await caregiverWithProfile(name);
    await h.addTeamMember(f.teamId, cg.user.id, "member");
    return { ...f, cg };
  }
  async function visit(f, { status, paid }) {
    const id = uuid();
    await db.prepare(`
      INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
        scheduled_date, scheduled_time, duration_hours, estimated_cost, payment_status, created_at)
      VALUES (?, ?, ?, ?, 'companionship', ?, ?, '10:00', 4, 88, ?, NOW())
    `).run(id, f.recipientId, f.fam.user.id, f.cg.profileId, status, todayStr(), paid ? "authorized" : null);
    return id;
  }

  test("on the team, no visit: she cannot add a care note", async () => {
    const f = await teamWithCaregiver("NoVisit");
    const n = await note(f.cg.token, f.recipientId);
    expect(n.status).toBe(403);
    expect(n.body.code).toBe("CARE_TOOLS_LOCKED");
    expect(n.body.audience).toBe("caregiver");
  });

  test("during a visit that is booked but NOT paid: still no", async () => {
    const f = await teamWithCaregiver("Unpaid");
    await visit(f, { status: "in_progress", paid: false });
    expect((await note(f.cg.token, f.recipientId)).status).toBe(403);
  });

  test("during a paid visit: yes", async () => {
    const f = await teamWithCaregiver("PaidVisit");
    await visit(f, { status: "in_progress", paid: true });
    expect((await note(f.cg.token, f.recipientId)).status).toBeLessThan(300);
  });

  test("a paid visit for someone else does not open this family", async () => {
    const f = await teamWithCaregiver("Elsewhere");
    const other = await lockedFamily("OtherFam");
    await h.addTeamMember(other.teamId, f.cg.user.id, "member");
    await visit({ ...other, cg: f.cg }, { status: "in_progress", paid: true });
    expect((await note(f.cg.token, f.recipientId)).status).toBe(403);
  });

  test("outside a paid visit she cannot check off tasks — medication included", async () => {
    const f = await teamWithCaregiver("Checks");
    const t = await task(f.fam.token, f.recipientId, "medication");
    expect(t.status).toBe(201);
    const occ = await db.prepare("SELECT id FROM care_task_occurrences WHERE task_id = ?").get(t.body.task.id);
    expect(occ).toBeTruthy(); // a test that cannot fail is worse than none
    {
      const chk = await h.request.post(`/api/care-tasks/occurrences/${occ.id}/check`).set(h.auth(f.cg.token)).send({});
      expect(chk.status).toBe(403);
      expect(chk.body.code).toBe("CARE_TOOLS_LOCKED");
    }
  });
});

describe("the admin report", () => {
  test("flags a team whose caregiver is active with no paid visits", async () => {
    const { fam, recipientId, teamId } = await lockedFamily("Flag");
    const cg = await caregiverWithProfile("Flag");
    await h.addTeamMember(teamId, cg.user.id, "member");
    await db.prepare(`
      INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, created_at)
      VALUES (?, ?, ?, 'old note from before the lock', NOW() - INTERVAL '2 days')
    `).run(uuid(), recipientId, cg.user.id);
    const r = await h.request.get("/api/admin/financials/care-tools-report").set(h.auth(admin.token));
    expect(r.status).toBe(200);
    const row = r.body.rows.find((x) => x.recipientId === recipientId);
    expect(row.flagOffApp).toBe(true);
    expect(row.toolsState).toBe("locked");
    expect(row.caregiverActivity30d.notes).toBe(1);
    expect(row.ownerEmail).toBe(fam.user.email);
  });
});
