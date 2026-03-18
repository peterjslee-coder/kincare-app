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

// ─── GET /api/costs/summary — Monthly cost summary with auto-pulled + manual ───
router.get("/summary", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const { months = 3 } = req.query;

    // Get manual costs grouped by month and category
    const manualCosts = await db.prepare(`
      SELECT period_month, category, SUM(amount) as total, COUNT(*) as entries
      FROM platform_costs
      GROUP BY period_month, category
      ORDER BY period_month DESC, category
    `).all();

    // Auto-pull Twilio costs
    let twilioCosts = [];
    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (accountSid && authToken) {
        const twilio = require("twilio")(accountSid, authToken);
        // Get usage for current month
        const now = new Date();
        for (let i = 0; i < parseInt(months); i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
          const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
          const endDate = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, "0")}-${String(endD.getDate()).padStart(2, "0")}`;
          const month = startDate.substring(0, 7);

          try {
            const records = await twilio.usage.records.list({
              category: "sms",
              startDate,
              endDate,
            });
            const smsRecord = records.find(r => r.category === "sms");
            if (smsRecord) {
              twilioCosts.push({
                period_month: month,
                category: "Twilio SMS",
                total: parseFloat(smsRecord.price || 0),
                count: parseInt(smsRecord.count || 0),
                source: "auto",
              });
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
        const now = new Date();
        for (let i = 0; i < parseInt(months); i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const startTs = Math.floor(d.getTime() / 1000);
          const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
          const endTs = Math.floor(endD.getTime() / 1000);
          const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

          try {
            const txns = await stripe.balanceTransactions.list({
              created: { gte: startTs, lte: endTs },
              limit: 100,
            });
            let totalFees = 0;
            let txnCount = 0;
            for (const txn of txns.data) {
              totalFees += (txn.fee || 0);
              txnCount++;
            }
            if (txnCount > 0) {
              stripeCosts.push({
                period_month: month,
                category: "Stripe Fees",
                total: totalFees / 100, // Stripe fees are in cents
                count: txnCount,
                source: "auto",
              });
            }
          } catch {}
        }
      }
    } catch {}

    // Merge everything into a monthly summary
    const monthMap = {};
    const addToMonth = (month, category, amount, source, count) => {
      if (!monthMap[month]) monthMap[month] = { month, categories: {}, total: 0 };
      if (!monthMap[month].categories[category]) monthMap[month].categories[category] = { amount: 0, source, count: 0 };
      monthMap[month].categories[category].amount += parseFloat(amount) || 0;
      monthMap[month].categories[category].count += count || 0;
      monthMap[month].total += parseFloat(amount) || 0;
    };

    for (const c of manualCosts) addToMonth(c.period_month, c.category, c.total, "manual", c.entries);
    for (const c of twilioCosts) addToMonth(c.period_month, c.category, c.total, "auto", c.count);
    for (const c of stripeCosts) addToMonth(c.period_month, c.category, c.total, "auto", c.count);

    const summary = Object.values(monthMap).sort((a, b) => b.month.localeCompare(a.month));

    res.json({ summary });
  } catch (err) {
    console.error("Cost summary error:", err);
    res.status(500).json({ error: "Failed to load cost summary" });
  }
});

// ─── GET /api/costs — List all manual cost entries ───
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
    console.error("Costs list error:", err);
    res.status(500).json({ error: "Failed to load costs" });
  }
});

// ─── POST /api/costs — Add a manual cost entry ───
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
    console.error("Add cost error:", err);
    res.status(500).json({ error: "Failed to add cost" });
  }
});

// ─── DELETE /api/costs/:id — Remove a manual cost entry ───
router.delete("/:id", authenticate, checkAdmin, async (req, res) => {
  try {
    const db = await getDb();
    await db.prepare("DELETE FROM platform_costs WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete cost error:", err);
    res.status(500).json({ error: "Failed to delete cost" });
  }
});

module.exports = router;
