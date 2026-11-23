/**
 * v1.150.2 — an admin approval of a family-consent (tier 3) recipient must finish the job.
 *
 * Pete, 11/23: a hospice family's loved one sat in Admin → Needs-you as "Consent pending —
 * Authorization required" for two days after Pete had approved him by hand, with no button left
 * to clear it. Three things were wrong at once:
 *   1. the attestation update used UPDATE ... ORDER BY ... LIMIT, which Postgres rejects — it
 *      threw AFTER consent_status was set, so the approve half-saved and answered 500;
 *   2. /consent/pending listed any unanswered outreach link, verified or not;
 *   3. nothing closed the outreach link when an admin decided.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "consent-approve-secret";

const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

let h, db, admin, family;

async function trustThisNetwork(as) {
  const probe = await h.request.get("/api/admin/overview").set(h.auth(as.token));
  const ip = (probe.body && probe.body.ip) || "::ffff:127.0.0.1";
  const { registerTrustedIp } = require("../../src/utils/trustedIps");
  await registerTrustedIp(as.user.id, ip, { verifiedVia: "itest" });
}

/** A tier-3 recipient with a signed attestation and an outreach link nobody answered. */
async function attestedRecipientWithOpenOutreach() {
  const { recipientId } = await h.createCareTeam({ familyUserId: family.user.id });
  await db.prepare(
    "UPDATE care_recipients SET authorization_tier = 'tier3', consent_status = 'attested' WHERE id = ?"
  ).run(recipientId);
  const attId = uuid();
  await db.prepare(`
    INSERT INTO attestations (id, care_recipient_id, attesting_user_id, relationship_to_recipient,
                              attestation_text, signature_name, admin_status)
    VALUES (?, ?, ?, 'son', 'I confirm…', 'Sam Test', 'pending')
  `).run(attId, recipientId, family.user.id);
  const outreachId = uuid();
  await db.prepare(`
    INSERT INTO consent_outreach (id, care_recipient_id, attestation_id, sent_to_email,
                                  outreach_token, expires_at)
    VALUES (?, ?, ?, 'recipient@example.test', ?, NOW() + INTERVAL '7 days')
  `).run(outreachId, recipientId, attId, uuid());
  return { recipientId, attId, outreachId };
}

const pendingIds = async () => {
  const res = await h.request.get("/api/admin/consent/pending").set(h.auth(admin.token));
  expect(res.status).toBe(200);
  return res.body.pending.map((p) => p.id);
};

beforeAll(async () => {
  h = await startHarness({ routers: { "/api/admin": "../../src/routes/admin" } });
  db = h.db;
  admin = await h.createUser({ firstName: "Ad", lastName: "Min", isAdmin: true });
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(admin.user.id);
  await trustThisNetwork(admin);
  family = await h.createUser({ firstName: "Fam", lastName: "Ily" });
});
afterAll(async () => { await stopHarness(h); });

test("approve answers 200 and records the attestation as approved", async () => {
  const { recipientId, attId } = await attestedRecipientWithOpenOutreach();
  expect(await pendingIds()).toContain(recipientId);

  const res = await h.request.put(`/api/admin/authorizations/${recipientId}`)
    .set(h.auth(admin.token)).send({ action: "approve" });
  expect(res.status).toBe(200);

  const cr = await db.prepare("SELECT consent_status, consent_method FROM care_recipients WHERE id = ?").get(recipientId);
  expect(cr.consent_status).toBe("verified");
  expect(cr.consent_method).toBe("admin_approved");
  const att = await db.prepare("SELECT admin_status, admin_reviewed_by FROM attestations WHERE id = ?").get(attId);
  expect(att.admin_status).toBe("approved");
  expect(att.admin_reviewed_by).toBe(admin.user.id);
});

test("approve closes the unanswered outreach link and clears Needs-you", async () => {
  const { recipientId, outreachId } = await attestedRecipientWithOpenOutreach();
  await h.request.put(`/api/admin/authorizations/${recipientId}`)
    .set(h.auth(admin.token)).send({ action: "approve" });

  const co = await db.prepare(
    "SELECT recipient_response, expires_at <= NOW() AS closed FROM consent_outreach WHERE id = ?"
  ).get(outreachId);
  expect(co.closed).toBe(true);
  expect(co.recipient_response).toBeNull(); // nobody answered — we do not pretend they did
  expect(await pendingIds()).not.toContain(recipientId);
});

test("a recipient already verified with a link still open is not in Needs-you", async () => {
  // The state the broken approve left behind on prod.
  const { recipientId } = await attestedRecipientWithOpenOutreach();
  await db.prepare(
    "UPDATE care_recipients SET consent_status = 'verified', consent_method = 'admin_approved' WHERE id = ?"
  ).run(recipientId);
  expect(await pendingIds()).not.toContain(recipientId);
});

test("an unverified recipient with an open link still IS in Needs-you", async () => {
  const { recipientId } = await attestedRecipientWithOpenOutreach();
  expect(await pendingIds()).toContain(recipientId);
});
