const express = require("express");
const router = express.Router();
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");

// Middleware: check admin
const checkAdmin = async (req, res, next) => {
  const db = await getDb();
  const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
  if (!user || !user.is_admin) return res.status(403).json({ error: "Admin access required" });
  req.isAdmin = true;
  next();
};

// Helper: generate month strings from start to end
function getMonthRange(startMonth, endMonth) {
  const months = [];
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

// ─── GET /api/costs/summary — Monthly cost summary with recurring + one-time + auto-pulled ───
router.get("/summary", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { months = 6 } = req.query;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Calculate the range of months to show
    const startD = new Date(now.getFullYear(), now.getMonth() - (parseInt(months) - 1), 1);
    const startMonth = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, "0")}`;
    const monthList = getMonthRange(startMonth, currentMonth);

    // Get one-time manual costs
    const manualCosts = await db.prepare(`
      SELECT period_month, category, description, amount
      FROM platform_costs
      WHERE period_month >= ? AND period_month <= ?
      ORDER BY period_month DESC
    `).all(startMonth, currentMonth);

    // Get recurring expenses
    const recurring = await db.prepare(`
      SELECT * FROM recurring_expenses WHERE active = 1
      ORDER BY category
    `).all();

    // Auto-pull Twilio costs
    let twilioCosts = [];
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (accountSid && authToken) {
        const twilio = require("twilio")(accountSid, authToken);
        for (let i = 0; i < Math.min(parseInt(months), 3); i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
          const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          const endDate = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-${String(endD.getDate()).padStart(2, "0")}`;
          const month = startDate.substring(0, 7);
          try {
            const records = await twilio.usage.records.list({ category: "sms", startDate, endDate });
            const smsRecord = records.find(r => r.category === "sms");
            if (smsRecord && parseFloat(smsRecord.price || 0) > 0) {
              twilioCosts.push({ period_month: month, category: "Twilio SMS", total: parseFloat(smsRecord.price || 0), count: parseInt(smsRecord.count || 0), source: "auto" });
            }
          } catch {}
        }
      }
    } catch {}

    // Auto-pull Stripe fees
    let stripeCosts = [];
    try {
      const stripeKey = process.env.stripe_secret_key || process.env.STRIPE_SECRET_KEY;
      if (stripeKey) {
        const stripe = require("stripe")(stripeKey);
        for (let i = 0; i < Math.min(parseInt(months), 3); i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const startTs = Math.floor(d.getTime() / 1000);
          const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
          const endTs = Math.floor(endD.getTime() / 1000);
          const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          try {
            const txns = await stripe.balanceTransactions.list({ created: { gte: startTs, lte: endTs }, limit: 100 });
            let totalFees = 0, txnCount = 0;
            for (const txn of txns.data) { totalFees += (txn.fee || 0); txnCount++; }
            if (txnCount > 0) {
              stripeCosts.push({ period_month: month, category: "Stripe Fees", total: totalFees / 100, count: txnCount, source: "auto" });
            }
          } catch {}
        }
      }
    } catch {}

    // Auto-pull Claude API costs
    let claudeCosts = [];
    try {
      const anthropicAdminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
      if (anthropicAdminKey) {
        for (let i = 0; i < Math.min(parseInt(months), 3); i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          const startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
          const endDate = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-${String(endD.getDate()).padStart(2, "0")}`;
          const month = startDate.substring(0, 7);
          try {
            const resp = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?start_date=${startDate}&end_date=${endDate}&grouping=service`, {
              headers: { "x-api-key": anthropicAdminKey, "anthropic-version": "2023-06-01" },
            });
            if (resp.ok) {
              const data = await resp.json();
              let totalCents = 0;
              for (const item of (data.data || [])) {
                totalCents += parseFloat(item.cost_cents || 0);
              }
              if (totalCents > 0) {
                claudeCosts.push({ period_month: month, category: "Claude API", total: totalCents / 100, source: "auto" });
              }
            }
          } catch {}
        }
      }
    } catch {}

    // Build monthly summary
    const monthMap = {};
    for (const month of monthList) {
      monthMap[month] = { month, categories: {}, total: 0 };
    }

    const addToMonth = (month, category, amount, source, description) => {
      if (!monthMap[month]) monthMap[month] = { month, categories: {}, total: 0 };
      if (!monthMap[month].categories[category]) monthMap[month].categories[category] = { amount: 0, source, items: [] };
      monthMap[month].categories[category].amount += parseFloat(amount) || 0;
      if (description) monthMap[month].categories[category].items.push(description);
      monthMap[month].total += parseFloat(amount) || 0;
    };

    // Add one-time manual costs
    for (const c of manualCosts) addToMonth(c.period_month, c.category, c.amount, "manual", c.description);

    // Add recurring expenses to each applicable month
    for (const r of recurring) {
      for (const month of monthList) {
        if (month >= r.start_month && (!r.end_month || month <= r.end_month)) {
          if (r.recurrence === "monthly") {
            addToMonth(month, r.category, r.amount, "recurring", r.description);
          } else if (r.recurrence === "yearly") {
            // Only add in the start month of each year
            const startMo = parseInt(r.start_month.split("-")[1]);
            const thisMo = parseInt(month.split("-")[1]);
            if (thisMo === startMo) addToMonth(month, r.category, r.amount, "recurring", r.description);
          }
        }
      }
    }

    // Add auto-pulled costs
    for (const c of twilioCosts) addToMonth(c.period_month, c.category, c.total, "auto");
    for (const c of stripeCosts) addToMonth(c.period_month, c.category, c.total, "auto");
    for (const c of claudeCosts) addToMonth(c.period_month, c.category, c.total, "auto");

    const summary = Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month));

    // Calculate running totals
    let runningTotal = 0;
    const sortedAsc = [...summary].reverse();
    for (const m of sortedAsc) {
      runningTotal += m.total;
      m.runningTotal = runningTotal;
    }

    res.json({ summary, recurring });
  } catch (err) {
    console.error("Cost summary error:", err);
    res.status(500).json({ error: "Failed to load cost summary" });
  }
});

// ─── GET /api/costs — List all one-time cost entries ───
router.get("/", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const costs = await db.prepare(`
      SELECT pc.*, u.first_name, u.last_name
      FROM platform_costs pc
      LEFT JOIN users u ON pc.created_by = u.id
      ORDER BY pc.period_month DESC, pc.created_at DESC
    `).all();
    res.json({ costs });
  } catch (err) {
    res.status(500).json({ error: "Failed to load costs" });
  }
});

// ─── POST /api/costs — Add a one-time cost entry ───
router.post("/", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { category, description, amount, period_month } = req.body;
    if (!category || !amount || !period_month) {
      return res.status(400).json({ error: "Category, amount, and period_month are required" });
    }

    const id = uuid();
    await db.prepare(`
      INSERT INTO platform_costs (id, category, description, amount, period_month, source, created_by)
      VALUES (?, ?, ?, ?, ?, 'manual', ?)
    `).run(id, category.trim(), description?.trim() || null, parseFloat(amount), period_month, req.user.id);

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: "Failed to add cost" });
  }
});

// ─── DELETE /api/costs/:id — Remove a one-time cost entry ───
router.delete("/:id", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare("DELETE FROM platform_costs WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete cost" });
  }
});

// ─── POST /api/costs/recurring — Add a recurring expense ───
router.post("/recurring", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { category, description, amount, recurrence, start_month } = req.body;
    if (!category || !amount || !recurrence || !start_month) {
      return res.status(400).json({ error: "Category, amount, recurrence, and start_month are required" });
    }

    const id = uuid();
    await db.prepare(`
      INSERT INTO recurring_expenses (id, category, description, amount, recurrence, start_month, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, category.trim(), description?.trim() || null, parseFloat(amount), recurrence, start_month, req.user.id);

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: "Failed to add recurring expense" });
  }
});

// ─── PUT /api/costs/recurring/:id — Update a recurring expense ───
router.put("/recurring/:id", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { amount, description, active, end_month } = req.body;
    const updates = [];
    const params = [];
    if (amount !== undefined) { updates.push("amount = ?"); params.push(parseFloat(amount)); }
    if (description !== undefined) { updates.push("description = ?"); params.push(description); }
    if (active !== undefined) { updates.push("active = ?"); params.push(active ? 1 : 0); }
    if (end_month !== undefined) { updates.push("end_month = ?"); params.push(end_month || null); }
    if (updates.length === 0) return res.status(400).json({ error: "Nothing to update" });

    params.push(req.params.id);
    await db.prepare(`UPDATE recurring_expenses SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update recurring expense" });
  }
});

// ─── DELETE /api/costs/recurring/:id — Delete a recurring expense ───
router.delete("/recurring/:id", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare("DELETE FROM recurring_expenses WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete recurring expense" });
  }
});

module.exports = router;
