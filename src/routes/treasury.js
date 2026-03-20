const express = require("express");
const { authenticate, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// ─── GET /api/admin/treasury — Combined Mercury + Stripe cash position ───
router.get("/", authenticate, requireAdmin, async (req, res) => {
  const results = { mercury: null, stripe: null, errors: [] };

  // ── Mercury: accounts + balances + recent transactions ──
  const mercuryToken = process.env.MERCURY_API_TOKEN;
  if (mercuryToken) {
    try {
      // Fetch all accounts
      const acctRes = await fetch("https://api.mercury.com/api/v1/accounts", {
        headers: { Authorization: `Bearer ${mercuryToken}`, Accept: "application/json" },
      });
      if (!acctRes.ok) {
        const errText = await acctRes.text().catch(() => "");
        results.errors.push(`Mercury accounts: ${acctRes.status} ${errText.substring(0, 200)}`);
      } else {
        const acctData = await acctRes.json();
        const accounts = (acctData.accounts || acctData || []);

        // Normalize account list
        const mercuryAccounts = [];
        for (const a of (Array.isArray(accounts) ? accounts : [])) {
          const account = {
            id: a.id,
            name: a.name || a.nickname || a.accountNumber || "Account",
            type: a.type || a.kind || "checking",
            currentBalance: a.currentBalance ?? a.availableBalance ?? a.balance ?? null,
            availableBalance: a.availableBalance ?? a.currentBalance ?? a.balance ?? null,
            routingNumber: a.routingNumber || null,
            accountNumber: a.accountNumber ? `****${a.accountNumber.slice(-4)}` : null,
            status: a.status || "active",
          };
          mercuryAccounts.push(account);

          // Fetch recent transactions for this account (last 30 days, max 25)
          try {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
            const txRes = await fetch(
              `https://api.mercury.com/api/v1/account/${a.id}/transactions?limit=25&start=${thirtyDaysAgo}`,
              { headers: { Authorization: `Bearer ${mercuryToken}`, Accept: "application/json" } }
            );
            if (txRes.ok) {
              const txData = await txRes.json();
              account.recentTransactions = (txData.transactions || txData || []).map(t => ({
                id: t.id,
                amount: t.amount,
                counterpartyName: t.counterpartyName || t.counterpartyNickname || "Unknown",
                note: t.note || t.bankDescription || null,
                status: t.status || "completed",
                kind: t.kind || t.type || null,
                createdAt: t.createdAt || t.postedAt || t.estimatedDeliveryDate || null,
                dashboardLink: t.dashboardLink || null,
              }));
            }
          } catch {
            account.recentTransactions = [];
          }
        }

        const totalBalance = mercuryAccounts.reduce((s, a) => s + (a.currentBalance || 0), 0);
        results.mercury = { accounts: mercuryAccounts, totalBalance };
      }
    } catch (err) {
      results.errors.push(`Mercury: ${err.message}`);
    }
  }

  // ── Stripe: balance + pending payouts + recent payouts ──
  const stripeKey = process.env.stripe_secret_key || process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    try {
      const stripe = require("stripe")(stripeKey);

      // Get Stripe balance
      const balance = await stripe.balance.retrieve();
      const available = balance.available.reduce((s, b) => s + b.amount, 0) / 100;
      const pending = balance.pending.reduce((s, b) => s + b.amount, 0) / 100;
      const connectReserved = (balance.connect_reserved || []).reduce((s, b) => s + b.amount, 0) / 100;

      // Get recent payouts (to Mercury)
      let recentPayouts = [];
      try {
        const payouts = await stripe.payouts.list({ limit: 10 });
        recentPayouts = payouts.data.map(p => ({
          id: p.id,
          amount: p.amount / 100,
          currency: p.currency,
          status: p.status,
          type: p.type,
          method: p.method,
          arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
          created: new Date(p.created * 1000).toISOString(),
          description: p.description || null,
        }));
      } catch {}

      // Get any open disputes
      let openDisputes = [];
      try {
        const disputes = await stripe.disputes.list({ limit: 5 });
        openDisputes = disputes.data
          .filter(d => d.status !== "won" && d.status !== "lost")
          .map(d => ({
            id: d.id,
            amount: d.amount / 100,
            currency: d.currency,
            status: d.status,
            reason: d.reason,
            created: new Date(d.created * 1000).toISOString(),
            evidenceDueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null,
          }));
      } catch {}

      // Get recent charges summary (last 30 days volume)
      let last30DaysVolume = 0;
      let last30DaysCount = 0;
      let last30DaysFees = 0;
      try {
        const thirtyDaysAgo = Math.floor((Date.now() - 30 * 86400000) / 1000);
        const txns = await stripe.balanceTransactions.list({
          created: { gte: thirtyDaysAgo },
          limit: 100,
          type: "charge",
        });
        for (const t of txns.data) {
          last30DaysVolume += t.amount;
          last30DaysFees += t.fee;
          last30DaysCount++;
        }
      } catch {}

      results.stripe = {
        balance: { available, pending, connectReserved, total: available + pending },
        recentPayouts,
        openDisputes,
        last30Days: {
          volume: last30DaysVolume / 100,
          fees: last30DaysFees / 100,
          count: last30DaysCount,
          effectiveFeeRate: last30DaysVolume > 0 ? Math.round((last30DaysFees / last30DaysVolume) * 10000) / 100 : 0,
        },
      };
    } catch (err) {
      results.errors.push(`Stripe: ${err.message}`);
    }
  }

  // Return status about what's connected
  results.connected = {
    mercury: !!mercuryToken,
    stripe: !!stripeKey,
  };

  res.json(results);
});

module.exports = router;
