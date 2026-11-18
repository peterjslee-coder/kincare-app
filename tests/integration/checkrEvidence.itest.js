/**
 * v1.131.0 — background-check claims come from Checkr, not from us.
 *
 * Pete, 11/18, about Faith: "It currently says her report has been submitted and we are awaiting
 * results. Like what evidence do we have that that was ever happening. ... I want webhooks that
 * fire that confirm things to be true before we claim reports are submitted or have come back
 * clear or whatever. Not just vibes."
 *
 * Faith's profile carried checkr_status = 'pending' — the column DEFAULT — and screens read that
 * as "in progress". Checkr had never been called. This suite runs the real routes against the
 * real schema and proves, step by step, that each claim appears only after Checkr makes it:
 *
 *   1. a fresh profile is "not started", never "in progress"
 *   2. an admin can send the form to the email on file (Pete: "I have to be able to test it
 *      before I tell paying customers 'it works!'"), which records Checkr's invitation id
 *   3. "Checkr has her form" appears only after a SIGNED invitation.completed webhook
 *   4. "clear" appears only after a SIGNED report.completed webhook
 *   5. an unsigned or wrongly-signed webhook changes nothing
 */
const crypto = require("crypto");
const express = require("express");
const supertest = require("supertest");
const { startHarness, stopHarness } = require("./harness");
const { v4: uuid } = require("uuid");

jest.setTimeout(180000);

const API_KEY = "test_checkr_api_key_0123456789";
let h, db, app, req;
const realFetch = global.fetch;
const checkrCalls = [];
let dashEmail = null;

beforeAll(async () => {
  process.env.CHECKR_API_KEY = API_KEY;
  delete process.env.CHECKR_WEBHOOK_SECRET; // Checkr signs with the API key — prove that alone works
  delete process.env.CHECKR_STAGING;
  delete process.env.CHECKR_PACKAGE;
  h = await startHarness({ routers: {} });
  db = h.db;
  // The webhook needs the RAW body (signature), so mount the router without a JSON parser in
  // front of it — exactly as server.js does for /api/checkr/webhook.
  app = express();
  app.use((r, res, next) => (r.originalUrl === "/api/checkr/webhook" ? next() : express.json()(r, res, next)));
  app.use("/api/checkr", require("../../src/routes/checkr"));
  req = supertest(app);

  await db.prepare(
    "INSERT INTO platform_settings (key, value) VALUES ('bg_checks_enabled', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'"
  ).run();

  // A fake Checkr API. The package list deliberately puts an expensive package FIRST — the old
  // code ordered "whatever came first".
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    checkrCalls.push({ url: u, method: opts.method, body });
    const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
    if (u.includes("/nodes")) return json({ data: [] });
    if (u.endsWith("/packages")) return json({ data: [
      { slug: "complete_criminal", name: "Complete Criminal" },
      { slug: "inplace_starter_pkg", name: "inPlace Starter" },
    ] });
    if (u.includes("/candidates/cand_dash")) return json({ id: "cand_dash", email: dashEmail });
    if (u.endsWith("/candidates") && opts.method === "POST") return json({ id: "cand_" + uuid().slice(0, 8) });
    if (u.endsWith("/invitations") && opts.method === "POST") {
      return json({ id: "inv_" + uuid().slice(0, 8), status: "pending", invitation_url: "https://apply.checkr.com/invite/abc" });
    }
    return json({ error: "unexpected " + u }, 404);
  });
});

afterAll(async () => {
  global.fetch = realFetch;
  await stopHarness(h);
});

async function caregiver() {
  const cg = await h.createUser({ firstName: "Faith", lastName: "Tester", roles: ["caregiver"] });
  await db.prepare(`
    INSERT INTO caregiver_profiles (id, user_id, hourly_rate, legal_first_name, legal_last_name, date_of_birth, created_at)
    VALUES (?, ?, 20, 'Faith', 'Tester', '1990-01-01', NOW())
  `).run(uuid(), cg.user.id);
  return cg;
}

const sign = (raw, key = API_KEY) => crypto.createHmac("sha256", key).update(raw).digest("hex");
const postWebhook = (payload, key) => {
  const raw = JSON.stringify(payload);
  const r = req.post("/api/checkr/webhook").set("Content-Type", "application/json");
  if (key !== null) r.set("X-Checkr-Signature", sign(raw, key));
  return r.send(raw);
};
const status = (cg) => req.get("/api/checkr/status").set(h.auth(cg.token)).then((r) => r.body);

describe("nothing is claimed that Checkr did not say", () => {
  test("a brand-new caregiver is not started — the old DEFAULT 'pending' is gone", async () => {
    const cg = await caregiver();
    const row = await db.prepare("SELECT checkr_status FROM caregiver_profiles WHERE user_id = ?").get(cg.user.id);
    expect(row.checkr_status).toBeNull();
    const s = await status(cg);
    expect(s.phase).toBe("not_started");
    expect(s.status).not.toBe("pending");
    expect(s.evidence.sentAt).toBeNull();
    expect(s.evidence.submittedAt).toBeNull();
  });

  test("a legacy 'pending' or 'initiated' row is not started either", async () => {
    for (const legacy of ["pending", "initiated"]) {
      const cg = await caregiver();
      await db.prepare("UPDATE caregiver_profiles SET checkr_status = ? WHERE user_id = ?").run(legacy, cg.user.id);
      expect((await status(cg)).phase).toBe("not_started");
    }
  });
});

describe("Pete can send the form to the email on file", () => {
  let cg, admin, sent;

  beforeAll(async () => {
    cg = await caregiver();
    admin = await h.createUser({ firstName: "Pete", lastName: "Admin", isAdmin: true });
    checkrCalls.length = 0;
    const r = await req.post(`/api/checkr/admin/send-invitation/${cg.user.id}`).set(h.auth(admin.token));
    sent = r;
  });

  test("Checkr is asked for an invitation, on the pinned package, to her email", () => {
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("invitation_sent");
    expect(sent.body.sentTo).toBe(cg.user.email);
    const inv = checkrCalls.find((c) => c.url.endsWith("/invitations"));
    expect(inv).toBeTruthy();
    // Not "the first package on the account" (Complete Criminal) — inPlace Starter.
    expect(inv.body.package).toBe("inplace_starter_pkg");
  });

  test("it works without her ticking InPlace's consent box or paying the $30 — InPlace is covering it", async () => {
    const row = await db.prepare("SELECT background_check_paid, checkr_invitation_id FROM caregiver_profiles WHERE user_id = ?").get(cg.user.id);
    expect(row.background_check_paid).toBe(1);
    expect(row.checkr_invitation_id).toBe(sent.body.invitationId);
  });

  test("'sent' is evidenced by Checkr's own invitation id, and she sees the form is waiting", async () => {
    const s = await status(cg);
    expect(s.phase).toBe("awaiting_caregiver");
    expect(s.evidence.sentAt).toBeTruthy();
    expect(s.evidence.submittedAt).toBeNull();     // she has not filled it in — say nothing
    expect(s.invitationUrl).toBe("https://apply.checkr.com/invite/abc");
  });

  test("admins are told", async () => {
    const n = await db.prepare(
      "SELECT COUNT(*) AS n FROM activity_feed WHERE family_user_id = ? AND event_type = 'checkr_invitation_sent'"
    ).get(admin.user.id);
    expect(Number(n.n)).toBeGreaterThan(0);
  });

  test("a non-admin cannot use it", async () => {
    const r = await req.post(`/api/checkr/admin/send-invitation/${cg.user.id}`).set(h.auth(cg.token));
    expect(r.status).toBe(403);
  });

  test("a demo account is never sent to Checkr", async () => {
    const demo = await h.createUser({ roles: ["caregiver"], isDemo: true });
    const r = await req.post(`/api/checkr/admin/send-invitation/${demo.user.id}`).set(h.auth(admin.token));
    expect(r.status).toBe(400);
  });

  describe("then Checkr's webhooks — and only they — move it forward", () => {
    test("an UNSIGNED invitation.completed changes nothing", async () => {
      const r = await postWebhook({ id: "evt_unsigned", type: "invitation.completed",
        data: { object: { id: sent.body.invitationId, candidate_id: sent.body.candidateId } } }, null);
      expect(r.status).toBe(401);
      expect((await status(cg)).evidence.submittedAt).toBeNull();
    });

    test("a WRONGLY-signed one changes nothing", async () => {
      const r = await postWebhook({ id: "evt_forged", type: "invitation.completed",
        data: { object: { id: sent.body.invitationId, candidate_id: sent.body.candidateId } } }, "not-the-key");
      expect(r.status).toBe(401);
      expect((await status(cg)).phase).toBe("awaiting_caregiver");
    });

    test("a signed invitation.completed: now — and only now — Checkr has her form", async () => {
      const r = await postWebhook({ id: "evt_inv_done", type: "invitation.completed",
        data: { object: { id: sent.body.invitationId, candidate_id: sent.body.candidateId } } }, API_KEY);
      expect(r.status).toBe(200);
      const s = await status(cg);
      expect(s.phase).toBe("in_progress");
      expect(s.evidence.submittedAt).toBeTruthy();
      expect(s.cleared).toBe(false);
    });

    test("Checkr retrying the same event does not duplicate the evidence", async () => {
      await postWebhook({ id: "evt_inv_done", type: "invitation.completed",
        data: { object: { id: sent.body.invitationId, candidate_id: sent.body.candidateId } } }, API_KEY);
      const n = await db.prepare("SELECT COUNT(*) AS n FROM checkr_events WHERE checkr_event_id = 'evt_inv_done'").get();
      expect(Number(n.n)).toBe(1);
    });

    test("a signed report.completed (clear): cleared, with the date Checkr said so", async () => {
      const reportId = "rep_" + uuid().slice(0, 8);
      const r = await postWebhook({ id: "evt_rep_done", type: "report.completed",
        data: { object: { id: reportId, candidate_id: sent.body.candidateId, status: "complete", result: "clear" } } }, API_KEY);
      expect(r.status).toBe(200);
      const row = await db.prepare("SELECT is_background_checked, checkr_report_id FROM caregiver_profiles WHERE user_id = ?").get(cg.user.id);
      expect(row.is_background_checked).toBe(1);
      expect(row.checkr_report_id).toBe(reportId);
      const ev = await db.prepare("SELECT source, result FROM checkr_events WHERE checkr_event_id = 'evt_rep_done'").get();
      expect(ev).toEqual({ source: "webhook", result: "clear" });
    });
  });
});

describe("a check Pete orders from Checkr's own dashboard still lands on her profile", () => {
  test("the unknown candidate is looked up at Checkr and matched by email", async () => {
    const cg = await caregiver();
    dashEmail = cg.user.email.toUpperCase(); // case must not matter
    const r = await postWebhook({ id: "evt_dash_inv", type: "invitation.created",
      data: { object: { id: "inv_dash", candidate_id: "cand_dash", status: "pending" } } }, API_KEY);
    expect(r.status).toBe(200);
    const row = await db.prepare("SELECT checkr_candidate_id, checkr_invitation_id, checkr_status FROM caregiver_profiles WHERE user_id = ?").get(cg.user.id);
    expect(row).toEqual({ checkr_candidate_id: "cand_dash", checkr_invitation_id: "inv_dash", checkr_status: "invitation_sent" });
    const s = await status(cg);
    expect(s.phase).toBe("awaiting_caregiver");
    expect(s.evidence.sentAt).toBeTruthy();
  });
});
