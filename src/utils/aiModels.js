// ─── Central AI model configuration ───
// Change these in Railway env vars when Anthropic retires a model version.
// No code deploy needed — just update the env var and restart.

const MODEL_SONNET = process.env.ANTHROPIC_MODEL_SONNET || "claude-sonnet-4-6";
const MODEL_HAIKU = process.env.ANTHROPIC_MODEL_HAIKU || "claude-haiku-4-5-20251001";

module.exports = { MODEL_SONNET, MODEL_HAIKU };
