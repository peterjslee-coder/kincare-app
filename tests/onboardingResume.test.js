// A caregiver who comes back to the signup wizard on another browser (or in the app) gets her
// answers back and lands on the first step that still needs her. (v1.134.0)
//
// Pete, 11/18, onboarding Kay: "the app acted like it never heard of her, even though she logged
// in. And then after that, it kept asking for the same information over again, like her address
// and phone number and date of birth and everything." And "It is requiring ID pictures twice."

const fs = require("fs");
const path = require("path");
const { resumeOnboarding } = require("../src/utils/onboardingResume");

const user = {
  first_name: "Kay", last_name: "Doe", phone: "5405550100", date_of_birth: "1960-04-02",
  pets: "comfortable", pet_allergies: "", food_allergies: "nuts", medical_conditions: "",
};
const personal = {
  terms_accepted_at: "2026-11-18T15:00:00Z", address_line1: "1 Main St", location_city: "Dublin",
  location_state: "VA", zip: "24084", max_travel_miles: 15, bio: "",
};
const legal = {
  legal_first_name: "Kay", legal_last_name: "Doe", date_of_birth: "1960-04-02", ssn_last4: "1234",
  id_doc_type: "state_id", background_check_consent: 1,
};

describe("resumeOnboarding — where she picks back up", () => {
  test("nothing saved yet: terms", () => {
    expect(resumeOnboarding({ user, profile: null }).resumeStep).toBe(2);
  });

  test("terms only: personal info", () => {
    expect(resumeOnboarding({ user: { ...user, phone: "" }, profile: { terms_accepted_at: "x" } }).resumeStep).toBe(3);
  });

  test("personal saved: safety-check details, with her address and allergies put back", () => {
    const r = resumeOnboarding({ user, profile: personal });
    expect(r.resumeStep).toBe(4);
    expect(r.prefill).toMatchObject({
      phone: "5405550100", addressLine1: "1 Main St", city: "Dublin", state: "VA", zip: "24084",
      foodAllergies: "nuts", comfortableWithPets: true, dateOfBirth: "1960-04-02", travelRadius: "15",
    });
  });

  test("legal saved, no uploads: certifications (both optional steps are quick)", () => {
    expect(resumeOnboarding({ user, profile: { ...personal, ...legal } }).resumeStep).toBe(5);
  });

  test("ID uploaded on step 7: straight to the selfie, reusing that ID", () => {
    const r = resumeOnboarding({
      user, profile: { ...personal, ...legal },
      documents: [{ id: "f1", document_type: "id_front" }, { id: "b1", document_type: "id_back" }],
      identity: { submitted: true, status: "pending" }, // step 7 lands on the Identity card too
    });
    expect(r.resumeStep).toBe(8);
    expect(r.idFrontDocumentId).toBe("f1");
  });

  test("a passport needs no back", () => {
    const r = resumeOnboarding({
      user, profile: { ...personal, ...legal, id_doc_type: "passport" },
      documents: [{ id: "p1", document_type: "id_front" }],
    });
    expect(r.resumeStep).toBe(8);
  });

  test("selfie done: review", () => {
    const r = resumeOnboarding({
      user, profile: { ...personal, ...legal },
      documents: [{ id: "f1", document_type: "id_front" }, { id: "b1", document_type: "id_back" }],
      identity: { submitted: true, status: "pending" }, selfie: true,
    });
    expect(r.resumeStep).toBe(9);
  });

  test("ID verified in person: neither ID step is asked", () => {
    const r = resumeOnboarding({
      user: { ...user, id_verified_in_person_at: "2026-11-18T16:00:00Z" },
      profile: { ...personal, ...legal },
    });
    expect(r.done.idUploaded).toBe(true);
    expect(r.done.identity).toBe(true);
    expect(r.resumeStep).toBe(9);
  });

  test("a rejected ID is hers to redo", () => {
    const r = resumeOnboarding({
      user, profile: { ...personal, ...legal },
      documents: [{ id: "f1", document_type: "id_front" }, { id: "b1", document_type: "id_back" }],
      identity: { submitted: true, status: "rejected" }, selfie: true,
    });
    expect(r.resumeStep).toBe(8);
  });

  test("never returns the SSN", () => {
    const r = resumeOnboarding({ user, profile: { ...personal, ...legal } });
    expect(JSON.stringify(r)).not.toContain("1234");
    expect(r.done.ssnOnFile).toBe(true);
  });
});

describe("the wizard uses it", () => {
  const src = fs.readFileSync(path.join(__dirname, "../public/js/components/CaregiverOnboarding.js"), "utf8");
  test("resume mode asks the server, not only localStorage", () => {
    expect(src).toContain("/api/caregivers/me/onboarding-resume");
  });
  test("step 8 can send the step-7 ID instead of a second photo", () => {
    expect(src).toContain("idDocumentId: idFrontDocId");
  });
  test("verify-id accepts it, and only her own front-of-ID", () => {
    const r = fs.readFileSync(path.join(__dirname, "../src/routes/caregiveronboarding.js"), "utf8");
    expect(r).toMatch(/WHERE id = \? AND user_id = \?/);
  });
});
