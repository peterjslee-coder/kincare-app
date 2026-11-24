/**
 * v1.110 — Legal & Financial Readiness, phase 1 (051_legal_readiness).
 *
 * The rules that matter: readiness follows the documents and the family's answers (and
 * "not answered" is its own state); caregivers never see any of it; the directory falls back
 * to statewide; a family report reaches admins without its text on a lock screen; a flag
 * reaches a family ONLY when an admin shares it, without the message; acknowledging twice is
 * a 409; and only admins edit the directory.
 */
const { v4: uuid } = require("uuid");
const { startHarness, stopHarness } = require("./harness");

jest.setTimeout(180000);

let h, db, pete, sister, julia, stranger, admin, recipientId, teamId;
const pushes = [];
const adminNotes = [];
const FLAGGED_TEXT = "Betty gave me her debit card PIN so I can take out cash for myself";

beforeAll(async () => {
  const push = require("../../src/routes/push");
  push.sendPushToUser = async (userId, payload) => { pushes.push({ userId, payload }); return { sent: 1 }; };
  push.notifyAdmins = (eventType, payload) => { adminNotes.push({ eventType, payload }); };
  h = await startHarness({ routers: { "/api/legal-readiness": "../../src/routes/legalReadiness" } });
  h.app.use("/api/admin/legal-readiness", require("../../src/routes/legalReadiness").adminRouter);
  db = h.db;
  pete = await h.createUser({ roles: ["family"], firstName: "Pete" });
  sister = await h.createUser({ roles: ["family"], firstName: "Sis" });
  julia = await h.createUser({ roles: ["caregiver"], firstName: "Julia" });
  stranger = await h.createUser({ roles: ["family"], firstName: "Stranger" });
  admin = await h.createUser({ roles: ["family"], firstName: "Admin", isAdmin: true });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  recipientId = t.recipientId; teamId = t.teamId;
  await h.addTeamMember(teamId, sister.user.id);
  await h.addTeamMember(teamId, julia.user.id);
  await db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, created_at) VALUES (?, ?, 25, NOW())").run(uuid(), julia.user.id);
});
afterAll(async () => { await stopHarness(h); });

const get = (who, path = "") => h.request.get(`/api/legal-readiness/${recipientId}${path}`).set(h.auth(who.token));
const item = (body, key) => body.items.find((i) => i.key === key);

describe("readiness checklist", () => {
  test("nothing uploaded, nothing answered: both items are NOT KNOWN YET, not missing", async () => {
    const res = await get(pete);
    expect(res.status).toBe(200);
    expect(item(res.body, "financial_poa").state).toBe("unknown");
    expect(item(res.body, "healthcare_directive").state).toBe("unknown");
    expect(res.body.complete).toBe(false);
    expect(res.body.disclaimer).toMatch(/not legal or financial advice/);
  });

  test("an approved POA upload marks the financial POA on file; the other stays unknown", async () => {
    await db.prepare(`
      INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, status, created_at)
      VALUES (?, 'care_recipient', ?, ?, 'legal', 'POA', 'r2:test', 'approved', NOW())
    `).run(uuid(), recipientId, pete.user.id);
    const res = await get(pete);
    expect(item(res.body, "financial_poa").state).toBe("on_file");
    expect(item(res.body, "financial_poa").done).toBe(true);
    expect(item(res.body, "healthcare_directive").state).toBe("unknown");
  });

  test("the family's answer fills the gap, and can be cleared back to unknown", async () => {
    const put = (answer) => h.request.put(`/api/legal-readiness/${recipientId}/answers/healthcare_directive`).set(h.auth(sister.token)).send({ answer });
    let res = await put("dont_have");
    expect(res.status).toBe(200);
    expect(item(res.body, "healthcare_directive").state).toBe("missing");
    res = await put("have_not_uploaded");
    expect(item(res.body, "healthcare_directive").state).toBe("have_it");
    expect((await put("maybe")).status).toBe(400);
    res = await put(null);
    expect(item(res.body, "healthcare_directive").state).toBe("unknown");
  });

  test("a POA filed under 'consent' counts; a consent-flow POA alone is 'check it covers money', not done", async () => {
    const t2 = await h.createCareTeam({ familyUserId: stranger.user.id });
    const r2 = (who) => h.request.get(`/api/legal-readiness/${t2.recipientId}`).set(h.auth(who.token));
    await db.prepare(`
      INSERT INTO authorization_documents (id, care_recipient_id, submitted_by, document_type, file_data, upload_status)
      VALUES (?, ?, ?, 'POA', 'r2:test', 'uploaded')
    `).run(uuid(), t2.recipientId, stranger.user.id);
    let res = await r2(stranger);
    expect(item(res.body, "financial_poa").state).toBe("check_type");
    expect(item(res.body, "financial_poa").done).toBe(false);
    await db.prepare(`
      INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, status, created_at)
      VALUES (?, 'care_recipient', ?, ?, 'consent', 'POA', 'r2:test', 'pending', NOW())
    `).run(uuid(), t2.recipientId, stranger.user.id);
    res = await r2(stranger);
    expect(item(res.body, "financial_poa").state).toBe("in_review");
    expect(item(res.body, "financial_poa").done).toBe(true);
  });

  test("a caregiver on the team gets 403; someone unconnected gets 404", async () => {
    expect((await get(julia)).status).toBe(403);
    expect((await get(julia, "/resources")).status).toBe(403);
    const w = await h.request.put(`/api/legal-readiness/${recipientId}/answers/financial_poa`).set(h.auth(julia.token)).send({ answer: "not_sure" });
    expect(w.status).toBe(403);
    expect((await get(stranger)).status).toBe(404);
  });
});

describe("get help nearby", () => {
  test("a Virginia address outside any listed locality falls back to statewide", async () => {
    await db.prepare("UPDATE care_recipients SET location_city = 'Arlington', location_state = 'VA', location_zip = '22201' WHERE id = ?").run(recipientId);
    const res = await get(pete, "/resources");
    expect(res.status).toBe(200);
    expect(res.body.region.matched).toBe("statewide");
    expect(res.body.resources.aps.map((r) => r.phone)).toContain("(888) 832-3858");
    expect(res.body.resources.aaa).toEqual([]);
    expect(res.body.footer).toBe("InPlace doesn't receive payment for these listings.");
    for (const list of Object.values(res.body.resources)) expect(list.length).toBeLessThanOrEqual(3);
  });

  test("Blacksburg gets the New River Valley Agency on Aging, local first", async () => {
    await db.prepare("UPDATE care_recipients SET location_city = 'Blacksburg', location_state = 'VA', location_zip = '24060' WHERE id = ?").run(recipientId);
    const res = await get(pete, "/resources");
    expect(res.body.region.matched).toBe("local");
    expect(res.body.resources.aaa[0].name).toMatch(/New River Valley Agency on Aging/);
    expect(res.body.resources.aaa[0].scope).toBe("local");
  });
});

describe("a family's own report", () => {
  test("creates a concern, tells admins without the text, and answers with resources", async () => {
    const description = "A man keeps calling Mom saying she won a prize and needs to pay a fee";
    const res = await h.request.post(`/api/legal-readiness/${recipientId}/concerns`).set(h.auth(pete.token)).send({ description });
    expect(res.status).toBe(201);
    const row = await db.prepare("SELECT * FROM financial_concerns WHERE id = ?").get(res.body.concern.id);
    expect(row).toEqual(expect.objectContaining({ source: "family_report", status: "open", reported_by: pete.user.id, description }));
    expect(adminNotes).toHaveLength(1);
    expect(JSON.stringify(adminNotes[0])).not.toContain("prize");
    const feed = await db.prepare("SELECT * FROM activity_feed WHERE family_user_id = ? AND event_type = 'financial_concern_reported'").all(admin.user.id);
    expect(feed).toHaveLength(1);
    expect(res.body.directory.resources.aps.length).toBeGreaterThan(0);
    expect(res.body.steps.length).toBeGreaterThan(0);
    // and no Needs-you item for a report the family made themselves
    const { attentionItemsFor } = require("../../src/utils/attention");
    expect((await attentionItemsFor(db, pete.user.id)).items.filter((i) => i.kind === "financialConcern")).toEqual([]);
  });

  test("a caregiver cannot file one", async () => {
    const res = await h.request.post(`/api/legal-readiness/${recipientId}/concerns`).set(h.auth(julia.token)).send({ description: "something something" });
    expect(res.status).toBe(403);
  });
});

describe("a flag reaches the family only when an admin shares it", () => {
  let flagId, concernId;
  beforeAll(async () => {
    flagId = uuid();
    await db.prepare("INSERT INTO safety_flags (id, user_id, flag_type, user_message, status, created_at) VALUES (?, ?, 'exploitation_signal', ?, 'pending', NOW())").run(flagId, julia.user.id, FLAGGED_TEXT);
  });

  test("before sharing, the family sees nothing", async () => {
    const res = await get(pete);
    expect(res.body.sharedConcerns).toEqual([]);
    const { attentionItemsFor } = require("../../src/utils/attention");
    expect((await attentionItemsFor(db, pete.user.id)).items.filter((i) => i.kind === "financialConcern")).toEqual([]);
  });

  test("the flag's author shows up as a candidate for the admin to pick from", async () => {
    const res = await h.request.get(`/api/admin/legal-readiness/safety-flags/${flagId}/recipients`).set(h.auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.shareable).toBe(true);
    expect(res.body.recipients.map((r) => r.id)).toContain(recipientId);
  });

  test("admin shares: the leader gets a Needs-you item and a push, neither with the message", async () => {
    pushes.length = 0;
    const res = await h.request.post(`/api/admin/legal-readiness/safety-flags/${flagId}/share`).set(h.auth(admin.token)).send({ careRecipientId: recipientId });
    expect(res.status).toBe(201);
    concernId = res.body.concern.id;
    expect(res.body.concern.sharedWithUserId).toBe(pete.user.id);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].userId).toBe(pete.user.id);
    expect(JSON.stringify(pushes[0].payload)).not.toMatch(/PIN|cash|Julia|exploit/i);

    const { attentionItemsFor } = require("../../src/utils/attention");
    const mine = await attentionItemsFor(db, pete.user.id);
    const fin = mine.items.filter((i) => i.kind === "financialConcern");
    expect(fin).toEqual([expect.objectContaining({ id: concernId, verb: "Open", action: null, page: "care-profile", focus: `legalReadiness:${recipientId}` })]);
    expect(mine.total).toBeGreaterThanOrEqual(1);
    expect(mine.financialConcerns).toBe(1);
    // addressed to the leader only
    expect((await attentionItemsFor(db, sister.user.id)).items.filter((i) => i.kind === "financialConcern")).toEqual([]);
    expect((await attentionItemsFor(db, julia.user.id)).items.filter((i) => i.kind === "financialConcern")).toEqual([]);

    const card = await get(pete);
    expect(card.body.sharedConcerns.map((c) => c.id)).toEqual([concernId]);
    expect(JSON.stringify(card.body)).not.toContain("PIN");
    expect(JSON.stringify(card.body)).not.toContain(julia.user.id);
  });

  test("sharing the same flag with the same family again is a 409", async () => {
    const res = await h.request.post(`/api/admin/legal-readiness/safety-flags/${flagId}/share`).set(h.auth(admin.token)).send({ careRecipientId: recipientId });
    expect(res.status).toBe(409);
  });

  test("a caregiver cannot acknowledge it; the leader can, once — then 409", async () => {
    const ack = (who) => h.request.post(`/api/legal-readiness/concerns/${concernId}/acknowledge`).set(h.auth(who.token));
    expect((await ack(julia)).status).toBe(403);
    expect((await ack(pete)).status).toBe(200);
    expect((await ack(pete)).status).toBe(409);
    const { attentionItemsFor } = require("../../src/utils/attention");
    expect((await attentionItemsFor(db, pete.user.id)).items.filter((i) => i.kind === "financialConcern")).toEqual([]);
    expect((await get(pete)).body.sharedConcerns).toEqual([]);
  });

  test("a flag that is not about money cannot be shared this way", async () => {
    const other = uuid();
    await db.prepare("INSERT INTO safety_flags (id, user_id, flag_type, user_message, status, created_at) VALUES (?, ?, 'neglect_signal', 'x', 'pending', NOW())").run(other, julia.user.id);
    const res = await h.request.post(`/api/admin/legal-readiness/safety-flags/${other}/share`).set(h.auth(admin.token)).send({ careRecipientId: recipientId });
    expect(res.status).toBe(422);
  });

  test("a non-admin cannot share", async () => {
    const res = await h.request.post(`/api/admin/legal-readiness/safety-flags/${flagId}/share`).set(h.auth(pete.token)).send({ careRecipientId: recipientId });
    expect(res.status).toBe(403);
  });
});

describe("the directory is admin-edited", () => {
  test("a non-admin cannot list, add, change or hide listings", async () => {
    const base = "/api/admin/legal-readiness/resources";
    expect((await h.request.get(base).set(h.auth(pete.token))).status).toBe(403);
    expect((await h.request.post(base).set(h.auth(pete.token)).send({ kind: "elder_law", name: "Mine", region_key: "VA" })).status).toBe(403);
    expect((await h.request.put(`${base}/lr_va_aps`).set(h.auth(pete.token)).send({ name: "x" })).status).toBe(403);
    expect((await h.request.delete(`${base}/lr_va_aps`).set(h.auth(pete.token))).status).toBe(403);
    expect((await h.request.get("/api/admin/legal-readiness/concerns").set(h.auth(sister.token))).status).toBe(403);
  });

  test("an admin adds a local firm and the family sees it first; hiding twice is a 409", async () => {
    const base = "/api/admin/legal-readiness/resources";
    const add = await h.request.post(base).set(h.auth(admin.token)).send({ kind: "elder_law", name: "Test Elder Law PLC", phone: "(540) 555-0100", url: "https://example.test", region_key: "Montgomery County" });
    expect(add.status).toBe(201);
    let res = await get(pete, "/resources");
    expect(res.body.resources.elder_law[0].name).toBe("Test Elder Law PLC");
    expect((await h.request.post(base).set(h.auth(admin.token)).send({ kind: "nope", name: "x" })).status).toBe(400);
    expect((await h.request.delete(`${base}/${add.body.resource.id}`).set(h.auth(admin.token))).status).toBe(200);
    expect((await h.request.delete(`${base}/${add.body.resource.id}`).set(h.auth(admin.token))).status).toBe(409);
    res = await get(pete, "/resources");
    expect(res.body.resources.elder_law.map((r) => r.name)).not.toContain("Test Elder Law PLC");
  });
});
