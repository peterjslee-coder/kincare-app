/**
 * Keep a caregiver on a family's roster once they have actually worked for them. (v1.106.16)
 *
 * Moved out of routes/sessions.js. Called from three places there and from the proposal
 * accept path; none of them is a route handler's own logic.
 */
// v1.106.23 — this import did not come with the function when it moved out of sessions.js in
// v1.106.16, so `uuid()` below threw ReferenceError on every FIRST claim by a caregiver for a
// family. The caller wraps it in try/catch and logs, so it degraded to a console line: the
// caregiver got the job and never joined the family's roster, and the family had to go find
// her by hand every time. Found by the first behavioural test ever written for /claim.
const { v4: uuid } = require("uuid");

async function ensureAssignment(db, { careRecipientId, familyUserId, caregiverProfileId }) {
  if (!careRecipientId || !familyUserId || !caregiverProfileId) return;
  const existing = await db.prepare(`
    SELECT id, is_active FROM caregiver_assignments
    WHERE care_recipient_id = ? AND family_user_id = ? AND caregiver_profile_id = ?
  `).get(careRecipientId, familyUserId, caregiverProfileId);

  if (existing && existing.is_active) return; // already active

  if (existing && !existing.is_active) {
    // Reactivate a previously deactivated assignment
    await db.prepare("UPDATE caregiver_assignments SET is_active = 1 WHERE id = ?").run(existing.id);
    console.log(`[ensureAssignment] Reactivated assignment ${existing.id} for caregiver ${caregiverProfileId.slice(0,8)}`);
    return;
  }

  // Create new assignment
  const id = uuid();
  await db.prepare(`
    INSERT INTO caregiver_assignments (id, care_recipient_id, family_user_id, caregiver_profile_id, is_active, is_favorite)
    VALUES (?, ?, ?, ?, 1, 0)
  `).run(id, careRecipientId, familyUserId, caregiverProfileId);
  console.log(`[ensureAssignment] Created assignment ${id.slice(0,8)} for caregiver ${caregiverProfileId.slice(0,8)} → recipient ${careRecipientId.slice(0,8)}`);
}

module.exports = { ensureAssignment };
