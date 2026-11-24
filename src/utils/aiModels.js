// ─── Central AI model configuration ───
// Change these in Railway env vars when Anthropic retires a model version.
// No code deploy needed — just update the env var and restart.

const MODEL_SONNET = process.env.ANTHROPIC_MODEL_SONNET || "claude-sonnet-4-6";
const MODEL_HAIKU = process.env.ANTHROPIC_MODEL_HAIKU || "claude-haiku-4-5-20251001";

// ─── v1.106.10 — one client, with a deadline ───
//
// Eleven route paths did `new Anthropic({ apiKey })` and got the SDK's defaults: a TEN MINUTE
// timeout with two retries. That is up to half an hour on one request, holding an Express
// handler, its socket, its worker slot and any pool client it took — the same shape as the
// hang v1.105.50 bounded on the inbound side, arriving from the other direction. Four utils
// already passed `{ timeout: 30000, maxRetries: 1 }`; this makes that the only way to get a
// client, so a twelfth call site cannot quietly get the ten-minute default.
//
// 30s and one retry: an iPAi reply that has not started after half a minute is not coming
// back in a form anyone still wants, and a person waiting on a screen is the real deadline.
const AI_TIMEOUT_MS = 30000;
const AI_MAX_RETRIES = 1;

/**
 * @param {string} [apiKey] defaults to ANTHROPIC_API_KEY
 * @returns {import("@anthropic-ai/sdk").default | null} null when no key is configured, so
 *          callers keep their existing "AI not available" branch rather than throwing.
 */
function getAnthropic(apiKey = process.env.ANTHROPIC_API_KEY) {
  if (!apiKey) return null;
  const Anthropic = require("@anthropic-ai/sdk");
  return new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES });
}

module.exports = { MODEL_SONNET, MODEL_HAIKU, getAnthropic, AI_TIMEOUT_MS, AI_MAX_RETRIES };
