/**
 * v1.156.0 — drop-in consent and awake noticing on the InPlace Hub (src/utils/dropIn.js).
 *
 * Pete, 11/24: "an acknowledgment that someone with a durable POA or that person has signed up
 * for drop-ins that might include microphone and camera usage without their active consent at
 * the time...recorded as purposeful." Who may drop in: "anyone I select." Listening: "don't
 * record audio. Speaking enough to be awake, call it 10 seconds."
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "drop-in-secret";

jest.mock("../../src/utils/push", () => ({ sendPushToUser: async () => ({ sent: 0 }) }));

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, leader, sister, stranger, mom, tina, recipientId, teamId;

beforeAll(async () => {
  h = await startHarness({ routers: {
    "/api/care-recipients": "../../src/routes/careRecipients",
    "/api/drop-in": "../../src/routes/dropIn",
    "/api/dashboard": "../../src/routes/dashboard",
  } });
  db = h.db;
  leader = await h.createUser({ firstName: "Pete", lastName: "ITest" });
  sister = await h.createUser({ firstName: "Sara", lastName: "ITest" });
  stranger = await h.createUser({ firstName: "Nobody", lastName: "ITest" });
  ({ recipientId, teamId } = await h.createCareTeam({ familyUserId: leader.user.id }));
  await h.addTeamMember(teamId, sister.user.id);
  tina = await h.createUser({ roles: ["caregiver"], firstName: "Tina", lastName: "ITest" });
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(uuid(), tina.user.id);
  await h.addTeamMember(teamId, tina.user.id);

  const r = await h.request.post(`/api/care-recipients/${recipientId}/own-login`).set(h.auth(leader.token))
    .send({ email: "mom-dropin@itest.local", password: "Kitchen#2026" });
  expect(r.status).toBe(201);
  const { generateToken } = require("../../src/middleware/auth");
  await h.verifyIdentity(r.body.userId);
  mom = { user: { id: r.body.userId }, token: generateToken({ id: r.body.userId, email: "mom-dropin@itest.local", roles: ["care_for"], role: "care_for" }) };
  const put = await h.request.put(`/api/care-recipients/${recipientId}/simple-mode`).set(h.auth(leader.token))
    .send({ on: true, callUserIds: [], hub: { on: true } });
  expect(put.status).toBe(200);
});

afterAll(async () => { await stopHarness(h); });

const get = (u) => h.request.get(`/api/drop-in/${recipientId}`).set(h.auth(u.token));
const D = () => require("../../src/utils/dropIn");

describe("signing", () => {
  test("the leader who is not her agent cannot sign; a hired caregiver sees nothing", async () => {
    const v = await get(leader);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ consent: null, canSign: false, isLeader: true });
    expect(v.body.wording).toMatch(/without asking/);
    const no = await h.request.post(`/api/drop-in/${recipientId}/consent`).set(h.auth(leader.token))
      .send({ signerName: "Pete ITest", agree: true, wordingVersion: v.body.wordingVersion });
    expect(no.status).toBe(403);
    expect((await get(tina)).status).toBe(404);
    expect((await get(stranger)).status).toBe(404);
  });

  test("once the leader is recorded as her POA agent, he signs; the exact wording is kept and audited", async () => {
    await db.prepare(`INSERT INTO recipient_authorities (care_recipient_id, kind, user_id, agent_name, set_by) VALUES (?, 'financial_poa', ?, 'Pete ITest', ?)`)
      .run(recipientId, leader.user.id, leader.user.id);
    const v = await get(leader);
    expect(v.body).toMatchObject({ canSign: true, capacity: "financial_poa" });
    const bad = await h.request.post(`/api/drop-in/${recipientId}/consent`).set(h.auth(leader.token))
      .send({ signerName: "Pete ITest", agree: true, wordingVersion: "old" });
    expect(bad.status).toBe(409);
    const ok = await h.request.post(`/api/drop-in/${recipientId}/consent`).set(h.auth(leader.token))
      .send({ signerName: "Pete ITest", agree: true, wordingVersion: v.body.wordingVersion });
    expect(ok.status).toBe(201);
    expect(ok.body.consent).toMatchObject({ signerName: "Pete ITest", capacity: "financial_poa", wording: v.body.wording });
    const row = await db.prepare("SELECT * FROM drop_in_consents WHERE care_recipient_id = ? AND revoked_at IS NULL").get(recipientId);
    expect(row).toMatchObject({ signed_by: leader.user.id, signer_capacity: "financial_poa", wording_text: v.body.wording });
    const log = await db.prepare("SELECT event_type FROM consent_audit_log WHERE care_recipient_id = ? AND event_type LIKE 'drop_in%'").all(recipientId);
    expect(log.map((x) => x.event_type)).toContain("drop_in_consent_signed");
  });

  test("she can sign for herself from her own account", async () => {
    const v = await get(mom);
    expect(v.body).toMatchObject({ canSign: true, capacity: "self" });
  });
});

describe("who may drop in", () => {
  test("the leader chooses from the family; a caregiver can't be chosen; only the chosen may drop in", async () => {
    const v = await get(leader);
    const ids = v.body.candidates.map((c) => c.userId);
    expect(ids).toEqual(expect.arrayContaining([leader.user.id, sister.user.id]));
    expect(ids).not.toContain(tina.user.id);
    expect(ids).not.toContain(mom.user.id);
    const s = await h.request.put(`/api/drop-in/${recipientId}/settings`).set(h.auth(leader.token))
      .send({ userIds: [sister.user.id, tina.user.id, stranger.user.id] });
    expect(s.body.chosen).toEqual([sister.user.id]);
    expect(await D().mayDropIn(db, recipientId, sister.user.id)).toBe(true);
    expect(await D().mayDropIn(db, recipientId, leader.user.id)).toBe(false);
    expect(await D().mayDropIn(db, recipientId, tina.user.id)).toBe(false);
    const notLeader = await h.request.put(`/api/drop-in/${recipientId}/settings`).set(h.auth(sister.token)).send({ userIds: [sister.user.id] });
    expect(notLeader.status).toBe(403);
  });
});

describe("noticing when she is up", () => {
  test("off until the leader turns it on; then minutes with movement, 10 s of talking or a touch become one period", async () => {
    const off = await h.request.post(`/api/drop-in/${recipientId}/awake`).set(h.auth(mom.token)).send({ motion: true });
    expect(off.body).toMatchObject({ recorded: false });
    await h.request.put(`/api/drop-in/${recipientId}/settings`).set(h.auth(leader.token)).send({ noticeAwake: true });
    const quiet = await h.request.post(`/api/drop-in/${recipientId}/awake`).set(h.auth(mom.token)).send({ voiceSeconds: 6 });
    expect(quiet.body.recorded).toBe(false);
    for (const body of [{ motion: true }, { voiceSeconds: 12 }, { touches: 2 }]) {
      const r = await h.request.post(`/api/drop-in/${recipientId}/awake`).set(h.auth(mom.token)).send(body);
      expect(r.body.recorded).toBe(true);
    }
    const rows = await db.prepare("SELECT * FROM hub_awake WHERE care_recipient_id = ?").all(recipientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ motion_minutes: 1, voice_minutes: 1, touches: 2 });
    // Only her own account reports.
    expect((await h.request.post(`/api/drop-in/${recipientId}/awake`).set(h.auth(leader.token)).send({ motion: true })).status).toBe(404);
  });

  test("last night reads as one plain sentence and goes into her care notes once each morning", async () => {
    const { lastNight, sentence, recordNightNote } = require("../../src/utils/awake");
    const tz = "America/New_York";
    const { getTodayStringInZone, zonedDateTimeToInstant } = require("../../src/utils/timezone");
    const today = getTodayStringInZone(tz);
    await db.prepare("DELETE FROM hub_awake WHERE care_recipient_id = ?").run(recipientId);
    await db.prepare("INSERT INTO hub_awake (id, care_recipient_id, started_at, ended_at, motion_minutes, voice_minutes) VALUES (?, ?, ?, ?, 120, 30)")
      .run(uuid(), recipientId, zonedDateTimeToInstant(today, "02:04", tz).toISOString(), zonedDateTimeToInstant(today, "05:10", tz).toISOString());
    const periods = await lastNight(db, recipientId, tz, "21:00", "07:00", today);
    const line = sentence("Betty", periods, tz);
    expect(line).toBe("Betty was up last night from about 2:04 AM to 5:10 AM (about 3 hours). The Hub noticed movement and talking.");
    const cr = await db.prepare("SELECT id, first_name, timezone, simple_mode FROM care_recipients WHERE id = ?").get(recipientId);
    const now = require("../../src/utils/timezone").getNowInZone(tz);
    if (now.getHours() >= 7) {
      expect(await recordNightNote(db, { ...cr, timezone: tz }, mom.user.id)).toBe(true);
      expect(await recordNightNote(db, { ...cr, timezone: tz }, mom.user.id)).toBe(false);
      const note = await db.prepare("SELECT content, note_type FROM recipient_notes WHERE care_recipient_id = ? AND note_type = 'hub_night'").get(recipientId);
      expect(note.content).toMatch(/^From the InPlace Hub: .* was up last night from about 2:04 AM to 5:10 AM/);
    }
  });

  test("withdrawing stops everything at once", async () => {
    const r = await h.request.post(`/api/drop-in/${recipientId}/revoke`).set(h.auth(mom.token)).send({});
    expect(r.status).toBe(200);
    expect(r.body.consent).toBeNull();
    expect(await D().mayDropIn(db, recipientId, sister.user.id)).toBe(false);
    expect(await D().mayNotice(db, recipientId)).toBe(false);
    const after = await h.request.post(`/api/drop-in/${recipientId}/awake`).set(h.auth(mom.token)).send({ motion: true });
    expect(after.body.recorded).toBe(false);
    const kept = await db.prepare("SELECT revoked_at, revoked_by FROM drop_in_consents WHERE care_recipient_id = ?").all(recipientId);
    expect(kept).toHaveLength(1);
    expect(kept[0].revoked_by).toBe(mom.user.id);
  });
});

describe("v1.156.1 — the leader asks the agent; she approves from Needs you", () => {
  let sara;
  beforeAll(async () => {
    sara = await h.createUser({ firstName: "Sara", lastName: "Agent" });
    await db.prepare(`INSERT INTO recipient_authorities (care_recipient_id, kind, user_id, agent_name, set_by) VALUES (?, 'healthcare_agent', ?, 'Sara Agent', ?)
      ON CONFLICT DO NOTHING`).run(recipientId, sara.user.id, leader.user.id);
  });

  test("a healthcare agent can sign (the kind is healthcare_agent), even off the care team", async () => {
    const v = await get(sara);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ canSign: true, capacity: "healthcare_agent", capacityLabel: "healthcare agent" });
  });

  test("the leader asks; it lands on her Needs-you card; she signs; the ask closes", async () => {
    const lv = await get(leader);
    const s = lv.body.signers.find((p) => p.userId === sara.user.id);
    expect(s).toMatchObject({ capacity: "healthcare_agent" });
    const ask = await h.request.post(`/api/drop-in/${recipientId}/request`).set(h.auth(leader.token)).send({ userId: sara.user.id });
    expect(ask.status).toBe(201);
    expect(ask.body.request).toMatchObject({ ofUserId: sara.user.id, forMe: false });
    const notSigner = await h.request.post(`/api/drop-in/${recipientId}/request`).set(h.auth(leader.token)).send({ userId: stranger.user.id });
    expect(notSigner.status).toBe(400);

    const { attentionItemsFor } = require("../../src/utils/attention");
    let att = await attentionItemsFor(db, sara.user.id);
    const card = att.items.find((i) => i.kind === "dropInConsent");
    expect(card).toMatchObject({ verb: "Review", action: null, focus: `dropIn:${recipientId}` });
    expect(att.dropInConsents).toBe(1);

    const sv = await get(sara);
    expect(sv.body.request.forMe).toBe(true);
    const ok = await h.request.post(`/api/drop-in/${recipientId}/consent`).set(h.auth(sara.token))
      .send({ signerName: "Sara Agent", agree: true, wordingVersion: sv.body.wordingVersion });
    expect(ok.status).toBe(201);
    expect(ok.body.consent).toMatchObject({ capacity: "healthcare_agent" });
    expect(ok.body.request).toBeNull();
    att = await attentionItemsFor(db, sara.user.id);
    expect(att.items.some((i) => i.kind === "dropInConsent")).toBe(false);
    await h.request.post(`/api/drop-in/${recipientId}/revoke`).set(h.auth(leader.token)).send({});
  });

  test("Not now closes the ask and the card", async () => {
    await h.request.post(`/api/drop-in/${recipientId}/request`).set(h.auth(leader.token)).send({ userId: sara.user.id });
    const no = await h.request.post(`/api/drop-in/${recipientId}/decline`).set(h.auth(sara.token)).send({});
    expect(no.status).toBe(200);
    expect(no.body.request).toBeNull();
    const { attentionItemsFor } = require("../../src/utils/attention");
    expect((await attentionItemsFor(db, sara.user.id)).dropInConsents).toBe(0);
  });
});
