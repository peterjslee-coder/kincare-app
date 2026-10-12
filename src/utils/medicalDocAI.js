// ─── iPAi review of ONE medical document → suggestions a human accepts or dismisses ───
//
// Pete's AI rule, which this file exists to keep: the app never generates medical or treatment
// information unless the person has acknowledged — at the point of generation — that iPAi is
// not medical care and can only reflect what it was given. So:
//
//   · The model reads ONE document and may return ONLY items literally written in it, each
//     with a verbatim quote as evidence. No outside medical knowledge, no inference, no
//     dosing advice, no interpretation of results.
//   · The same constraint is shown to the user beside every suggestion (DocumentsCenter.js).
//   · Output is a SUGGESTION. Nothing is created until a person taps Accept.
//   · AI-derived output is never ground truth for another AI document: suggestions are never
//     fed back into this prompt or any other.
//   · The route only calls this when the iPAi key is ON (medicalAccess.aiConsentOn).
const { MODEL_SONNET, getAnthropic } = require("./aiModels");

const KINDS = ["appointment", "medication", "review_item"];

const SYSTEM_PROMPT = `You read ONE document a family uploaded about their loved one and list items that are LITERALLY WRITTEN in it, so the family can review them. You are not a clinician and you do not give medical advice.

Rules — follow every one:
- Use ONLY what is written in this document. Do not use outside medical knowledge. Do not infer, interpret, diagnose, explain results, or fill gaps.
- Never suggest, change, or comment on doses, timing, or whether a medication is appropriate. Copy medications exactly as listed.
- Every item MUST include "source_quote": an exact, verbatim excerpt from the document (max 300 characters) that shows the item is written there. If you cannot quote it, leave the item out.
- Kinds:
  - "appointment": a follow-up visit, test, or appointment the document says should happen. "suggested_date" = the date in YYYY-MM-DD ONLY if the document states an explicit calendar date; otherwise null. Do not compute relative dates.
  - "medication": a medication as listed in the document (name and the instructions exactly as written).
  - "review_item": an instruction the document gives that the family may want to read (e.g. "call if fever over 101").
- If the document contains none of these, return an empty list.

Respond with ONLY a JSON object, no prose, no code fences:
{"items":[{"kind":"appointment|medication|review_item","title":"short label copied from the document","detail":"what the document says, copied as closely as possible, or null","source_quote":"verbatim excerpt","suggested_date":"YYYY-MM-DD or null"}]}`;

function clean(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    if (!KINDS.includes(it.kind)) continue;
    const quote = String(it.source_quote || "").trim();
    const title = String(it.title || "").trim();
    if (!quote || !title) continue; // no evidence, no suggestion
    const date = /^\d{4}-\d{2}-\d{2}$/.test(it.suggested_date || "") && it.kind === "appointment" ? it.suggested_date : null;
    out.push({
      kind: it.kind,
      title: title.slice(0, 200),
      detail: it.detail ? String(it.detail).trim().slice(0, 1000) : null,
      source_quote: quote.slice(0, 400),
      suggested_date: date,
    });
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * @param {string} dataUri data:<mime>;base64,... (already resolved from storage)
 * @param {string} mimeType
 * @returns {Promise<{items: object[]} | {skipped: true, reason: string} | {error: true, reason: string}>}
 */
async function extractSuggestions(dataUri, mimeType) {
  const client = getAnthropic(); // 30s timeout, 1 retry (aiModels.js)
  if (!client) return { skipped: true, reason: "iPAi isn't configured on this server, so documents can't be reviewed right now." };
  const isPdf = mimeType === "application/pdf";
  if (!isPdf && !/^image\/(jpeg|png|gif|webp)$/.test(mimeType || "")) {
    return { error: true, reason: "iPAi can only read PDF and image documents." };
  }
  try {
    const raw = String(dataUri || "").replace(/^data:[^;]+;base64,/, "");
    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: isPdf ? "document" : "image", source: { type: "base64", media_type: mimeType, data: raw } },
          { type: "text", text: "List only the items literally written in this document, each with a verbatim source_quote. JSON only." },
        ],
      }],
    });
    const text = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed;
    try { parsed = JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()); } catch {
      return { error: true, reason: "iPAi's answer couldn't be read. Nothing was saved — please try again." };
    }
    return { items: clean(parsed && parsed.items) };
  } catch (err) {
    console.error("[medicalDocAI] review failed:", err.message);
    return { error: true, reason: "iPAi couldn't review this document right now. Nothing was saved — please try again." };
  }
}

module.exports = { extractSuggestions, SYSTEM_PROMPT, _clean: clean };
