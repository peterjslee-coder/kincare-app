// Split out of routes/admin.js (v1.92.0, tier-2 #3 — zero behavior change).
// Route bodies are verbatim; registration ORDER across modules is preserved by
// ./index.js. Shared state (passkey challenge store, helpers) lives in ./shared.js.
const { v4: uuid } = require("uuid");
const { getDb } = require("../../models/database");
const { authenticate, requireAdmin } = require("../../middleware/auth");
const { captureException } = require("../../utils/sentry");
const { activeVouchesFor } = require("../../utils/vouches");
const { sendVerificationEmail } = require("../auth");
const {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isTrustedIp, registerTrustedIp, getTrustedIps, removeTrustedIp } = require("../../utils/trustedIps");
const { getClientIp, writeAuditLog } = require("../../middleware/auditLog");
const {
  RP_ID, ORIGIN,
  setPasskeyChallenge, getPasskeyChallenge, setNukeChallenge, getNukeChallenge,
  NOT_DEMO_SESSION, safeJson, logAdminAction, checkAdmin,
} = require("./shared");

module.exports = function register(router) {

// ─── GET /api/admin/sessions/no-show-cancelled — List sessions cancelled by no-show poller ───
router.get("/sessions/no-show-cancelled", async (req, res) => {
  try {
    const db = await getDb();
    const sessions = await db.prepare(`
      SELECT cs.id, cs.scheduled_date, cs.scheduled_time, cs.status, cs.cancelled_at,
        cs.caregiver_no_show, cs.caregiver_no_show_at,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        u.first_name || ' ' || u.last_name AS caregiver_name,
        fu.first_name || ' ' || fu.last_name AS family_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users u ON cp.user_id = u.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE cs.cancelled_by = 'system' AND cs.caregiver_no_show = 1 AND ${NOT_DEMO_SESSION()}
      ORDER BY cs.cancelled_at DESC
      LIMIT 50
    `).all();
    res.json({ sessions });
  } catch (err) {
    console.error("List no-show cancelled error:", err);
    res.status(500).json({ error: "Failed to fetch cancelled sessions" });
  }
});

// ─── POST /api/admin/sessions/:id/restore — Restore any cancelled session ───
// Optional body: { checkInTime: "2026-03-31T14:00:00", setInProgress: true }
// If checkInTime is provided, also creates/updates the visit_log with the corrected check-in time.
router.post("/sessions/:id/restore", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id, cp.id AS caregiver_profile_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== 'cancelled') {
      return res.status(400).json({ error: "Session is not cancelled — current status: " + session.status });
    }

    const { checkInTime, setInProgress } = req.body || {};
    const wasNoShow = session.caregiver_no_show;
    const restoreStatus = (setInProgress || checkInTime) ? 'in_progress' : 'confirmed';

    await db.prepare(`
      UPDATE care_sessions SET
        status = ?,
        caregiver_no_show = 0,
        caregiver_no_show_at = NULL,
        cancelled_at = NULL,
        cancelled_by = NULL,
        cancel_reason = NULL,
        review_required = 0,
        notifications_sent = REPLACE(COALESCE(notifications_sent, ''), ',no_show_flagged', ''),
        updated_at = NOW()
      WHERE id = ?
    `).run(restoreStatus, req.params.id);

    // If check-in time provided, create or update the visit_log
    if (checkInTime && session.caregiver_profile_id) {
      const existingLog = await db.prepare("SELECT id FROM visit_logs WHERE session_id = ?").get(req.params.id);
      if (existingLog) {
        await db.prepare("UPDATE visit_logs SET check_in_time = ?, updated_at = NOW() WHERE session_id = ?")
          .run(checkInTime, req.params.id);
      } else {
        const { v4: uuidv4 } = require("uuid");
        await db.prepare(`
          INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
          VALUES (?, ?, ?, ?, NOW())
        `).run(uuidv4(), req.params.id, session.caregiver_profile_id, checkInTime);
      }
    }

    await logAdminAction(req, "restore_session", "care_session", req.params.id, {
      restoredTo: restoreStatus,
      previousCancelledBy: session.cancelled_by,
      previousCancelReason: session.cancel_reason,
      wasNoShow: !!wasNoShow,
      checkInTime: checkInTime || null,
    });

    console.log(`[admin] Restored session ${req.params.id.slice(0, 8)} → ${restoreStatus} (was: cancelled by ${session.cancelled_by || 'unknown'})${checkInTime ? ` (check-in: ${checkInTime})` : ''} by ${req.user.email}`);
    res.json({ success: true, message: `Session restored to ${restoreStatus}${checkInTime ? ` with check-in at ${checkInTime}` : ''}` });
  } catch (err) {
    console.error("Restore session error:", err);
    res.status(500).json({ error: "Failed to restore session" });
  }
});

// ─── POST /api/admin/sessions/:id/rewind — Rewind session to an earlier state ───
// Lets admin undo checkout (completed→in_progress) or undo check-in (in_progress→confirmed)
// Body: { target: "in_progress" | "confirmed" }
//   completed → in_progress: clears checkout data, keeps check-in. Re-test checkout.
//   completed → confirmed: full rewind, deletes visit log. Re-test everything.
//   in_progress → confirmed: undo check-in, deletes visit log. Re-test check-in.
router.post("/sessions/:id/rewind", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { target } = req.body || {};
    const validTransitions = {
      'completed': ['in_progress', 'confirmed'],
      'in_progress': ['confirmed'],
    };
    const allowed = validTransitions[session.status];
    if (!allowed) {
      return res.status(400).json({ error: `Cannot rewind from status "${session.status}" — only completed or in_progress sessions can be rewound` });
    }
    if (!target || !allowed.includes(target)) {
      return res.status(400).json({ error: `Invalid target "${target}" for status "${session.status}". Allowed: ${allowed.join(', ')}` });
    }

    const previousStatus = session.status;

    if (target === 'in_progress') {
      // Undo checkout only — keep the visit log and check-in, clear checkout data
      await db.prepare(`
        UPDATE care_sessions SET
          status = 'in_progress',
          completed_at = NULL,
          payment_due_at = NULL,
          payment_status = NULL,
          review_required = 0,
          review_completed = 0,
          overtime_minutes = NULL,
          overtime_cost = NULL,
          updated_at = NOW()
        WHERE id = ?
      `).run(req.params.id);

      // Clear checkout fields on the visit log (keep check-in data)
      await db.prepare(`
        UPDATE visit_logs SET
          check_out_time = NULL,
          departure_mood = NULL,
          condition_tags = NULL,
          care_feedback = NULL,
          service_feedback = NULL,
          summary = NULL,
          early_departure_reason = NULL,
          early_departure_minutes = NULL,
          check_out_lat = NULL,
          check_out_lng = NULL,
          ai_summary = NULL
        WHERE session_id = ?
      `).run(req.params.id);

      // Delete any payment records created during checkout
      await db.prepare("DELETE FROM payments WHERE session_id = ? AND status IN ('pending', 'waived')").run(req.params.id);

    } else if (target === 'confirmed') {
      // Full rewind — delete visit log, reset to pre-check-in state
      await db.prepare(`
        UPDATE care_sessions SET
          status = 'confirmed',
          completed_at = NULL,
          payment_due_at = NULL,
          payment_status = NULL,
          review_required = 0,
          review_completed = 0,
          overtime_minutes = NULL,
          overtime_cost = NULL,
          late_check_in = 0,
          late_minutes = NULL,
          notifications_sent = '[]',
          updated_at = NOW()
        WHERE id = ?
      `).run(req.params.id);

      // Delete visit logs entirely
      await db.prepare("DELETE FROM visit_logs WHERE session_id = ?").run(req.params.id);

      // Delete any payment records
      await db.prepare("DELETE FROM payments WHERE session_id = ? AND status IN ('pending', 'waived')").run(req.params.id);
    }

    await logAdminAction(req, "rewind_session", "care_session", req.params.id, {
      from: previousStatus,
      to: target,
    });

    console.log(`[admin] Rewound session ${req.params.id.slice(0, 8)}: ${previousStatus} → ${target} by ${req.user.email}`);
    res.json({ success: true, message: `Session rewound: ${previousStatus} → ${target}` });
  } catch (err) {
    console.error("Rewind session error:", err);
    res.status(500).json({ error: "Failed to rewind session" });
  }
});

// ─── POST /api/admin/sessions/:id/force-check-in ───
// Admin can force-check-in any confirmed session (bypasses caregiver-only gate)
router.post("/sessions/:id/force-check-in", async (req, res) => {
  try {
    const db = await getDb();
    const session = await db.prepare(`
      SELECT cs.*, cp.id AS caregiver_profile_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.id = ?
    `).get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status === 'in_progress') return res.json({ success: true, message: "Already checked in" });
    if (session.status !== 'confirmed') {
      return res.status(400).json({ error: "Cannot check in — session status is " + session.status });
    }

    const now = new Date();
    // Set session to in_progress
    await db.prepare(`
      UPDATE care_sessions SET status = 'in_progress', updated_at = NOW() WHERE id = ?
    `).run(req.params.id);

    // Create or update visit_log
    const { v4: uuidv4 } = require("uuid");
    const existing = await db.prepare("SELECT id FROM visit_logs WHERE session_id = ?").get(req.params.id);
    if (existing) {
      await db.prepare("UPDATE visit_logs SET check_in_time = ?, updated_at = NOW() WHERE session_id = ?")
        .run(now.toISOString(), req.params.id);
    } else {
      await db.prepare(`
        INSERT INTO visit_logs (id, session_id, caregiver_id, check_in_time, created_at)
        VALUES (?, ?, ?, ?, NOW())
      `).run(uuidv4(), req.params.id, session.caregiver_profile_id, now.toISOString());
    }

    await logAdminAction(req, "force_check_in", "care_session", req.params.id, { checkInTime: now.toISOString() });
    console.log(`[admin] Force check-in session ${req.params.id.slice(0, 8)} by ${req.user.email}`);
    res.json({ success: true, message: "Session checked in" });
  } catch (err) {
    console.error("Force check-in error:", err);
    res.status(500).json({ error: "Failed to force check-in" });
  }
});

// ─── GET /api/admin/sessions/:id/detail ───
// Full session lifecycle drill-down for admin audit view
// Returns: booking info, confirmation, check-in (GPS, mood), visit log,
// check-out, payment trail, no-show flags/restores, audit history
router.get("/sessions/:id/detail", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const sid = req.params.id;

    // 1. Core session data with all participants
    const session = await db.prepare(`
      SELECT cs.*,
        cr.first_name AS recipient_first, cr.last_name AS recipient_last,
        cr.age AS recipient_age, cr.health_conditions,
        cr.location_city, cr.location_state,
        fu.first_name AS family_first, fu.last_name AS family_last, fu.email AS family_email,
        cu.first_name AS caregiver_first, cu.last_name AS caregiver_last, cu.email AS caregiver_email,
        cp.hourly_rate AS caregiver_rate
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      LEFT JOIN users cu ON cp.user_id = cu.id
      WHERE cs.id = ?
    `).get(sid);

    if (!session) return res.status(404).json({ error: "Session not found" });

    // 2. Visit log (check-in, check-out, GPS, moods, notes)
    const visitLog = await db.prepare(`
      SELECT vl.*,
        vu.first_name AS vl_caregiver_first
      FROM visit_logs vl
      LEFT JOIN caregiver_profiles vcp ON vl.caregiver_id = vcp.id
      LEFT JOIN users vu ON vcp.user_id = vu.id
      WHERE vl.session_id = ?
      ORDER BY vl.created_at ASC
    `).all(sid);

    // 3. Payment records (session auto-pay + manual)
    let sessionPayments = [];
    try {
      sessionPayments = await db.prepare(`
        SELECT p.*, 'session' AS payment_type
        FROM payments p WHERE p.session_id = ?
        ORDER BY p.created_at ASC
      `).all(sid);
    } catch (e) { captureException(e, { where: "admin: session detail payments" }); }

    // 4. Activity feed entries for this session
    let activities = [];
    try {
      activities = await db.prepare(`
        SELECT af.event_type, af.title, af.message, af.metadata, af.created_at
        FROM activity_feed af
        WHERE af.metadata LIKE ?
        ORDER BY af.created_at ASC
      `).all(`%${sid}%`);
    } catch (e) { captureException(e, { where: "admin: session detail activities" }); }

    // 5. Admin audit log entries for this session
    let auditLog = [];
    try {
      auditLog = await db.prepare(`
        SELECT aal.action, aal.details, aal.ip_address, aal.created_at,
          u.first_name AS admin_first, u.last_name AS admin_last, u.email AS admin_email
        FROM admin_audit_log aal
        LEFT JOIN users u ON aal.admin_user_id = u.id
        WHERE aal.target_id = ? AND aal.target_type = 'care_session'
        ORDER BY aal.created_at ASC
      `).all(sid);
    } catch (e) { captureException(e, { where: "admin: session detail audit log" }); }

    // 6. Build a unified timeline
    const timeline = [];

    // Session created
    if (session.created_at) {
      timeline.push({ time: session.created_at, type: 'booking', label: 'Session Requested',
        detail: `${session.service_type}, ${session.duration_hours}h on ${session.scheduled_date} at ${session.scheduled_time}` });
    }

    // Confirmation (if caregiver assigned)
    if (session.caregiver_id && session.offered_to_caregiver_id) {
      timeline.push({ time: session.updated_at || session.created_at, type: 'confirmed', label: 'Caregiver Confirmed',
        detail: `${session.caregiver_first || ''} ${session.caregiver_last || ''}`.trim() });
    }

    // Check-in
    for (const vl of visitLog) {
      if (vl.check_in_time) {
        const gps = (vl.check_in_lat && vl.check_in_lng)
          ? { lat: vl.check_in_lat, lng: vl.check_in_lng, distance_ft: vl.check_in_distance_ft }
          : (vl.check_in_latitude && vl.check_in_longitude)
            ? { lat: vl.check_in_latitude, lng: vl.check_in_longitude }
            : null;
        let moods = {};
        try { moods.arrival = JSON.parse(vl.arrival_mood); } catch { moods.arrival = vl.arrival_mood; }
        timeline.push({ time: vl.check_in_time, type: 'check_in', label: 'Checked In',
          detail: `by ${vl.vl_caregiver_first || 'caregiver'}`, gps, moods,
          briefingAcked: !!vl.briefing_acknowledged_at });
      }

      // Visit notes
      if (vl.care_feedback || vl.summary) {
        let tags = [];
        try { tags = JSON.parse(vl.condition_tags || '[]'); } catch {} // expected: tolerated parse fallback
        timeline.push({ time: vl.check_out_time || vl.check_in_time || vl.created_at, type: 'visit_notes', label: 'Visit Notes',
          detail: vl.care_feedback || vl.summary, tags,
          serviceFeedback: vl.service_feedback || null });
      }

      // Check-out
      if (vl.check_out_time) {
        let departureMoods = {};
        try { departureMoods.departure = JSON.parse(vl.departure_mood); } catch { departureMoods.departure = vl.departure_mood; }
        const checkOutGps = (vl.check_out_lat && vl.check_out_lng)
          ? { lat: vl.check_out_lat, lng: vl.check_out_lng } : null;
        timeline.push({ time: vl.check_out_time, type: 'check_out', label: 'Checked Out',
          detail: vl.early_departure_reason ? `Early departure: ${vl.early_departure_reason}` : null,
          moods: departureMoods, gps: checkOutGps });
      }
    }

    // No-show flag
    if (session.caregiver_no_show && session.caregiver_no_show_at) {
      timeline.push({ time: session.caregiver_no_show_at, type: 'no_show', label: 'No-Show Flagged',
        detail: 'Caregiver did not check in within 30 minutes' });
    }

    // Cancellation
    if (session.cancelled_at) {
      timeline.push({ time: session.cancelled_at, type: 'cancelled', label: 'Session Cancelled',
        detail: `By ${session.cancelled_by || 'unknown'}${session.cancel_reason ? ': ' + session.cancel_reason : ''}` });
    }

    // Completion
    if (session.completed_at) {
      timeline.push({ time: session.completed_at, type: 'completed', label: 'Session Completed' });
    }

    // Payments
    for (const p of sessionPayments) {
      timeline.push({ time: p.created_at, type: 'payment', label: `Payment ${p.status}`,
        detail: `$${(p.amount / 100).toFixed(2)} total — $${(p.caregiver_payout / 100).toFixed(2)} to caregiver, $${(p.platform_fee / 100).toFixed(2)} platform fee`,
        paymentId: p.id, stripeIntent: p.stripe_payment_intent, autoCharged: !!p.auto_charged,
        tipCents: p.tip_cents || 0 });
    }

    // Payment authorization/capture from session fields
    if (session.payment_authorized_at) {
      timeline.push({ time: session.payment_authorized_at, type: 'payment_auth', label: 'Payment Authorized',
        detail: `$${((session.authorized_amount || 0) / 100).toFixed(2)} authorized` });
    }
    if (session.payment_captured_at) {
      timeline.push({ time: session.payment_captured_at, type: 'payment_capture', label: 'Payment Captured',
        detail: `Stripe PI: ${session.stripe_payment_intent_id || 'N/A'}` });
    }

    // Admin actions
    for (const a of auditLog) {
      let details = {};
      try { details = JSON.parse(a.details || '{}'); } catch {} // expected: tolerated parse fallback
      timeline.push({ time: a.created_at, type: 'admin_action', label: `Admin: ${a.action.replace(/_/g, ' ')}`,
        detail: `by ${a.admin_first || ''} ${a.admin_last || ''}`.trim() + (a.admin_email ? ` (${a.admin_email})` : ''),
        adminDetails: details });
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => new Date(a.time) - new Date(b.time));

    res.json({
      session: {
        id: session.id,
        status: session.status,
        service_type: session.service_type,
        scheduled_date: session.scheduled_date,
        scheduled_time: session.scheduled_time,
        duration_hours: session.duration_hours,
        agreed_rate: session.agreed_rate,
        estimated_cost: session.estimated_cost,
        actual_cost: session.actual_cost,
        special_instructions: session.special_instructions,
        private_only: session.private_only,
        payment_status: session.payment_status,
        late_check_in: session.late_check_in,
        late_minutes: session.late_minutes,
        review_required: session.review_required,
        created_at: session.created_at,
      },
      recipient: {
        name: `${session.recipient_first || ''} ${session.recipient_last || ''}`.trim(),
        age: session.recipient_age,
        location: [session.location_city, session.location_state].filter(Boolean).join(', '),
      },
      family: {
        name: `${session.family_first || ''} ${session.family_last || ''}`.trim(),
        email: session.family_email,
      },
      caregiver: session.caregiver_id ? {
        name: `${session.caregiver_first || ''} ${session.caregiver_last || ''}`.trim(),
        email: session.caregiver_email,
        rate: session.caregiver_rate,
      } : null,
      visitLog: visitLog.map(vl => ({
        check_in_time: vl.check_in_time,
        check_out_time: vl.check_out_time,
        arrival_mood: vl.arrival_mood,
        departure_mood: vl.departure_mood,
        condition_tags: vl.condition_tags,
        care_feedback: vl.care_feedback,
        service_feedback: vl.service_feedback,
        check_in_lat: vl.check_in_lat || vl.check_in_latitude,
        check_in_lng: vl.check_in_lng || vl.check_in_longitude,
        check_in_distance_ft: vl.check_in_distance_ft,
        check_out_lat: vl.check_out_lat,
        check_out_lng: vl.check_out_lng,
        briefing_acknowledged_at: vl.briefing_acknowledged_at,
        early_departure_reason: vl.early_departure_reason,
        ai_summary: vl.ai_summary,
      })),
      payments: sessionPayments,
      timeline,
    });
  } catch (err) {
    console.error("Session detail error:", err);
    res.status(500).json({ error: "Failed to load session details" });
  }
});

// ─── Backfill care notes from visit_logs care_feedback ───
// One-time use: creates recipient_notes for completed sessions that had
// care_feedback but no corresponding visit_summary note.
router.post("/backfill-care-notes", authenticate, requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const since = req.body.since || '2026-02-26';

    // Find completed sessions with care_feedback in visit_logs
    // that don't already have a visit_summary note
    const rows = await db.prepare(`
      SELECT cs.id AS session_id, cs.care_recipient_id, cp.user_id AS caregiver_user_id,
             vl.care_feedback, vl.check_out_time
      FROM care_sessions cs
      JOIN visit_logs vl ON vl.session_id = cs.id
      JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.status = 'completed'
        AND cs.care_recipient_id IS NOT NULL
        AND vl.care_feedback IS NOT NULL
        AND TRIM(vl.care_feedback) != ''
        AND vl.check_out_time >= ?
        AND NOT EXISTS (
          SELECT 1 FROM recipient_notes rn
          WHERE rn.care_recipient_id = cs.care_recipient_id
            AND rn.author_id = cp.user_id
            AND rn.note_type = 'visit_summary'
            AND rn.created_at >= ?
            AND rn.content = TRIM(vl.care_feedback)
        )
    `).all(since, since);

    let created = 0;
    for (const row of rows) {
      await db.prepare(`
        INSERT INTO recipient_notes (id, care_recipient_id, author_id, content, note_type, created_at)
        VALUES (?, ?, ?, ?, 'visit_summary', ?)
      `).run(uuid(), row.care_recipient_id, row.caregiver_user_id, row.care_feedback.trim(), row.check_out_time);
      created++;
    }

    res.json({ success: true, found: rows.length, created, since });
  } catch (err) {
    console.error("Backfill care notes error:", err);
    res.status(500).json({ error: "Failed to backfill care notes" });
  }
});
};
