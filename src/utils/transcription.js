/**
 * Turning an appointment recording into care notes. (v1.106.32)
 *
 * Pete, twice on the same day: "Would like to have a smart transcription feature that could
 * record and put notes in automatically" / "AI transcription of the meeting to add salient
 * points would be super useful here." He chose: record in the app, transcribe, then delete
 * the audio.
 *
 * THE AUDIO IS NEVER STORED. Not "deleted after" — never written. It arrives in memory
 * (multer.memoryStorage), goes straight to the transcriber, and the buffer goes out of scope.
 * There is no row, no R2 object, no temp file, and therefore nothing to leak, subpoena, or
 * forget to purge. A recording of a medical consultation is the most sensitive thing this
 * product could hold, and the safest version of holding it is not holding it.
 *
 * NO NEW VENDOR. ElevenLabs is already the TTS provider for the Kindred companion voice and
 * ELEVENLABS_API_KEY is already in Railway. Their speech-to-text is the same key and the same
 * billing relationship, so this adds a capability rather than a third party. It also
 * diarizes — speaker_id per word — which is what makes "what the doctor said" separable from
 * "what Pete asked".
 */
const { MODEL_SONNET, getAnthropic } = require("./aiModels");

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || "scribe_v2";

// A doctor's visit is twenty minutes, not two hours. The cap is here so a runaway recording
// cannot turn into an unbounded upload and an unbounded bill.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

class TranscriptionError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * Audio buffer → transcript. Returns { text, languageCode, speakers }.
 * Throws TranscriptionError with a status the route can hand to res.
 */
async function transcribeAudio(buffer, mimeType = "audio/webm", filename = "appointment.webm") {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new TranscriptionError("Transcription is not configured on this server.", 503);
  if (!buffer || !buffer.length) throw new TranscriptionError("No audio received.", 400);
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new TranscriptionError("That recording is too long — keep it under about 25 MB.", 413);
  }

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), filename);
  form.append("model_id", STT_MODEL);
  // Diarization is the point: it separates the clinician from the family in the transcript,
  // which is what makes the extracted notes attributable rather than a wall of text.
  form.append("diarize", "true");

  let res;
  try {
    res = await fetch(`${ELEVENLABS_BASE}/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
      // Long enough for a 20-minute recording, short enough that a hung request does not
      // hold an Express handler indefinitely — the v1.106.10 lesson, from the other side.
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    throw new TranscriptionError(
      e.name === "TimeoutError" ? "Transcription timed out — try a shorter recording." : "Could not reach the transcription service.",
      504
    );
  }

  if (!res.ok) {
    // Never echo the provider's body: it can contain the audio's own content in an error.
    throw new TranscriptionError(`Transcription failed (${res.status}).`, 502);
  }

  const data = await res.json();
  const text = (data.text || "").trim();
  if (!text) throw new TranscriptionError("Nothing was said in that recording.", 422);

  const speakers = new Set();
  for (const w of data.words || []) if (w.speaker_id) speakers.add(w.speaker_id);

  return { text, languageCode: data.language_code || null, speakers: speakers.size };
}

/**
 * Transcript → the handful of things somebody actually needs to remember.
 *
 * Returns { summary, items[] } where items are {kind, text}: medication, follow-up,
 * instruction, or observation. Deliberately NOT a diagnosis and NOT advice — the model is
 * told to report what was said, not to interpret it, because this becomes part of a care
 * record that people act on.
 */
async function extractAppointmentNotes(transcript, { recipientFirstName = "the patient" } = {}) {
  const client = getAnthropic();
  if (!client) return null; // caller keeps the plain transcript

  const prompt = `You are reading a transcript of a medical appointment for ${recipientFirstName}, recorded by a family member who was there.

Pull out only what someone would need to remember afterwards. Report what was SAID. Do not diagnose, do not add advice that was not given, and do not infer anything the transcript does not state. If the transcript is too garbled or too short to be useful, say so in the summary and return an empty items array.

Return ONLY valid JSON, no prose around it:
{
  "summary": "two or three sentences, plain language",
  "items": [
    {"kind": "medication" | "follow_up" | "instruction" | "observation", "text": "one specific thing that was said"}
  ]
}

Transcript:
${transcript.slice(0, 40000)}`;

  try {
    const result = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = (result.content || []).map((c) => c.text || "").join("").trim();
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json);
    const KINDS = ["medication", "follow_up", "instruction", "observation"];
    return {
      summary: String(parsed.summary || "").trim(),
      items: (Array.isArray(parsed.items) ? parsed.items : [])
        .filter((i) => i && typeof i.text === "string" && i.text.trim())
        .map((i) => ({
          kind: KINDS.includes(i.kind) ? i.kind : "observation",
          text: String(i.text).trim().slice(0, 500),
        }))
        .slice(0, 25),
    };
  } catch {
    // The transcript is the valuable part and it is already in hand. A failed extraction
    // must not lose it — the caller files the transcript either way.
    return null;
  }
}

module.exports = { transcribeAudio, extractAppointmentNotes, TranscriptionError, MAX_AUDIO_BYTES };
