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
const router = express.Router();

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

    // Get the care_recipient record
    const careRecipient = await db.prepare(
      "SELECT id FROM care_recipients WHERE linked_user_id = ?"
    ).get(req.user.id);

    if (!careRecipient) {
      return res.status(404).json({ error: "Care recipient record not found" });
    }

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

    // Check DOB match if we have both
    const careRecipientFull = await db.prepare(
      "SELECT date_of_birth FROM care_recipients WHERE id = ?"
    ).get(careRecipient.id);
    let dobMatched = true;
    if (extractedDOB && careRecipientFull?.date_of_birth) {
      const registeredDOB = new Date(careRecipientFull.date_of_birth).toLocaleDateString('en-US');
      dobMatched = extractedDOB.includes(registeredDOB) || registeredDOB.includes(extractedDOB) ||
                   careRecipientFull.date_of_birth === extractedDOB;
      if (!dobMatched) {
        allConcerns.unshift(`Date of birth mismatch: registered "${registeredDOB}" but ID shows "${extractedDOB}"`);
      }
    }

    // Determine if this needs human review
    const isVerified = nameMatched && classifyResult.isValid && dobMatched;
    const needsHumanReview = !isVerified || (classifyResult.confidence || 0) < 0.8;

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
    };

    // Store the ID verification in verified_documents table
    // Original v1.36.0 schema NOT NULL columns: id, owner_type, owner_id, uploaded_by, category, document_type, file_data
    const docId = uuid();
    await db.prepare(
      `INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type, status, ai_classification, extracted_data, ai_confidence, ai_concerns, is_verified, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docId,
      careRecipient.id,
      'care_recipient',
      req.user.id,
      'identity',
      classifyResult.classification || 'drivers_license',
      idPhotoBase64,
      mimetype,
      needsHumanReview ? 'pending' : 'approved',
      JSON.stringify(aiClassificationForAdmin),                // ai_classification — for admin panel
      JSON.stringify({
        extractedName, registeredName, extractedDOB,
        issuingAuthority, expiryDate,
        confidence: classifyResult.confidence,
        nameMatched, dobMatched,
      }),
      classifyResult.confidence || 0,
      JSON.stringify(allConcerns),
      isVerified ? 1 : 0,
      new Date().toISOString(),
      new Date().toISOString()
    );

    // Return verification result
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
