// ─── Where a returning caregiver picks the signup wizard back up (v1.134.0) ───
//
// Pete, 11/18, onboarding Kay in person: "We entered all the information from the link. Then we
// downloaded the app. And the app acted like it never heard of her, even though she logged in.
// And then after that, it kept asking for the same information over again, like her address and
// phone number and date of birth and everything." And: "It is requiring ID pictures twice and
// that's after I've already bypassed it."
//
// Every wizard step already POSTs to the server before it advances, so her answers were never
// lost. What was lost was the wizard's memory of them: its only draft lives in localStorage,
// and Chrome and the app are two different browsers. Re-opened in the app, it started at step 2
// with an empty form and asked for everything again.
//
// So the server answers instead. This module is pure: given what the database holds, it returns
// the answers to put back in the form (never the SSN; the wizard has never held it after step
// 4) and the first step that still needs her. Steps are the wizard's own numbers:
//   2 terms · 3 personal · 4 safety-check details · 5 certifications · 6 school program
//   7 ID upload · 8 selfie + ID · 9 review
//
// 5 and 6 are optional and leave no trace when skipped, so they count as passed once she has
// got past them, which is to say once any later step left a mark.

const ID_FRONT_TYPES = ["id_front", "dl_front", "drivers_license"];
const ID_BACK_TYPES = ["id_back", "dl_back"];
// Mirrors idDocSpec in the wizard: a passport has no back, nor do these.
const NO_BACK = new Set(["passport"]);

const s = (v) => (v == null ? "" : String(v));
const has = (v) => s(v).trim().length > 0;

function isoDate(v) {
  if (!v) return "";
  if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/**
 * @param {object} p
 * @param {object} p.user        users row (phone, first_name, last_name, date_of_birth, pets, pet_allergies,
 *                               food_allergies, medical_conditions, id_verified_in_person_at)
 * @param {object|null} p.profile caregiver_profiles row
 * @param {Array}  p.documents   caregiver_documents rows [{ id, document_type }]
 * @param {object|null} p.identity { submitted, status } from utils/identity — the ID card,
 *                               which step 7's uploads already put there
 * @param {boolean} p.selfie      a selfie is on file, i.e. step 8 ran
 */
function resumeOnboarding({ user = {}, profile = null, documents = [], identity = null, selfie = false }) {
  const cp = profile || {};
  const docs = Array.isArray(documents) ? documents : [];
  const idFront = docs.slice().reverse().find((d) => ID_FRONT_TYPES.includes(d.document_type)) || null;
  const idBack = docs.slice().reverse().find((d) => ID_BACK_TYPES.includes(d.document_type)) || null;

  const inPerson = !!user.id_verified_in_person_at;
  const identityStatus = identity && identity.submitted ? s(identity.status) : "";
  // Step 7's uploads land on the same Identity card step 8 does, so "an ID is on file" does not
  // mean step 8 ran. Step 8 is done when its selfie exists, or when there is nothing left for it
  // to prove: a person approved the ID, or Pete saw it face to face.
  const identityApproved = identityStatus === "approved";
  const identitySubmitted = (!!selfie && identityStatus !== "rejected") || identityApproved;

  const pets = s(user.pets);
  const prefill = {
    firstName: s(user.first_name), lastName: s(user.last_name),
    phone: s(user.phone),
    addressLine1: s(cp.address_line1 || cp.address), addressLine2: s(cp.address_line2),
    city: s(cp.location_city || cp.city), state: s(cp.location_state || cp.state), zip: s(cp.zip),
    yearsExperience: cp.years_experience != null && cp.years_experience !== 0 ? String(cp.years_experience) : "",
    bio: s(cp.bio),
    travelRadius: cp.max_travel_miles ? String(Math.round(Number(cp.max_travel_miles))) : "",
    openToInterview: cp.open_to_interview == null ? null : !!cp.open_to_interview,
    comfortableWithPets: pets === "comfortable" ? true : pets === "prefer-none" ? false : null,
    petAllergies: s(user.pet_allergies), foodAllergies: s(user.food_allergies),
    medicalConditions: s(user.medical_conditions),
    legalFirstName: s(cp.legal_first_name), legalMiddleName: s(cp.legal_middle_name),
    legalLastName: s(cp.legal_last_name),
    dateOfBirth: isoDate(cp.date_of_birth) || isoDate(user.date_of_birth),
    idDocType: s(cp.id_doc_type), dlNumber: s(cp.dl_number), dlState: s(cp.dl_state),
    backgroundCheckConsent: !!cp.background_check_consent,
  };
  // An empty middle name that was saved at all means she ticked "no middle name".
  if (has(prefill.legalFirstName) && !has(prefill.legalMiddleName)) prefill.noMiddleName = true;

  const done = {
    terms: !!cp.terms_accepted_at,
    personal: has(prefill.phone) && has(prefill.addressLine1) && has(prefill.city) && has(prefill.state) && has(prefill.zip),
    ssnOnFile: has(cp.ssn_last4),
    legal: false,
    idUploaded: false,
    identity: identitySubmitted || inPerson,
    inPerson,
  };
  const licence = prefill.idDocType === "drivers_license";
  done.legal = has(prefill.legalFirstName) && has(prefill.legalLastName) && has(prefill.dateOfBirth)
    && done.ssnOnFile && has(prefill.idDocType) && prefill.backgroundCheckConsent
    && (!licence || (has(prefill.dlNumber) && has(prefill.dlState)));
  const needsBack = !NO_BACK.has(prefill.idDocType);
  done.idUploaded = inPerson || (!!idFront && (!needsBack || !!idBack));

  let resumeStep;
  if (!done.terms) resumeStep = 2;
  else if (!done.personal) resumeStep = 3;
  else if (!done.legal) resumeStep = 4;
  else if (!done.idUploaded && !done.identity) {
    // Certifications and the school question leave nothing behind when skipped. If she has not
    // reached the uploads yet, start at certifications; they are quick and both optional.
    resumeStep = cp.academic_program || (cp.certifications && cp.certifications !== "[]") ? 7 : 5;
  } else if (!done.identity) resumeStep = 8;
  else resumeStep = 9;

  return {
    prefill,
    done,
    resumeStep,
    idFrontDocumentId: idFront ? idFront.id : null,
  };
}

module.exports = { resumeOnboarding, ID_FRONT_TYPES, ID_BACK_TYPES };
