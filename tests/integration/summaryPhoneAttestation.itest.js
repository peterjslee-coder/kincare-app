/**
 * v1.144.0 — three things from Nov 21.
 *
 * 1. The iPAi visit summary reads the person's earlier visits (report taps, moods, notes), oldest
 *    first, so it can say what changed. Pete: "string data a little more between visits."
 * 2. An admin can set a loved one's own phone (Kit typed his dad's number wrong and had nowhere
 *    to fix it). Consent is bound to the number, so the new one is not texted until it says YES.
 * 3. The tier-3 approve no longer 500s on an UPDATE with its own ORDER BY / LIMIT, and the
 *    attestation is actually stamped.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, admin;

async function trustThisNetwork(as) {
  const probe = await h.request.get("/api/admin/overview").set(h.auth(as.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  const { registerTrustedIp } = require("../../src/utils/trustedIps");
  await registerTrustedIp(as.user.id, ip, { verifiedVia: "itest" });
}

async function setup(name, cgName) {
  const family = await h.createUser({ firstName: name, lastName: "Fam" });
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id, name: `${name} team` });
  const cg = await h.createUser({ firstName: cgName, lastName: "Care", roles: ["caregiver"] });
  const profileId = uuid();
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, rate_daytime, created_at)
    VALUES (?, ?, 22, 22, NOW())
  `).run(profileId, cg.user.id);
  return { family, recipientId, profileId };
}

async function visit(s, date, { note = "", arrival = null, departure = null, answers = [], status = "completed" } = {}) {
  const id = uuid();
  await db.prepare(`
    INSERT INTO care_sessions (id, care_recipient_id, family_user_id, caregiver_id, service_type, status,
      scheduled_date, scheduled_time, duration_hours, proposed_rate, estimated_cost, created_at)
    VALUES (?, ?, ?, ?, 'companionship', ?, ?, '09:00', 8, 22, 176, NOW())
  `).run(id, s.recipientId, s.family.user.id, s.profileId, status, date);
  await db.prepare(`
    INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, check_out_time, arrival_mood, departure_mood, summary, created_at)
    VALUES (?, ?, ?, NOW(), NOW(), ?, ?, ?, NOW())
  `).run(uuid(), id, s.profileId, arrival, departure, note);
  for (const [topic, ref, value, n] of answers) {
    await db.prepare(`
      INSERT INTO visit_report_answers (id, session_id, care_recipient_id, topic, ref, value, note, answered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), id, s.recipientId, topic, ref, value, n || null, s.family.user.id);
  }
  return id;
}

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin": "../../src/routes/admin" } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  await trustThisNetwork(admin);
});
afterAll(async () => { await stopHarness(h); });

describe("visit summary inputs", () => {
  test("today plus earlier completed visits, oldest first, raw input only", async () => {
    const s = await setup("Jane", "Sam");
    await visit(s, "2026-11-18", { note: "Grocery run", arrival: '["happy"]', answers: [["fluids", "", "good"]] });
    await visit(s, "2026-11-19", { note: "Looked for the dog", answers: [["fluids", "", "good"], ["fall", "", "near"]] });
    await visit(s, "2026-11-20", { note: "never happened", status: "cancelled" });
    await visit(s, "2026-11-25", { note: "a later visit" });
    const today = await visit(s, "2026-11-21", { note: "Watched a show", arrival: '["happy","busy"]', departure: '["calm"]',
      answers: [["fluids", "", "some"], ["meal", "breakfast", "all"]] });
    // An earlier AI summary must never feed this one (iPAi cardinal rule).
    await db.prepare("UPDATE visit_logs SET ai_summary = ? WHERE session_id IN (SELECT id FROM care_sessions WHERE care_recipient_id = ?)")
      .run(JSON.stringify({ summary: "AI-WROTE-THIS" }), s.recipientId);

    const { sessionSummaryInputs, buildSessionSummaryPrompt } = require("../../src/utils/careIntelligence");
    const inputs = await sessionSummaryInputs(db, today);
    expect(inputs.visit.note).toBe("Watched a show");
    expect(inputs.visit.caregiver).toBe("Sam");
    expect(inputs.visit.arrival).toBe("happy, busy");
    expect(inputs.visit.report).toMatch(/Drinks: Some/);
    expect(inputs.history.map((v) => v.date)).toEqual(["2026-11-18", "2026-11-19"]);
    expect(inputs.history[1].report).toMatch(/Near-fall|near/i);

    const prompt = buildSessionSummaryPrompt(inputs);
    expect(prompt).toContain("EARLIER VISITS");
    expect(prompt).toContain("Looked for the dog");
    expect(prompt).not.toContain("never happened");
    expect(prompt).not.toContain("a later visit");
    expect(prompt).not.toContain("AI-WROTE-THIS");
    expect(prompt.indexOf("2026-11-18")).toBeLessThan(prompt.indexOf("2026-11-19"));
  });

  test("a first visit says so", async () => {
    const s = await setup("Ann", "Lee");
    const only = await visit(s, "2026-11-21", { note: "First day" });
    const { sessionSummaryInputs, buildSessionSummaryPrompt } = require("../../src/utils/careIntelligence");
    const inputs = await sessionSummaryInputs(db, only);
    expect(inputs.history).toEqual([]);
    expect(buildSessionSummaryPrompt(inputs)).toMatch(/first visit with a record/);
  });
});

describe("admin: a loved one's own phone", () => {
  test("sets it, shows it in family comp, and the old consent does not carry over", async () => {
    const s = await setup("Kim", "Pat");
    await db.prepare("UPDATE care_recipients SET sms_phone = '(555) 201-7743', sms_consent_at = NOW(), sms_consent_phone = '(555) 201-7743' WHERE id = ?").run(s.recipientId);
    const res = await h.request.put(`/api/admin/care-recipients/${s.recipientId}/phone`).set(h.auth(admin.token)).send({ phone: "+1 (555) 201-7742" });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe("(555) 201-7742");

    const { consentedSql } = require("../../src/utils/smsConsent");
    const row = await db.prepare(`SELECT sms_phone, ${consentedSql("cr")} AS ok FROM care_recipients cr WHERE id = ?`).get(s.recipientId);
    expect(row.sms_phone).toBe("(555) 201-7742");
    expect(!!row.ok).toBe(false);

    const comp = await h.request.get(`/api/admin/users/${s.family.user.id}/family-comp`).set(h.auth(admin.token));
    expect(comp.body.recipients[0].phone).toBe("(555) 201-7742");
  });

  test("rejects a number that is not one", async () => {
    const s = await setup("Rae", "Max");
    const res = await h.request.put(`/api/admin/care-recipients/${s.recipientId}/phone`).set(h.auth(admin.token)).send({ phone: "555-12" });
    expect(res.status).toBe(400);
  });

  test("is admin-only", async () => {
    const s = await setup("Bo", "Cy");
    const res = await h.request.put(`/api/admin/care-recipients/${s.recipientId}/phone`).set(h.auth(s.family.token)).send({ phone: "(555) 201-0000" });
    expect([401, 403]).toContain(res.status);
  });
});

describe("admin: tier-3 approve", () => {
  test("approves without a 500 and stamps only the newest attestation", async () => {
    const s = await setup("Joy", "Ida");
    await db.prepare("UPDATE care_recipients SET authorization_tier = 'tier3', consent_status = 'pending' WHERE id = ?").run(s.recipientId);
    const older = uuid(), newer = uuid();
    for (const [id, ago] of [[older, "2 days"], [newer, "1 hour"]]) {
      await db.prepare(`
        INSERT INTO attestations (id, care_recipient_id, attesting_user_id, relationship_to_recipient, attestation_text, signature_name, admin_status, created_at)
        VALUES (?, ?, ?, 'Child', 'text', 'Joy Fam', 'pending', NOW() - INTERVAL '${ago}')
      `).run(id, s.recipientId, s.family.user.id);
    }
    const res = await h.request.put(`/api/admin/authorizations/${s.recipientId}`).set(h.auth(admin.token)).send({ action: "approve" });
    expect(res.status).toBe(200);
    const rows = await db.prepare("SELECT id, admin_status FROM attestations WHERE care_recipient_id = ?").all(s.recipientId);
    expect(rows.find((r) => r.id === newer).admin_status).toBe("approved");
    expect(rows.find((r) => r.id === older).admin_status).toBe("pending");
  });
});
