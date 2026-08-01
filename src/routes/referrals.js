// ─── Referrals & Milestones ───
const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

// Ensure user has a referral code (lazy-generate on first access)
async function ensureReferralCode(db, userId) {
  const user = await db.prepare("SELECT referral_code, first_name, last_name FROM users WHERE id = ?").get(userId);
  if (user?.referral_code) return user.referral_code;

  // Generate a short, readable code: first name + random 4 chars
  const base = (user?.first_name || "user").toLowerCase().replace(/[^a-z]/g, "").slice(0, 8);
  const rand = Math.random().toString(36).slice(2, 6);
  const code = `${base}-${rand}`;
  await db.prepare("UPDATE users SET referral_code = ? WHERE id = ?").run(code, userId);
  return code;
}

// ─── GET /api/referrals/my-code — Get current user's referral code + stats ───
router.get("/my-code", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const code = await ensureReferralCode(db, req.user.id);
    const stats = await db.prepare(`
      SELECT
        COUNT(*) as total_sent,
        SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) as total_claimed
      FROM referrals WHERE referrer_user_id = ?
    `).get(req.user.id);

    res.json({
      referralCode: code,
      referralLink: `${process.env.BASE_URL || "https://yourinplace.com"}/register?ref=${code}&role=caregiver`,
      totalSent: stats?.total_sent || 0,
      totalClaimed: stats?.total_claimed || 0,
    });
  } catch (err) {
    console.error("Get referral code error:", err);
    res.status(500).json({ error: "Failed to get referral code" });
  }
});

// ─── GET /api/referrals/qr — this user's referral link, as a scannable SVG ───
//
// Deliberately takes NO input. An endpoint that renders a QR for arbitrary text is a
// small open redirect with extra steps: anyone could mint an official-looking
// yourinplace.com QR pointing anywhere they liked, and the whole value of a QR is that
// people scan it without reading the URL first. This one can only ever encode the
// authenticated caller's own referral link.
//
// SVG rather than PNG so it stays crisp printed on a flyer or blown up on a laptop held
// across a table, and so it costs ~2KB instead of ~40KB on a phone connection.
router.get("/qr", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const code = await ensureReferralCode(db, req.user.id);
    const link = `${process.env.BASE_URL || "https://yourinplace.com"}/register?ref=${code}&role=caregiver`;
    const QRCode = require("qrcode");
    const svg = await QRCode.toString(link, {
      type: "svg",
      // High correction — ~30% can be obscured by a thumb, a fold or screen glare and it
      // still decodes. The realistic failure here is someone holding a phone at an angle.
      errorCorrectionLevel: "H",
      margin: 2,
      color: { dark: "#1b6b5a", light: "#FFFFFF" },
    });
    res.type("image/svg+xml");
    // Per-user content: must never land in a shared cache.
    res.set("Cache-Control", "private, max-age=3600");
    res.send(svg);
  } catch (err) {
    console.error("Referral QR error:", err);
    res.status(500).json({ error: "Failed to generate the QR code" });
  }
});

// ─── POST /api/referrals/send — Send a referral email ───
router.post("/send", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { email, phone, name } = req.body;
    if (!email && !phone) return res.status(400).json({ error: "Email or phone required" });

    const code = await ensureReferralCode(db, req.user.id);
    const referrer = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const referrerName = `${referrer?.first_name || ""} ${referrer?.last_name || ""}`.trim();

    // Check for existing referral to same email
    if (email) {
      const existing = await db.prepare("SELECT id FROM referrals WHERE referrer_user_id = ? AND referred_email = ?").get(req.user.id, email.toLowerCase().trim());
      if (existing) return res.status(409).json({ error: "You've already sent a referral to this email" });
    }

    const referralId = uuid();
    await db.prepare(`
      INSERT INTO referrals (id, referrer_user_id, referred_email, referred_phone, referral_code, status, sent_at)
      VALUES (?, ?, ?, ?, ?, 'pending', NOW())
    `).run(referralId, req.user.id, email?.toLowerCase().trim() || null, phone?.trim() || null, code);

    // Send referral email if email provided
    if (email) {
      try {
        const { sendEmail, brandedHtml } = require("../utils/email");
        const refLink = `${process.env.BASE_URL || "https://yourinplace.com"}/register?ref=${code}&role=caregiver`;
        const recipientName = name?.trim() || "there";

        await sendEmail({
          to: email.trim(),
          subject: `${referrerName} thinks you'd be a great caregiver on inPlace`,
          html: brandedHtml({
            title: "You've Been Referred!",
            greeting: `Hi ${recipientName},`,
            body: `${referrerName} is a caregiver on inPlace — an on-demand home care platform where caregivers keep 80% of every session. They think you'd be great at it.<br><br>inPlace connects vetted caregivers with families who need help with companionship, meal prep, medication reminders, and transportation. You set your own schedule — it flexes around classes, another job, or family — and you build real relationships with families in your community. Typical caregivers earn $25–35/hr, paid within 48 hours.`,
            ctaUrl: refLink,
            ctaText: "Check It Out",
            footnote: `When you sign up, ${referrerName} gets credit for referring you. Questions? Just reply to this email.`,
          }),
        });
      } catch (emailErr) {
        console.error("Referral email error:", emailErr);
        // Don't fail the referral if email fails
      }
    }

    res.json({ success: true, referralId });
  } catch (err) {
    console.error("Send referral error:", err);
    res.status(500).json({ error: "Failed to send referral" });
  }
});

// ─── GET /api/referrals/list — List user's sent referrals ───
router.get("/list", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const referrals = await db.prepare(`
      SELECT r.id, r.referred_email, r.referred_phone, r.status, r.sent_at, r.claimed_at,
        u.first_name as claimed_first_name, u.last_name as claimed_last_name
      FROM referrals r
      LEFT JOIN users u ON u.id = r.referred_user_id
      WHERE r.referrer_user_id = ?
      ORDER BY r.sent_at DESC
    `).all(req.user.id);

    res.json({ referrals });
  } catch (err) {
    console.error("List referrals error:", err);
    res.status(500).json({ error: "Failed to list referrals" });
  }
});

// ─── POST /api/referrals/claim — Claim a referral during registration ───
// Called with either { referralCode } or { referrerSearch } (name search)
router.post("/claim", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { referralCode, referrerSearch } = req.body;

    let referrerUserId = null;
    let referrerName = null;

    if (referralCode) {
      // Direct code match
      const referrer = await db.prepare("SELECT id, first_name, last_name FROM users WHERE referral_code = ? AND is_active = 1").get(referralCode);
      if (!referrer) return res.status(404).json({ error: "Referral code not found" });
      referrerUserId = referrer.id;
      referrerName = `${referrer.first_name} ${referrer.last_name}`.trim();
    } else if (referrerSearch) {
      // Fuzzy name search — return candidates
      const searchTerm = `%${referrerSearch.trim()}%`;
      const candidates = await db.prepare(`
        SELECT id, first_name, last_name, avatar_url
        FROM users
        WHERE is_active = 1 AND COALESCE(is_demo, 0) = 0
          AND (first_name || ' ' || last_name LIKE ? OR first_name LIKE ? OR last_name LIKE ?)
        ORDER BY first_name, last_name
        LIMIT 10
      `).all(searchTerm, searchTerm, searchTerm);

      return res.json({ candidates: candidates.map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), avatar: c.avatar_url })) });
    } else {
      return res.status(400).json({ error: "Provide referralCode or referrerSearch" });
    }

    // If we have a referrer, create/update the referral record
    if (referrerUserId && req.user?.id) {
      // Check if a pending referral exists for this email
      const userEmail = (await db.prepare("SELECT email FROM users WHERE id = ?").get(req.user.id))?.email;
      const pending = await db.prepare("SELECT id FROM referrals WHERE referrer_user_id = ? AND referred_email = ? AND status = 'pending'")
        .get(referrerUserId, userEmail);

      if (pending) {
        // Claim existing referral
        await db.prepare("UPDATE referrals SET referred_user_id = ?, status = 'claimed', claimed_at = NOW() WHERE id = ?")
          .run(req.user.id, pending.id);
      } else {
        // Create new referral (user credited referrer during registration)
        await db.prepare(`
          INSERT INTO referrals (id, referrer_user_id, referred_user_id, referral_code, status, sent_at, claimed_at)
          VALUES (?, ?, ?, ?, 'claimed', NOW(), NOW())
        `).run(uuid(), referrerUserId, req.user.id, referralCode || null);
      }

      // Notify the referrer
      try {
        const newUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
        const newName = `${newUser?.first_name || ""} ${newUser?.last_name || ""}`.trim();
        await db.prepare(`
          INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at)
          VALUES (?, ?, 'referral_claimed', ?, ?, NOW())
        `).run(uuid(), referrerUserId, "Referral Joined!", `${newName} signed up and credited you as their referral.`);
      } catch (notifyErr) { console.error("Referral notification error:", notifyErr); }

      return res.json({ success: true, referrerName });
    }

    res.json({ success: false });
  } catch (err) {
    console.error("Claim referral error:", err);
    res.status(500).json({ error: "Failed to claim referral" });
  }
});

// ─── POST /api/referrals/select-referrer — Finalize referrer selection by user ID ───
router.post("/select-referrer", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { referrerUserId } = req.body;
    if (!referrerUserId || !req.user?.id) return res.status(400).json({ error: "Missing data" });

    const referrer = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ? AND is_active = 1").get(referrerUserId);
    if (!referrer) return res.status(404).json({ error: "User not found" });

    // Check if already claimed
    const existing = await db.prepare("SELECT id FROM referrals WHERE referred_user_id = ?").get(req.user.id);
    if (existing) return res.status(409).json({ error: "You've already credited a referrer" });

    await db.prepare(`
      INSERT INTO referrals (id, referrer_user_id, referred_user_id, status, sent_at, claimed_at)
      VALUES (?, ?, ?, 'claimed', NOW(), NOW())
    `).run(uuid(), referrerUserId, req.user.id);

    // Notify referrer
    const newUser = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    const newName = `${newUser?.first_name || ""} ${newUser?.last_name || ""}`.trim();
    const referrerName = `${referrer.first_name} ${referrer.last_name}`.trim();

    try {
      await db.prepare(`
        INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at)
        VALUES (?, ?, 'referral_claimed', ?, ?, NOW())
      `).run(uuid(), referrerUserId, "Referral Joined!", `${newName} signed up and credited you as their referral.`);
    } catch (e) { /* ok */ }

    res.json({ success: true, referrerName });
  } catch (err) {
    console.error("Select referrer error:", err);
    res.status(500).json({ error: "Failed to select referrer" });
  }
});

// ─── Milestone check (called after session completion) ───
async function checkSessionMilestones(db, caregiverId) {
  try {
    // Get the user ID for this caregiver profile
    const profile = await db.prepare("SELECT user_id FROM caregiver_profiles WHERE id = ?").get(caregiverId);
    if (!profile) return;

    const userId = profile.user_id;

    // Count completed sessions
    const count = await db.prepare(`
      SELECT COUNT(*) as cnt FROM care_sessions
      WHERE caregiver_id = ? AND status = 'completed'
    `).get(caregiverId);

    const total = count?.cnt || 0;
    const milestones = [10, 25, 50, 100, 250, 500];

    for (const m of milestones) {
      if (total >= m) {
        // Check if this milestone was already recorded
        const exists = await db.prepare(
          "SELECT id FROM milestones WHERE user_id = ? AND milestone_type = 'sessions_completed' AND milestone_value = ?"
        ).get(userId, m);

        if (!exists) {
          await db.prepare(`
            INSERT INTO milestones (id, user_id, milestone_type, milestone_value, created_at)
            VALUES (?, ?, 'sessions_completed', ?, NOW())
          `).run(uuid(), userId, m);

          // Create activity feed entry for the caregiver
          const milestoneLabels = { 10: "First 10 Sessions!", 25: "25 Sessions!", 50: "50 Sessions!", 100: "Century Club!", 250: "250 Sessions!", 500: "500 Sessions!" };
          const label = milestoneLabels[m] || `${m} Sessions!`;

          await db.prepare(`
            INSERT INTO activity_feed (id, family_user_id, event_type, title, message, created_at)
            VALUES (?, ?, 'milestone', ?, ?, NOW())
          `).run(uuid(), userId, label, `Congratulations! You've completed ${m} care sessions on inPlace. Thank you for the incredible work you do.`);

          console.log(`  [milestone] ${userId} reached ${m} completed sessions`);
        }
      }
    }
  } catch (err) {
    console.error("Milestone check error:", err);
  }
}

// ─── GET /api/referrals/milestones — Get user's milestones ───
router.get("/milestones", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const milestones = await db.prepare(`
      SELECT id, milestone_type, milestone_value, acknowledged, created_at
      FROM milestones WHERE user_id = ? ORDER BY milestone_value ASC
    `).all(req.user.id);

    // Get unacknowledged milestones for banner display
    const unacknowledged = milestones.filter(m => !m.acknowledged);

    res.json({ milestones, unacknowledged });
  } catch (err) {
    console.error("Get milestones error:", err);
    res.status(500).json({ error: "Failed to get milestones" });
  }
});

// ─── POST /api/referrals/milestones/:id/acknowledge ───
router.post("/milestones/:id/acknowledge", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare("UPDATE milestones SET acknowledged = 1 WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to acknowledge milestone" });
  }
});

module.exports = router;
module.exports.checkSessionMilestones = checkSessionMilestones;
