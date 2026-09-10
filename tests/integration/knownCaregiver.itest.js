/**
 * v1.105.186 — a family adds a caregiver it already knows. Real Postgres, real rows.
 *
 * The chain this pins: leader sends → invite row → caregiver registers and accepts → the
 * family's gate row exists (keyed on the OWNER) → profile created → assignment appears under
 * the recipient → the leader's list shows honest progress. And the two refusals that keep the
 * door narrow: not-the-leader, and a second open invite for the same email.
 */
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const ROUTERS = {
  "/api/known-caregivers": "../../src/routes/knownCaregivers",
  "/api/platform-invites": "../../src/routes/platformInvites",
  "/api/assignments": "../../src/routes/assignments",
};

let h, pete, deborah, stranger, recipientId, teamId;

beforeAll(async () => {
  process.env.RESEND_API_KEY = ""; // never send
  h = await startHarness({ routers: ROUTERS });
  pete = await h.createUser({ roles: ["family"], firstName: "Pete", lastName: "Lee" });
  deborah = await h.createUser({ roles: ["family"], firstName: "Deborah" });
  stranger = await h.createUser({ roles: ["family"], firstName: "Nobody" });
  const t = await h.createCareTeam({ familyUserId: pete.user.id });
  recipientId = t.recipientId;
  teamId = t.teamId;
  await h.addTeamMember(teamId, deborah.user.id, "member");
});

afterAll(async () => { await stopHarness(h); });

const send = (who, body) => h.request.post("/api/known-caregivers").set(h.auth(who.token))
  .send(Object.assign({ careRecipientId: recipientId }, body));

describe("adding a caregiver you already know", () => {
  let inviteId, token;
  const carolEmail = "carol.whitaker@itest.local";

  test("a member (not the leader) is refused", async () => {
    const res = await send(deborah, { name: "Carol Whitaker", email: carolEmail });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/leader/i);
  });

  test("the leader sends it, and the row carries what he typed", async () => {
    const res = await send(pete, { name: "Carol Whitaker", email: carolEmail, phone: "(540) 555-0142" });
    expect(res.status).toBe(201);
    expect(res.body.invite.name).toBe("Carol Whitaker");
    expect(res.body.invite.phone).toBe("5405550142");
    inviteId = res.body.invite.id;
    const row = await h.db.prepare("SELECT * FROM platform_invites WHERE id = ?").get(inviteId);
    expect(row.kind).toBe("known-caregiver");
    expect(row.care_recipient_id).toBe(recipientId);
    expect(row.role).toBe("caregiver");
    token = row.token;
    // 14 days, not the admin invite's 7.
    const days = (new Date(row.expires_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(13);
  });

  test("a second open invite for the same email is refused, and says to resend", async () => {
    const res = await send(pete, { name: "Carol W", email: carolEmail.toUpperCase() });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/resend/i);
  });

  test("/info tells the wizard it is the short path, with the family's name", async () => {
    const res = await h.request.get(`/api/platform-invites/info?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.invite.kind).toBe("known-caregiver");
    expect(res.body.invite.recipientFirstName).toBe("Betty");
    expect(res.body.invite.inviterName).toBe("Pete Lee");
    expect(res.body.invite.firstName).toBe("Carol");
    expect(res.body.invite.lastName).toBe("Whitaker");
    expect(res.body.invite.existingAccount).toBe(false);
  });

  test("the leader's list shows it as waiting on her", async () => {
    const res = await h.request.get(`/api/known-caregivers?careRecipientId=${recipientId}`).set(h.auth(pete.token));
    expect(res.status).toBe(200);
    expect(res.body.invites).toHaveLength(1);
    expect(res.body.invites[0].status).toBe("pending");
    expect(res.body.invites[0].progress).toBeNull();
  });

  let carol;
  test("she accepts: the family's gate row exists, keyed on the OWNER, and her phone is kept", async () => {
    carol = await h.createUser({ roles: ["caregiver"], firstName: "Carol", lastName: "Whitaker", email: carolEmail });
    const res = await h.request.post("/api/platform-invites/accept-invite").set(h.auth(carol.token)).send({ token });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("known-caregiver");
    const gate = await h.db.prepare(
      "SELECT * FROM bg_admin_vouches WHERE caregiver_user_id = ? AND revoked_at IS NULL"
    ).all(carol.user.id);
    expect(gate).toHaveLength(1);
    expect(gate[0].family_user_id).toBe(pete.user.id);
    expect(gate[0].vouched_by).toBe(pete.user.id);
    expect(gate[0].note).toBe("family-brought");
    const u = await h.db.prepare("SELECT phone FROM users WHERE id = ?").get(carol.user.id);
    expect(u.phone).toBe("5405550142");
    // No profile yet, so no assignment yet — that is not a failure, it is the order she walks.
    const a = await h.db.prepare("SELECT * FROM caregiver_assignments WHERE care_recipient_id = ?").all(recipientId);
    expect(a).toHaveLength(0);
  });

  test("accepting twice does not double the gate row", async () => {
    const { fulfillKnownCaregiverInvite } = require("../../src/utils/knownCaregivers");
    const inv = await h.db.prepare("SELECT * FROM platform_invites WHERE id = ?").get(inviteId);
    const out = await fulfillKnownCaregiverInvite(h.db, inv, carol.user.id);
    expect(out.gated).toBe(false);
    const gate = await h.db.prepare("SELECT id FROM bg_admin_vouches WHERE caregiver_user_id = ? AND revoked_at IS NULL").all(carol.user.id);
    expect(gate).toHaveLength(1);
  });

  test("once a profile exists she is under Betty, and the leader sees honest progress", async () => {
    const profileId = uuid();
    await h.db.prepare("INSERT INTO caregiver_profiles (id, user_id, hourly_rate, is_available) VALUES (?, ?, 25, 1)").run(profileId, carol.user.id);
    const { fulfillPendingForUser } = require("../../src/utils/knownCaregivers");
    const out = await fulfillPendingForUser(h.db, carol.user.id);
    expect(out[0].assigned).toBe(true);

    const list = await h.request.get("/api/assignments").set(h.auth(pete.token));
    expect(list.status).toBe(200);
    const row = list.body.assignments.find((a) => a.caregiver_profile_id === profileId);
    expect(row).toBeTruthy();
    expect(Number(row.family_brought)).toBe(1);

    const res = await h.request.get(`/api/known-caregivers?careRecipientId=${recipientId}`).set(h.auth(pete.token));
    const inv = res.body.invites[0];
    expect(inv.status).toBe("accepted");
    expect(inv.progress.userId).toBe(carol.user.id);
    expect(inv.progress.account).toBe(true);
    expect(inv.progress.details).toBe(true);
    expect(inv.progress.pay).toBe(false);
    expect(inv.progress.licence).toBe(false);
    expect(inv.progress.done).toBe(2);
    expect(inv.progress.ready).toBe(false);
  });

  test("when the fourth thing lands, the leader is told she is ready to book — once", async () => {
    const { notifyIfReadyToBook } = require("../../src/utils/knownCaregivers");
    // Not yet: no Stripe, no licence photo.
    expect(await notifyIfReadyToBook(h.db, carol.user.id)).toEqual([]);
    await h.db.prepare("UPDATE caregiver_profiles SET stripe_onboard_complete = 1 WHERE user_id = ?").run(carol.user.id);
    expect(await notifyIfReadyToBook(h.db, carol.user.id)).toEqual([]);
    const profile = await h.db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(carol.user.id);
    await h.db.prepare(`INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type, file_data, mime_type, status, is_verified, created_at)
      VALUES (?, 'caregiver', ?, ?, 'identity', 'drivers_license', 'x', 'image/jpeg', 'pending', 0, NOW())`).run(uuid(), profile.id, carol.user.id);
    const fired = await notifyIfReadyToBook(h.db, carol.user.id);
    expect(fired).toEqual([inviteId]);
    const row = await h.db.prepare("SELECT status FROM platform_invites WHERE id = ?").get(inviteId);
    expect(row.status).toBe("ready");
    const feed = await h.db.prepare("SELECT * FROM activity_feed WHERE family_user_id = ? AND event_type = 'known_caregiver_ready'").all(pete.user.id);
    expect(feed).toHaveLength(1);
    expect(feed[0].title).toBe("Carol Whitaker is ready to book");
    // Once. A second Stripe webhook or re-upload must not tell him again.
    expect(await notifyIfReadyToBook(h.db, carol.user.id)).toEqual([]);
    // And the leader's list still shows her, now with progress 4 of 4.
    const res = await h.request.get(`/api/known-caregivers?careRecipientId=${recipientId}`).set(h.auth(pete.token));
    const inv = res.body.invites.find((i) => i.id === inviteId);
    expect(inv.status).toBe("accepted");
    expect(inv.progress.ready).toBe(true);
  });

  test("resend and withdraw are the leader's, and only while it is open", async () => {
    // Carol's is accepted now — cannot be withdrawn.
    const w = await h.request.delete(`/api/known-caregivers/${inviteId}`).set(h.auth(pete.token));
    expect(w.status).toBe(400);
    // A fresh one for someone else.
    const res = await send(pete, { name: "Ruth Ann Baker", email: "ruthann@itest.local" });
    expect(res.status).toBe(201);
    const id = res.body.invite.id;
    const notLeader = await h.request.post(`/api/known-caregivers/${id}/resend`).set(h.auth(stranger.token));
    expect(notLeader.status).toBe(404);
    const rs = await h.request.post(`/api/known-caregivers/${id}/resend`).set(h.auth(pete.token));
    expect(rs.status).toBe(200);
    const del = await h.request.delete(`/api/known-caregivers/${id}`).set(h.auth(pete.token));
    expect(del.status).toBe(200);
    const row = await h.db.prepare("SELECT status FROM platform_invites WHERE id = ?").get(id);
    expect(row.status).toBe("cancelled");
  });

  test("an email that already belongs to a family account is refused with a reason", async () => {
    const res = await send(pete, { name: "Deb", email: deborah.user.email });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/isn't a caregiver account/);
  });
});
