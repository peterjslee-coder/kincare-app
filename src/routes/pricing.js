const express = require("express");
const { getDb } = require("../models/database");
const { captureException } = require("../utils/sentry");
const { getPlatformFeePercent, DEFAULT_PLATFORM_FEE_PERCENT } = require("../utils/platformFee");

const router = express.Router();

// ─── GET /api/pricing — the fee, published, so the copy can stop hardcoding it ───
//
// Pete: "if I change that later, then when I do I don't want a bunch of old hard-coded 20s to
// wreak havoc." v1.106.18 made the QUOTE and the CHARGE agree by reading
// platform_settings.platform_fee_percent. The COPY still said 20 in six places, including the
// public splash page — which is read by people who are not logged in, so it needs a public
// number to read.
//
// Deliberately unauthenticated: this figure is already printed on the marketing page. It is
// also in VERSION_GATE_EXEMPT, for the same reason /api/version is — a client too old to pass
// the gate should still render a number rather than a gap.
//
// Lives in a router rather than inline on `app` so it can be mounted by the integration
// harness. A route defined directly in server.js cannot be integration-tested at all, which is
// most of why the money paths had no coverage.
router.get("/", async (req, res) => {
  try {
    const db = await getDb();
    const platformFeePercent = await getPlatformFeePercent(db);
    // Short cache: the number changes when an admin moves it, which is rare, and every
    // logged-out visitor hits this.
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      platformFeePercent,
      // Derived, never stored. "Caregivers keep 80%" is the same fact said the other way, and
      // two stored numbers is how it drifts.
      caregiverSharePercent: 100 - platformFeePercent,
    });
  } catch (e) {
    captureException(e, { where: "GET /api/pricing" });
    res.json({
      platformFeePercent: DEFAULT_PLATFORM_FEE_PERCENT,
      caregiverSharePercent: 100 - DEFAULT_PLATFORM_FEE_PERCENT,
    });
  }
});

module.exports = router;
