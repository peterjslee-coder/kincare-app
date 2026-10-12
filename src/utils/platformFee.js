/**
 * The platform's cut. (v1.106.16, per-family special rate v1.111.0)
 *
 * This function existed twice, byte-identical, in routes/sessions.js and routes/dashboard.js —
 * including the fallback of 20. Two copies of a money default is one edit away from the
 * dashboard quoting a different fee from the one the session actually charges, with nothing
 * to notice the divergence.
 *
 * ─── v1.111.0 — special rate ───
 *
 * Pete, 10/12: friends who bring their own caregiver relationships pay a reduced service fee
 * that just covers costs. "It's 20% as a default unless I go in and change their rate to
 * lower. Set the floor at 5%." The rate lives on the family's account
 * (users.special_fee_percent, set only from admin People) and applies to visits for any care
 * recipient that account owns, whoever on the team booked them.
 *
 * Which percent a visit uses, in order:
 *   1. care_sessions.platform_fee_percent — LOCKED when money first moves for the visit (the
 *      pre-shift hold, auto-pay, or checkout). Changing a family's rate afterwards never
 *      re-prices a visit that is already held or paid, so the hold and the capture agree.
 *   2. the special rate of the account that owns the visit's care recipient
 *   3. the special rate of the account that booked it (a visit with no recipient owner rate)
 *   4. the global platform_settings.platform_fee_percent (20 by default)
 *
 * Before money moves, a change to the family's rate applies to their upcoming visits too —
 * that is the point of tagging a family.
 */

// The value used when platform_settings has no row, or the read throws. Named so a change
// happens in one place and reads as a decision rather than a magic number in a catch block.
const DEFAULT_PLATFORM_FEE_PERCENT = 20;

// Pete, 10/12: "set the floor at 5%". Below roughly 4% Stripe's processing on a typical visit
// costs more than the fee brings in. Also enforced by a CHECK constraint (migration 055).
const SPECIAL_FEE_FLOOR_PERCENT = 5;

async function getGlobalPlatformFeePercent(db) {
  try {
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'platform_fee_percent'").get();
    const v = row ? parseFloat(row.value) : DEFAULT_PLATFORM_FEE_PERCENT;
    return Number.isFinite(v) ? v : DEFAULT_PLATFORM_FEE_PERCENT;
  } catch { return DEFAULT_PLATFORM_FEE_PERCENT; }
}

function finiteOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Defensive: the column has a CHECK constraint, but a money read never trusts one layer.
function specialOrNull(v) {
  const n = finiteOrNull(v);
  return n == null ? null : Math.max(SPECIAL_FEE_FLOOR_PERCENT, n);
}

/**
 * Everything needed to price many visits without a query per visit.
 * Special-rate families are a handful of rows, so this is two tiny reads.
 */
async function loadFeeTable(db) {
  const global = await getGlobalPlatformFeePercent(db);
  const byUser = new Map();
  const byRecipient = new Map();
  try {
    const users = await db.prepare(
      "SELECT id, special_fee_percent FROM users WHERE special_fee_percent IS NOT NULL"
    ).all();
    for (const u of users || []) {
      const pct = specialOrNull(u.special_fee_percent);
      if (pct != null) byUser.set(u.id, pct);
    }
    if (byUser.size) {
      const crs = await db.prepare(`
        SELECT cr.id, cr.family_user_id FROM care_recipients cr
        JOIN users u ON u.id = cr.family_user_id
        WHERE u.special_fee_percent IS NOT NULL
      `).all();
      for (const c of crs || []) {
        if (byUser.has(c.family_user_id)) byRecipient.set(c.id, byUser.get(c.family_user_id));
      }
    }
  } catch (e) {
    // A failed special-rate read must not take pricing down. It falls back to the default —
    // which over-charges a friend rather than under-charging everyone — and says so.
    try { require("./sentry").captureException(e, { where: "platformFee: special-rate read" }); } catch { /* ignore */ }
  }

  function pctFor(row = {}) {
    const locked = finiteOrNull(row.platform_fee_percent);
    if (locked != null) return locked;
    if (row.care_recipient_id && byRecipient.has(row.care_recipient_id)) return byRecipient.get(row.care_recipient_id);
    const payer = row.family_user_id || row.familyUserId || null;
    if (payer && byUser.has(payer)) return byUser.get(payer);
    return global;
  }

  return { global, byUser, byRecipient, pctFor };
}

/**
 * getPlatformFeePercent(db)          → the global default (marketing page, caregiver copy)
 * getPlatformFeePercent(db, ctx)     → the percent for one visit or one family
 *   ctx.sessionId                    — reads the session's lock, recipient and booker
 *   ctx.session                      — a care_sessions row already in hand (cs.* is enough)
 *   ctx.careRecipientId / ctx.familyUserId — before a session exists (cost preview)
 */
async function getPlatformFeePercent(db, ctx) {
  if (!ctx) return getGlobalPlatformFeePercent(db);
  let row = ctx.session ? { ...ctx.session } : {};
  const sessionId = ctx.sessionId || (ctx.session && ctx.session.id) || null;
  const needsRead = sessionId && (
    !ctx.session || !("platform_fee_percent" in ctx.session) || !("care_recipient_id" in ctx.session)
  );
  if (needsRead) {
    try {
      const s = await db.prepare(
        "SELECT platform_fee_percent, care_recipient_id, family_user_id FROM care_sessions WHERE id = ?"
      ).get(sessionId);
      // The database is the authority for the lock; the caller's row fills anything else.
      if (s) {
        row = {
          ...row,
          platform_fee_percent: s.platform_fee_percent,
          care_recipient_id: row.care_recipient_id || s.care_recipient_id,
          family_user_id: row.family_user_id || s.family_user_id,
        };
      }
    } catch { /* fall through to what we have */ }
  }
  if (ctx.careRecipientId && !row.care_recipient_id) row.care_recipient_id = ctx.careRecipientId;
  if (ctx.familyUserId && !row.family_user_id) row.family_user_id = ctx.familyUserId;
  const table = await loadFeeTable(db);
  return table.pctFor(row);
}

/**
 * Lock the percent onto the visit the first time money moves for it. Never overwrites an
 * existing lock — a capture after a hold must use the hold's percent.
 */
async function lockSessionFeePercent(db, sessionId, pct) {
  if (!sessionId || finiteOrNull(pct) == null) return;
  try {
    await db.prepare(
      "UPDATE care_sessions SET platform_fee_percent = ? WHERE id = ? AND platform_fee_percent IS NULL"
    ).run(Number(pct), sessionId);
  } catch (e) {
    try { require("./sentry").captureException(e, { where: "platformFee: lock", sessionId }); } catch { /* ignore */ }
  }
}

/**
 * SQL for the percent a care_sessions row (alias `cs` by default) is priced at — the same
 * order as pctFor, for reports that aggregate in Postgres. `globalPct` is a number read
 * server-side, never user input; it is still forced through Number() before interpolation.
 */
function feePercentSql(globalPct, alias = "cs") {
  const g = Number(globalPct);
  const safe = Number.isFinite(g) ? g : DEFAULT_PLATFORM_FEE_PERCENT;
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("bad alias");
  return `COALESCE(
      ${alias}.platform_fee_percent::float8,
      (SELECT sf_o.special_fee_percent::float8 FROM care_recipients sf_cr JOIN users sf_o ON sf_o.id = sf_cr.family_user_id WHERE sf_cr.id = ${alias}.care_recipient_id),
      (SELECT sf_b.special_fee_percent::float8 FROM users sf_b WHERE sf_b.id = ${alias}.family_user_id),
      ${safe}::float8)`;
}

module.exports = {
  getPlatformFeePercent,
  getGlobalPlatformFeePercent,
  loadFeeTable,
  lockSessionFeePercent,
  feePercentSql,
  DEFAULT_PLATFORM_FEE_PERCENT,
  SPECIAL_FEE_FLOOR_PERCENT,
};
