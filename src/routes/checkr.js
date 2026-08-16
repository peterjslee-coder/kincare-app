const express = require("express");
const { activeVouchesFor } = require("../utils/vouches");
const { getDb } = require("../models/database");
const { authenticate, requireRole } = require("../middleware/auth");
const { writeAuditLog } = require("../middleware/auditLog");
const { captureException } = require("../utils/sentry");

const router = express.Router();

// ─── Helper: check if background checks are enabled by admin ───
async function bgChecksEnabled() {
  const db = await getDb();
  const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'bg_checks_enabled'").get();
  return row?.value === 'true';
}

// ─── GET /api/checkr/bg-checks-enabled ───
router.get("/bg-checks-enabled", async (req, res) => {
  try {
    const enabled = await bgChecksEnabled();
    res.json({ bgChecksEnabled: enabled });
  } catch (err) {
    res.status(500).json({ error: "Failed to check background check status" });
  }
});

// ─── PUT /api/checkr/bg-checks-enabled ───
// Toggle background checks on/off — admin kill switch
router.put("/bg-checks-enabled", authenticate, async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: "enabled must be true or false" });
  }
  try {
    const db = await getDb();
    const adminCheck = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!adminCheck?.is_admin) return res.status(403).json({ error: "Admin only" });
    await db.prepare(
      "INSERT INTO platform_settings (key, value) VALUES ('bg_checks_enabled', ?) ON CONFLICT (key) DO UPDATE SET value = ?, updated_at = NOW()"
    ).run(String(enabled), String(enabled));
    console.log(`🔍 Background checks ${enabled ? 'ENABLED' : 'DISABLED'} by admin`);
    res.json({ bgChecksEnabled: enabled });
  } catch (err) {
    res.status(500).json({ error: "Failed to update background check status" });
  }
});

// ─── Checkr API helpers ───
// Use staging URL when CHECKR_STAGING=true (set in Railway env for testing)
const CHECKR_API_BASE = process.env.CHECKR_STAGING === "true"
  ? "https://api.checkr-staging.com/v1"
  : "https://api.checkr.com/v1";

function getCheckrKey() {
  const key = (process.env.CHECKR_API_KEY || "").trim();
  if (!key) throw new Error("CHECKR_API_KEY not configured");
  return key;
}

async function checkrRequest(method, path, body = null) {
  const key = getCheckrKey();
  const opts = {
    method,
    // v1.105.51 — every Checkr call was untimed, inside a request handler: a slow vendor
    // held the socket and a worker slot indefinitely and the caregiver saw a spinner.
    signal: AbortSignal.timeout(8000),
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
  // Kill switch check
  if (!(await bgChecksEnabled())) {
    return res.status(503).json({ error: "Background checks are currently disabled by the administrator." });
  }
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
// Caregiver must have: legal name, DOB, address, and consent. SSN is collected by Checkr's invitation flow.
router.post("/initiate", authenticate, requireRole("caregiver"), async (req, res) => {
  const db = await getDb();

  // Kill switch check
  if (!(await bgChecksEnabled())) {
    return res.status(503).json({ error: "Background checks are currently disabled by the administrator." });
  }

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

    // Verify payment was made (staging can bypass)
    const isStaging = process.env.CHECKR_STAGING === "true";
    if (!profile.background_check_paid && !isStaging) {
      return res.status(400).json({ error: "Background check payment required first" });
    }
    if (!profile.background_check_paid && isStaging) {
      // In staging, auto-mark as paid so the flow continues
      await db.prepare("UPDATE caregiver_profiles SET background_check_paid = 1, updated_at = NOW() WHERE user_id = ?").run(req.user.id);
      console.log(`[checkr] Staging: auto-marked background_check_paid for user ${req.user.id}`);
    }

    // Verify consent (staging can bypass)
    if (!profile.background_check_consent && !isStaging) {
      return res.status(400).json({ error: "Background check consent required" });
    }
    if (!profile.background_check_consent && isStaging) {
      await db.prepare("UPDATE caregiver_profiles SET background_check_consent = 1, background_check_consent_at = NOW(), updated_at = NOW() WHERE user_id = ?").run(req.user.id);
      console.log(`[checkr] Staging: auto-set background_check_consent for user ${req.user.id}`);
    }

    // Check if already initiated — allow re-initiation for expired, canceled, rejected, or did_not_pass
    const reInitiatableStatuses = ['invitation_expired', 'invitation_canceled', 'rejected', 'did_not_pass'];
    if (profile.checkr_candidate_id && profile.checkr_invitation_id) {
      if (!reInitiatableStatuses.includes(profile.checkr_status)) {
        return res.json({
          status: "already_initiated",
          checkrStatus: profile.checkr_status,
          message: "Background check has already been initiated."
        });
      }
      // Re-initiating: clear old invitation so a new one can be created
      console.log(`[checkr] Re-initiating BG check for user ${req.user.id} (previous status: ${profile.checkr_status})`);
    }

    // Verify required fields
    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const missing = [];
    if (!profile.legal_first_name) missing.push("legal first name");
    if (!profile.legal_last_name) missing.push("legal last name");
    if (!profile.date_of_birth) missing.push("date of birth");
    if (!user.email) missing.push("email");
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required info: ${missing.join(", ")}`,
        missing
      });
    }

    // Determine email for Checkr candidate
    // In staging: use override email from request body, or strip plus-addressing from account email
    let checkrEmail = user.email;
    if (isStaging) {
      if (req.body.checkrEmail) {
        checkrEmail = req.body.checkrEmail;
      } else {
        // Strip plus-addressing: peter+nick@yourinplace.com → peter@yourinplace.com
        checkrEmail = user.email.replace(/\+[^@]*@/, '@');
      }
      console.log(`[checkr] Staging: using email ${checkrEmail} for Checkr (account email: ${user.email})`);
    }

    // Step 1: Create or reuse candidate in Checkr
    // Certification requires: first_name, middle_name OR no_middle_name, last_name, zip, phone, email, custom_id
    let candidate;
    if (profile.checkr_candidate_id) {
      // Re-initiation: reuse existing candidate
      console.log(`[checkr] Reusing existing candidate ${profile.checkr_candidate_id} for user ${req.user.id}`);
      candidate = { id: profile.checkr_candidate_id };
    } else {
      console.log(`[checkr] Creating candidate for ${profile.legal_first_name} ${profile.legal_last_name}`);
      const candidatePayload = {
        first_name: profile.legal_first_name,
        last_name: profile.legal_last_name,
        no_middle_name: !profile.legal_middle_name,
        email: checkrEmail,
        phone: user.phone || undefined,
        dob: profile.date_of_birth,
        // SSN not sent here — candidate provides full SSN via Checkr's invitation flow
        zipcode: profile.zip || undefined,
        work_locations: [{ country: "US", state: profile.location_state || "VA", city: profile.location_city || "Radford" }],
        custom_id: req.user.id,
        driver_license_number: profile.dl_number || undefined,
        driver_license_state: profile.dl_state || undefined,
      };
      if (profile.legal_middle_name) candidatePayload.middle_name = profile.legal_middle_name;
      candidate = await checkrRequest("POST", "/candidates", candidatePayload);
      console.log(`[checkr] Candidate created: ${candidate.id}`);
    }

    // Save candidate ID immediately (or reset status for re-initiation)
    await db.prepare(
      "UPDATE caregiver_profiles SET checkr_candidate_id = ?, checkr_status = 'initiated', checkr_eta = NULL, updated_at = NOW() WHERE user_id = ?"
    ).run(candidate.id, req.user.id);

    // Step 2: Create invitation — Checkr emails the candidate a link
    // to provide full SSN, consent, and complete the background check
    console.log(`[checkr] Creating invitation for candidate ${candidate.id}`);

    // Certification: retrieve account hierarchy nodes and packages dynamically
    let packageSlug = process.env.CHECKR_PACKAGE || "inplace_starter";
    let nodeId = null;
    try {
      const nodesResp = await checkrRequest("GET", "/nodes?include=packages");
      const nodes = nodesResp?.data || [];
      if (nodes.length > 0) {
        // Use the first node (InPlace only has one business line)
        nodeId = nodes[0].id;
        // If the node has assigned packages, use the first one
        const nodePackages = nodes[0].packages || [];
        if (nodePackages.length > 0) {
          packageSlug = nodePackages[0].slug || nodePackages[0].name || packageSlug;
        }
      }
    } catch (nodesErr) {
      // Account hierarchy may not be enabled — fall back to GET /packages
      console.warn("[checkr] GET /nodes failed, falling back to GET /packages:", nodesErr.message);
    }

    // Also call GET /packages as fallback / for accounts without hierarchy
    if (!nodeId) {
      try {
        const pkgsResp = await checkrRequest("GET", "/packages");
        const packages = pkgsResp?.data || [];
        if (packages.length > 0) {
          // Prefer configured package if it's in the list, otherwise use first available
          const match = packages.find(p => p.slug === packageSlug);
          if (!match && packages[0]?.slug) packageSlug = packages[0].slug;
        }
      } catch (pkgErr) {
        console.warn("[checkr] GET /packages failed, using default:", pkgErr.message);
      }
    }

    const invitationPayload = {
      candidate_id: candidate.id,
      package: packageSlug,
      work_locations: [{ city: profile.location_city || "Radford", state: profile.location_state || "VA", country: "US" }],
    };
    if (nodeId) invitationPayload.node = nodeId;

    const invitation = await checkrRequest("POST", "/invitations", invitationPayload);

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
      staging: process.env.CHECKR_STAGING === "true",
      paid: !!profile.background_check_paid,
      status: profile.is_background_checked ? "complete" : (profile.checkr_status || "pending"),
      cleared: !!profile.is_background_checked,
      vouches: (await activeVouchesFor(db, req.user.id)).map((v) => ({ familyName: v.family_name, since: v.created_at })),
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
          // Certification: use report.result (clear/consider) for findings, report.status for lifecycle (complete/pending)
          let newStatus = profile.checkr_status;
          let cleared = false;
          const actualResult = report.result || report.status;
          if (actualResult === "clear") {
            newStatus = "clear";
            cleared = true;
          } else if (actualResult === "consider") {
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
        const { id: invitationId, candidate_id, estimated_completion_time } = data.object;
        console.log(`[checkr-webhook] Invitation completed: ${invitationId}, candidate: ${candidate_id}, eta: ${estimated_completion_time || 'none'}`);

        // Certification: store ETA from invitation if available
        if (estimated_completion_time) {
          await db.prepare(
            "UPDATE caregiver_profiles SET checkr_status = 'processing', checkr_eta = ?, updated_at = NOW() WHERE checkr_invitation_id = ? OR checkr_candidate_id = ?"
          ).run(estimated_completion_time, invitationId, candidate_id);
        } else {
          await db.prepare(
            "UPDATE caregiver_profiles SET checkr_status = 'processing', updated_at = NOW() WHERE checkr_invitation_id = ? OR checkr_candidate_id = ?"
          ).run(invitationId, candidate_id);
        }

        // Notify admins that a candidate submitted their background check form
        try {
          const { v4: uuid } = require("uuid");
          const cgProfile = await db.prepare(
            "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_invitation_id = ? OR cp.checkr_candidate_id = ?"
          ).get(invitationId, candidate_id);
          const candidateName = cgProfile ? `${cgProfile.first_name} ${cgProfile.last_name}` : `Candidate ${(candidate_id || '').substring(0, 12)}`;
          const title = `📋 Background check submitted — ${candidateName}`;
          const msg = cgProfile
            ? `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) completed the Checkr invitation form. Report is now processing.`
            : `Checkr candidate ${candidate_id} completed the invitation form. Report is now processing.`;
          const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
          for (const admin of admins) {
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(uuid(), admin.id, "checkr_submitted", title, msg, JSON.stringify({ invitationId, candidateId: candidate_id, userId: cgProfile?.user_id }));
          }
          // Push notification to admins
          try {
            const { sendPushToUser } = require("../utils/push");
            if (sendPushToUser) {
              for (const admin of admins) { await sendPushToUser(db, admin.id, title, msg.substring(0, 100)); }
            }
          } catch (e) { captureException(e, { where: "checkr: admin alert push (report complete)" }); }
        } catch (alertErr) {
          console.error("[checkr-webhook] Invitation completed alert error:", alertErr.message);
        }

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

        // Checkr report.completed: status = "complete" (lifecycle), result = "clear" | "consider" (finding)
        const actualResult = result || status;
        const cleared = actualResult === "clear";
        const checkrStatus = cleared ? "clear" : (actualResult === "consider" ? "consider" : actualResult);

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

          // Alert admins for ALL report completions (clear and non-clear)
          try {
            const { v4: uuid } = require("uuid");
            const cgProfile = await db.prepare(
              "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_candidate_id = ?"
            ).get(candidate_id);
            if (cgProfile) {
              const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
              const icon = cleared ? '✅' : '🔍';
              const eventType = cleared ? "checkr_cleared" : "checkr_flagged";
              const title = `${icon} Background check: ${actualResult.toUpperCase()} — ${cgProfile.first_name} ${cgProfile.last_name}`;
              const msg = cleared
                ? `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) passed their background check. They're cleared for sessions.`
                : `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) background check returned "${actualResult}". Review in Admin → BG Checks.`;
              for (const admin of admins) {
                await db.prepare(
                  "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
                ).run(uuid(), admin.id, eventType, title, msg, JSON.stringify({ reportId, candidateId: candidate_id, status: actualResult, userId: cgProfile.user_id }));
              }
              try {
                const { sendPushToUser } = require("../utils/push");
                if (sendPushToUser) {
                  for (const admin of admins) { await sendPushToUser(db, admin.id, title, msg.substring(0, 100)); }
                }
              } catch (e) { captureException(e, { where: "checkr: admin alert push (invitation)" }); }
            }
          } catch (alertErr) {
            console.error("[checkr-webhook] Admin alert error:", alertErr.message);
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
        const { id: reportId, candidate_id, status, result, estimated_completion_time } = report;
        const updatedResult = result || status;
        console.log(`[checkr-webhook] Report updated: ${reportId}, status: ${status}, result: ${result}, eta: ${estimated_completion_time || 'none'}`);

        const cleared = updatedResult === "clear";
        const updatedStatus = cleared ? "clear" : (updatedResult === "consider" ? "consider" : updatedResult);

        // Certification: store ETA if provided by Checkr
        if (estimated_completion_time) {
          await db.prepare(
            `UPDATE caregiver_profiles SET
              checkr_status = ?,
              checkr_report_id = ?,
              is_background_checked = ?,
              checkr_eta = ?,
              updated_at = NOW()
            WHERE checkr_candidate_id = ?`
          ).run(updatedStatus, reportId, cleared ? 1 : 0, estimated_completion_time, candidate_id);
        } else {
          await db.prepare(
            `UPDATE caregiver_profiles SET
              checkr_status = ?,
              checkr_report_id = ?,
              is_background_checked = ?,
              updated_at = NOW()
            WHERE checkr_candidate_id = ?`
          ).run(updatedStatus, reportId, cleared ? 1 : 0, candidate_id);
        }
        break;
      }

      // ─── Invitation expired — candidate didn't complete in time ───
      case "invitation.expired": {
        const { id: invitationId, candidate_id } = data.object;
        console.log(`[checkr-webhook] Invitation expired: ${invitationId}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'invitation_expired', updated_at = NOW() WHERE checkr_invitation_id = ?"
        ).run(invitationId);

        // Notify admins about expired invitation
        try {
          const { v4: uuid } = require("uuid");
          const cgProfile = await db.prepare(
            "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_invitation_id = ?"
          ).get(invitationId);
          const candidateName = cgProfile ? `${cgProfile.first_name} ${cgProfile.last_name}` : `Candidate ${(candidate_id || '').substring(0, 12)}`;
          const title = `⏰ Background check expired — ${candidateName}`;
          const msg = cgProfile
            ? `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) didn't complete the Checkr invitation in time. You may need to resend.`
            : `Checkr invitation ${invitationId} expired. Candidate didn't complete in time.`;
          const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
          for (const admin of admins) {
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(uuid(), admin.id, "checkr_expired", title, msg, JSON.stringify({ invitationId, candidateId: candidate_id, userId: cgProfile?.user_id }));
          }
          try {
            const { sendPushToUser } = require("../utils/push");
            if (sendPushToUser) {
              for (const admin of admins) { await sendPushToUser(db, admin.id, title, msg.substring(0, 100)); }
            }
          } catch (e) { captureException(e, { where: "checkr: admin alert push (report created)" }); }
        } catch (alertErr) {
          console.error("[checkr-webhook] Invitation expired alert error:", alertErr.message);
        }

        writeAuditLog({
          action: "checkr_invitation_expired",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { invitationId, candidateId: candidate_id },
          severity: "warning",
        });
        break;
      }

      // ─── Report suspended (e.g., SSN mismatch, requires candidate action) ───
      case "report.suspended": {
        const report = data.object;
        const { id: reportId, candidate_id, status } = report;
        console.log(`[checkr-webhook] Report suspended: ${reportId}, candidate: ${candidate_id}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'suspended', checkr_report_id = ?, updated_at = NOW() WHERE checkr_candidate_id = ?"
        ).run(reportId, candidate_id);

        // Notify admins — this is an action item, candidate needs to fix something
        try {
          const { v4: uuid } = require("uuid");
          const cgProfile = await db.prepare(
            "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_candidate_id = ?"
          ).get(candidate_id);
          const candidateName = cgProfile ? `${cgProfile.first_name} ${cgProfile.last_name}` : `Candidate ${(candidate_id || '').substring(0, 12)}`;
          const title = `⚠️ Background check suspended — ${candidateName}`;
          const msg = cgProfile
            ? `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) background check is ON HOLD. Checkr found an issue (likely SSN mismatch). The candidate has been emailed to correct it.`
            : `Checkr report ${reportId} is suspended. Candidate needs to resolve an exception (likely SSN mismatch).`;
          const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
          for (const admin of admins) {
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(uuid(), admin.id, "checkr_suspended", title, msg, JSON.stringify({ reportId, candidateId: candidate_id, userId: cgProfile?.user_id }));
          }
          try {
            const { sendPushToUser } = require("../utils/push");
            if (sendPushToUser) {
              for (const admin of admins) { await sendPushToUser(db, admin.id, title, msg.substring(0, 100)); }
            }
          } catch (e) { captureException(e, { where: "checkr: admin alert push (report pending)" }); }
        } catch (alertErr) {
          console.error("[checkr-webhook] Report suspended alert error:", alertErr.message);
        }

        writeAuditLog({
          action: "checkr_suspended",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { reportId, candidateId: candidate_id },
          severity: "warning",
        });
        break;
      }

      // ─── Report resumed (e.g., candidate corrected SSN) ───
      case "report.resumed": {
        const report = data.object;
        const { id: reportId, candidate_id } = report;
        console.log(`[checkr-webhook] Report resumed: ${reportId}, candidate: ${candidate_id}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'processing', updated_at = NOW() WHERE checkr_candidate_id = ?"
        ).run(candidate_id);

        // Notify admins — good news, candidate fixed the issue
        try {
          const { v4: uuid } = require("uuid");
          const cgProfile = await db.prepare(
            "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_candidate_id = ?"
          ).get(candidate_id);
          const candidateName = cgProfile ? `${cgProfile.first_name} ${cgProfile.last_name}` : `Candidate ${(candidate_id || '').substring(0, 12)}`;
          const title = `🔄 Background check resumed — ${candidateName}`;
          const msg = cgProfile
            ? `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) resolved their exception. Background check is processing again.`
            : `Checkr report ${reportId} has resumed processing after the candidate resolved the exception.`;
          const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
          for (const admin of admins) {
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(uuid(), admin.id, "checkr_resumed", title, msg, JSON.stringify({ reportId, candidateId: candidate_id, userId: cgProfile?.user_id }));
          }
          try {
            const { sendPushToUser } = require("../utils/push");
            if (sendPushToUser) {
              for (const admin of admins) { await sendPushToUser(db, admin.id, title, msg.substring(0, 100)); }
            }
          } catch (e) { captureException(e, { where: "checkr: admin alert push (report engaged)" }); }
        } catch (alertErr) {
          console.error("[checkr-webhook] Report resumed alert error:", alertErr.message);
        }

        writeAuditLog({
          action: "checkr_resumed",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { reportId, candidateId: candidate_id },
          severity: "info",
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

      // ─── Report disputed by candidate ───
      case "report.disputed": {
        const report = data.object;
        const { id: reportId, candidate_id } = report;
        console.log(`[checkr-webhook] Report disputed: ${reportId}, candidate: ${candidate_id}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'disputed', updated_at = NOW() WHERE checkr_candidate_id = ?"
        ).run(candidate_id);

        // Notify admins
        try {
          const { v4: uuid } = require("uuid");
          const cgProfile = await db.prepare(
            "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_candidate_id = ?"
          ).get(candidate_id);
          const candidateName = cgProfile ? `${cgProfile.first_name} ${cgProfile.last_name}` : `Candidate ${(candidate_id || '').substring(0, 12)}`;
          const title = `⚖️ Background check disputed — ${candidateName}`;
          const msg = cgProfile
            ? `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) is disputing their background check results. Check Checkr dashboard for details.`
            : `Checkr report ${reportId} has been disputed by the candidate.`;
          const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
          for (const admin of admins) {
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(uuid(), admin.id, "checkr_disputed", title, msg, JSON.stringify({ reportId, candidateId: candidate_id, userId: cgProfile?.user_id }));
          }
          try {
            const { sendPushToUser } = require("../utils/push");
            if (sendPushToUser) {
              for (const admin of admins) { await sendPushToUser(db, admin.id, title, msg.substring(0, 100)); }
            }
          } catch (e) { captureException(e, { where: "checkr: admin alert push (adverse action)" }); }
        } catch (alertErr) {
          console.error("[checkr-webhook] Report disputed alert error:", alertErr.message);
        }

        writeAuditLog({
          action: "checkr_disputed",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { reportId, candidateId: candidate_id },
          severity: "warning",
        });
        break;
      }

      // ─── Invitation created — Checkr sent the invitation ───
      case "invitation.created": {
        const { id: invitationId, candidate_id } = data.object;
        console.log(`[checkr-webhook] Invitation created: ${invitationId}, candidate: ${candidate_id}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'invitation_sent', checkr_invitation_id = ?, updated_at = NOW() WHERE checkr_candidate_id = ?"
        ).run(invitationId, candidate_id);

        writeAuditLog({
          action: "checkr_invitation_created",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { invitationId, candidateId: candidate_id },
          severity: "info",
        });
        break;
      }

      // ─── Invitation deleted/canceled ───
      case "invitation.deleted": {
        const { id: invitationId, candidate_id } = data.object;
        console.log(`[checkr-webhook] Invitation canceled: ${invitationId}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'invitation_canceled', updated_at = NOW() WHERE checkr_invitation_id = ? OR checkr_candidate_id = ?"
        ).run(invitationId, candidate_id);

        writeAuditLog({
          action: "checkr_invitation_canceled",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { invitationId, candidateId: candidate_id },
          severity: "info",
        });
        break;
      }

      // ─── Post-adverse action — 7 days passed since pre-adverse, no dispute → "Did Not Pass" ───
      case "report.post_adverse_action": {
        const { id: reportId, candidate_id } = data.object;
        console.log(`[checkr-webhook] Post-adverse action: ${reportId}, candidate: ${candidate_id}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'did_not_pass', updated_at = NOW() WHERE checkr_candidate_id = ?"
        ).run(candidate_id);

        // Notify admins
        try {
          const { v4: uuid } = require("uuid");
          const cgProfile = await db.prepare(
            "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_candidate_id = ?"
          ).get(candidate_id);
          const candidateName = cgProfile ? `${cgProfile.first_name} ${cgProfile.last_name}` : `Candidate ${(candidate_id || '').substring(0, 12)}`;
          const title = `🚫 Background check: DID NOT PASS — ${candidateName}`;
          const msg = cgProfile
            ? `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) did not pass the adverse action review period (7 days, no dispute). They should not be assigned to sessions.`
            : `Checkr report ${reportId} post-adverse action complete — candidate did not pass.`;
          const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
          for (const admin of admins) {
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(uuid(), admin.id, "checkr_did_not_pass", title, msg, JSON.stringify({ reportId, candidateId: candidate_id, userId: cgProfile?.user_id }));
          }
        } catch (alertErr) {
          console.error("[checkr-webhook] Post-adverse action alert error:", alertErr.message);
        }

        writeAuditLog({
          action: "checkr_post_adverse_action",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { reportId, candidateId: candidate_id },
          severity: "critical",
        });
        break;
      }

      // ─── Report engaged — adjudicator marked as "engaged" (maps to Clear per cert guide) ───
      case "report.engaged": {
        const { id: reportId, candidate_id } = data.object;
        console.log(`[checkr-webhook] Report engaged: ${reportId}, candidate: ${candidate_id}`);

        // Per certification guide: report.engaged maps to "Clear" partner status
        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'clear', is_background_checked = 1, checkr_report_id = ?, updated_at = NOW() WHERE checkr_candidate_id = ?"
        ).run(reportId, candidate_id);

        writeAuditLog({
          action: "checkr_engaged",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { reportId, candidateId: candidate_id },
          severity: "info",
        });
        break;
      }

      // ─── Report canceled (fully canceled background check) ───
      case "report.canceled": {
        const report = data.object;
        const { id: reportId, candidate_id } = report;
        console.log(`[checkr-webhook] Report canceled: ${reportId}, candidate: ${candidate_id}`);

        await db.prepare(
          "UPDATE caregiver_profiles SET checkr_status = 'canceled', is_background_checked = 0, checkr_report_id = ?, updated_at = NOW() WHERE checkr_candidate_id = ?"
        ).run(reportId, candidate_id);

        // Notify admins — the background check was fully canceled
        try {
          const { v4: uuid } = require("uuid");
          const cgProfile = await db.prepare(
            "SELECT cp.user_id, u.first_name, u.last_name, u.email FROM caregiver_profiles cp JOIN users u ON cp.user_id = u.id WHERE cp.checkr_candidate_id = ?"
          ).get(candidate_id);
          const candidateName = cgProfile ? `${cgProfile.first_name} ${cgProfile.last_name}` : `Candidate ${(candidate_id || '').substring(0, 12)}`;
          const title = `❌ Background check canceled — ${candidateName}`;
          const msg = cgProfile
            ? `${cgProfile.first_name} ${cgProfile.last_name} (${cgProfile.email}) background check has been fully canceled. A new background check will need to be initiated if needed.`
            : `Checkr report ${reportId} has been canceled. A new invitation must be sent to restart the process.`;
          const admins = await db.prepare("SELECT id FROM users WHERE is_admin = 1 AND COALESCE(is_demo, 0) = 0").all();
          for (const admin of admins) {
            await db.prepare(
              "INSERT INTO activity_feed (id, family_user_id, event_type, title, message, metadata) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(uuid(), admin.id, "checkr_canceled", title, msg, JSON.stringify({ reportId, candidateId: candidate_id, userId: cgProfile?.user_id }));
          }
          try {
            const { sendPushToUser } = require("../utils/push");
            if (sendPushToUser) {
              for (const admin of admins) { await sendPushToUser(db, admin.id, title, msg.substring(0, 100)); }
            }
          } catch (e) { captureException(e, { where: "checkr: admin alert push (manual review)" }); }
        } catch (alertErr) {
          console.error("[checkr-webhook] Report canceled alert error:", alertErr.message);
        }

        writeAuditLog({
          action: "checkr_canceled",
          endpoint: "/api/checkr/webhook",
          method: "POST",
          details: { reportId, candidateId: candidate_id },
          severity: "warning",
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

// ─── POST /api/checkr/admin/sync-statuses ───
// Re-fetch report results from Checkr API and fix stored statuses
router.post("/admin/sync-statuses", authenticate, async (req, res) => {
  const db = await getDb();
  if (!req.isAdmin) {
    const adminCheck = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
    if (!adminCheck?.is_admin) return res.status(403).json({ error: "Admin only" });
  }

  try {
    const candidates = await db.prepare(
      "SELECT checkr_candidate_id, checkr_report_id, checkr_status FROM caregiver_profiles WHERE checkr_report_id IS NOT NULL"
    ).all();

    let updated = 0;
    const details = [];
    for (const c of candidates) {
      try {
        const report = await checkrRequest("GET", `/reports/${c.checkr_report_id}`);
        const actualResult = report.result || report.status;
        const cleared = actualResult === "clear";
        const newStatus = cleared ? "clear" : (actualResult === "consider" ? "consider" : actualResult);

        details.push({
          candidate: c.checkr_candidate_id,
          reportId: c.checkr_report_id,
          oldStatus: c.checkr_status,
          apiStatus: report.status,
          apiResult: report.result,
          newStatus,
        });

        if (newStatus !== c.checkr_status) {
          await db.prepare(
            "UPDATE caregiver_profiles SET checkr_status = ?, is_background_checked = ?, updated_at = NOW() WHERE checkr_report_id = ?"
          ).run(newStatus, cleared ? 1 : 0, c.checkr_report_id);
          updated++;
          console.log(`[checkr-sync] ${c.checkr_candidate_id}: ${c.checkr_status} → ${newStatus}`);
        }
      } catch (err) {
        console.warn(`[checkr-sync] Failed for report ${c.checkr_report_id}:`, err.message);
      }
    }

    res.json({ ok: true, checked: candidates.length, updated, details });
  } catch (err) {
    console.error("[checkr-sync] Error:", err);
    res.status(500).json({ error: "Sync failed" });
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
        cp.onboarding_complete, cp.checkr_eta,
        COALESCE(cp.bg_check_admin_approved, 0) AS bg_check_admin_approved,
        u.email, u.first_name, u.last_name
      FROM caregiver_profiles cp
      JOIN users u ON cp.user_id = u.id
      /* v1.104.9 — two fixes:
         (1) precedence bug: the AND is_demo=0 only bound to the first OR term,
             so demo caregivers with a candidate/vouch leaked in and (worse) the
             demo guard didn't actually apply to most rows. Parenthesized now.
         (2) a caregiver being VOUCHED (trusted friend, BG check waived) never
             enters the Checkr pipeline, so the old list couldn't show them and
             there was no card to vouch on. Include anyone who has meaningfully
             onboarded (completed onboarding, or entered their legal name in the
             BG-info step) so the admin can always find + vouch for them. Empty
             auto-created stubs (null legal name, no consent) stay excluded. */
      WHERE COALESCE(u.is_demo, 0) = 0 /* demo caregivers out of the BG admin page */
        AND (
          cp.background_check_consent = 1
          OR cp.checkr_candidate_id IS NOT NULL
          OR cp.is_background_checked = 1
          OR COALESCE(cp.bg_check_admin_approved, 0) = 1
          OR cp.onboarding_complete = 1
          OR cp.legal_first_name IS NOT NULL
          /* v1.105.63 — two more ways to be a real caregiver rather than a stub.
             The v1.104.9 note above got the problem right and the fix half-right: it
             reached people who had TYPED THEIR LEGAL NAME, which is collected inside the
             background-check step. So the only route onto this page ran through the very
             pipeline a vouch exists to keep someone OUT of — to waive a caregiver's
             background check you first had to make them start one.
             The real case: a caregiver whose fee an admin had waived, with Stripe
             connected, was invisible here — so there was no card to vouch on, and the
             waiver the admin had already granted did nothing but push her one step
             further into Checkr. Paying the fee (or being granted a waiver of it) and
             connecting a bank account are both unambiguous signals of a real person.
             Empty auto-created stubs still have none of these. */
          OR cp.background_check_paid = 1
          OR cp.stripe_onboard_complete = 1
          OR EXISTS (SELECT 1 FROM bg_admin_vouches v WHERE v.caregiver_user_id = cp.user_id AND v.revoked_at IS NULL)
        )
      ORDER BY cp.updated_at DESC
    `).all();

    // v1.64.0: attach active vouches + flag hand-set "cleared" rows that have
    // no Checkr report behind them (candidates for convert-to-vouch).
    const allVouches = await db.prepare(`
      SELECT v.id, v.caregiver_user_id, v.family_user_id, v.note, v.created_at,
             fu.first_name || ' ' || fu.last_name AS family_name
      FROM bg_admin_vouches v JOIN users fu ON fu.id = v.family_user_id
      WHERE v.revoked_at IS NULL
    `).all();
    for (const c of candidates) {
      c.vouches = allVouches.filter((v) => v.caregiver_user_id === c.user_id);
      c.manually_set_no_report = !!c.is_background_checked && !c.checkr_report_id;
    }

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
    // Step 1: Create candidate WITH work_locations (required by Checkr for compliance)
    console.log(`[checkr-test] Creating candidate: ${first_name} ${last_name}`);
    const candidateBody = {
      first_name,
      last_name,
      email,
      ssn: ssn || undefined,
      dob: dob || undefined,
      zipcode: zipcode || undefined,
      work_locations: locations,
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
    const testEmail = `test-${first_name.toLowerCase()}-${last_name.toLowerCase()}-${Date.now()}@checkr-mock.inplace`;

    // Create test user
    try {
      await db.prepare(
        "INSERT INTO users (id, email, first_name, last_name, role, password_hash, is_active, is_demo) VALUES (?, ?, ?, ?, 'caregiver', 'checkr-test-no-login', 1, 0)"
      ).run(testUserId, testEmail, first_name, last_name);
      console.log(`[checkr-test] Created test user: ${testEmail}`);
    } catch (userErr) {
      console.warn(`[checkr-test] User creation failed:`, userErr.message);
    }

    // Create caregiver profile linked to Checkr candidate — separate try so it runs even if user already existed
    try {
      await db.prepare(`
        INSERT INTO caregiver_profiles (id, user_id, legal_first_name, legal_last_name, date_of_birth,
          checkr_candidate_id, checkr_invitation_id, checkr_status, background_check_consent, background_check_paid, hourly_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'invitation_sent', 1, 1, 25)
      `).run(uuid(), testUserId, first_name, last_name, dob || null, candidate.id, invitation.id);
      console.log(`[checkr-test] Created profile linked to candidate ${candidate.id}`);
    } catch (profileErr) {
      // If profile creation fails, try updating existing profile with the new candidate ID
      try {
        const existing = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(testUserId);
        if (existing) {
          await db.prepare("UPDATE caregiver_profiles SET checkr_candidate_id = ?, checkr_invitation_id = ?, checkr_status = 'invitation_sent' WHERE user_id = ?")
            .run(candidate.id, invitation.id, testUserId);
          console.log(`[checkr-test] Updated existing profile with candidate ${candidate.id}`);
        }
      } catch (updateErr) {
        console.error(`[checkr-test] Profile creation AND update failed:`, profileErr.message, updateErr.message);
      }
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

// ─── GET /api/checkr/admin/packages ───
// List available Checkr packages (admin diagnostic)
router.get("/admin/packages", authenticate, async (req, res) => {
  const db = await getDb();
  const adminCheck = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
  if (!adminCheck?.is_admin) return res.status(403).json({ error: "Admin only" });
  try {
    getCheckrKey();
    const pkgs = await checkrRequest("GET", "/packages");
    res.json(pkgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
