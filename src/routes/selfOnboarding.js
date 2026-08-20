/**
 * Self-Onboarding Routes for Care Recipients (Tier 1 users)
 *
 * Handles care_for role users through identity verification and setup
 */

const express = require("express");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { classifyDocument } = require("../utils/documentAI");
const { identityDecision, verdictLabel, VERDICT } = require("../utils/identityDecision");
const { MODEL_SONNET } = require("../utils/aiModels");
const storage = require("../utils/storage"); // v1.91.0 — env-gated R2 offload for document blobs
const router = express.Router();

/**
 * Compare a selfie to the photo on an ID using Claude vision.
 * Returns { similar: boolean, confidence: 0-1, explanation: string }
 */
async function compareFaces(selfieBase64, idPhotoBase64) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { similar: false, confidence: 0, explanation: "AI comparison unavailable", skipped: true };
  }

  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const stripDataUri = (d) => d.replace(/^data:[^;]+;base64,/, "");
    const getMime = (d) => { const m = d.match(/^data:([^;]+);/); return m ? m[1] : "image/jpeg"; };

    const response = await client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 512,
      system: `You are a visual verification assistant for a care coordination platform. You will be shown two images: a selfie and a government ID photo. Your task is to assess whether they appear to be the same person.

Consider: general facial structure, approximate age range, and overall appearance. You are NOT performing biometric identification — just a basic visual plausibility check. Err on the side of caution: if it's ambiguous, say so.

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "similar": true or false,
  "confidence": 0.0 to 1.0,
  "explanation": "Brief reason for your assessment"
}`,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: getMime(selfieBase64), data: stripDataUri(selfieBase64) } },
          { type: "image", source: { type: "base64", media_type: getMime(idPhotoBase64), data: stripDataUri(idPhotoBase64) } },
          { type: "text", text: "Image 1 is the selfie taken just now. Image 2 is the government ID. Do these appear to be the same person?" },
        ],
      }],
    });

    const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const result = JSON.parse(cleaned);

    return {
      similar: !!result.similar,
      confidence: typeof result.confidence === "number" ? result.confidence : 0,
      explanation: result.explanation || "",
    };
  } catch (err) {
    console.error("Face comparison error:", err.message);
    return { similar: false, confidence: 0, explanation: `Comparison failed: ${err.message}`, error: true };
  }
}

// ─── POST /api/self-onboarding/verify-id ───
// Verify identity by comparing selfie to government ID
// Accepts JSON body with base64 data URIs: { idPhoto: "data:image/jpeg;base64,...", selfie?: "data:..." }
router.post("/verify-id", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const { idPhoto: idPhotoBase64, selfie: selfieBase64 } = req.body;

    if (!idPhotoBase64) {
      return res.status(400).json({ error: "ID photo is required" });
    }

    // Get the user's name from registration
    const user = await db.prepare(
      "SELECT first_name, last_name FROM users WHERE id = ?"
    ).get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get the care_recipient record (if one exists for this user)
    const careRecipient = await db.prepare(
      "SELECT id FROM care_recipients WHERE linked_user_id = ?"
    ).get(req.user.id);

    // Determine document owner — care_recipient if linked, otherwise the user directly
    const ownerId = careRecipient ? careRecipient.id : req.user.id;
    const ownerType = careRecipient ? 'care_recipient' : 'user';

    // Extract mimetype from data URI (e.g. "data:image/jpeg;base64,..." → "image/jpeg")
    const mimeMatch = idPhotoBase64.match(/^data:([^;]+);/);
    const mimetype = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // Classify the ID document using Claude
    const classifyResult = await classifyDocument(
      idPhotoBase64,
      mimetype,
      "Identity"
    );

    // Extract verification data from AI classification
    const extractedName = classifyResult.extractedFields?.name || '';
    const extractedDOB = classifyResult.extractedFields?.dateOfBirth || '';
    const expiryDate = classifyResult.extractedFields?.expirationDate || '';
    const issuingAuthority = classifyResult.extractedFields?.issuingAuthority || '';

    // Build merged concerns list: AI concerns + our own checks
    const allConcerns = [...(classifyResult.concerns || [])];

    // Check if name matches (fuzzy: last name must appear somewhere)
    const registeredName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    const userLastName = (user.last_name || '').toLowerCase().trim();
    const extractedLastName = extractedName.split(' ').pop().toLowerCase().trim();
    const nameMatched = extractedLastName === userLastName ||
                        extractedName.toLowerCase().includes(userLastName);

    if (!nameMatched && extractedName) {
      allConcerns.unshift(`Name mismatch: account registered as "${registeredName}" but ID shows "${extractedName}"`);
    }

    // Check DOB match if we have both (only for care_recipients who have DOB on file)
    let dobMatched = true;
    if (careRecipient) {
      const careRecipientFull = await db.prepare(
        "SELECT date_of_birth FROM care_recipients WHERE id = ?"
      ).get(careRecipient.id);
      if (extractedDOB && careRecipientFull?.date_of_birth) {
        const registeredDOB = new Date(careRecipientFull.date_of_birth).toLocaleDateString('en-US');
        dobMatched = extractedDOB.includes(registeredDOB) || registeredDOB.includes(extractedDOB) ||
                     careRecipientFull.date_of_birth === extractedDOB;
        if (!dobMatched) {
          allConcerns.unshift(`Date of birth mismatch: registered "${registeredDOB}" but ID shows "${extractedDOB}"`);
        }
      }
    }

    // ─── Face comparison (selfie vs ID photo) ───
    let faceComparison = { similar: false, confidence: 0, explanation: "No selfie provided", skipped: true };
    if (selfieBase64) {
      faceComparison = await compareFaces(selfieBase64, idPhotoBase64);
      if (!faceComparison.similar && !faceComparison.skipped) {
        allConcerns.unshift(`Face comparison: ${faceComparison.explanation} (confidence: ${Math.round(faceComparison.confidence * 100)}%)`);
      }
    } else {
      allConcerns.push("Selfie was skipped — face comparison not performed");
    }

    // ─── Decision — v1.105.112: the AI no longer makes one ───
    //
    // The second of the two doors into identity verification (src/utils/identity.js explains
    // why there are two). Both wrote status='approved' outright when the checks agreed, with
    // nobody asked. Pete's call: "I want to review everything an AI clears. Below a confidence
    // of, say, 90%, it doesn't even decide...I do."
    const facePassed = faceComparison.skipped || faceComparison.similar || faceComparison.confidence >= 0.5;
    const looksRight = nameMatched && classifyResult.isValid && dobMatched && facePassed;
    const decision = identityDecision({
      looksRight,
      docConfidence: classifyResult.confidence,
      faceConfidence: faceComparison.confidence,
      faceSkipped: !!faceComparison.skipped,
    });
    const isVerified = looksRight;   // "the checks agreed", never "you are verified"
    const needsHumanReview = true;

    // Build ai_classification JSON for admin panel compatibility (matches format from classifyDocument)
    const aiClassificationForAdmin = {
      classification: classifyResult.classification,
      confidence: classifyResult.confidence,
      isValid: classifyResult.isValid,
      matchesClaimed: classifyResult.matchesClaimed,
      extractedFields: classifyResult.extractedFields || {},
      concerns: allConcerns,
      summary: classifyResult.summary || '',
      nameMatched,
      dobMatched,
      registeredName,
      extractedName,
      faceComparison: {
        similar: faceComparison.similar,
        confidence: faceComparison.confidence,
        explanation: faceComparison.explanation,
        skipped: !!faceComparison.skipped,
      },
    };

    // Store the ID verification in verified_documents table
    // Original v1.36.0 schema NOT NULL columns: id, owner_type, owner_id, uploaded_by, category, document_type, file_data
    const docId = uuid();
    await db.prepare(
      `INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type, status, ai_classification, extracted_data, ai_confidence, ai_concerns, ai_recommendation, ai_recommendation_reason, is_verified, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docId,
      ownerId,
      ownerType,
      req.user.id,
      'identity',
      classifyResult.classification || 'drivers_license',
      await storage.storeFileData("identity", idPhotoBase64), // v1.91.0
      mimetype,
      decision.status,                                         // always 'pending'
      JSON.stringify(aiClassificationForAdmin),                // ai_classification — for admin panel
      JSON.stringify({
        extractedName, registeredName, extractedDOB,
        issuingAuthority, expiryDate,
        confidence: classifyResult.confidence,
        nameMatched, dobMatched,
      }),
      classifyResult.confidence || 0,
      JSON.stringify(allConcerns),
      decision.verdict,
      decision.reason,
      0,                                                       // a human's word, not the model's
      null,
      new Date().toISOString(),
      new Date().toISOString()
    );

    // Store selfie as a separate verified_document (for admin face comparison review)
      // v1.105.73 — the selfie used to be inserted WITHOUT ai_confidence/ai_concerns, so the
      // column fell to its DEFAULT of 0 and the admin preview rendered "0% confidence" next to
      // the ID's 97%. Two different measurements, one of them never taken. The selfie's real
      // number is the face-match similarity, so write it: the column and the JSON now agree,
      // and `0` in this column means the faces genuinely did not match.
    if (selfieBase64) {
      const selfieDocId = uuid();
      const selfieMime = (selfieBase64.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
      await db.prepare(
        `INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type, status, ai_classification, ai_confidence, ai_concerns, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        selfieDocId, ownerId, ownerType, req.user.id,
        'identity', 'selfie', await storage.storeFileData("identity", selfieBase64), selfieMime, // v1.91.0
        'approved',  // selfie itself doesn't need review — it's supporting evidence
        JSON.stringify({ linkedIdDocId: docId, faceComparison }),
        faceComparison.skipped ? null : (typeof faceComparison.confidence === 'number' ? faceComparison.confidence : null),
        JSON.stringify(faceComparison.skipped ? [] : (faceComparison.similar ? [] : [`Face comparison: ${faceComparison.explanation || 'faces did not match'}`])),
        new Date().toISOString()
      );
    }

    // Return verification result
    // v1.105.68 — tell someone. This is the door most people find (My Account → "Verify your
    // identity"), and it notified NOBODY: no push, no email, no admin alert count, no activity
    // feed entry. The person submits their government ID, sees it succeed, and waits. The admin
    // gets no signal and has no screen listing what is waiting. For a caregiver that silence is
    // a hard stop — onboarding cannot complete without an APPROVED identity document.
    //
    // Fire-and-forget on purpose: the submitter's result must not depend on a push succeeding.
    try {
      const { notifyAdmins } = require("./push");
      notifyAdmins("identity_submitted", {
        // v1.105.112 — there is no longer an "auto-approved" case. Every submission waits on a
        // person, and the notification says which way the AI leans so the reviewer knows
        // whether this is a formality or a real question.
        title: "ID waiting on your review",
        body: `${req.user.firstName || "Someone"} submitted a selfie and photo ID. ${verdictLabel(decision.verdict)}${decision.verdict === VERDICT.ABSTAIN ? ` (${Math.round(decision.confidence * 100)}% — below the threshold).` : "."}`,
        data: { type: "identity_submitted", userId: req.user.id, documentId: docId, aiRecommendation: decision.verdict },
      });
    } catch (e) { console.error("[identity] admin notify failed:", e.message); }

    res.json({
      matched: isVerified,
      extractedName,
      registeredName,
      extractedDOB,
      expiryDate,
      confidence: classifyResult.confidence,
      concerns: allConcerns,
      documentId: docId,
      issuingAuthority,
      nameMatched,
      dobMatched,
      needsHumanReview,
      classification: classifyResult.classification,
      faceComparison: {
        similar: faceComparison.similar,
        confidence: faceComparison.confidence,
        explanation: faceComparison.explanation,
        skipped: !!faceComparison.skipped,
      },
    });
  } catch (err) {
    console.error('Verify ID error:', err);
    res.status(500).json({ error: 'Error verifying ID. Please try again.' });
  }
});

// ─── POST /api/self-onboarding/complete ───
// Complete onboarding and save all collected data
router.post("/complete", authenticate, async (req, res) => {
  try {
    const db = await getDb();
    const {
      dateOfBirth,
      preferredName,
      careAddress,
      medicalConditions,
      medications,
      foodAllergies,
      petAllergies,
      otherAllergies,
      pets,
      emergencyContact,
      termsAccepted,
      nonMedicalAcknowledged,
    } = req.body;

    // Validate required fields
    if (!termsAccepted || !nonMedicalAcknowledged) {
      return res.status(400).json({ error: "You must accept all terms to continue" });
    }

    if (!careAddress?.line1 || !careAddress?.city || !careAddress?.state || !careAddress?.zip) {
      return res.status(400).json({ error: "Complete care address is required" });
    }

    if (!emergencyContact?.name || !emergencyContact?.phone || !emergencyContact?.relationship) {
      return res.status(400).json({ error: "Emergency contact information is required" });
    }

    // Get care_recipient record
    const careRecipient = await db.prepare(
      "SELECT id FROM care_recipients WHERE linked_user_id = ?"
    ).get(req.user.id);

    if (!careRecipient) {
      return res.status(404).json({ error: "Care recipient record not found" });
    }

    // Format date_of_birth
    const dobFormatted = dateOfBirth ? new Date(dateOfBirth).toISOString().split('T')[0] : null;

    // Update care_recipients table with health & safety info
    await db.prepare(
      `UPDATE care_recipients
       SET
         self_onboarding_complete = 1,
         date_of_birth = ?,
         preferred_name = ?,
         location_address = ?,
         location_city = ?,
         location_state = ?,
         location_zip = ?,
         medical_conditions = ?,
         medications = ?,
         food_allergies = ?,
         pet_allergies = ?,
         pets = ?,
         emergency_contact_name = ?,
         emergency_contact_phone = ?,
         emergency_contact_relationship = ?,
         care_preferences = ?,
         terms_accepted_at = ?,
         terms_version = ?,
         non_medical_acknowledged = ?,
         updated_at = NOW()
       WHERE id = ?`
    ).run(
      dobFormatted,
      preferredName || null,
      careAddress.line1,
      careAddress.city,
      careAddress.state,
      careAddress.zip,
      medicalConditions || null,
      medications || null,
      foodAllergies || null,
      petAllergies || null,
      pets || null,
      emergencyContact.name,
      emergencyContact.phone,
      emergencyContact.relationship,
      JSON.stringify({
        otherAllergies: otherAllergies || null,
        careAddressLine2: careAddress.line2 || null,
      }),
      new Date().toISOString(),
      process.env.TERMS_VERSION || '1.0',
      nonMedicalAcknowledged ? 1 : 0,
      careRecipient.id
    );

    // Update users table with address and terms
    const termsDate = new Date().toISOString();
    const termsVersion = process.env.TERMS_VERSION || '1.0';

    await db.prepare(
      `UPDATE users
       SET
         address_line1 = ?,
         address_line2 = ?,
         city = ?,
         state = ?,
         zip = ?,
         disclaimer_accepted_at = ?,
         disclaimer_version = ?,
         updated_at = NOW()
       WHERE id = ?`
    ).run(
      careAddress.line1,
      careAddress.line2 || null,
      careAddress.city,
      careAddress.state,
      careAddress.zip,
      termsDate,
      termsVersion,
      req.user.id
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Complete onboarding error:', err);
    res.status(500).json({ error: 'Error completing setup. Please try again.' });
  }
});

// ─── GET /api/self-onboarding/status ───
// Get current onboarding status
router.get("/status", authenticate, async (req, res) => {
  try {
    const db = await getDb();

    // Get care_recipient record
    const careRecipient = await db.prepare(
      `SELECT
         id, self_onboarding_complete, date_of_birth, preferred_name,
         location_address, location_city, location_state, location_zip,
         medical_conditions, medications, food_allergies, pet_allergies,
         emergency_contact_name
       FROM care_recipients
       WHERE linked_user_id = ?`
    ).get(req.user.id);

    if (!careRecipient) {
      return res.status(404).json({ error: "Care recipient record not found" });
    }

    // Check for verified identity document
    const identityDoc = await db.prepare(
      "SELECT id, is_verified FROM verified_documents WHERE owner_id = ? AND category = 'identity' ORDER BY verified_at DESC LIMIT 1"
    ).get(careRecipient.id);

    res.json({
      complete: !!careRecipient.self_onboarding_complete,
      data: {
        dateOfBirth: careRecipient.date_of_birth,
        preferredName: careRecipient.preferred_name,
        address: {
          line1: careRecipient.location_address,
          city: careRecipient.location_city,
          state: careRecipient.location_state,
          zip: careRecipient.location_zip,
        },
        medicalConditions: careRecipient.medical_conditions,
        medications: careRecipient.medications,
        foodAllergies: careRecipient.food_allergies,
        petAllergies: careRecipient.pet_allergies,
        emergencyContactName: careRecipient.emergency_contact_name,
        identityVerified: !!identityDoc?.is_verified,
      },
    });
  } catch (err) {
    console.error('Get onboarding status error:', err);
    res.status(500).json({ error: 'Error retrieving status' });
  }
});

module.exports = router;
