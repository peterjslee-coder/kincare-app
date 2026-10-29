/**
 * v1.122.0 — recorded outreach calls → transcript → iPAi notes → "OK to text", with evidence.
 *
 * Pete, 10/15, after carriers rejected the outreach campaign (a public list of caregivers seeking
 * work is not consent to text): "Fine. I'll call them each from the app. Prepare a script that we
 * can use as part of the proof ... I want something to record the transcript as evidence as well.
 * And I want iPAi to fill out the notes per call and mark them appropriately."
 *
 * So every call from Admin → Outreach is recorded (no announcement since v1.122.5 — one-party consent),
 * transcribed (ElevenLabs, the existing vendor — utils/transcription.js), and read by iPAi, which
 * writes the notes and the outcome. iPAi may mark texts OK ONLY when the transcript shows the
 * consent question and a clear yes, and it must quote the yes; the server checks the quote really
 * is in the transcript before believing it. The quote, the transcript and the recording are the
 * evidence. Nothing about consent is inferred.
 */
const AI = require("./aiModels"); // property access at call time, so tests can stub it


/**
 * v1.124.1 — the call ends by inviting them to text JOIN. Carriers rejected the outreach campaign
 * twice on the CTA; a yes on a phone call is something a reviewer cannot verify, a keyword text is.
 * So texting opens ONLY when they text the number themselves (JOIN or anything else) — never from
 * the call. Pete, 10/19: "go ahead with that."
 */
const JOIN_ASK =
  "If you'd like the details, just text JOIN to this number, 540-835-5987, and I'll send you everything. " +
  "Message and data rates may apply, and you can reply STOP any time.";

/**
 * v1.125.8 — Pete, 10/28: "update the privacy policy and clearly state that if the transcript shows
 * they agree to a text, we will reach out to them that way, only after a recorded call." So the call
 * asks the question he actually asks, and a clear yes on the RECORDED call is an opt-in (recorded as
 * his OK against that call — routes/outreach.js PATCH textsOk). Texting JOIN still works too.
 */
const TEXT_ASK =
  "Is it OK if I text you some more information from this number, 540-835-5987? " +
  "Message and data rates may apply, and you can reply STOP any time.";

/**
 * The voicemail, in Pete's own live voice (never a pre-recorded drop — automated voice to a cell
 * phone needs prior consent under the TCPA). It asks them to text first: their text is their
 * opt-in, and most people never pick up. Pete, 10/15: "They may actually respond to a text if I
 * said, I'm calling about your interest in caregiving work."
 */
const VOICEMAIL_SCRIPT =
  "Hi {first}, this is Pete with InPlace Care. I'm calling about your interest in caregiving work — " +
  "the Agency on Aging has you listed as looking for private-pay clients. If you're still looking, just text " +
  "JOIN to this number, 540-835-5987, and I'll send you the details. Thanks!";

/** Pete's call script — shown in the thread during a call, and published as proof. */
const CALL_SCRIPT = [
  { note: "Voicemail? Leave this, in your own voice:", branch: "voicemail" },
  { say: VOICEMAIL_SCRIPT, branch: "voicemail" },
  { say: "Hi {first}, this is Pete with InPlace Care. I'm calling about your interest in caregiving work — the Agency on Aging has you listed as looking for private-pay clients. Is that still something you're looking for?" },
  { note: "“No thank you”: “No problem, thanks for your time.” End the call. (iPAi marks them Declined; they're never texted.)" },
  { say: "InPlace connects local families with independent caregivers. You set your own rate and keep all of it; the family pays through the app and you're paid after each visit." },
  { say: TEXT_ASK, consent: true },
  { note: "A clear yes → after the call, Record OK from the call (it's saved with this recording). Not sure? “You can also text JOIN to this number any time.” Don't want texts? “No problem — can I email you instead?”" },
  { say: "Thanks for your time, {first}." },
];

const OUTCOMES = ["interested", "not_interested", "call_back", "wrong_number", "voicemail", "no_conversation"];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** True only if every word of the quote appears, in order, contiguously, in the transcript. */
function quoteInTranscript(quote, transcript) {
  const q = norm(quote);
  return q.length >= 2 && norm(transcript).includes(q);
}

/**
 * Transcript → { summary, outcome, textsOk, consentQuote, email, availability, area, experience, nextStep }
 * or null when AI is unavailable / the reply is unusable. textsOk is only ever true with a quote
 * that is verifiably in the transcript.
 */
async function analyzeCall(transcript, { first = "the caregiver" } = {}) {
  const client = AI.getAnthropic();
  if (!client) return null;
  const prompt = `You are reading the transcript of a recruiting phone call. Pete Lee of InPlace Care called ${first}, a caregiver listed as looking for private-pay work. Two voices are on the call.

Write Pete's notes. Report only what was SAID; never guess. If Pete only left a voicemail, the outcome is "voicemail". If the other person hung up or no real conversation happened, it is "no_conversation". "No thank you" or similar is "not_interested".

"texts_ok" decides whether InPlace may text this person. Set it true ONLY if, in the transcript, Pete asked whether InPlace may text them ((for example, whether InPlace may text them)) AND the other person clearly agreed. If the question was not asked, the answer was unclear, conditional, or no, set it false. When true, "consent_quote" must be the other person's exact words of agreement copied from the transcript (a few words, verbatim); otherwise null.

Return ONLY valid JSON:
{
  "summary": "2-3 sentences",
  "outcome": one of ${JSON.stringify(OUTCOMES)},
  "texts_ok": true | false,
  "consent_quote": string | null,
  "email": string | null,
  "availability": string | null,
  "area": string | null,
  "experience": string | null,
  "next_step": string | null
}

Transcript:
${String(transcript).slice(0, 30000)}`;
  try {
    const r = await client.messages.create({ model: AI.MODEL_SONNET, max_tokens: 800, messages: [{ role: "user", content: prompt }] });
    const raw = (r.content || []).map((c) => c.text || "").join("").trim();
    const p = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const str = (v, n = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    const quote = str(p.consent_quote, 200);
    const email = str(p.email, 200);
    return {
      summary: str(p.summary, 800) || "",
      outcome: OUTCOMES.includes(p.outcome) ? p.outcome : "no_conversation",
      textsOk: p.texts_ok === true && !!quote && quoteInTranscript(quote, transcript),
      consentQuote: quote,
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null,
      availability: str(p.availability),
      area: str(p.area),
      experience: str(p.experience),
      nextStep: str(p.next_step),
    };
  } catch {
    return null;
  }
}

/** Outcome → contact status, only moving forward from early states. */
function statusFor(outcome, current) {
  if (!["new", "texted", "replied", "interested"].includes(current)) return current;
  if (outcome === "interested") return current === "interested" ? current : "interested";
  if (outcome === "not_interested") return "declined";
  if (outcome === "wrong_number") return "wrong_number";
  return current;
}

module.exports = { JOIN_ASK, TEXT_ASK, CALL_SCRIPT, VOICEMAIL_SCRIPT, OUTCOMES, analyzeCall, quoteInTranscript, statusFor };
