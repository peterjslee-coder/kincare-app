/**
 * InPlace — Twilio Video/Voice Call Routes
 *
 * Generates Twilio Video Access Tokens for in-app video and voice calls.
 * Voice calls use Twilio Video rooms with camera off (no separate Voice SDK needed).
 *
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET env vars.
 * If not configured, returns 503 gracefully.
 */

const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { v4: uuid } = require("uuid");

/**
 * POST /api/video/token
 * Generate a Twilio Video Access Token for a room.
 * Body: { roomName: string }
 * Returns: { token: string, roomName: string }
 */
router.post("/token", authenticate, async (req, res) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || !apiKeySid || !apiKeySecret) {
    return res.status(503).json({ error: "Video calling is not configured on this server" });
  }

  const { roomName } = req.body;
  if (!roomName) {
    return res.status(400).json({ error: "roomName is required" });
  }

  try {
    const twilio = require("twilio");
    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity: req.user.id,
      ttl: 3600, // 1 hour
    });

    const videoGrant = new VideoGrant({ room: roomName });
    token.addGrant(videoGrant);

    res.json({
      token: token.toJwt(),
      roomName,
      identity: req.user.id,
    });
  } catch (err) {
    console.error("[video] Token generation error:", err.message);
    res.status(500).json({ error: "Failed to generate video token" });
  }
});

module.exports = router;
