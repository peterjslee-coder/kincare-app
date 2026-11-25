// ─── /api/drop-in — consent, who may drop in, and awake noticing (v1.156.0) ───
// Rules: src/utils/dropIn.js. Every change lands in consent_audit_log.
const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { captureException } = require("../utils/sentry");
const { recipientCapabilities } = require("../utils/access");
const D = require("../utils/dropIn");
const { authenticate } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);

/** Anyone with access to her record, or her own account. */
async function access(db, req) {
  const cr = await D.recipient(db, req.params.recipientId);
  if (!cr) return { status: 404 };
  const { trustedLinkedUserId } = require("../utils/linkedAccount");
  const herself = (await trustedLinkedUserId(db, cr)) === req.user.id;
  // A recorded agent can always reach the consent, even if not on the care team.
  const agent = !herself && !!(await D.signerCapacity(db, cr, req.user.id));
  if (!herself && !agent) {
    const caps = await recipientCapabilities(db, cr.id, req.user.id);
    if (!caps.length) return { status: 404 };
    const cg = await db.prepare("SELECT 1 FROM caregiver_profiles WHERE user_id = ? LIMIT 1").get(req.user.id);
    if (cg && !(await D.isLeader(db, cr, req.user.id))) return { status: 404 }; // hired caregivers: none of this
  }
  return { status: 200, cr, herself };
}

async function view(db, cr, userId) {
  const consent = await D.activeConsent(db, cr.id);
  const capacity = await D.signerCapacity(db, cr, userId);
  const leader = await D.isLeader(db, cr, userId);
  const { parseSimpleMode } = require("../utils/simpleMode");
  const hub = parseSimpleMode(cr.simple_mode).hub || {};
  const candidates = leader ? await D.dropInCandidates(db, cr) : [];
  return {
    firstName: cr.first_name,
    hubOn: !!hub.on,
    consent: consent ? {
      signerName: consent.signer_name, capacity: consent.signer_capacity,
      capacityLabel: D.CAPACITY_LABEL[consent.signer_capacity] || consent.signer_capacity,
      signedAt: consent.created_at, wording: consent.wording_text,
    } : null,
    wording: D.wordingFor(cr.first_name || "them"),
    wordingVersion: D.WORDING_VERSION,
    canSign: !!capacity,
    capacity,
    capacityLabel: capacity ? D.CAPACITY_LABEL[capacity] : null,
    canRevoke: !!consent && (!!capacity || leader || consent.signed_by === userId),
    isLeader: leader,
    candidates,
    chosen: (hub.dropInUserIds || []).filter((id) => candidates.length === 0 || candidates.some((c) => c.userId === id)),
    noticeAwake: !!hub.noticeAwake,
    // v1.158.2 — the most recent time the Hub noticed her up (times and which signals only),
    // so the leader can see noticing works. Pete, 11/24: "how do we test if it's noticing?"
    lastNoticed: leader && hub.noticeAwake ? await (async () => {
      const r = await db.prepare("SELECT started_at, ended_at, motion_minutes, voice_minutes, touches FROM hub_awake WHERE care_recipient_id = ? ORDER BY ended_at DESC LIMIT 1").get(cr.id);
      return r ? { startedAt: r.started_at, endedAt: r.ended_at, motion: r.motion_minutes > 0, talking: r.voice_minutes > 0, touches: r.touches > 0 } : null;
    })() : null,
    // v1.159.0 — the last 24 hours, oldest first: up / quiet (watching, nothing noticed) /
    // not watching. Leader only, like lastNoticed. Times are care-location times.
    nightStory: leader && hub.noticeAwake ? await require("../utils/awake").nightStory(db, cr.id, cr.first_name, cr.timezone || "America/New_York") : null,
    last24: leader && hub.noticeAwake ? await require("../utils/awake").timeline(db, cr.id, cr.timezone || "America/New_York") : null,
    // 1.3 — may THIS person drop in right now (the same check call_invite makes), and on whom.
    mayDropIn: await D.mayDropIn(db, cr.id, userId),
    hubUserId: await (async () => {
      const { trustedLinkedUserId } = require("../utils/linkedAccount");
      return trustedLinkedUserId(db, cr);
    })(),
    // v1.156.1 — the leader asks the person who can sign; she gets a Needs-you card.
    signers: leader ? await D.possibleSigners(db, cr) : [],
    request: await (async () => {
      const r = await D.pendingRequest(db, cr.id);
      return r ? { id: r.id, ofUserId: r.requested_of, ofFirstName: r.of_first, byFirstName: r.by_first, at: r.created_at, forMe: r.requested_of === userId } : null;
    })(),
  };
}

router.get("/:recipientId", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    res.json(await view(db, a.cr, req.user.id));
  } catch (err) {
    captureException(err, { where: "dropIn: get" });
    res.status(500).json({ error: "Couldn't load drop-in settings" });
  }
});

// GET /:recipientId/nights?before=YYYY-MM-DD&count=7 — v1.162.0, the night-by-night record.
// Leader only, like last24. Shown whether or not noticing is on today: nights already recorded
// under consent stay readable (Pete, 11/25: "keep all the info stored to track over time").
router.get("/:recipientId/nights", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    if (!(await D.isLeader(db, a.cr, req.user.id))) return res.status(403).json({ error: "Only the team leader can see this" });
    const before = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.before || "")) ? String(req.query.before) : null;
    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 7, 1), 31);
    const out = await require("../utils/awake").nights(db, a.cr.id, a.cr.first_name, a.cr.timezone || "America/New_York", { count, beforeDay: before });
    res.json(out);
  } catch (err) {
    captureException(err, { where: "dropIn: nights" });
    res.status(500).json({ error: "Couldn't load the nights" });
  }
});

// POST /:recipientId/consent { signerName, agree: true, wordingVersion }
router.post("/:recipientId/consent", async (req, res) => {
  try {
    if (req.user.impersonatedBy) return res.status(403).json({ error: "A consent can't be signed while viewing as someone else." });
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    const capacity = await D.signerCapacity(db, a.cr, req.user.id);
    if (!capacity) {
      return res.status(403).json({ error: `Only ${a.cr.first_name || "the person"}, or the agent recorded under their power of attorney or as their healthcare agent, can sign this. Record the agent in Legal readiness first.` });
    }
    const name = String((req.body && req.body.signerName) || "").trim().slice(0, 120);
    if (req.body?.agree !== true || name.length < 2) return res.status(400).json({ error: "Type your full name and tick that you agree." });
    if (req.body?.wordingVersion !== D.WORDING_VERSION) return res.status(409).json({ error: "The wording changed. Please read it again." });
    const existing = await D.activeConsent(db, a.cr.id);
    if (existing) await db.prepare("UPDATE drop_in_consents SET revoked_at = NOW(), revoked_by = ? WHERE id = ?").run(req.user.id, existing.id);
    const id = uuid();
    await db.prepare(`
      INSERT INTO drop_in_consents (id, care_recipient_id, signed_by, signer_capacity, signer_name, wording_version, wording_text)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, a.cr.id, req.user.id, capacity, name, D.WORDING_VERSION, D.wordingFor(a.cr.first_name || "them"));
    await D.closeRequests(db, a.cr.id, "signed");
    await D.audit(db, a.cr.id, req.user.id, "drop_in_consent_signed",
      `${name} signed the drop-in and awake-noticing consent as ${D.CAPACITY_LABEL[capacity]}`,
      { consentId: id, capacity, wordingVersion: D.WORDING_VERSION, replaced: existing ? existing.id : null });
    res.status(201).json(await view(db, await D.recipient(db, a.cr.id), req.user.id));
  } catch (err) {
    captureException(err, { where: "dropIn: consent" });
    res.status(500).json({ error: "Couldn't record the consent" });
  }
});

router.post("/:recipientId/revoke", async (req, res) => {
  try {
    if (req.user.impersonatedBy) return res.status(403).json({ error: "Not while viewing as someone else." });
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    const c = await D.activeConsent(db, a.cr.id);
    if (!c) return res.json(await view(db, a.cr, req.user.id));
    const allowed = a.herself || c.signed_by === req.user.id || (await D.signerCapacity(db, a.cr, req.user.id)) || (await D.isLeader(db, a.cr, req.user.id));
    if (!allowed) return res.status(403).json({ error: "Only the signer, the person, their agent or the care team leader can withdraw this." });
    await db.prepare("UPDATE drop_in_consents SET revoked_at = NOW(), revoked_by = ? WHERE id = ?").run(req.user.id, c.id);
    await D.audit(db, a.cr.id, req.user.id, "drop_in_consent_revoked", "Withdrew the drop-in and awake-noticing consent", { consentId: c.id });
    res.json(await view(db, a.cr, req.user.id));
  } catch (err) {
    captureException(err, { where: "dropIn: revoke" });
    res.status(500).json({ error: "Couldn't withdraw the consent" });
  }
});

// ─── v1.156.1 — ask the person who can sign ───
// Pete: "my sister is POA...someone can sign up / setup and she gets a 'needs you' card to
// click approve." POST /:recipientId/request { userId } — leader only; userId must be someone
// who can sign (her own account or a recorded agent). One open ask at a time.
router.post("/:recipientId/request", async (req, res) => {
  try {
    if (req.user.impersonatedBy) return res.status(403).json({ error: "Not while viewing as someone else." });
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    if (!(await D.isLeader(db, a.cr, req.user.id))) return res.status(403).json({ error: "Only the care team leader can ask for this." });
    if (await D.activeConsent(db, a.cr.id)) return res.status(409).json({ error: "It's already signed." });
    const signer = (await D.possibleSigners(db, a.cr)).find((p) => p.userId === req.body?.userId);
    if (!signer) return res.status(400).json({ error: "That person can't sign this. Record them as the agent in Legal readiness first." });
    await D.closeRequests(db, a.cr.id, "replaced");
    await db.prepare("INSERT INTO drop_in_requests (id, care_recipient_id, requested_by, requested_of) VALUES (?, ?, ?, ?)")
      .run(uuid(), a.cr.id, req.user.id, signer.userId);
    await D.audit(db, a.cr.id, req.user.id, "drop_in_consent_requested", `Asked ${signer.firstName} to review the drop-in consent`, { of: signer.userId, capacity: signer.capacity });
    // No PHI on the lock screen: who asked and that something is waiting, nothing more.
    try {
      const me = await db.prepare("SELECT first_name FROM users WHERE id = ?").get(req.user.id);
      await require("../routes/push").sendPushToUser(signer.userId, {
        title: `${(me && me.first_name) || "Your care team"} needs your OK`,
        body: `A consent for ${a.cr.first_name || "your loved one"}'s InPlace Hub is waiting for you.`,
        data: { type: "drop_in_consent_request", page: "dashboard", focus: `dropIn:${a.cr.id}` },
      });
    } catch (e) { captureException(e, { where: "dropIn: request push" }); }
    res.status(201).json(await view(db, a.cr, req.user.id));
  } catch (err) {
    captureException(err, { where: "dropIn: request" });
    res.status(500).json({ error: "Couldn't send that" });
  }
});

// POST /:recipientId/decline — the person asked says no (or the leader withdraws the ask).
router.post("/:recipientId/decline", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    const r = await D.pendingRequest(db, a.cr.id);
    if (!r) return res.json(await view(db, a.cr, req.user.id));
    const mine = r.requested_of === req.user.id;
    if (!mine && !(await D.isLeader(db, a.cr, req.user.id))) return res.status(403).json({ error: "Not yours to answer." });
    await D.closeRequests(db, a.cr.id, mine ? "declined" : "withdrawn");
    await D.audit(db, a.cr.id, req.user.id, mine ? "drop_in_consent_declined" : "drop_in_request_withdrawn", mine ? "Declined to sign the drop-in consent" : "Withdrew the ask", { requestId: r.id });
    res.json(await view(db, a.cr, req.user.id));
  } catch (err) {
    captureException(err, { where: "dropIn: decline" });
    res.status(500).json({ error: "Couldn't save that" });
  }
});

// PUT /:recipientId/settings { userIds?: [], noticeAwake?: bool } — leader only
router.put("/:recipientId/settings", async (req, res) => {
  try {
    if (req.user.impersonatedBy) return res.status(403).json({ error: "Not while viewing as someone else." });
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    if (!(await D.isLeader(db, a.cr, req.user.id))) return res.status(403).json({ error: "Only the care team leader can choose this." });
    const { parseSimpleMode, cleanHub } = require("../utils/simpleMode");
    let raw = {};
    try { raw = a.cr.simple_mode ? JSON.parse(a.cr.simple_mode) : {}; } catch { raw = {}; }
    const hub = { ...parseSimpleMode(a.cr.simple_mode).hub, ...(raw.hub || {}) };
    const changes = {};
    if (Array.isArray(req.body?.userIds)) {
      const ok = new Set((await D.dropInCandidates(db, a.cr)).map((c) => c.userId));
      hub.dropInUserIds = [...new Set(req.body.userIds.filter((id) => ok.has(id)))];
      changes.dropInUserIds = hub.dropInUserIds;
    }
    if (typeof req.body?.noticeAwake === "boolean") { hub.noticeAwake = req.body.noticeAwake; changes.noticeAwake = hub.noticeAwake; }
    const clean = cleanHub(hub);
    await db.prepare("UPDATE care_recipients SET simple_mode = ? WHERE id = ?").run(JSON.stringify({ ...raw, hub: clean }), a.cr.id);
    await D.audit(db, a.cr.id, req.user.id, "drop_in_settings_changed", "Changed who may drop in or awake noticing", changes);
    res.json(await view(db, await D.recipient(db, a.cr.id), req.user.id));
  } catch (err) {
    captureException(err, { where: "dropIn: settings" });
    res.status(500).json({ error: "Couldn't save that" });
  }
});

// ─── Awake noticing: the Hub reports each minute it noticed her ───
// POST /:recipientId/awake { motion: bool, voiceSeconds: n, touches: n } — her own account only.
// A minute counts as awake if there was movement, or ≥10 s of talking, or a touch (Pete:
// "Speaking enough to be awake, call it 10 seconds...with movement or other noise be
// considered awake"). Noise without movement or talking is not sent as awake by the Hub.
// Minutes within AWAKE_JOIN_MIN of each other join one period.
const AWAKE_JOIN_MIN = 10;
const VOICE_AWAKE_SECONDS = 10;
const PERSON_RECENT_MIN = 5; // v1.160.0 — movement/talking count only this soon after a person was seen
router.post("/:recipientId/awake", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200 || !a.herself) return res.status(404).json({ error: "Not found" });
    if (req.user.impersonatedBy) return res.json({ recorded: false });
    if (!(await D.mayNotice(db, a.cr.id))) return res.json({ recorded: false, reason: "off" });
    const motion = req.body?.motion === true;
    const voice = Math.max(0, Math.min(60, Number(req.body?.voiceSeconds) || 0));
    const touches = Math.max(0, Math.min(200, Math.floor(Number(req.body?.touches) || 0)));
    const talking = voice >= VOICE_AWAKE_SECONDS;
    // v1.160.0 — Pete, 11/25: the TV kept her "up" all night. person is true/false when the
    // tablet's person check is running, null when it isn't (old page, or the model failed).
    const person = req.body?.person === true ? true : req.body?.person === false ? false : null;
    const last = await db.prepare("SELECT * FROM hub_awake WHERE care_recipient_id = ? ORDER BY ended_at DESC LIMIT 1").get(a.cr.id);
    const joins = last && (Date.now() - new Date(last.ended_at).getTime()) <= AWAKE_JOIN_MIN * 60000;
    // A person seen within the last few minutes: the stretch she is in.
    const personRecently = !!(last && (last.person_minutes || 0) > 0 && (Date.now() - new Date(last.ended_at).getTime()) <= PERSON_RECENT_MIN * 60000);
    const awake = person === null
      ? (motion || talking || touches > 0)                         // no person check: the old rule
      : (person || touches > 0 || ((motion || talking) && personRecently)); // a person, not a TV
    if (!awake) return res.json({ recorded: false });
    if (joins) {
      await db.prepare(`UPDATE hub_awake SET ended_at = NOW(), motion_minutes = motion_minutes + ?, voice_minutes = voice_minutes + ?, touches = touches + ?, person_minutes = person_minutes + ? WHERE id = ?`)
        .run(motion ? 1 : 0, talking ? 1 : 0, touches, person ? 1 : 0, last.id);
    } else {
      await db.prepare(`INSERT INTO hub_awake (id, care_recipient_id, started_at, ended_at, motion_minutes, voice_minutes, touches, person_minutes) VALUES (?, ?, NOW() - INTERVAL '1 minute', NOW(), ?, ?, ?, ?)`)
        .run(uuid(), a.cr.id, motion ? 1 : 0, talking ? 1 : 0, touches, person ? 1 : 0);
    }
    res.json({ recorded: true });
  } catch (err) {
    captureException(err, { where: "dropIn: awake" });
    res.status(500).json({ error: "Couldn't record that" });
  }
});

module.exports = router;
module.exports.AWAKE_JOIN_MIN = AWAKE_JOIN_MIN;
module.exports.VOICE_AWAKE_SECONDS = VOICE_AWAKE_SECONDS;
module.exports.PERSON_RECENT_MIN = PERSON_RECENT_MIN;
