const express = require("express");
const { getDb } = require("../models/database");
const { authenticate, denyDemo } = require("../middleware/auth");
const { sendEmail } = require("../utils/email");
const { getTodayStringInZone } = require("../utils/timezone");

const router = express.Router();

// v1.106.4 — every value below is interpolated into an HTML email, and none of it was escaped.
// A caregiver controls their own first/last name and academic_program, so this route would
// render whatever markup they put there inside a message sent from our own address.
const esc = (v) => String(v == null ? "" : v)
  .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A subject line is a header, not markup: HTML-escaping it would show the reader "&amp;".
// What it must never contain is a line break, which would let a crafted name append headers.
const escHeader = (v) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim().slice(0, 200);

// The report goes to an address the caregiver types, which is the feature (a school supervisor).
// That also makes it a way to send mail from hello@yourinplace.com to anywhere, so it is metered
// per account rather than per IP, and every send is written to the audit log.
const HOURLY_EMAIL_CAP = 5;
const _reportSends = new Map(); // userId -> timestamps
function tooManyReportEmails(userId) {
  const now = Date.now();
  const recent = (_reportSends.get(userId) || []).filter((t) => now - t < 60 * 60 * 1000);
  recent.push(now);
  _reportSends.set(userId, recent);
  if (_reportSends.size > 5000) _reportSends.clear(); // bounded; this is a per-instance heuristic
  return recent.length > HOURLY_EMAIL_CAP;
}
// v1.106.4 — demo sessions are free and passwordless; this route sends email from the platform's own address.
router.use(authenticate, denyDemo);

// ─── GET /api/reports/hours ───
// Generate hour report data for the logged-in caregiver
// Query params: from, to (date strings YYYY-MM-DD)
router.get("/hours", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const role = req.user.activeRole || req.user.role;

    if (role !== "caregiver") {
      return res.status(403).json({ error: "Only caregivers can generate hour reports" });
    }

    // Get caregiver profile
    const profile = await db.prepare(
      "SELECT * FROM caregiver_profiles WHERE user_id = ?"
    ).get(userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    const user = await db.prepare(
      "SELECT first_name, last_name, email FROM users WHERE id = ?"
    ).get(userId);

    // Date range — defaults to current semester (last 4 months)
    const { from, to } = req.query;
    const toDate = to || getTodayStringInZone();
    const fromDate = from || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 4);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    })();

    // Fetch completed sessions in range
    const sessions = await db.prepare(`
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name,
        fu.first_name || ' ' || fu.last_name AS family_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      LEFT JOIN users fu ON cs.family_user_id = fu.id
      WHERE cs.caregiver_id = ?
        AND cs.scheduled_date >= ?
        AND cs.scheduled_date <= ?
        AND cs.status = 'completed'
      ORDER BY cs.scheduled_date ASC, cs.scheduled_time ASC
    `).all(profile.id, fromDate, toDate);

    // Aggregate totals
    const totalHours = sessions.reduce((sum, s) => sum + (s.duration_hours || 0), 0);
    const totalSessions = sessions.length;

    // Group by service type
    const byServiceType = {};
    sessions.forEach(s => {
      const t = s.service_type || "general";
      if (!byServiceType[t]) byServiceType[t] = { hours: 0, count: 0 };
      byServiceType[t].hours += s.duration_hours || 0;
      byServiceType[t].count += 1;
    });

    // Academic program info from profile
    const academicProgram = profile.academic_program || null;
    const academicProgramYear = profile.academic_program_year || null;

    res.json({
      report: {
        generatedAt: new Date().toISOString(),
        dateRange: { from: fromDate, to: toDate },
        student: {
          name: `${esc(user.first_name)} ${esc(user.last_name)}`,
          email: user.email,
          academicProgram,
          academicProgramYear,
        },
        summary: {
          totalHours: Math.round(totalHours * 10) / 10,
          totalSessions,
          byServiceType,
        },
        sessions: sessions.map(s => ({
          date: s.scheduled_date,
          time: s.scheduled_time,
          durationHours: s.duration_hours,
          serviceType: s.service_type,
          recipientName: s.recipient_name,
          familyName: s.family_name,
          specialInstructions: s.special_instructions,
        })),
      },
    });
  } catch (err) {
    console.error("Hour report error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ─── POST /api/reports/hours/email ───
// Email the hour report to a school address
router.post("/hours/email", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.user.id;
    const role = req.user.activeRole || req.user.role;

    if (role !== "caregiver") {
      return res.status(403).json({ error: "Only caregivers can send hour reports" });
    }

    const { recipientEmail, recipientName, from, to } = req.body;
    if (!recipientEmail) return res.status(400).json({ error: "recipientEmail is required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(recipientEmail).trim())) {
      return res.status(400).json({ error: "That doesn't look like an email address" });
    }
    if (tooManyReportEmails(userId)) {
      return res.status(429).json({ error: `You can send ${HOURLY_EMAIL_CAP} reports an hour. Try again shortly.` });
    }

    // Get caregiver info
    const profile = await db.prepare("SELECT * FROM caregiver_profiles WHERE user_id = ?").get(userId);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    const user = await db.prepare("SELECT first_name, last_name, email FROM users WHERE id = ?").get(userId);

    // Date range
    const toDate = to || getTodayStringInZone();
    const fromDate = from || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 4);
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    })();

    // Fetch completed sessions
    const sessions = await db.prepare(`
      SELECT cs.*,
        cr.first_name || ' ' || cr.last_name AS recipient_name
      FROM care_sessions cs
      LEFT JOIN care_recipients cr ON cs.care_recipient_id = cr.id
      WHERE cs.caregiver_id = ?
        AND cs.scheduled_date >= ?
        AND cs.scheduled_date <= ?
        AND cs.status = 'completed'
      ORDER BY cs.scheduled_date ASC
    `).all(profile.id, fromDate, toDate);

    const totalHours = sessions.reduce((sum, s) => sum + (s.duration_hours || 0), 0);

    // Build email HTML
    const formatDate = (d) => {
      const [y, mo, day] = (d || "").split("-").map(Number);
      const dt = new Date(y, mo - 1, day);
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    };

    const serviceLabel = (t) => (t || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    const sessionRows = sessions.map(s => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${esc(formatDate(s.scheduled_date))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${esc(s.scheduled_time || "—")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;text-align:right;font-weight:600">${esc(s.duration_hours || 0)}h</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${esc(serviceLabel(s.service_type))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${esc(s.recipient_name || "—")}</td>
      </tr>
    `).join("");

    const emailHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:650px;margin:0 auto;color:#333">
        <div style="background:#1b6b5a;padding:24px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;color:#fff;font-size:22px">Clinical Hours Report</h1>
          <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px">InPlace Care Platform — Verified Hours</p>
        </div>
        <div style="padding:24px 32px;background:#fff;border:1px solid #e0e0e0;border-top:none">
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#888;width:120px">Student Name</td>
              <td style="padding:6px 0;font-size:14px;font-weight:600">${esc(user.first_name)} ${esc(user.last_name)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#888">Email</td>
              <td style="padding:6px 0;font-size:14px">${esc(user.email)}</td>
            </tr>
            ${profile.academic_program ? `<tr>
              <td style="padding:6px 0;font-size:13px;color:#888">Program</td>
              <td style="padding:6px 0;font-size:14px">${esc(profile.academic_program)}${profile.academic_program_year ? ` (${esc(profile.academic_program_year)})` : ""}</td>
            </tr>` : ""}
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#888">Report Period</td>
              <td style="padding:6px 0;font-size:14px">${esc(formatDate(fromDate))} — ${esc(formatDate(toDate))}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#888">Total Hours</td>
              <td style="padding:6px 0;font-size:18px;font-weight:700;color:#1b6b5a">${Math.round(totalHours * 10) / 10} hours</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#888">Total Sessions</td>
              <td style="padding:6px 0;font-size:14px">${sessions.length}</td>
            </tr>
          </table>

          <h3 style="margin:20px 0 10px;font-size:15px;color:#333;border-bottom:2px solid #1b6b5a;padding-bottom:6px">Session Detail</h3>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#f5f5f5">
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase">Date</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase">Time</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;color:#888;font-weight:600;text-transform:uppercase">Hours</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase">Type of Care</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase">Client</th>
              </tr>
            </thead>
            <tbody>
              ${sessionRows || '<tr><td colspan="5" style="padding:20px;text-align:center;color:#999">No completed sessions in this period</td></tr>'}
            </tbody>
            <tfoot>
              <tr style="border-top:2px solid #333">
                <td colspan="2" style="padding:10px 12px;font-weight:700;font-size:14px">Total</td>
                <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px;color:#1b6b5a">${Math.round(totalHours * 10) / 10}h</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>

          <div style="margin-top:24px;padding:16px;background:#f8f9fa;border-radius:8px;border:1px solid #e0e0e0">
            <p style="margin:0;font-size:12px;color:#666;line-height:1.6">
              This report was generated by <strong>InPlace</strong> (yourinplace.com), an on-demand care coordination platform.
              All sessions listed above have been verified as completed through the platform.
              For questions about this report, please contact ${esc(user.first_name)} at ${esc(user.email)}.
            </p>
            <p style="margin:8px 0 0;font-size:11px;color:#999">
              Report generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
      </div>
    `;

    // Send email
    const result = await sendEmail({
      to: recipientEmail,
      subject: escHeader(`Clinical Hours Report — ${user.first_name} ${user.last_name} (${formatDate(fromDate)} to ${formatDate(toDate)})`),
      html: emailHtml,
      replyTo: user.email,
    });

    if (result.success) {
      res.json({ success: true, message: `Report emailed to ${recipientEmail}` });
    } else {
      res.status(500).json({ error: result.error || "Failed to send email" });
    }
  } catch (err) {
    console.error("Hour report email error:", err);
    res.status(500).json({ error: "Failed to send report" });
  }
});

module.exports = router;
