// ─── User-facing safety: report content, block people (v1.105.18) ───
//
// App Review guideline 1.2 requires an app with user-generated content to provide a way to
// report objectionable content AND to block abusive users. Until now InPlace had neither:
// every route in admin/safety.js is requireAdmin, and safety_flags is written only by the
// AI screener and has no reporter column.
//
// REPORT and BLOCK are deliberately different acts, and the difference is the safety
// property that matters most in this file:
//
//   REPORT is silent. The reported person is never told, ever. Someone frightened of a
//   caregiver who is in their home needs to raise it without provoking them. If reporting
//   ever notifies the reported party, this feature becomes a way to get someone hurt.
//
//   BLOCK is loud. Pete's rule (7/30): the person finds out, future visits are cancelled,
//   and the confirmation says so before you commit. That is not a compromise on safety —
//   it is forced, because cancelling someone's visits tells them regardless. Disclosing it
//   just stops the app from pretending otherwise.
//
// The design is also shaped by a real user: someone who blocks impulsively, including
// people they want to talk to. So a block must be reversible, findable afterwards, and the
// blocked conversation must NOT vanish — a thread that disappears leaves no path back.

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { canBlockDirectly, findApprover, getOutgoingBlocks, isBlockedBetween } = require("../utils/blocks");
const { decideCancellationCharge } = require("../utils/cancellationFee");
const { sendPushToUser, notifyAdmins } = require("./push");

const router = express.Router();
router.use(authenticate);

const REPORT_CATEGORIES = [
  "harassment", "inappropriate", "spam", "safety_concern",
  "impersonation", "scam", "other",
];

// ─── POST /api/safety/report ───
// Silent. Never notifies the reported party. Never reveals the reporter to them.
router.post("/report", async (req, res) => {
  try {
    const db = await getDb();
    const { reportedUserId, messageId, conversationId, category, details } = req.body || {};

    if (!REPORT_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: "Please choose a reason for the report." });
    }
    if (!reportedUserId && !messageId) {
      return res.status(400).json({ error: "Nothing to report." });
    }
    if (reportedUserId === req.user.id) {
      return res.status(400).json({ error: "You cannot report yourself." });
    }

    // Snapshot the content NOW. Messages support soft deletion, so a reported message can
    // be deleted between the report and an admin reading it — leaving the reviewer an empty
    // thread and an unactionable report, which is the same as having no report feature.
    let snapshot = null;
    let subjectId = reportedUserId || null;
    if (messageId) {
      const msg = await db.prepare(
        "SELECT id, sender_id, content, created_at FROM messages WHERE id = ?"
      ).get(messageId);
      if (msg) {
        snapshot = JSON.stringify({
          content: msg.content, senderId: msg.sender_id, createdAt: msg.created_at,
        });
        if (!subjectId) subjectId = msg.sender_id;
      }
    }

    const id = uuid();
    await db.prepare(`
      INSERT INTO content_reports
        (id, reporter_user_id, reported_user_id, message_id, conversation_id,
         category, details, content_snapshot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, req.user.id, subjectId, messageId || null, conversationId || null,
           category, (details || "").slice(0, 4000), snapshot);

    // Admins only. Deliberately no notification of any kind to the reported user.
    notifyAdmins("content_report", {
      title: "Content reported",
      body: `A user reported ${category.replace(/_/g, " ")}. Review in the admin panel.`,
      data: { type: "content_report", reportId: id },
    }).catch(() => {});

    // Guideline 1.2 also expects a stated response commitment. Saying it here means the
    // person who just reported something sees it at the moment they care about it.
    res.json({
      reportId: id,
      message: "Thanks — this has been sent to our safety team. We review reports within 24 hours. The person you reported is not told that you reported them.",
    });
  } catch (err) {
    console.error("Report error:", err);
    res.status(500).json({ error: "Could not submit the report." });
  }
});

// ─── GET /api/safety/block-preview/:userId ───
// What blocking this person would do, BEFORE committing to it. The consequences are the
// whole point of the confirmation, so they are computed rather than described in prose that
// drifts from reality.
router.get("/block-preview/:userId", async (req, res) => {
  try {
    const db = await getDb();
    const target = await db.prepare(
      "SELECT id, first_name, last_name, role FROM users WHERE id = ?"
    ).get(req.params.userId);
    if (!target) return res.status(404).json({ error: "Person not found." });

    const permission = await canBlockDirectly(db, req.user.id, req.user.activeRole || req.user.role);
    const sessions = await futureSessionsBetween(db, req.user.id, target.id);

    res.json({
      name: `${target.first_name} ${target.last_name}`.trim(),
      needsApproval: !permission.allowed,
      upcomingVisits: sessions.length,
      consequences: [
        `${target.first_name} will be told that you blocked them.`,
        sessions.length
          ? `${sessions.length} upcoming visit${sessions.length === 1 ? "" : "s"} will be cancelled.`
          : "You have no upcoming visits together.",
        "You have not been charged for cancelled visits, and you will not be.",
        "You can unblock them at any time from Account settings.",
      ],
    });
  } catch (err) {
    console.error("Block preview error:", err);
    res.status(500).json({ error: "Could not check what blocking would do." });
  }
});

// Future sessions the two of them share. Used by both the preview and the block itself so
// the number shown is the number acted on.
async function futureSessionsBetween(db, userAId, userBId) {
  try {
    return await db.prepare(`
      SELECT cs.id, cs.status, cs.scheduled_date, cs.scheduled_time,
             cs.stripe_payment_intent_id, cs.payment_status, cs.authorized_amount,
             cs.family_user_id, cp.user_id AS caregiver_user_id
      FROM care_sessions cs
      LEFT JOIN caregiver_profiles cp ON cs.caregiver_id = cp.id
      WHERE cs.status IN ('confirmed', 'pending', 'open', 'requested')
        AND cs.scheduled_date >= CURRENT_DATE
        AND (
          (cs.family_user_id = ? AND cp.user_id = ?) OR
          (cs.family_user_id = ? AND cp.user_id = ?)
        )
    `).all(userAId, userBId, userBId, userAId);
  } catch (e) {
    console.error("[safety] futureSessionsBetween failed:", e.message);
    return [];
  }
}

// ─── POST /api/safety/block ───
router.post("/block", async (req, res) => {
  try {
    const db = await getDb();
    const { userId: targetId, reason } = req.body || {};
    if (!targetId) return res.status(400).json({ error: "No one to block." });
    if (targetId === req.user.id) return res.status(400).json({ error: "You cannot block yourself." });

    const target = await db.prepare("SELECT id, first_name, last_name FROM users WHERE id = ?").get(targetId);
    if (!target) return res.status(404).json({ error: "Person not found." });

    // Admins are never blockable: the support conversation is how a blocked or frightened
    // person reaches a human. Letting someone sever that — impulsively or under pressure
    // from an abuser — removes the one channel that can actually help them.
    const isAdmin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(targetId);
    if (isAdmin?.is_admin) {
      return res.status(400).json({ error: "You can't block InPlace Support. If someone here is bothering you, reply in that conversation and a person will read it." });
    }

    // Managed accounts route to the care team leader instead of acting.
    const permission = await canBlockDirectly(db, req.user.id, req.user.activeRole || req.user.role);
    if (!permission.allowed) {
      const approver = permission.recipientId ? await findApprover(db, permission.recipientId) : null;
      const reqId = uuid();
      await db.prepare(`
        INSERT INTO block_requests (id, requester_user_id, target_user_id, care_team_id, reason, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(reqId, req.user.id, targetId, approver?.careTeamId || null, (reason || "").slice(0, 2000));

      if (approver?.userId) {
        sendPushToUser(approver.userId, {
          title: "Block request",
          body: `${req.user.firstName || "A care recipient"} asked to block ${target.first_name}.`,
          data: { type: "block_request", requestId: reqId },
        }, "block_request").catch(() => {});
      }
      return res.json({
        status: "pending_approval",
        requestId: reqId,
        message: `We've asked your care team to review this. ${target.first_name} has not been told.`,
      });
    }

    if (await isBlockedBetween(db, req.user.id, targetId)) {
      return res.json({ status: "already_blocked", message: "That person is already blocked." });
    }

    await db.prepare(
      "INSERT INTO user_blocks (id, blocker_user_id, blocked_user_id, reason) VALUES (?, ?, ?, ?) ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING"
    ).run(uuid(), req.user.id, targetId, (reason || "").slice(0, 2000));

    // Cancel shared future visits and settle any hold under the same contract rules the
    // cancel endpoint uses. A block that quietly left visits on the calendar would send a
    // caregiver to the door of someone who just blocked them.
    const sessions = await futureSessionsBetween(db, req.user.id, targetId);
    let cancelled = 0;
    let voidFailures = 0; // v1.105.48 — see the void check below
    for (const s of sessions) {
      try {
        const cancelledBy = s.family_user_id === req.user.id ? "family" : "caregiver";
        await db.prepare(
          "UPDATE care_sessions SET status = 'cancelled', cancellation_reason = 'Cancelled because a participant blocked the other', cancelled_by = ?, cancelled_at = NOW(), updated_at = NOW() WHERE id = ?"
        ).run(cancelledBy, s.id);
        cancelled++;

        // Blocking is not a late cancellation. Someone removing themselves from an unsafe
        // or unwanted situation should not be charged for it, so isLateCancel is false here
        // regardless of timing — a deliberate divergence from the ordinary cancel path.
        const charge = await decideCancellationCharge(db, {
          cancelledBy, isLateCancel: false,
          paymentIntentId: s.stripe_payment_intent_id,
          paymentStatus: s.payment_status,
          authorizedAmountCents: s.authorized_amount,
        });
        // v1.105.48 — this result used to be discarded, and thirty lines below we tell the
        // person "You have not been charged." If the void failed that sentence was false
        // and the authorization hold was still sitting on their card. The ordinary cancel
        // path already checks `voided?.error`; this one didn't.
        if (charge.action === "void") {
          const { voidSessionPayment } = require("./accountability");
          const voided = await voidSessionPayment(s.id);
          if (voided?.error) {
            voidFailures++;
            captureException(new Error(`Void failed on block-cancel: ${voided.error}`), {
              where: "safety: block cancel void", sessionId: s.id,
            });
          }
        }
        const other = s.family_user_id === req.user.id ? s.caregiver_user_id : s.family_user_id;
        if (other) {
          sendPushToUser(other, {
            title: "Visit cancelled",
            body: `Your ${s.scheduled_date} visit was cancelled. Please do not travel to the home.`,
            data: { type: "session_cancelled", sessionId: s.id },
          }, "session_cancelled").catch(() => {});
        }
      } catch (e) {
        console.error("[safety] failed cancelling session on block:", e.message);
      }
    }

    // Pete's rule: they are told. Plainly, without editorialising about why.
    sendPushToUser(targetId, {
      title: "You've been blocked",
      body: `${req.user.firstName || "Someone"} on InPlace has blocked you. You can no longer message each other.`,
      data: { type: "blocked" },
    }, "blocked").catch(() => {});

    res.json({
      status: "blocked",
      cancelledVisits: cancelled,
      // v1.105.48 — only promise what actually happened. If a hold could not be released
      // we say so, because the alternative is the app telling someone they weren't charged
      // while the hold sits on their statement.
      message: `${target.first_name} has been blocked and told. ${cancelled ? `${cancelled} upcoming visit${cancelled === 1 ? " was" : "s were"} cancelled. ` : ""}${
        voidFailures
          ? "We couldn't release one of the payment holds — we're on it, and you won't be charged for a cancelled visit."
          : "You have not been charged."
      } You can unblock them from Account settings.`,
    });
  } catch (err) {
    console.error("Block error:", err);
    res.status(500).json({ error: "Could not block that person." });
  }
});

// ─── DELETE /api/safety/block/:userId ───
// One tap, no confirmation, no consequences. Undoing an impulsive block must be strictly
// easier than making one — cancelled visits do not come back, so the least this can do is
// not stand in the way of the relationship resuming.
router.delete("/block/:userId", async (req, res) => {
  try {
    const db = await getDb();
    const r = await db.prepare(
      "DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?"
    ).run(req.user.id, req.params.userId);
    if (!r?.changes) return res.status(404).json({ error: "You haven't blocked that person." });
    sendPushToUser(req.params.userId, {
      title: "You've been unblocked",
      body: "You can message each other again on InPlace.",
      data: { type: "unblocked" },
    }, "unblocked").catch(() => {});
    res.json({ status: "unblocked" });
  } catch (err) {
    console.error("Unblock error:", err);
    res.status(500).json({ error: "Could not unblock that person." });
  }
});

// ─── GET /api/safety/blocks ───
// The list has to exist and be findable, or an impulsive block is permanent in practice.
router.get("/blocks", async (req, res) => {
  try {
    const db = await getDb();
    res.json({ blocks: await getOutgoingBlocks(db, req.user.id) });
  } catch (err) {
    res.status(500).json({ error: "Could not load your blocked list." });
  }
});

// ─── GET /api/safety/block-requests ───
// Pending requests a care team leader needs to decide.
router.get("/block-requests", async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.prepare(`
      SELECT br.id, br.reason, br.created_at,
             ru.first_name AS requester_first, ru.last_name AS requester_last,
             tu.first_name AS target_first, tu.last_name AS target_last, tu.id AS target_id
      FROM block_requests br
      JOIN users ru ON ru.id = br.requester_user_id
      JOIN users tu ON tu.id = br.target_user_id
      JOIN care_team_members ctm ON ctm.care_team_id = br.care_team_id
      WHERE br.status = 'pending' AND ctm.user_id = ? AND ctm.role = 'leader'
      ORDER BY br.created_at DESC
    `).all(req.user.id);
    res.json({ requests: rows });
  } catch (err) {
    console.error("Block requests error:", err);
    res.status(500).json({ error: "Could not load block requests." });
  }
});

module.exports = router;
