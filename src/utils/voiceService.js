/**
 * Voice Service — ElevenLabs TTS provider abstraction
 *
 * Wraps ElevenLabs so the rest of the app just calls:
 *   generateSpeech(text, voiceId, options)  → Buffer (mp3 audio)
 *   listVoices()                            → [{ voice_id, name, ... }]
 *   getVoice(voiceId)                       → { voice_id, name, ... }
 *
 * Env vars:
 *   ELEVENLABS_API_KEY  — required
 *
 * All functions throw on error with descriptive messages.
 * Audio is returned as a Buffer — caller decides whether to stream, save, or pipe to response.
 */

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

// Default voice settings tuned for elder care clarity
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.8,
  style: 0.0,
  use_speaker_boost: true,
};

// Default model — eleven_multilingual_v2 is the current best for natural speech
const DEFAULT_MODEL = "eleven_multilingual_v2";

function getApiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY not set. Add it to Railway env vars.");
  }
  return key;
}

/**
 * Generate speech audio from text.
 *
 * @param {string} text - The text to speak
 * @param {string} voiceId - ElevenLabs voice_id (cloned or preset)
 * @param {object} [options] - Override defaults
 * @param {number} [options.speed] - Speaking speed 0.7–1.2 (default 1.0)
 * @param {number} [options.stability] - Voice consistency 0.0–1.0
 * @param {number} [options.similarity_boost] - Clone fidelity 0.0–1.0
 * @param {string} [options.model] - ElevenLabs model ID
 * @param {string} [options.output_format] - mp3_44100_128 (default), pcm_16000, etc.
 * @returns {Promise<Buffer>} MP3 audio data
 */
async function generateSpeech(text, voiceId, options = {}) {
  const apiKey = getApiKey();

  if (!text || !text.trim()) {
    throw new Error("generateSpeech: text is required");
  }
  if (!voiceId) {
    throw new Error("generateSpeech: voiceId is required");
  }

  const {
    speed = 1.0,
    stability = DEFAULT_VOICE_SETTINGS.stability,
    similarity_boost = DEFAULT_VOICE_SETTINGS.similarity_boost,
    style = DEFAULT_VOICE_SETTINGS.style,
    use_speaker_boost = DEFAULT_VOICE_SETTINGS.use_speaker_boost,
    model = DEFAULT_MODEL,
    output_format = "mp3_44100_128",
  } = options;

  const url = `${ELEVENLABS_BASE}/text-to-speech/${voiceId}?output_format=${output_format}`;

  const body = {
    text: text.trim(),
    model_id: model,
    voice_settings: {
      stability,
      similarity_boost,
      style,
      use_speaker_boost,
    },
  };

  // Speed is only supported on certain models — include if non-default
  if (speed !== 1.0) {
    body.voice_settings.speed = speed;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail?.message || errJson.detail || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text().catch(() => "unknown error");
    }
    throw new Error(
      `ElevenLabs TTS failed (${response.status}): ${errorDetail}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Stream speech audio (for real-time playback).
 * Returns a ReadableStream instead of buffering the entire response.
 *
 * @param {string} text - The text to speak
 * @param {string} voiceId - ElevenLabs voice_id
 * @param {object} [options] - Same as generateSpeech
 * @returns {Promise<ReadableStream>} Audio stream
 */
async function streamSpeech(text, voiceId, options = {}) {
  const apiKey = getApiKey();

  if (!text || !text.trim()) {
    throw new Error("streamSpeech: text is required");
  }
  if (!voiceId) {
    throw new Error("streamSpeech: voiceId is required");
  }

  const {
    speed = 1.0,
    stability = DEFAULT_VOICE_SETTINGS.stability,
    similarity_boost = DEFAULT_VOICE_SETTINGS.similarity_boost,
    style = DEFAULT_VOICE_SETTINGS.style,
    use_speaker_boost = DEFAULT_VOICE_SETTINGS.use_speaker_boost,
    model = DEFAULT_MODEL,
    output_format = "mp3_44100_128",
  } = options;

  const url = `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream?output_format=${output_format}`;

  const body = {
    text: text.trim(),
    model_id: model,
    voice_settings: {
      stability,
      similarity_boost,
      style,
      use_speaker_boost,
    },
  };

  if (speed !== 1.0) {
    body.voice_settings.speed = speed;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = errJson.detail?.message || errJson.detail || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text().catch(() => "unknown error");
    }
    throw new Error(
      `ElevenLabs TTS stream failed (${response.status}): ${errorDetail}`
    );
  }

  return response.body;
}

/**
 * List all available voices (cloned + preset).
 * @returns {Promise<Array>} Array of voice objects
 */
async function listVoices() {
  const apiKey = getApiKey();

  const response = await fetch(`${ELEVENLABS_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs listVoices failed (${response.status})`);
  }

  const data = await response.json();
  return data.voices || [];
}

/**
 * Get details for a specific voice.
 * @param {string} voiceId
 * @returns {Promise<object>} Voice details
 */
async function getVoice(voiceId) {
  const apiKey = getApiKey();

  const response = await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs getVoice failed (${response.status})`);
  }

  return response.json();
}

/**
 * Get current subscription/usage info (credits remaining, etc.)
 * @returns {Promise<object>} Subscription info
 */
async function getUsage() {
  const apiKey = getApiKey();

  const response = await fetch(`${ELEVENLABS_BASE}/user/subscription`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs getUsage failed (${response.status})`);
  }

  return response.json();
}

module.exports = {
  generateSpeech,
  streamSpeech,
  listVoices,
  getVoice,
  getUsage,
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_MODEL,
};
