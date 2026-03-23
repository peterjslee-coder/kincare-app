/**
 * Document AI — Claude-powered document classification & verification
 *
 * Uses Anthropic Claude Sonnet with vision to classify uploaded documents,
 * detect fraud (e.g., a burger wrapper claimed as a POA), extract metadata,
 * and flag concerns for human review.
 *
 * Never auto-rejects — flags for admin review. AI approval still requires
 * admin sign-off for consent documents.
 */

const { MODEL_SONNET } = require("./aiModels");

const SYSTEM_PROMPT = `You are a document verification specialist for a care coordination platform called InPlace. Your job is to examine uploaded documents and classify them accurately.

You will receive:
1. An image or PDF of a document
2. The document type the uploader CLAIMS it is (e.g., "POA", "DL_Front", "CNA")

Your task:
- Determine what the document ACTUALLY is
- Assess whether it matches the claimed type
- Extract key fields (names, dates, expiration, issuing authority)
- Flag any concerns (blurry, expired, wrong document type, not a real document)

IMPORTANT: Be vigilant for fraud. People may upload random images (food wrappers, screenshots, blank pages) and claim they are legal documents. If the image is clearly not the claimed document type, say so clearly.

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "classification": "one of: drivers_license, POA, healthcare_POA, court_order, CNA_cert, CPR_cert, HHA_cert, LPN_cert, RN_cert, BLS_cert, insurance_card, medical_record, birth_certificate, social_security, other_legal, other_certification, not_a_document, unreadable",
  "confidence": 0.0 to 1.0,
  "isValid": true or false,
  "matchesClaimed": true or false,
  "extractedFields": {
    "name": "person name if visible",
    "dateOfBirth": "if visible",
    "expirationDate": "if visible",
    "issuingAuthority": "state, org, or body that issued it",
    "documentNumber": "license/cert number if visible",
    "notarizedDate": "if applicable",
    "grantor": "for POA documents",
    "agent": "for POA documents"
  },
  "concerns": ["array of strings describing any issues"],
  "summary": "One-sentence plain English description of what this document is"
}`;

/**
 * Classify a document using Claude's vision capability
 *
 * @param {string} base64Data - Full data URI (data:mime;base64,...) or raw base64
 * @param {string} mimeType - MIME type of the file
 * @param {string} expectedType - What the uploader claims this document is
 * @returns {Object} Classification result
 */
async function classifyDocument(base64Data, mimeType, expectedType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set — skipping AI document classification");
    return {
      classification: "skipped",
      confidence: 0,
      isValid: false,
      matchesClaimed: false,
      extractedFields: {},
      concerns: ["AI classification unavailable — manual review required"],
      summary: "AI classification skipped (API key not configured)",
      skipped: true,
    };
  }

  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    // Strip data URI prefix if present to get raw base64
    const rawBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");

    // Map MIME type for Claude's vision API
    const mediaType = mimeType === "application/pdf" ? "application/pdf" :
      mimeType.startsWith("image/") ? mimeType : "image/jpeg";

    // For PDFs, Claude accepts them as document type
    const sourceType = mimeType === "application/pdf" ? "base64" : "base64";

    const content = [
      {
        type: mimeType === "application/pdf" ? "document" : "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: rawBase64,
        },
      },
      {
        type: "text",
        text: `The uploader claims this is: "${expectedType}"\n\nPlease classify this document and respond with ONLY a JSON object.`,
      },
    ];

    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    // Parse the response
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    // Try to parse JSON from the response (handle markdown code fences just in case)
    let result;
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("AI response parse error:", parseErr.message, "Raw:", text.substring(0, 200));
      return {
        classification: "parse_error",
        confidence: 0,
        isValid: false,
        matchesClaimed: false,
        extractedFields: {},
        concerns: ["AI response could not be parsed — manual review required"],
        summary: "AI classification returned unparseable response",
        rawResponse: text.substring(0, 500),
      };
    }

    // Ensure all expected fields exist
    return {
      classification: result.classification || "unknown",
      confidence: typeof result.confidence === "number" ? result.confidence : 0,
      isValid: !!result.isValid,
      matchesClaimed: !!result.matchesClaimed,
      extractedFields: result.extractedFields || {},
      concerns: Array.isArray(result.concerns) ? result.concerns : [],
      summary: result.summary || "No summary provided",
    };
  } catch (err) {
    console.error("AI document classification error:", err.message);
    return {
      classification: "error",
      confidence: 0,
      isValid: false,
      matchesClaimed: false,
      extractedFields: {},
      concerns: [`AI classification failed: ${err.message}`],
      summary: "AI classification encountered an error",
      error: true,
    };
  }
}

module.exports = { classifyDocument };
