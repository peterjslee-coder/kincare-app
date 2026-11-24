// ─── Admin vouches (v1.64.0 honest-override batch) ───
// A vouch approves ONE caregiver for ONE family. It is not a background check.

async function hasActiveVouch(db, caregiverUserId, familyUserId) {
  if (!caregiverUserId || !familyUserId) return false;
  const row = await db.prepare(
    "SELECT id FROM bg_admin_vouches WHERE caregiver_user_id = ? AND family_user_id = ? AND revoked_at IS NULL LIMIT 1"
  ).get(caregiverUserId, familyUserId);
  return !!row;
}

async function hasAnyActiveVouch(db, caregiverUserId) {
  const row = await db.prepare(
    "SELECT id FROM bg_admin_vouches WHERE caregiver_user_id = ? AND revoked_at IS NULL LIMIT 1"
  ).get(caregiverUserId);
  return !!row;
}

// All active vouches for a caregiver, with family display names.
async function activeVouchesFor(db, caregiverUserId) {
  return await db.prepare(`
    SELECT v.id, v.family_user_id, v.note, v.created_at,
           u.first_name || ' ' || u.last_name AS family_name
    FROM bg_admin_vouches v
    JOIN users u ON u.id = v.family_user_id
    WHERE v.caregiver_user_id = ? AND v.revoked_at IS NULL
    ORDER BY v.created_at ASC
  `).all(caregiverUserId);
}

module.exports = { hasActiveVouch, hasAnyActiveVouch, activeVouchesFor };
