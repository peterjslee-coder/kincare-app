// ─── v1.109.5 — a photo ID, not a driver's licence ───
//
// Sep 21 2026. The question was whether Checkr or the Terms shut out a lawful immigrant on a
// work permit. Neither does: the Terms ask only for 18+ and US residence, Checkr screens
// criminal history from an SSN trace and never looks at work authorisation, and the Caregiver
// Agreement says outright that access is not denied on national origin.
//
// The signup form did it instead. Step 5 required a licence NUMBER and issuing state; step 7
// required a licence photo, front AND back. A green-card holder or an EAD holder who does not
// drive could not finish — a form field enforcing an eligibility rule nobody wrote, failing in
// the one direction the Caregiver Agreement forbids. These tests hold the door open.
const { code } = require("./helpers/source");
const wizard = code("public/js/components/CaregiverOnboarding.js");
const cgRoute = code("src/routes/caregivers.js");
const docs = code("src/routes/documents.js");
const onboarding = code("src/routes/caregiveronboarding.js");
const db = code("src/models/database.js");
const admin = code("public/js/components/AdminPanel.js");
const documentAI = code("src/utils/documentAI.js");

test("five documents are offered by name, and the EAD says what it is", () => {
  for (const v of ["drivers_license", "state_id", "passport", "ead", "permanent_resident_card"]) {
    expect(wizard).toContain(`value: '${v}'`);
  }
  // Named in the words the person holding one would recognise.
  expect(wizard).toContain("Employment Authorization Document (EAD / work permit)");
  expect(wizard).toContain("Permanent resident card (green card)");
  expect(wizard).toContain("Passport (US or foreign)");
});

test("a passport is never asked for its back", () => {
  expect(wizard).toContain("{ value: 'passport', label: 'Passport (US or foreign)', front: 'Passport \\u2014 photo page', back: null }");
  expect(wizard).toContain("if (spec.back) slots.push({ key: 'id_back', label: spec.back });");
});

test("the licence number is required only of someone presenting a licence", () => {
  expect(wizard).toContain("if (form.idDocType === 'drivers_license') {");
  expect(wizard).toContain("{form.idDocType === 'drivers_license' && (");
  // And it is cleared when she switches away, so Checkr never gets a number
  // the document she sent cannot back up.
  expect(wizard).toContain("if (e.target.value !== 'drivers_license') { updateForm('dlNumber', ''); updateForm('dlState', ''); }");
  expect(wizard).toContain("dlNumber: form.idDocType === 'drivers_license' ? form.dlNumber : null,");
});

test("no step demands a driver's licence of everyone", () => {
  expect(wizard).not.toContain("Driver's license front is required");
  expect(wizard).not.toContain("Driver's license back is required");
  expect(wizard).not.toContain("Driver's License — Front *");
  expect(wizard).not.toContain("Upload photos of your driver's license (front and back)");
  // The error names her document: "Passport — photo page is required".
  expect(wizard).toContain("errs.id_front = `${spec.front} is required`");
});

test("the driving record is claimed only where there is a licence to check", () => {
  // Checkr's package here is a criminal search. Telling a passport holder we will pull her
  // MVR is a consent she cannot give and a check that cannot run.
  expect(wizard).toContain("including criminal history{form.idDocType === 'drivers_license' ? ', driving record,' : ''}");
  expect(wizard).not.toContain("This includes criminal history, driving record, and identity verification.");
});

test("which document she presented is stored, not inferred from a licence number", () => {
  expect(cgRoute).toContain("id_doc_type = COALESCE(?, id_doc_type),");
  expect(db).toContain('id: "046_id_doc_type"');
  expect(db).toContain("ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS id_doc_type TEXT");
  // Anyone who finished the wizard before this column existed did present a licence.
  expect(db).toContain("SET id_doc_type = 'drivers_license'");
  expect(admin).toContain("ID presented:");
  expect(admin).toContain("N/A \\u2014 not a driver\\u2019s license");
});

test("the generic ID pair is a first-class document type everywhere it lands", () => {
  expect(docs).toContain('"ID_Front", "ID_Back",');
  expect(docs).toContain('"EAD", "Permanent_Resident_Card",');
  // Legacy rows keep working — every DL photo uploaded before today is still an identity doc.
  expect(docs).toContain('"DL_Front", "DL_Back", "Passport", "State_ID"');
  expect(onboarding).toContain('id_front: "ID_Front", id_back: "ID_Back"');
  expect(onboarding).toContain('["dl_front", "dl_back", "drivers_license", "id_front", "id_back"].includes(docType)');
  // The boot sync has to agree with the upload path or a row's category depends on when it landed.
  expect(db).toContain("document_type IN ('dl_front', 'dl_back', 'drivers_license', 'id_front', 'id_back')");
  expect(db).toContain("WHEN 'id_front' THEN 'ID_Front' WHEN 'id_back' THEN 'ID_Back'");
});

test("the classifier can name what it is looking at", () => {
  // It used to have one word for a government ID. A passport classified as "other" reads to
  // the reviewing admin as a document that failed, which is the worst possible default here.
  expect(documentAI).toContain("drivers_license, state_id, passport, ead, permanent_resident_card,");
  expect(onboarding).not.toContain("classifyResult.classification || 'drivers_license'");
});
