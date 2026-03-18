const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { parseSchedulingIntent, suggestMatches } = require("../utils/nlScheduling");

/**
 * POST /api/scheduling/natural
 * Parse natural language scheduling request and suggest matches
 *
 * Request body: { text: "Betty needs someone Tuesday afternoon..." }
 * Response: { intent, suggestions }
 */
router.post("/natural", authenticate, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text field required and must be a string" });
    }

    // Parse the natural language intent
    const parseResult = await parseSchedulingIntent(text, req.user.id);

    if (parseResult.error || !parseResult.intent) {
      return res.status(400).json({
        error: parseResult.error || "Failed to parse intent",
      });
    }

    // Suggest matching caregivers
    const matchResult = await suggestMatches(parseResult.intent, req.user.id);

    res.json({
      intent: parseResult.intent,
      suggestions: matchResult.suggestions,
      totalCandidates: matchResult.totalCandidates,
    });
  } catch (err) {
    console.error("[NL Scheduling] Route error:", err);
    res.status(500).json({ error: "Failed to process scheduling request" });
  }
});

module.exports = router;
