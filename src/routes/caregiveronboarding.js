const express = require("express");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { getDb } = require("../models/database");
const { authenticate } = require("../middleware/auth");
const { classifyDocument } = require("../utils/documentAI");
const { MODEL_SONNET } = require("../utils/aiModels");
const storage = require("../utils/storage"); // v1.91.0 — env-gated R2 offload for document blobs

const router = express.Router();

// Multer config — memory storage, 10MB per file, images + PDFs
const ALLOWED_MIMES = ["image/", "application/pdf"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.some((m) => file.mimetype.startsWith(m))) {
      cb(null, true);
    } else {
      cb(new Error("Only image and PDF files are allowed"));
    }
  },
});

// All routes require authentication
router.use(authenticate);

// ─── POST /api/caregiver-onboarding/documents ───
// Upload identity/certification documents (DL front, DL back, cert images)
router.post("/documents", upload.array("documents", 10), async (req, res) => {
  try {
    const db = await getDb();

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    // Parse document types and metadata from form data
    const types = req.body.types ? JSON.parse(req.body.types) : [];
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : [];

    const savedDocs = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const docType = types[i] || "other";
      const docMeta = metadata[i] ? JSON.stringify(metadata[i]) : null;
      const docId = uuid();

      // v1.91.0 — upload ONCE to R2 (when configured); same marker feeds the
      // verified_documents dual-write below (same id by design).
      const storedFileData = await storage.storeFileData("caregiver-docs", base64);

      await db.prepare(`
        INSERT INTO caregiver_documents (id, user_id, document_type, file_data, file_name, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(docId, req.user.id, docType, storedFileData, file.originalname, docMeta);

      // v1.87.0 (infra #7): write verified_documents AT UPLOAD (same id, so the
      // per-boot caregiver_documents sync skips it) instead of waiting for the
      // next boot. Mapping mirrors the boot sync; real size/mime instead of the
      // sync's placeholders. Non-fatal: if the caregiver profile doesn't exist
      // yet, owner_id is NULL and this insert fails — the boot sync picks the
      // row up once the profile exists, exactly as before.
      try {
        await db.prepare(`
          INSERT INTO verified_documents (id, owner_type, owner_id, uploaded_by, category, document_type,
            file_data, file_name, file_size, mime_type, status, created_at, updated_at)
          VALUES (?, 'caregiver', (SELECT cp.id FROM caregiver_profiles cp WHERE cp.user_id = ? LIMIT 1), ?,
            ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())
        `).run(
          docId, req.user.id, req.user.id,
          ["dl_front", "dl_back", "drivers_license"].includes(docType) ? "identity" : "certification",
          ({ dl_front: "DL_Front", dl_back: "DL_Back", drivers_license: "DL_Front", certification: "Other_Cert" })[docType] || "Other",
          storedFileData, file.originalname, file.size, file.mimetype
        );
      } catch (dualWriteErr) {
        console.warn("verified_documents dual-write deferred to boot sync:", dualWriteErr.message);
      }

      savedDocs.push({
        id: docId,
        documentType: docType,
        fileName: file.originalname,
        metadata: metadata[i] || null,
      });
    }

    res.status(201).json({ documents: savedDocs, message: `${savedDocs.length} document(s) uploaded` });
  } catch (err) {
    console.error("Document upload error:", err);
    res.status(500).json({ error: "Failed to upload documents" });
  }
});

// ─── GET /api/caregiver-onboarding/documents ───
// Get documents for the authenticated user (or admin can query by userId)
router.get("/documents", async (req, res) => {
  try {
    const db = await getDb();
    const userId = req.query.userId || req.user.id;

    // Only admin can view other users' documents
    if (userId !== req.user.id) {
      const admin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
      if (!admin || !admin.is_admin) {
        return res.status(403).json({ error: "Not authorized" });
      }
    }

    const docs = await db.prepare(`
      SELECT id, document_type, file_name, metadata, created_at
      FROM caregiver_documents WHERE user_id = ?
      ORDER BY created_at ASC
    `).all(userId);

    res.json({ documents: docs });
  } catch (err) {
    console.error("Get documents error:", err);
    res.status(500).json({ error: "Failed to get documents" });
  }
});

// ─── GET /api/caregiver-onboarding/documents/:id/image ───
// Get the actual image data for a document
router.get("/documents/:id/image", async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare(
      "SELECT file_data, user_id FROM caregiver_documents WHERE id = ?"
    ).get(req.params.id);

    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Only owner or admin
    if (doc.user_id !== req.user.id) {
      const admin = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.user.id);
      if (!admin || !admin.is_admin) {
        return res.status(403).json({ error: "Not authorized" });
      }
    }

    res.json({ fileData: await storage.resolveFileData(doc.file_data) }); // v1.91.0 — fetches from R2 when marker
  } catch (err) {
    console.error("Get document image error:", err);
    res.status(500).json({ error: "Failed to get document" });
  }
});

// ─── DELETE /api/caregiver-onboarding/documents/:id ───
// Delete a document (owner only, during onboarding)
router.delete("/documents/:id", async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.prepare(
      "SELECT user_id FROM caregiver_documents WHERE id = ?"
    ).get(req.params.id);

    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (doc.user_id !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    await db.prepare("DELETE FROM caregiver_documents WHERE id = ?").run(req.params.id);
    res.json({ message: "Document deleted" });
  } catch (err) {
    console.error("Delete document error:", err);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// ─── Face comparison helper (same as selfOnboarding.js) ───
async function compareFaces(selfieBase64, idPhotoBase64) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { similar: false, confidence: 0, explanation: "AI comparison unavailable", skipped: true };
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const stripDataUri = (d) => d.replace(/^data:[^;]+;base64,/, "");
    const getMime = (d) => { const m = d.match(/^data:([^;]+);/); return m ? m[1] : "image/jpeg"; };
    const response = await client.messages.create({
      model: MODEL_SONNET, max_tokens: 512,
      system: `You are a visual verification assistant for a care coordination platform. Compare a selfie to a government ID photo. Assess whether they appear to be the same person based on general facial structure, approximate age range, and overall appearance. This is a basic visual plausibility check, not biometric identification. Err on the side of caution.
Respond with ONLY a JSON object (no markdown): { "similar": true/false, "confidence": 0.0-1.0, "explanation": "Brief reason" }`,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: getMime(selfieBase64), data: stripDataUri(selfieBase64) } },
        { type: "image", source: { type: "base64", media_type: getMime(idPhotoBase64), data: stripDataUri(idPhotoBase64) } },
        { type: "text", text: "Image 1 is the selfie. Image 2 is the government ID. Do these appear to be the same person?" },
      ] }],
    });
    const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const result = JSON.parse(cleaned);
    return { similar: !!result.similar, confidence: typeof result.confidence === "number" ? result.confidence : 0, explanation: result.explanation || "" };
  } catch (err) {
    console.error("Face comparison error:", err.message);
    return { similar: false, confidence: 0, explanation: `Comparison failed: ${err.message}`, error: true };
  }
}

// ─── POST /api/caregiver-onboarding/verify-id ───
// Caregiver identity verification: selfie + government ID
router.post("/verify-id", async (req, res) => {
  try {
    const db = await getDb();
    const { idPhoto: idPhotoBase64, selfie: selfieBase64 } = req.body;

    if (!idPhotoBase64) return res.status(400).json({ error: "ID photo is required" });
    if (!selfieBase64) return res.status(400).json({ error: "Selfie is required" });

    const user = await db.prepare("SELECT first_name, last_name FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
    if (!profile) return res.status(404).json({ error: "Caregiver profile not found" });

    const mimeMatch = idPhotoBase64.match(/^data:([^;]+);/);
    const mimetype = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // Classify the ID document using Claude
    const classifyResult = await classifyDocument(idPhotoBase64, mimetype, "Identity");

    const extractedName = classifyResult.extractedFields?.name || '';
    const extractedDOB = classifyResult.extractedFields?.dateOfBirth || '';
    const expiryDate = classifyResult.extractedFields?.expirationDate || '';
    const issuingAuthority = classifyResult.extractedFields?.issuingAuthority || '';

    const allConcerns = [...(classifyResult.concerns || [])];

    // Name match
    const registeredName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    const userLastName = (user.last_name || '').toLowerCase().trim();
    const extractedLastName = extractedName.split(' ').pop().toLowerCase().trim();
    const nameMatched = extractedLastName === userLastName || extractedName.toLowerCase().includes(userLastName);
    if (!nameMatched && extractedName) {
      allConcerns.unshift(`Name mismatch: account registered as "${registeredName}" but ID shows "${extractedName}"`);
    }

    // DOB match (use form-provided DOB from step 4 if available)
    let dobMatched = true;
    const profileFull = await db.prepare("SELECT date_of_birth FROM caregiver_profiles WHERE id = ?").get(profile.id);
    if (extractedDOB && profileFull?.date_of_birth) {
      const registeredDOB = new Date(profileFull.date_of_birth).toLocaleDateString('en-US');
      dobMatched = extractedDOB.includes(registeredDOB) || registeredDOB.includes(extractedDOB) || profileFull.date_of_birth === extractedDOB;
      if (!dobMatched) allConcerns.unshift(`DOB mismatch: registered "${registeredDOB}" but ID shows "${extractedDOB}"`);
    }

    // Face comparison
    const faceComparison = await compareFaces(selfieBase64, idPhotoBase64);
    if (!faceComparison.similar && !faceComparison.skipped) {
      allConcerns.unshift(`Face comparison: ${faceComparison.explanation} (confidence: ${Math.round(faceComparison.confidence * 100)}%)`);
    }

    // Decision
    const facePassed = faceComparison.skipped || faceComparison.similar || faceComparison.confidence >= 0.5;
    const isVerified = nameMatched && classifyResult.isValid && dobMatched && facePassed;
    const needsHumanReview = !isVerified || (classifyResult.confidence || 0) < 0.8 || (!faceComparison.skipped && faceComparison.confidence < 0.7);

    const aiClassification = {
      classification: classifyResult.classification, confidence: classifyResult.confidence,
      isValid: classifyResult.isValid, matchesClaimed: classifyResult.matchesClaimed,
      extractedFields: classifyResult.extractedFields || {}, concerns: allConcerns,
      summary: classifyResult.summary || '', nameMatched, dobMatched, registeredName, extractedName,
      faceComparison: { similar: faceComparison.similar, confidence: faceComparison.confidence, explanation: faceComparison.explanation, skipped: !!faceComparison.skipped },
    };

    // Store ID document
    const docId = uuid();
    await db.prepare(
      `INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type, status, ai_classification, extracted_data, ai_confidence, ai_concerns, is_verified, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      docId, profile.id, 'caregiver', req.user.id, 'identity',
      classifyResult.classification || 'drivers_license',
      await storage.storeFileData("identity", idPhotoBase64), mimetype, // v1.91.0

      needsHumanReview ? 'pending' : 'approved',
      JSON.stringify(aiClassification),
      JSON.stringify({ extractedName, registeredName, extractedDOB, issuingAuthority, expiryDate, confidence: classifyResult.confidence, nameMatched, dobMatched }),
      classifyResult.confidence || 0,
      JSON.stringify(allConcerns),
      isVerified ? 1 : 0,
      new Date().toISOString(),
      new Date().toISOString()
    );

    // Store selfie
    const selfieDocId = uuid();
    const selfieMime = (selfieBase64.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg';
    await db.prepare(
      `INSERT INTO verified_documents (id, owner_id, owner_type, uploaded_by, category, document_type, file_data, mime_type, status, ai_classification, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      selfieDocId, profile.id, 'caregiver', req.user.id,
      'identity', 'selfie', await storage.storeFileData("identity", selfieBase64), selfieMime, // v1.91.0
      'approved', JSON.stringify({ linkedIdDocId: docId, faceComparison }),
      new Date().toISOString()
    );

    res.json({
      matched: isVerified, needsHumanReview,
      extractedName, registeredName, extractedDOB, expiryDate,
      confidence: classifyResult.confidence, concerns: allConcerns,
      documentId: docId, issuingAuthority, nameMatched, dobMatched,
      classification: classifyResult.classification,
      faceComparison: { similar: faceComparison.similar, confidence: faceComparison.confidence, explanation: faceComparison.explanation, skipped: !!faceComparison.skipped },
    });
  } catch (err) {
    console.error('Caregiver verify-id error:', err);
    res.status(500).json({ error: 'Error verifying ID. Please try again.' });
  }
});

// ─── GET /api/caregiver-onboarding/identity-status ───
// Check if caregiver has completed identity verification
router.get("/identity-status", async (req, res) => {
  try {
    const db = await getDb();
    const profile = await db.prepare("SELECT id FROM caregiver_profiles WHERE user_id = ?").get(req.user.id);
    if (!profile) return res.json({ submitted: false, status: null });

    // v1.105.64 — the caregiver's First Steps reads this, so it must agree with the gate in
    // caregivers.js and with the admin panel. All three now resolve through
    // src/utils/identity.js, which accepts a My Account submission as well as a wizard one.
    const { caregiverIdentityDoc } = require("../utils/identity");
    const idDoc = await caregiverIdentityDoc(db, req.user.id, profile.id);

    if (!idDoc) return res.json({ submitted: false, status: null });
    res.json({ submitted: true, status: idDoc.status, isVerified: !!idDoc.is_verified, documentId: idDoc.id });
  } catch (err) {
    console.error("Identity status error:", err);
    res.status(500).json({ error: "Failed to check identity status" });
  }
});

module.exports = router;
