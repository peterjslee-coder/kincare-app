/**
 * The platform's cut. (v1.106.16)
 *
 * This function existed twice, byte-identical, in routes/sessions.js and routes/dashboard.js —
 * including the fallback of 20. Two copies of a money default is one edit away from the
 * dashboard quoting a different fee from the one the session actually charges, with nothing
 * to notice the divergence.
 */

// The value used when platform_settings has no row, or the read throws. Named so a change
// happens in one place and reads as a decision rather than a magic number in a catch block.
const DEFAULT_PLATFORM_FEE_PERCENT = 20;

async function getPlatformFeePercent(db) {
  try {
    const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'platform_fee_percent'").get();
    return row ? parseFloat(row.value) : DEFAULT_PLATFORM_FEE_PERCENT;
  } catch { return DEFAULT_PLATFORM_FEE_PERCENT; }
}

module.exports = { getPlatformFeePercent, DEFAULT_PLATFORM_FEE_PERCENT };
