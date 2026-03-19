const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { writeAuditLog } = require("../middleware/auditLog");

const router = express.Router();

// ─── Checkr API helpers ───
// Use staging URL when CHECKR_STAGING=true (set in Railway env for testing)
const CHECKR_API_BASE = process.env.CHECKR_STAGING === "true"
  ? "https://api.checkr-staging.com/v1"
  : "https://api.checkr.com/v1";

function getCheckrKey() {
  const key = process.env.CHECKR_API_KEY;
  if (!key) throw new Error("CHECKR_API_KEY not configured");
  return key;
}

async function checkrRequest(method, path, body = null) {
  const key = getCheckrKey();
  const opts = {
    method,
    headers: {
      "Authorization": "Basic " + Buffer.from(key + ":").toString("base64"),
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${CHECKR_API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    console.error(`[checkr] ${method} ${path} failed:`, data);
    throw new Error(data.error || data.message || `Checkr API error ${res.status}`);
  }
  return data;
}

// ─── POST /api/checkr/session-token ───
// Generates a Checkr Embed session token for the WebSDK
// The frontend calls this via sessionTokenPath prop on the NewInvitation embed
router.post("/session-token", authenticate, requireRole("caregiver"), async (req, res) => {
  try {
    getCheckrKey();
  } catch {
    return res.status(503).json({ error: "Background check service is not configured" });
  }

  try {
    const db = await getDb();
    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    // Use the configured package or default
    const packageSlug = process.env.CHECKR_PACKAGE || "essential_criminal";

    // Request a session token from Checkr — this is what the Embed uses
    const tokenData = await checkrRequest("POST", "/embed_sessions", {
      package: packageSlug,
    });

    console.log(`[checkr] Session token created for embed, user: ${req.user.id}`);

    // Return the token — the WebSDK uses this to render the invitation form
    res.json({
      sessionToken: tokenData.token || tokenData.session_token,
      expiresAt: tokenData.expires_at,
    });
  } catch (err) {
    console.error("[checkr] Session token error:", err);
    res.status(500).json({ error: "Failed to create background check session" });
  }
});

// ─── GET /api/checkr/config ───
// Returns frontend configuration for Checkr Embeds (no secrets exposed)
router.get("/config", authenticate, async (req, res) => {
  const isStaging = process.env.CHECKR_STAGING === "true";
  res.json({
    configured: !!process.env.CHECKR_API_KEY,
    staging: isStaging,
    embedUrl: isStaging
      ? "https://embed.checkr-staging.com"
      : "https://embed.checkr.com",
  });
});

// ─── POST /api/checkr/initiate ───
// Called after background check payment succeeds.
// Creates a Checkr candidate and sends them an invitation to complete the check.
// Caregiver must have: legal name, DOB, SSN last 4, address, and consent.
router.post("/initiate", authenticate, requireRole("caregiver"), async (req, res) => {
  const db = await getDb();

  try {
    // Verify Checkr is configured
    getCheckrKey();
  } catch {
    return res.status(503).json({ error: "Background check service is not configured yet." });
  }

  try {
    const profile = await db.prepare(
      "SELECT * FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.user.id);

    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    // Verify payment was made
    if (!profile.background_check_paid) {
      return res.status(400).json({ error: "Background check payment required first" });
    }

    // Verify consent
    if (!profile.background_check_consent) {
      return res.status(400).json({ error: "Background check consent required" });
    }

    // Check if already initiated
    if (profile.checkr_candidate_id && profile.checkr_invitation_id) {
      return res.json({
        status: "already_initiated",
        checkrStatus: profile.checkr_status,
        message: "Background check has already been initiated."
      });
    }

    // Verify required fields
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const missing = [];
    if (!profile.legal_first_name) missing.push("legal first name");
    if (!profile.legal_last_name) missing.push("legal last name");
    if (!profile.date_of_birth) missing.push("date of birth");
    if (!profile.ssn_last4) missing.push("SSN last 4");
    if (!user.email) missing.push("email");
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required info: ${missing.join(", ")}`,
        missing
      });
    }

    // Step 1: Create candidate in Checkr
    console.log(`[checkr] Creating candidate for ${profile.legal_first_name} ${profile.legal_last_name}`);
    const candidate = await checkrRequest("POST", "/candidates", {
      first_name: profile.legal_first_name,
      last_name: profile.legal_last_name,
      email: user.email,
      dob: profile.date_of_birth,
      ssn: profile.ssn_last4,
      zipcode: profile.zip || undefined,
      driver_license_number: profile.dl_number || undefined,
      driver_license_state: profile.dl_state || undefined,
    });

    console.log(`[checkr] Candidate created: ${candidate.id}`);

    // Save candidate ID immediately
    await db.prepare(
      "UPDATE caregiver_profiles SET checkr_candidate_id = ?, checkr_status = 'initiated', updated_at = NOW() WHERE user_id = ?"
    ).run(candidate.id, req.user.id);

    // Step 2: Create invitation — Checkr emails the candidate a link
    // to provide full SSN, consent, and complete the background check
    console.log(`[checkr] Creating invitation for candidate ${candidate.id}`);

    // Use the configured package or default to basic+mvr
    const packageSlug = process.env.CHECKR_PACKAGE || "essential_criminal";

    const invitation = await checkrRequest("POST", "/invitations", {
      candidate_id: candidate.id,
      package: packageSlug,
      work_locations: [{ city: profile.work_city || "Radford", state: profile.work_state || "VA", country: "US" }],
    });

    console.log(`[checkr] Invitation created: ${invitation.id}, status: ${invitation.status}`);

    // Save invitation ID
    await db.prepare(
      "UPDATE caregiver_profiles SET checkr_invitation_id = ?, checkr_status = 'invitation_sent', updated_at = NOW() WHERE user_id = ?"
    ).run(invitation.id, req.user.id);

    // Audit log
    writeAuditLog({
      userId: req.user.id,
      userEmail: user.email,
      userRole: "caregiver",
      action: "checkr_initiated",
      endpoint: "/api/checkr/initiate",
      method: "POST",
      details: { candidateId: candidate.id, invitationId: invitation.id, package: packageSlug },
      severity: "info",
    });

    res.json({
      status: "invitation_sent",
      message: "Background check initiated. You'll receive an email from Checkr to complete the process.",
      candidateId: candidate.id,
      invitationId: invitation.id,
      invitationUrl: invitation.invitation_url || null,
    });

  } catch (err) {
    console.error("[checkr] Initiation error:", err);
    res.status(500).json({ error: "Failed to initiate background check. Please try again or contact support." });
  }
});

// ─── GET /api/checkr/status ───
// Check current Checkr status for the logged-in caregiver
router.get("/status", authenticate, requireRole("caregiver"), async (req, res) => {
  const db = await getDb();

  try {
    const profile = await db.prepare(
      "SELECT checkr_status, checkr_candidate_id, checkr_invitation_id, checkr_report_id, is_background_checked, background_check_paid FROM caregiver_profiles WHERE user_id = ?"
    ).get(req.user.id);

    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    const response = {
      checkrConfigured: !!process.env.CHECKR_API_KEY,
      paid: !!profile.background_check_paid,
      status: profile.checkr_status || "pending",
      cleared: !!profile.is_background_checked,
      candidateId: profile.checkr_candidate_id || null,
      invitationId: profile.checkr_invitation_id || null,
      reportId: profile.checkr_report_id || null,
    };

    // If we have a candidate but status is stale, check Checkr for updates
    if (profile.checkr_candidate_id && !profile.is_background_checked && process.env.CHECKR_API_KEY) {
      try {
        const candidate = await checkrRequest("GET", `/candidates/${profile.checkr_candidate_id}`);
        if (candidate.report_ids && candidate.report_ids.length > 0) {
          const reportId = candidate.report_ids[0];
          const report = await checkrRequest("GET", `/reports/${reportId}`);

          // Update our records with latest status
          let newStatus = profile.checkr_status;
          let cleared = false;
          if (report.status === "clear") {
            newStatus = "clear";
            cleared = true;
          } else if (report.status === "consider") {
            newStatus = "consider"; // has flags but not disqualified
          } else if (report.status === "pending") {
            newStatus = "processing";
          }

          await db.prepare(
            "UPDATE caregiver_profiles SET checkr_status = ?, checkr_report_id = ?, is_background_checked = ? WHERE user_id = ?"
          ).run(newStatus, reportId, cleared ? 1 : 0, req.user.id);

          response.status = newStatus;
          response.cleared = cleared;
          response.reportId = reportId;
        }
      } catch (err) {
        console.error("[checkr] Status check error:", err.message);
        // Don't fail the request — return cached status
      }
    }

    res.json(response);
  } catch (err) {
    console.error("[checkr] Status error:", err);
    res.status(500).json({ error: "Failed to check background check status" });
  }
});

// ─── POST /api/checkr/webhook ───
// Receives webhook events from Checkr when report/invitation status changes
// This endpoint must be publicly accessible (no auth)
// Configure in Checkr Dashboard → Developer Settings → New Webhook → URL: https://yourinplace.com/api/checkr/webhook
// Body is parsed here (skipped in global middleware) so we can verify the signature against raw bytes.
router.post("/webhook", express.raw({ type: "application/json", limit: "100kb" }), async (req, res) => {
  const db = await getDb();
  const rawBody = req.body; // Buffer (raw bytes)

  // Verify webhook signature if secret is configured
  const webhookSecret = process.env.CHECKR_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = req.headers["x-checkr-signature"];
    if (!signature) {
      console.warn("[checkr-webhook] Missing signature header");
      return res.status(401).json({ error: "Missing signature" });
    }
    // Checkr uses HMAC-SHA256 on the raw body
    const crypto = require("crypto");
    const expectedSig = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    if (signature !== expectedSig && signature !== `sha256=${expectedSig}`) {
      console.warn("[checkr-webhook] Invalid signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  // Parse the raw body into JSON
  let body;
  try {
    body = JSON.parse(rawBody.toString());
  } catch (err) {
    console.error("[checkr-webhook] Invalid JSON body:", err.message);
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { type, data } = body;
  console.log(`[checkr-webhook] Event: ${type}`, JSON.stringify(data?.object || {}).substring(0, 200));

  // Log every webhook event to the database for debugging/certification
  try {
    const { v4: uuid } = require("uuid");
    await db.prepare(`
      INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata, created_at)
      VALUES (?, (SELECT id FROM users WHERE is_admin = 1 LIMIT 1), ?, ?, ?, ?, NOW())
    `).run(
      uuid(),
      "checkr_webhook",
      `Checkr: ${type}`,
      `Candidate: ${data?.object?.candidate_id || data?.object?.id || 'unknown'}, Status: ${data?.object?.status || 'n/a'}`,
      JSON.stringify({ type, object: data?.object })
    );
  } catch (logErr) {
    console.warn("[checkr-webhook] Failed to log event:", logErr.message);
  }

  try {
    switch (type) {
      // ─── Invitation completed — candidate filled out the Checkr form ───
      case "invitation.completed": {
        const { id: invitationId, candidate_id } = data.object;
        console.log(`[checkr-webhook] Invitation completed: ${invitationId}, candidate: ${candidate_id}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'processing', updated_at = NOW() WHERE checkr_invitation_id = ? OR checkr_candidate_id = ?"
        ).run(invitationId, candidate_id);

        writeAuditLog({
          action: "checkr_invitation_completed",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { invitationId, candidateId: candidate_id },
          severity: "info",
        });
        break;
      }

      // ─── Report completed — background check is done ───
      case "report.completed": {
        const report = data.object;
        const { id: reportId, candidate_id, status, result } = report;
        console.log(`[checkr-webhook] Report completed: ${reportId}, candidate: ${candidate_id}, status: ${status}, result: ${result}`);

        // Status can be: "clear", "consider", "suspended", "dispute"
        const cleared = status === "clear";
        const checkrStatus = status === "clear" ? "clear" : status;

        const updated = await db.prepare(
          `UPDATE caregiver_profiles SET
            checkr_status = ?,
            checkr_report_id = ?,
            is_background_checked = ?,
            updated_at = NOW()
          WHERE checkr_candidate_id = ?`
        ).run(checkrStatus, reportId, cleared ? 1 : 0, candidate_id);

        if (updated.changes > 0) {
          console.log(`[checkr-webhook] Caregiver profile updated — cleared: ${cleared}`);

          // Alert admin for non-clear results
          if (!cleared) {
            try {
              const { v4: uuid } = require("uuid");
              const cgProfile = await db.prepare(
                "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_candidate_id = ?"
              ).get(candidate_id);
              if (cgProfile) {
                const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
                const title = `🔍 Background check: ${status.toUpperCase()} — ${cgProfile.first_name} ${cgProfile.last_name}`;
                const msg = `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) background check returned "${status}". Review in Admin → BG Checks.`;
                for (const admin of admins) {
                  await db.prepare(
                    "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
                  ).run(uuid(), admin.id, "checkr_flagged", title, msg, JSON.stringify({ reportId, candidateId: candidate_id, status, userId: cgProfile.user_id }));
                }
                try {
                  const { sendPushToUser } = require("../utils/push");
                  if (sendPushToUser) {
                    for (const admin of admins) { await sendPushToUser(db, admin.id, title, msg.substring(0, 100)); }
                  }
                } catch {}
              }
            } catch (alertErr) {
              console.error("[checkr-webhook] Admin alert error:", alertErr.message);
            }
          }
        } else {
          console.warn(`[checkr-webhook] No caregiver found for candidate ${candidate_id}`);
        }

        writeAuditLog({
          action: cleared ? "checkr_cleared" : "checkr_flagged",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { reportId, candidateId: candidate_id, status, result },
          severity: cleared ? "info" : "warning",
        });
        break;
      }

      // ─── Report updated (e.g., additional screening results came in) ───
      case "report.updated": {
        const report = data.object;
        const { id: reportId, candidate_id, status } = report;
        console.log(`[checkr-webhook] Report updated: ${reportId}, status: ${status}`);

        const cleared = status === "clear";
        await db.prepare(
          `UPDATE caregiver_profiles SET
            checkr_status = ?,
            checkr_report_id = ?,
            is_background_checked = ?,
            updated_at = NOW()
          WHERE checkr_candidate_id = ?`
        ).run(status, reportId, cleared ? 1 : 0, candidate_id);
        break;
      }

      // ─── Invitation expired — candidate didn't complete in time ───
      case "invitation.expired": {
        const { id: invitationId, candidate_id } = data.object;
        console.log(`[checkr-webhook] Invitation expired: ${invitationId}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'invitation_expired', updated_at = NOW() WHERE checkr_invitation_id = ?"
        ).run(invitationId);

        writeAuditLog({
          action: "checkr_invitation_expired",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { invitationId, candidateId: candidate_id },
          severity: "warning",
        });
        break;
      }

      // ─── Candidate engaged with adverse action ───
      case "report.pre_adverse_action": {
        const { id: reportId, candidate_id } = data.object;
        console.log(`[checkr-webhook] Pre-adverse action: ${reportId}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'adverse_action', updated_at = NOW() WHERE checkr_candidate_id = ?"
        ).run(candidate_id);

        writeAuditLog({
          action: "checkr_adverse_action",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { reportId, candidateId: candidate_id },
          severity: "critical",
        });
        break;
      }

      default:
        console.log(`[checkr-webhook] Unhandled event type: ${type}`);
    }

    // Always return 200 so Checkr doesn't retry
    res.json({ received: true });

  } catch (err) {
    console.error("[checkr-webhook] Processing error:", err);
    // Still return 200 — we don't want Checkr retrying on our error
    res.json({ received: true, error: "Processing error logged" });
  }
});

// ─── GET /api/checkr/admin/candidates ───
// Admin view of all Checkr-related caregiver statuses
router.get("/admin/candidates", authenticate, async (req, res) => {
  const db = await getDb();
  if (!req.isAdmin) {
    const adminCheck = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!adminCheck?.is_admin) return res.status(403).json({ error: "Admin only" });
  }

  try {
    const candidates = await db.prepare(`
      SELECT
        cp.user_id, cp.legal_first_name, cp.legal_last_name,
        cp.checkr_status, cp.checkr_candidate_id, cp.checkr_invitation_id, cp.checkr_report_id,
        cp.is_background_checked, cp.background_check_paid, cp.background_check_consent,
        cp.onboarding_complete,
        u.email, u.first_name, u.last_name
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      WHERE cp.background_check_consent = 1 OR cp.checkr_candidate_id IS NOT NULL
      ORDER BY cp.updated_at DESC
    `).all();

    res.json({ candidates });
  } catch (err) {
    console.error("[checkr] Admin candidates error:", err);
    res.status(500).json({ error: "Failed to fetch candidates" });
  }
});

// ─── POST /api/checkr/test-candidate — Admin: test with mock candidate data ───
// For Checkr certification testing only. Creates candidate + invitation with mock data.
router.post("/test-candidate", authenticate, async (req, res) => {
  // Admin only
  const db = await getDb();
  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
  if (!user?.is_admin) return res.status(403).json({ error: "Admin only" });

  try {
    getCheckrKey();
  } catch {
    return res.status(503).json({ error: "CHECKR_API_KEY not configured" });
  }

  const { first_name, last_name, email, ssn, dob, zipcode, driver_license_number, driver_license_state, work_locations, city, state } = req.body;

  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: "first_name, last_name, and email are required" });
  }

  // Build work_locations — Checkr staging requires this
  const locations = work_locations || [{ city: city || "Radford", state: state || "VA", country: "US" }];

  try {
    // Step 1: Create candidate (without work_locations — goes on invitation)
    console.log(`[checkr-test] Creating candidate: ${first_name} ${last_name}`);
    const candidateBody = {
      first_name,
      last_name,
      email,
      ssn: ssn || undefined,
      dob: dob || undefined,
      zipcode: zipcode || undefined,
      driver_license_number: driver_license_number || undefined,
      driver_license_state: driver_license_state || undefined,
    };
    console.log(`[checkr-test] Candidate body:`, JSON.stringify(candidateBody));
    const candidate = await checkrRequest("POST", "/candidates", candidateBody);
    console.log(`[checkr-test] Candidate created: ${candidate.id}`);

    // Step 2: Create invitation WITH work_locations
    const packageSlug = process.env.CHECKR_PACKAGE || "essential_criminal";
    const invitation = await checkrRequest("POST", "/invitations", {
      candidate_id: candidate.id,
      package: packageSlug,
      work_locations: locations,
    });
    console.log(`[checkr-test] Invitation created: ${invitation.id}, url: ${invitation.invitation_url}`);

    // Step 3: Create a test user + caregiver profile linked to this Checkr candidate
    // so webhooks can update the profile when results come back
    const { v4: uuid } = require("uuid");
    const testUserId = uuid();
    const testEmail = `test-${first_name.toLowerCase()}-${last_name.toLowerCase()}@checkr-mock.inplace`;
    try {
      await db.prepare(
        "INSERT INTO users (id, email, first_name, last_name, role, password_hash, is_active, is_demo) VALUES (?, ?, ?, ?, 'caregiver', 'checkr-test-no-login', 1, 0)"
      ).run(testUserId, testEmail, first_name, last_name);

      await db.prepare(`
        INSERT INTO caregiver_profiles (id, user_id, legal_first_name, legal_last_name, date_of_birth,
          checkr_candidate_id, checkr_invitation_id, checkr_status, background_check_consent, background_check_paid)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'invitation_sent', 1, 1)
      `).run(uuid(), testUserId, first_name, last_name, dob || null, candidate.id, invitation.id);

      console.log(`[checkr-test] Created test profile for ${first_name} ${last_name} linked to candidate ${candidate.id}`);
    } catch (profileErr) {
      console.warn(`[checkr-test] Profile creation failed (may already exist):`, profileErr.message);
    }

    res.json({
      success: true,
      candidateId: candidate.id,
      invitationId: invitation.id,
      invitationUrl: invitation.invitation_url,
      testUserId,
      package: packageSlug,
      message: `Check your email at ${email} for the Checkr invitation link. Test profile created — webhooks will update status.`,
    });
  } catch (err) {
    console.error("[checkr-test] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
