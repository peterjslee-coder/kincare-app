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

// GET /:recipientId/live — v1.165.0: is she in a call right now, and with whom (utils/liveCall.js).
// Pete, 11/26: "Can I see if she's currently in a call?" Her family (anyone `access` lets in,
// not hired caregivers). Names only for people on her care team; anyone else is "someone".
router.get("/:recipientId/live", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200 || a.herself) return res.status(404).json({ error: "Not found" });
    const linked = a.cr.linked_user_id || (await db.prepare("SELECT linked_user_id FROM care_recipients WHERE id = ?").get(a.cr.id) || {}).linked_user_id;
    if (!linked) return res.json({ inCall: false });
    const c = await require("../utils/liveCall").callFor(linked);
    if (!c.inCall) return res.json({ inCall: c.inCall });
    const names = [];
    for (const id of c.withIds) {
      const u = await db.prepare(
        `SELECT u.first_name FROM users u WHERE u.id = ? AND (u.id = ? OR EXISTS (
           SELECT 1 FROM care_team_members m JOIN care_teams t ON t.id = m.care_team_id
            WHERE t.care_recipient_id = ? AND m.user_id = u.id) OR EXISTS (
           SELECT 1 FROM care_recipients r WHERE r.id = ? AND r.family_user_id = u.id))`
      ).get(id, req.user.id, a.cr.id, a.cr.id);
      names.push(u ? (id === req.user.id ? "you" : u.first_name) : "someone");
    }
    res.json({ inCall: true, since: c.since, with: names });
  } catch (err) {
    captureException(err, { where: "dropIn: live" });
    res.json({ inCall: null });
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
    // v1.164.0 — "recently" is measured from the last time a person was actually SEEN
    // (last_person_at), not from the stretch's end. The end moves every minute the TV talks, so
    // one sighting at 6 PM used to keep Betty "up" until morning (Pete, 11/26).
    const lastSeen = last && last.last_person_at ? new Date(last.last_person_at).getTime() : 0;
    const personRecently = !!lastSeen && (Date.now() - lastSeen) <= PERSON_RECENT_MIN * 60000;
    // v1.164.0 — with no person check running, sound and movement can't be told from the TV,
    // so only a touch counts. The Hub's status line says the check isn't working.
    // v1.167.0 — what counts near a person follows the leader's confirmed tuning
    // (utils/hubTuning.js): movement and sound each can be switched off.
    const tuning = require("../utils/simpleMode").parseSimpleMode(a.cr.simple_mode).hub.tuning || require("../utils/hubTuning").cleanTuning(null);
    const near = (motion && tuning.motionNearPerson) || (talking && tuning.soundNearPerson);
    const awake = person === null
      ? touches > 0
      : (person || touches > 0 || (near && personRecently)); // a person, not a TV
    const review = await require("../utils/hubReview").isOn(db, a.cr.id);
    if (!awake) return res.json({ recorded: false, review });
    if (joins) {
      await db.prepare(`UPDATE hub_awake SET ended_at = NOW(), motion_minutes = motion_minutes + ?, voice_minutes = voice_minutes + ?, touches = touches + ?, person_minutes = person_minutes + ?, last_person_at = CASE WHEN ? THEN NOW() ELSE last_person_at END WHERE id = ?`)
        .run(motion ? 1 : 0, talking ? 1 : 0, touches, person ? 1 : 0, !!person, last.id);
    } else {
      await db.prepare(`INSERT INTO hub_awake (id, care_recipient_id, started_at, ended_at, motion_minutes, voice_minutes, touches, person_minutes, last_person_at) VALUES (?, ?, NOW() - INTERVAL '1 minute', NOW(), ?, ?, ?, ?, CASE WHEN ? THEN NOW() ELSE NULL END)`)
        .run(uuid(), a.cr.id, motion ? 1 : 0, talking ? 1 : 0, touches, person ? 1 : 0, !!person);
    }
    res.json({ recorded: true, review });
  } catch (err) {
    captureException(err, { where: "dropIn: awake" });
    res.status(500).json({ error: "Couldn't record that" });
  }
});

// ─── v1.164.0 — checking the noticing (utils/hubReview.js) ───
const R = require("../utils/hubReview");

/** Who would be told if the leader signs: her recorded agents, by first name ("Sara", "Sara and Dean"). */
async function agentNames(db, cr, exceptUserId) {
  const signers = (await D.possibleSigners(db, cr)).filter((x) => x.capacity !== "self" && x.userId !== exceptUserId);
  const names = signers.map((x) => x.firstName).filter(Boolean);
  return { signers, text: names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : (names[0] || "") };
}

function reviewView(cr, c, capacity, leader, agents) {
  const asLeader = !capacity && leader;
  return {
    on: !!c,
    endsAt: c ? c.ends_at : null,
    signerName: c ? c.signer_name : null,
    signedAt: c ? c.created_at : null,
    wording: R.wordingFor(cr.first_name || "them", asLeader, agents || ""),
    wordingVersion: R.WORDING_VERSION,
    canSign: !!capacity || leader,
    capacityLabel: capacity ? D.CAPACITY_LABEL[capacity] : leader ? "care team leader" : null,
    isLeader: leader,
    days: R.REVIEW_DAYS, hours: R.CLIP_HOURS,
  };
}

// GET /:recipientId/review — is checking on, and the clips (leader only)
router.get("/:recipientId/review", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200 || a.herself) return res.status(404).json({ error: "Not found" });
    const leader = await D.isLeader(db, a.cr, req.user.id);
    const capacity = await D.signerCapacity(db, a.cr, req.user.id);
    if (!leader && !capacity) return res.status(403).json({ error: "Only the team leader can see this" });
    const c = await R.current(db, a.cr.id);
    const agents = (await agentNames(db, a.cr, req.user.id)).text;
    res.json({ ...reviewView(a.cr, c, capacity, leader, agents), clips: leader ? await R.listClips(db, a.cr.id) : [] });
  } catch (err) {
    captureException(err, { where: "dropIn: review" });
    res.status(500).json({ error: "Couldn't load that" });
  }
});

// POST /:recipientId/review/consent { signerName, agree: true, wordingVersion }
router.post("/:recipientId/review/consent", async (req, res) => {
  try {
    if (req.user.impersonatedBy) return res.status(403).json({ error: "A consent can't be signed while viewing as someone else." });
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    const capacity = await D.signerCapacity(db, a.cr, req.user.id);
    const leader = await D.isLeader(db, a.cr, req.user.id);
    if (!capacity && !leader) return res.status(403).json({ error: `Only the care team leader, ${a.cr.first_name || "the person"}, or the agent recorded under their power of attorney or as their healthcare agent, can sign this.` });
    if (!(await D.mayNotice(db, a.cr.id))) return res.status(409).json({ error: "Turn on noticing first (the drop-in consent and Notice when up)." });
    const name = String((req.body && req.body.signerName) || "").trim().slice(0, 120);
    if (req.body?.agree !== true || name.length < 2) return res.status(400).json({ error: "Type your full name and tick that you agree." });
    if (req.body?.wordingVersion !== R.WORDING_VERSION) return res.status(409).json({ error: "The wording changed. Please read it again." });
    const asLeader = !capacity;
    const agents = await agentNames(db, a.cr, req.user.id);
    const role = capacity || "team_leader";
    const label = capacity ? D.CAPACITY_LABEL[capacity] : "care team leader";
    const c = await R.sign(db, a.cr, req.user, role, name, R.wordingFor(a.cr.first_name || "them", asLeader, agents.text));
    await D.audit(db, a.cr.id, req.user.id, "hub_review_signed",
      `${name} agreed, as ${label}, to the Hub saving pictures and sound for ${R.REVIEW_DAYS} days to check its noticing`,
      { consentId: c.id, capacity: role, wordingVersion: R.WORDING_VERSION, endsAt: c.ends_at, told: agents.signers.map((x) => x.userId) });
    // Her agents hear about it at once, and can stop it (POST /review/stop allows them).
    // No details on the lock screen (v1.105.39): who and where are in the app.
    for (const ag of agents.signers) {
      try {
        const { sendPushToUser } = require("../utils/push");
        await sendPushToUser(db, ag.userId, "InPlace Hub", `${name.split(" ")[0]} turned on a 7-day check of the Hub. Open InPlace to see it or stop it.`, { type: "hub_review_started", page: "care-team" }).catch(() => {});
        await db.prepare("INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)")
          .run(uuid(), ag.userId, "hub_review_started", `${a.cr.first_name}'s Hub: checking is on for ${R.REVIEW_DAYS} days`,
            `${name} turned on checking: for ${R.REVIEW_DAYS} days the Hub saves a picture and a few seconds of sound each minute it notices something, so the leader can see whether it's noticing ${a.cr.first_name} or the TV. You can stop it in Care Team, Accessibility Options, Check what it's counting.`,
            JSON.stringify({ careRecipientId: a.cr.id }));
      } catch (e) { captureException(e, { where: "dropIn: review notify agent" }); }
    }
    res.status(201).json(reviewView(a.cr, c, capacity, leader, agents.text));
  } catch (err) {
    captureException(err, { where: "dropIn: review consent" });
    res.status(500).json({ error: "Couldn't record that" });
  }
});

// POST /:recipientId/review/stop — stops checking and deletes everything saved
router.post("/:recipientId/review/stop", async (req, res) => {
  try {
    if (req.user.impersonatedBy) return res.status(403).json({ error: "Not while viewing as someone else." });
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200) return res.status(a.status).json({ error: "Not found" });
    const may = a.herself || (await D.isLeader(db, a.cr, req.user.id)) || !!(await D.signerCapacity(db, a.cr, req.user.id));
    if (!may) return res.status(403).json({ error: "Not allowed" });
    const deleted = await R.withdraw(db, a.cr.id, req.user.id);
    await D.audit(db, a.cr.id, req.user.id, "hub_review_stopped", `Checking the noticing was stopped; ${deleted} saved minute(s) deleted`, { deleted });
    res.json({ on: false, deleted });
  } catch (err) {
    captureException(err, { where: "dropIn: review stop" });
    res.status(500).json({ error: "Couldn't stop it" });
  }
});

// POST /:recipientId/review-clip { photo, audio, counted, signals } — from her Hub only
router.post("/:recipientId/review-clip", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200 || !a.herself) return res.status(404).json({ error: "Not found" });
    if (req.user.impersonatedBy) return res.json({ saved: false });
    if (!(await R.isOn(db, a.cr.id))) return res.json({ saved: false, reason: "off" });
    const b = req.body || {};
    res.json(await R.saveClip(db, a.cr.id, { photo: b.photo, audio: b.audio, counted: b.counted === true, signals: b.signals }));
  } catch (err) {
    captureException(err, { where: "dropIn: review clip" });
    res.status(500).json({ error: "Couldn't save that" });
  }
});

// GET /:recipientId/review-clip/:clipId/:part — the picture or the sound (leader only)
router.get("/:recipientId/review-clip/:clipId/:part", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200 || a.herself || !(await D.isLeader(db, a.cr, req.user.id))) return res.status(404).json({ error: "Not found" });
    const col = req.params.part === "photo" ? "photo_ref" : req.params.part === "audio" ? "audio_ref" : null;
    if (!col) return res.status(404).json({ error: "Not found" });
    const row = await db.prepare(`SELECT ${col} AS ref FROM hub_review_clips WHERE id = ? AND care_recipient_id = ? AND expires_at > NOW()`).get(req.params.clipId, a.cr.id);
    if (!row || !row.ref) return res.status(404).json({ error: "Not found" });
    const data = await require("../utils/storage").resolveFileData(row.ref);
    const m = data && String(data).match(/^data:([^;,]+)[^,]*;base64,(.+)$/s);
    if (!m) return res.status(404).json({ error: "Not found" });
    res.set("Content-Type", m[1]);
    res.set("Cache-Control", "private, no-store");
    res.send(Buffer.from(m[2], "base64"));
  } catch (err) {
    captureException(err, { where: "dropIn: review clip read" });
    res.status(500).json({ error: "Couldn't load that" });
  }
});

// POST /:recipientId/review/delete { before? } — "Reviewed — delete these" (leader only)
router.post("/:recipientId/review/delete", async (req, res) => {
  try {
    const db = await getDb();
    const a = await access(db, req);
    if (a.status !== 200 || a.herself || !(await D.isLeader(db, a.cr, req.user.id))) return res.status(404).json({ error: "Not found" });
    const before = req.body && req.body.before && !Number.isNaN(Date.parse(req.body.before)) ? new Date(req.body.before).toISOString() : null;
    const deleted = await R.deleteClips(db, a.cr.id, { before });
    await D.audit(db, a.cr.id, req.user.id, "hub_review_deleted", `${deleted} reviewed minute(s) deleted`, { deleted });
    res.json({ deleted });
  } catch (err) {
    captureException(err, { where: "dropIn: review delete" });
    res.status(500).json({ error: "Couldn't delete them" });
  }
});

module.exports = router;
module.exports.AWAKE_JOIN_MIN = AWAKE_JOIN_MIN;
module.exports.VOICE_AWAKE_SECONDS = VOICE_AWAKE_SECONDS;
module.exports.PERSON_RECENT_MIN = PERSON_RECENT_MIN;
