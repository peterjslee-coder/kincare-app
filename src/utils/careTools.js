// ─── Care tools come with care booked through InPlace (v1.114.0) ───
//
// Pete, 10/13: "until your commission fees to IP has passed about $20/mo, no video/voice, no
// care notes, no scheduling, no reimbursement, no hours, tasks....basically they get messaging
// and visits logged. I hate the 'unlock for premium features' crap on a lot of sites, but the
// software IS the hook we're trying to retain."
//
// His answers to the questions that shape it (10/13):
//   - measured over a ROLLING 30 days (no lock on the 1st of the month)
//   - locked = READ-ONLY, never hidden: everything a family entered stays visible
//   - medication reminders, medical records and legal documents stay free
//   - exempt: his own family (Betty's team), caregivers included. Caregivers never pay a fee;
//     their tools ride on paid visits instead (below)
//   - friends on a special rate are NOT exempt; at 7% they need ~$286 of care in 30 days
//
// What stays free for everyone: messaging, the family visit log, booking care, care team and
// caregiver invites, medication tasks and their check-offs, medical records, legal documents,
// and reading anything already entered. Settling a reimbursement that already exists (approve,
// pay, decline, cancel) also stays open — that is money owed to a person, not a tool.
//
// ── Where it is enforced ──
//   middleware/auth.js authenticate() → careToolsRefusal() below, right after the identity gate.
//   A locked request answers 403 { code: 'CARE_TOOLS_LOCKED', feature, ... } before the handler
//   runs; utils.js apiFetch turns that into one friendly sheet in the app.
//
// The unit is the PERSON, measured across every care recipient they are family-side on (owner,
// care team member other than a caregiver, share, or the person themselves). Booked care for any
// of them unlocks the tools — almost every family has one recipient.
//
// Caregivers (Pete, 10/13, revised): a caregiver's tools on a family's team — notes, task and
// to-do check-offs, calendar edits, video — work only inside a visit booked and paid through
// InPlace for that loved one. Messaging is always free. See careToolsCheck.

const { captureException } = require("./sentry");

const THRESHOLD_CENTS = 2000;     // "$20/mo"
const WINDOW_DAYS = 30;           // rolling
// Ledger kinds that are InPlace's own money. An authorization is a hold, not a charge; a tip is
// all the caregiver's.
const COMMISSION_KINDS = ["capture", "remainder", "autopay", "checkout", "cancel_fee", "reimbursement"];

const FEATURES = {
  video: "Video and voice calls",
  notes: "Care notes",
  calendar: "Appointments and the care calendar",
  tasks: "Care tasks",
  todos: "To-dos",
  reimbursements: "Reimbursements",
  hours: "Hours reports",
  ipai: "iPAi",
};

/** The care recipients this person is on the FAMILY side of. */
async function familyRecipientIds(db, userId) {
  const rows = await db.prepare(`
    SELECT cr.id FROM care_recipients cr WHERE cr.family_user_id = ? OR cr.linked_user_id = ?
    UNION
    SELECT ct.care_recipient_id FROM care_team_members ctm
      JOIN care_teams ct ON ct.id = ctm.care_team_id
     WHERE ctm.user_id = ? AND COALESCE(ctm.role, 'member') <> 'caregiver'
       -- a caregiver on a family's team is there as the caregiver, whatever her row says
       AND NOT EXISTS (SELECT 1 FROM caregiver_profiles cp WHERE cp.user_id = ctm.user_id)
    UNION
    SELECT s.care_recipient_id FROM care_recipient_shares s WHERE s.shared_with_user_id = ?
  `).all(userId, userId, userId, userId);
  return (rows || []).map((r) => r.id).filter(Boolean);
}

/** InPlace's commission on visits for these recipients over the rolling window, in cents. */
async function commissionCents(db, recipientIds) {
  if (!recipientIds.length) return 0;
  const ph = recipientIds.map(() => "?").join(",");
  const kindPh = COMMISSION_KINDS.map(() => "?").join(",");
  const ledger = await db.prepare(`
    SELECT COALESCE(SUM(le.platform_cents), 0) AS cents
      FROM ledger_entries le
      LEFT JOIN care_sessions cs ON cs.id = le.session_id
     WHERE COALESCE(le.care_recipient_id, cs.care_recipient_id) IN (${ph})
       AND le.kind IN (${kindPh})
       AND le.status = 'succeeded'
       AND le.created_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
  `).get(...recipientIds, ...COMMISSION_KINDS);
  // Payments recorded before the ledger existed (checkout / auto-pay rows with no ledger twin).
  const legacy = await db.prepare(`
    SELECT COALESCE(SUM(p.platform_fee), 0) AS dollars
      FROM payments p
      JOIN care_sessions cs ON cs.id = p.session_id
     WHERE cs.care_recipient_id IN (${ph})
       AND p.status = 'completed'
       AND p.created_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
       AND NOT EXISTS (SELECT 1 FROM ledger_entries le2 WHERE le2.session_id = p.session_id
                         AND le2.kind IN ('checkout', 'autopay', 'capture'))
  `).get(...recipientIds);
  return Math.round(Number(ledger && ledger.cents) || 0) + Math.round((Number(legacy && legacy.dollars) || 0) * 100);
}

/**
 * @returns {Promise<{status: 'exempt'|'unlocked'|'locked', reason: string|null,
 *   commissionCents: number, thresholdCents: number, windowDays: number,
 *   feePercent: number|null, careNeededCents: number}>}
 */
async function careToolsFor(db, userId) {
  const base = { thresholdCents: THRESHOLD_CENTS, windowDays: WINDOW_DAYS, commissionCents: 0, feePercent: null, careNeededCents: 0 };
  if (!userId) return { ...base, status: "locked", reason: null };
  const u = await db.prepare("SELECT is_admin, is_demo, care_tools_open_at FROM users WHERE id = ?").get(userId);
  if (!u) return { ...base, status: "locked", reason: null };
  if (u.is_admin) return { ...base, status: "exempt", reason: "admin" };
  // Pete turned this person's tools on by hand (Admin → People → Care tools).
  if (u.care_tools_open_at) return { ...base, status: "exempt", reason: "admin_opened" };
  // Demo accounts are fiction and never book real care; the demo has to show the product.
  if (u.is_demo) return { ...base, status: "exempt", reason: "demo" };
  const recipients = await familyRecipientIds(db, userId);
  // A caregiver never pays a fee, so the FAMILY rule does not apply to her. What she can do
  // on a family's team is decided per visit instead (caregiverVisitWindow below).
  if (!recipients.length) {
    const cg = await db.prepare("SELECT 1 AS x FROM caregiver_profiles WHERE user_id = ? LIMIT 1").get(userId);
    if (cg) return { ...base, status: "exempt", reason: "caregiver" };
  }
  if (recipients.length) {
    // Pete's own family: any recipient an admin owns or is on the team of.
    const ph = recipients.map(() => "?").join(",");
    const adminTeam = await db.prepare(`
      SELECT 1 AS x FROM care_recipients cr JOIN users au ON au.id = cr.family_user_id
       WHERE cr.id IN (${ph}) AND au.is_admin = 1
      UNION
      SELECT 1 FROM care_teams ct JOIN care_team_members ctm ON ctm.care_team_id = ct.id
        JOIN users au ON au.id = ctm.user_id
       WHERE ct.care_recipient_id IN (${ph}) AND au.is_admin = 1
      LIMIT 1
    `).get(...recipients, ...recipients);
    if (adminTeam) return { ...base, status: "exempt", reason: "founder_family" };
  }

  let cents = await commissionCents(db, recipients);
  let feePercent = null;
  try {
    const { loadFeeTable } = require("./platformFee");
    const table = await loadFeeTable(db);
    feePercent = table.pctFor({ care_recipient_id: recipients[0] || null, family_user_id: userId });
  } catch { /* the estimate is a courtesy */ }
  // Paying a caregiver directly through the app (Payments → pay a caregiver, no visit) is
  // on-app money too. manual_payments stores her amount; the fee rode on top at this
  // family's percent.
  try {
    const mp = await db.prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM manual_payments
       WHERE from_user_id = ? AND status = 'completed' AND created_at >= NOW() - INTERVAL '${WINDOW_DAYS} days'
    `).get(userId);
    const pct = feePercent != null ? feePercent : 20;
    cents += Math.round((Number(mp && mp.cents) || 0) * pct / 100);
  } catch { /* older databases: no manual payments */ }
  const short = Math.max(0, THRESHOLD_CENTS - cents);
  // How much care, at this family's own fee, would make up the difference.
  const careNeededCents = feePercent ? Math.ceil(short / (feePercent / 100) / 100) * 100 : 0;
  return {
    ...base,
    status: cents >= THRESHOLD_CENTS ? "unlocked" : "locked",
    reason: null,
    commissionCents: cents,
    feePercent,
    careNeededCents,
  };
}

// ── Which requests are care tools ──
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns the feature key a request touches, or null when it is free. `taskIsMedication` is
 * an async lookup used only for care-task paths, so the common case costs nothing.
 */
async function featureFor(db, method, url) {
  const path = String(url || "").split("?")[0];
  const m = String(method || "GET").toUpperCase();

  if (path.startsWith("/api/video")) return "video";
  if (path.startsWith("/api/ipai") || path.startsWith("/api/care-intelligence") || path.startsWith("/api/scheduling")) return "ipai";
  if (/^\/api\/care-recipients\/[^/]+\/doctor-report/.test(path)) return "ipai";
  if (path.startsWith("/api/reports/hours")) return "hours";

  if (!WRITE.has(m)) return null; // reading what is already there is always free

  if (path.startsWith("/api/notes")) return "notes";
  if (path.startsWith("/api/care-events")) return "calendar";
  if (path.startsWith("/api/care-todos")) return "todos";
  if (path.startsWith("/api/reimbursements")) {
    // New requests and recurring schedules are the tool. Settling one that exists is money
    // owed to a person and is never blocked.
    if (path === "/api/reimbursements" || path === "/api/reimbursements/" ||
        path === "/api/reimbursements/record" || path === "/api/reimbursements/schedules") return "reimbursements";
    return null;
  }
  if (path.startsWith("/api/care-tasks")) {
    return (await careTaskIsMedication(db, m, path)) ? null : "tasks";
  }
  return null;
}

// Medication tasks — creating, editing and checking them off — stay free (Pete, 10/13).
async function careTaskIsMedication(db, method, path) {
  try {
    const occ = path.match(/^\/api\/care-tasks\/occurrences\/([^/]+)/);
    if (occ) {
      const r = await db.prepare(`
        SELECT t.task_type FROM care_task_occurrences o JOIN care_tasks t ON t.id = o.task_id WHERE o.id = ?
      `).get(occ[1]);
      return !!r && r.task_type === "medication";
    }
    const one = path.match(/^\/api\/care-tasks\/([^/]+)/);
    // PUT/DELETE /:id, POST /:id/restore — the task already exists; read its type.
    if (one && (method !== "POST" || /\/restore$/.test(path))) {
      const r = await db.prepare("SELECT task_type FROM care_tasks WHERE id = ?").get(one[1]);
      return !!r && r.task_type === "medication";
    }
    return false; // POST /api/care-tasks (create) is decided from the body by the caller
  } catch (e) {
    captureException(e, { where: "careTools: task type" });
    return true; // fail OPEN on a lookup error: never block a medication check-off by accident
  }
}

// ── A caregiver's tools ride on a paid visit (Pete, 10/13) ──
// "Only sessions that are booked and paid in app get the checkin/notes/etc." A caregiver on a
// family's team can always MESSAGE them. Her care notes, task and to-do check-offs, calendar
// edits and video calls work only inside a visit booked and paid through InPlace for that
// loved one: on the day of a confirmed visit, during it, and until 6 hours after it ends (time
// to finish the report). "Paid" = the card hold is in place or the visit is paid.
const CAREGIVER_FEATURES = new Set(["notes", "tasks", "todos", "calendar", "video"]);

async function caregiverVisitWindow(db, userId, recipientId) {
  const r = await db.prepare(`
    SELECT 1 AS x
      FROM care_sessions cs
      JOIN caregiver_profiles cp ON cp.id = cs.caregiver_id
     WHERE cp.user_id = ?
       ${recipientId ? "AND cs.care_recipient_id = ?" : ""}
       AND (cs.payment_status IN ('authorized', 'paid') OR cs.payment_captured_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM payments p WHERE p.session_id = cs.id AND p.status = 'completed'))
       AND (cs.status = 'in_progress'
            OR (cs.status = 'completed' AND COALESCE(cs.completed_at, cs.updated_at) >= NOW() - INTERVAL '6 hours')
            OR (cs.status = 'confirmed' AND cs.scheduled_date = TO_CHAR(NOW() AT TIME ZONE COALESCE(
                  (SELECT timezone FROM care_recipients WHERE id = cs.care_recipient_id), 'America/New_York'), 'YYYY-MM-DD')))
     LIMIT 1
  `).get(...(recipientId ? [userId, recipientId] : [userId]));
  return !!r;
}

/** The loved one a caregiver-tool request is about, when it can be told. */
async function recipientForRequest(db, method, path, body) {
  const b = body || {};
  const fromBody = b.care_recipient_id || b.careRecipientId || null;
  if (fromBody && (method === "POST")) return String(fromBody);
  let m;
  if ((m = path.match(/^\/api\/care-tasks\/occurrences\/([^/]+)/))) {
    const r = await db.prepare("SELECT t.care_recipient_id FROM care_task_occurrences o JOIN care_tasks t ON t.id = o.task_id WHERE o.id = ?").get(m[1]);
    return r ? r.care_recipient_id : null;
  }
  if ((m = path.match(/^\/api\/care-tasks\/([^/]+)/))) {
    const r = await db.prepare("SELECT care_recipient_id FROM care_tasks WHERE id = ?").get(m[1]);
    return r ? r.care_recipient_id : null;
  }
  if ((m = path.match(/^\/api\/care-todos\/([^/]+)/))) {
    const r = await db.prepare("SELECT care_recipient_id FROM care_todos WHERE id = ?").get(m[1]);
    return r ? r.care_recipient_id : null;
  }
  if ((m = path.match(/^\/api\/care-events\/([^/]+)/))) {
    const r = await db.prepare("SELECT care_recipient_id FROM care_events WHERE id = ?").get(m[1]);
    return r ? r.care_recipient_id : null;
  }
  if ((m = path.match(/^\/api\/notes\/([^/]+)/))) {
    const r = await db.prepare("SELECT care_recipient_id FROM recipient_notes WHERE id = ?").get(m[1]);
    return r ? r.care_recipient_id : null;
  }
  return fromBody ? String(fromBody) : null;
}

/** Is this recipient exempt as Pete's own family (an admin owns it or is on its team)? */
async function founderFamilyRecipient(db, recipientId) {
  if (!recipientId) return false;
  const r = await db.prepare(`
    SELECT 1 AS x FROM care_recipients cr JOIN users au ON au.id = cr.family_user_id
     WHERE cr.id = ? AND au.is_admin = 1
    UNION
    SELECT 1 FROM care_teams ct JOIN care_team_members ctm ON ctm.care_team_id = ct.id
      JOIN users au ON au.id = ctm.user_id
     WHERE ct.care_recipient_id = ? AND au.is_admin = 1
    LIMIT 1
  `).get(recipientId, recipientId);
  return !!r;
}

/**
 * { feature, refusal } for a request. feature is null when the request is not a care tool;
 * refusal is the 403 body when this person may not use it right now. Called from
 * authenticate(), after the body is parsed.
 *
 *   family side (owner, team member, share, the person themselves) → the $20 / 30-day rule
 *   caregiver on that loved one's team → only inside a paid visit
 */
async function careToolsCheck(db, req) {
  const url = req.originalUrl || req.url || req.path;
  if (!url || !String(url).startsWith("/api/")) return { feature: null, refusal: null };
  const userId = req.user && req.user.id;
  if (!userId || userId === "api-key-admin") return { feature: null, refusal: null };
  const method = String(req.method || "GET").toUpperCase();
  const path = String(url).split("?")[0];
  let feature = await featureFor(db, method, url);
  const isTaskCreate = method === "POST" && /^\/api\/care-tasks\/?$/.test(path);
  if (feature === "tasks" && isTaskCreate) {
    const t = req.body && (req.body.task_type || req.body.type);
    if (t === "medication") feature = null;
  }

  // A caregiver checking off a MEDICATION task is still a caregiver tool (featureFor frees
  // medication tasks for families). Work out the caregiver case on its own terms.
  const u = await db.prepare("SELECT is_admin, is_demo, care_tools_open_at FROM users WHERE id = ?").get(userId);
  if (!u || u.is_admin || u.is_demo || u.care_tools_open_at) return { feature, refusal: null };
  const isCaregiver = !!(await db.prepare("SELECT 1 AS x FROM caregiver_profiles WHERE user_id = ? LIMIT 1").get(userId));

  if (isCaregiver) {
    const cgFeature = feature || (WRITE.has(method) && /^\/api\/care-tasks\/occurrences\//.test(path) ? "tasks" : null);
    if (cgFeature && CAREGIVER_FEATURES.has(cgFeature)) {
      const rid = await recipientForRequest(db, method, path, req.body);
      const familySide = rid ? (await familyRecipientIds(db, userId)).includes(rid) : false;
      if (!familySide) {
        if (await founderFamilyRecipient(db, rid)) return { feature: cgFeature, refusal: null };
        const ok = await caregiverVisitWindow(db, userId, rid);
        return {
          feature: cgFeature,
          refusal: ok ? null : {
            code: "CARE_TOOLS_LOCKED", feature: cgFeature, featureName: FEATURES[cgFeature], audience: "caregiver",
            error: `${FEATURES[cgFeature]}: these work during a visit booked and paid through InPlace. You can still message the family any time.`,
          },
        };
      }
    }
  }

  if (!feature) return { feature: null, refusal: null };
  const state = await careToolsFor(db, userId);
  return { feature, refusal: state.status === "locked" ? refusalBody(feature, state) : null };
}

async function careToolsRefusal(db, req) {
  return (await careToolsCheck(db, req)).refusal;
}

/**
 * Count one use of a tool (usage_counters, kind "tool:<feature>", per day). Feeds the admin
 * report of who uses the costly tools. Never throws.
 */
async function recordToolUse(db, userId, feature) {
  if (!userId || !feature) return;
  try {
    await db.prepare(`
      INSERT INTO usage_counters (user_id, kind, day, count) VALUES (?, ?, CURRENT_DATE, 1)
      ON CONFLICT (user_id, kind, day) DO UPDATE SET count = usage_counters.count + 1
    `).run(userId, `tool:${feature}`);
  } catch { /* usage is never load-bearing */ }
}

function refusalBody(feature, state) {
  return {
    code: "CARE_TOOLS_LOCKED",
    feature,
    featureName: FEATURES[feature] || "This",
    error: `${FEATURES[feature] || "This"}: part of the care tools that come with care booked through InPlace.`,
    careNeededCents: state.careNeededCents,
    windowDays: state.windowDays,
  };
}

module.exports = {
  careToolsFor, careToolsRefusal, careToolsCheck, recordToolUse, featureFor, caregiverVisitWindow, familyRecipientIds, commissionCents,
  THRESHOLD_CENTS, WINDOW_DAYS, FEATURES, COMMISSION_KINDS,
};
