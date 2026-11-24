/**
 * Outreach progress ladder (v1.125.0).
 *
 * Pete, 10/26: "track where they are in the process from the outreach tab ... see steps along the
 * way and how far they made it ... all the way to signup ... just perused the splash page, etc."
 *
 * Every step is read from something the app ALREADY records — no new tracking, nothing new in
 * the privacy policy:
 *
 *   called        outreach_messages kind='call', direction='out'      (Pete dialed from Outreach)
 *   texted_join   outreach_contacts.texts_ok_at                      (their first text = their OK)
 *   link_sent     first outbound text carrying a /i/ link, not failed
 *   link_opened   visit_events kind='start' on one of their track_links
 *   read_page     screen time on the caregiver landing page / welcome page
 *   started       the Sign-up screen (appState 'register' / 'invite' / caregiver onboarding)
 *   account       users.created_at for the account matched to this contact
 *   id_sent       their identity document was submitted          (utils/identity.js — the ONE resolver)
 *   id_ok         ... and a human approved it, or ID seen in person
 *   bg_started    background check consent / Checkr invitation
 *   bg_clear      Checkr phase CLEARED                            (constants/checkrStatus.js)
 *   payouts       Stripe payouts set up (stripe_onboard_complete)
 *   first_visit   first COMPLETED payment where they were the caregiver
 *
 * Some facts carry no timestamp (payouts set up; a Checkr clear from the webhook). Those steps
 * are done with at = null, and the UI says "done" without a date. A later step being done never
 * back-fills an earlier one: the ladder shows what happened, gaps included (someone Pete met in
 * person never "texted JOIN", and that is true).
 *
 * The pre-signup facts are computed for every contact in a handful of set-based queries, so the
 * list stays one round of SQL however long it grows. Post-signup facts are per matched account,
 * and only a few contacts have one.
 */
const { personIdentityStatus } = require("./identity");
const { phaseFor, PHASE } = require("../constants/checkrStatus");

const STEPS = [
  { key: "called", label: "Called" },
  { key: "texted_join", label: "Texted JOIN" },
  { key: "link_sent", label: "Got their link" },
  { key: "link_opened", label: "Opened the link" },
  { key: "read_page", label: "Read about InPlace" },
  { key: "started", label: "Started sign-up" },
  { key: "account", label: "Created an account" },
  { key: "id_sent", label: "Sent photo ID" },
  { key: "id_ok", label: "ID approved" },
  { key: "bg_started", label: "Background check started" },
  { key: "bg_clear", label: "Background check clear" },
  { key: "payouts", label: "Payouts set up" },
  { key: "first_visit", label: "First paid visit" },
];
const STEP_KEYS = STEPS.map((s) => s.key);

// Screens that count as "reading about InPlace" before signing up.
const READ_PAGES = ["land-caregiver", "splash"];
// Screens that mean they began creating an account.
const SIGNUP_PAGES = ["register", "invite", "platform-onboarding", "signup-onboarding"];

const ph = (n) => Array.from({ length: n }, () => "?").join(",");
const DAY = 24 * 60 * 60 * 1000;

/**
 * @param db
 * @param contacts  rows with { id, texts_ok_at, opted_out_at, status, joined_user_id }
 * @param now       injectable for tests
 * @returns Map contactId → { steps, furthest, furthestLabel, furthestAt, stalledDays, flag }
 */
async function progressFor(db, contacts, now = new Date()) {
  const out = new Map();
  if (!contacts || contacts.length === 0) return out;
  const ids = contacts.map((c) => c.id);
  const facts = new Map(ids.map((id) => [id, {}]));
  const set = (cid, key, at, extra) => {
    const f = facts.get(cid);
    if (!f) return;
    f[key] = { at: at || null, ...(extra || {}) };
  };

  // ── Calls and texts ──
  const msgs = await db.prepare(`
    SELECT contact_id,
           MIN(created_at) FILTER (WHERE kind = 'call' AND direction = 'out') AS called_at,
           MIN(created_at) FILTER (WHERE direction = 'out' AND COALESCE(kind, 'sms') = 'sms'
                                    AND body LIKE '%/i/%'
                                    AND COALESCE(status, '') NOT IN ('failed', 'undelivered')) AS link_sent_at
      FROM outreach_messages
     WHERE contact_id IN (${ph(ids.length)})
     GROUP BY contact_id
  `).all(...ids);
  for (const m of msgs) {
    if (m.called_at) set(m.contact_id, "called", m.called_at);
    if (m.link_sent_at) set(m.contact_id, "link_sent", m.link_sent_at);
  }
  for (const c of contacts) if (c.texts_ok_at) set(c.id, "texted_join", c.texts_ok_at);

  // ── Their link and what they looked at ──
  const opened = await db.prepare(`
    SELECT l.outreach_contact_id AS cid, MIN(e.created_at) AS at, COUNT(*) AS n
      FROM track_links l JOIN visit_events e ON e.link_code = l.code AND e.kind = 'start'
     WHERE l.outreach_contact_id IN (${ph(ids.length)})
     GROUP BY l.outreach_contact_id
  `).all(...ids);
  for (const o of opened) set(o.cid, "link_opened", o.at, { count: Number(o.n) || 0 });

  // A contact's browsers: any that arrived on their link, plus any signed in as their account.
  const joined = contacts.filter((c) => c.joined_user_id);
  const userArgs = joined.flatMap((c) => [c.id, c.joined_user_id]);
  const userValues = joined.length ? joined.map(() => "(?, ?)").join(",") : null;
  const pages = await db.prepare(`
    WITH cv AS (
      SELECT DISTINCT l.outreach_contact_id AS cid, e.visitor_id AS vid
        FROM track_links l JOIN visit_events e ON e.link_code = l.code
       WHERE l.outreach_contact_id IN (${ph(ids.length)})
      UNION
      SELECT l.outreach_contact_id, v.id
        FROM track_links l JOIN visitors v ON v.first_link_code = l.code
       WHERE l.outreach_contact_id IN (${ph(ids.length)})
      ${userValues ? `UNION
      SELECT j.cid, v.id FROM (VALUES ${userValues}) AS j(cid, uid) JOIN visitors v ON v.user_id = j.uid` : ""}
    )
    SELECT cv.cid, e.page, MIN(e.created_at) AS first_at, COALESCE(SUM(e.ms), 0) AS ms
      FROM cv JOIN visit_events e ON e.visitor_id = cv.vid
     WHERE e.kind = 'page' AND e.demo = FALSE
       AND e.page IN (${ph(READ_PAGES.length + SIGNUP_PAGES.length)})
     GROUP BY cv.cid, e.page
  `).all(...ids, ...ids, ...userArgs, ...READ_PAGES, ...SIGNUP_PAGES);
  const readAgg = new Map();
  const signAgg = new Map();
  for (const p of pages) {
    const bucket = READ_PAGES.includes(p.page) ? readAgg : signAgg;
    const cur = bucket.get(p.cid) || { at: null, ms: 0 };
    if (!cur.at || new Date(p.first_at) < new Date(cur.at)) cur.at = p.first_at;
    cur.ms += Number(p.ms) || 0;
    bucket.set(p.cid, cur);
  }
  for (const [cid, v] of readAgg) set(cid, "read_page", v.at, { ms: v.ms });
  for (const [cid, v] of signAgg) set(cid, "started", v.at);

  // ── After sign-up: one matched account each ──
  for (const c of joined) {
    const uid = c.joined_user_id;
    const u = await db.prepare("SELECT created_at, id_verified_in_person_at FROM users WHERE id = ?").get(uid);
    if (!u) continue;
    set(c.id, "account", u.created_at);
    // Someone who made an account certainly started the sign-up, even if the screen was missed.
    if (!facts.get(c.id).started) set(c.id, "started", null);

    const idn = await personIdentityStatus(db, uid);
    if (idn.doc) set(c.id, "id_sent", idn.doc.created_at);
    if (idn.identityVerified) set(c.id, "id_ok", idn.doc.verified_at || null);
    else if (u.id_verified_in_person_at) set(c.id, "id_ok", u.id_verified_in_person_at, { inPerson: true });
    if (idn.identityStatus === "rejected") facts.get(c.id)._idRejected = true;

    const cp = await db.prepare(`
      SELECT id, checkr_status, is_background_checked, background_check_consent_at, checkr_invitation_id,
             bg_check_admin_approved_at, stripe_onboard_complete
        FROM caregiver_profiles WHERE user_id = ?
    `).get(uid);
    if (cp) {
      const phase = phaseFor(cp.checkr_status, !!cp.is_background_checked);
      if (cp.background_check_consent_at || cp.checkr_invitation_id || (phase !== PHASE.NOT_STARTED)) {
        set(c.id, "bg_started", cp.background_check_consent_at || null);
      }
      if (phase === PHASE.CLEARED) set(c.id, "bg_clear", cp.bg_check_admin_approved_at || null);
      facts.get(c.id)._bgPhase = phase;
      if (cp.stripe_onboard_complete) set(c.id, "payouts", null);
      const pay = await db.prepare(
        "SELECT MIN(created_at) AS at FROM payments WHERE caregiver_id = ? AND status = 'completed'"
      ).get(cp.id);
      if (pay && pay.at) set(c.id, "first_visit", pay.at);
    }
  }

  // ── Shape it ──
  for (const c of contacts) {
    const f = facts.get(c.id);
    const steps = STEPS.map((s) => ({ key: s.key, label: s.label, done: !!f[s.key], at: f[s.key]?.at || null,
      ...(f[s.key]?.ms != null ? { ms: f[s.key].ms } : {}),
      ...(f[s.key]?.count != null ? { count: f[s.key].count } : {}),
      ...(f[s.key]?.inPerson ? { inPerson: true } : {}) }));
    let fi = -1;
    steps.forEach((s, i) => { if (s.done) fi = i; });
    const furthest = fi >= 0 ? steps[fi] : null;

    // How long since anything happened, measured from the latest dated step at or before the
    // furthest one (an undated step can't start the clock).
    let lastAt = null;
    for (let i = fi; i >= 0; i--) { if (steps[i].at) { lastAt = steps[i].at; break; } }
    const finished = fi === steps.length - 1;
    const optedOut = !!c.opted_out_at || c.status === "opted_out";
    const stalledDays = !finished && !optedOut && lastAt
      ? Math.floor((now.getTime() - new Date(lastAt).getTime()) / DAY) : null;

    // A flag that needs Pete, independent of the ladder position.
    let flag = null;
    if (optedOut) flag = "opted_out";
    else if (f._bgPhase === PHASE.BLOCKED_PENDING_REVIEW) flag = "bg_needs_review";
    else if (f._bgPhase === PHASE.UNDER_REVIEW) flag = "bg_under_review";
    else if (f._idRejected) flag = "id_rejected";

    out.set(c.id, {
      steps,
      furthest: furthest ? furthest.key : null,
      furthestLabel: furthest ? furthest.label : "Not started",
      furthestAt: furthest ? furthest.at : null,
      next: !finished ? steps[fi + 1].label : null,
      stalledDays,
      flag,
    });
  }
  return out;
}

/** How many contacts reached each step (did it, not "is furthest at it"). */
function funnel(progressMap) {
  const counts = Object.fromEntries(STEP_KEYS.map((k) => [k, 0]));
  for (const p of progressMap.values()) for (const s of p.steps) if (s.done) counts[s.key] += 1;
  return STEPS.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }));
}

module.exports = { progressFor, funnel, STEPS, STEP_KEYS, READ_PAGES, SIGNUP_PAGES };
