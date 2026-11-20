// ─── What care cost in the last 30 days, all in (v1.136.0) ───
//
// Pete, 11/18 and 11/20: "Per month spend is important ... how much the spend is in the previous
// 30 days. All in. Wages plus in place fees." "Monthly look back is more important to me and
// most often compared to other care options like nursing homes or memory care facilities."
//
// The old "Total Spend" read care_sessions.actual_cost/estimated_cost: the caregiver's pay only,
// no InPlace fee, no tips, no mileage, and only visits the viewer booked personally. This reads
// the ledger (src/utils/ledger.js) — one row per charge that actually happened — so it is what
// the card was charged, for every visit for the people this user can book care for.
//
// Pete, 11/20: just our numbers, no outside comparisons.

const DAY_MS = 24 * 60 * 60 * 1000;

function splitRow(row) {
  let b = null;
  try { b = row.breakdown ? JSON.parse(row.breakdown) : null; } catch { b = null; }
  const total = row.family_cents || 0;
  const toCaregiver = row.caregiver_cents || 0;
  let tips = 0;
  let mileage = 0;
  if (row.kind === "tip") tips = toCaregiver;
  else if (row.kind === "mileage") mileage = toCaregiver;
  else if (b && b.mileageCents) mileage = Math.min(b.mileageCents, toCaregiver);
  const wages = Math.max(0, toCaregiver - tips - mileage);
  // Fees are whatever the family paid that didn't go to the caregiver: InPlace's share plus any
  // card processing charged on top (tips, mileage). Derived, not summed from platform_cents +
  // card_fee_cents, because on a visit charge the card fee comes OUT of InPlace's share
  // (feedback_caregiver_gets_exact) and adding both would count it twice. This way the lines
  // always add up to the total Pete sees.
  return { total, wages, tips, mileage, fees: Math.max(0, total - toCaregiver) };
}

/** Pure: sum ledger rows into the tile's numbers (cents in, dollars out). */
function summarize(rows) {
  const c = { total: 0, wages: 0, tips: 0, mileage: 0, fees: 0 };
  const visits = new Set();
  for (const row of rows || []) {
    if (row.status !== "succeeded" || row.kind === "authorization") continue;
    const s = splitRow(row);
    for (const k of Object.keys(c)) c[k] += s[k];
    if (row.session_id && row.kind !== "tip") visits.add(row.session_id);
  }
  const out = { visits: visits.size };
  for (const k of Object.keys(c)) out[k] = Math.round(c[k]) / 100;
  return out;
}

/**
 * @param recipientIds the care recipients this user may book care for (they see the money)
 */
async function spendLast30(db, recipientIds, now = new Date()) {
  const ids = (recipientIds || []).filter(Boolean);
  const since = new Date(now.getTime() - 30 * DAY_MS);
  if (ids.length === 0) return { ...summarize([]), since: since.toISOString(), days: 30 };
  const rows = await db.prepare(`
    SELECT session_id, kind, status, family_cents, caregiver_cents, platform_cents, card_fee_cents, breakdown
      FROM ledger_entries
     WHERE care_recipient_id IN (${ids.map(() => "?").join(",")})
       AND created_at >= ?
  `).all(...ids, since.toISOString());
  return { ...summarize(rows), since: since.toISOString(), days: 30 };
}

module.exports = { spendLast30, summarize, splitRow };
