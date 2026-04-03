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

    // Classify the ID document using Claude
    const classifyResult = await classifyDocument(
      idPhotoBase64,
      idPhotoFile.mimetype,
      "Identity"
    );

    // Extract verification data
    const extractedName = classifyResult.extractedFields?.name || '';
    const expiryDate = classifyResult.extractedFields?.expirationDate || '';
    const issuingAuthority = classifyResult.extractedFields?.issuingAuthority || '';

    // Check if name matches (basic fuzzy matching — last name must match)
    const userLastName = (user.last_name || '').toLowerCase().trim();
    const extractedLastName = extractedName.split(' ').pop().toLowerCase().trim();
    const nameMatched = extractedLastName === userLastName ||
                        extractedName.toLowerCase().includes(userLastName);

    // Store the ID photo in verified_documents table
    const docId = uuid();
    await db.prepare(
      `INSERT INTO verified_documents (id, owner_id, owner_type, category, doc_type, file_path, extracted_data, ai_confidence, ai_concerns, is_verified, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docId,
      careRecipient.id,
      'care_recipient',
      'identity',
      classifyResult.classification || 'other_legal',
      `identity/${careRecipient.id}/${docId}.jpg`, // Logical path (actual storage handled elsewhere)
      JSON.stringify({
        extractedName,
        issuingAuthority,
        expiryDate,
        confidence: classifyResult.confidence,
      }),
      classifyResult.confidence || 0,
      JSON.stringify(classifyResult.concerns || []),
      nameMatched && classifyResult.isValid ? 1 : 0,
      new Date().toISOString(),
      new Date().toISOString()
    );

    // Return verification result
    res.json({
      matched: nameMatched && classifyResult.isValid,
      extractedName,
      expiryDate,
      confidence: classifyResult.confidence,
      concerns: classifyResult.concerns || [],
      documentId: docId,
      issuingAuthority,
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
