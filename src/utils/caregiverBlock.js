/**
 * Stop a caregiver working, pending Pete's review. (v1.106.14)
 *
 * Pete, 13 Sep: "if someone fails a background check, they don't get jobs, they don't get an
 * invitation to do anything until I am in the loop and have reviewed their check."
 *
 * None of that was happening. The three adverse Checkr webhooks — report.suspended,
 * report.pre_adverse_action and report.post_adverse_action — each did exactly one thing:
 *
 *     UPDATE caregiver_profiles SET checkr_status = 'did_not_pass' WHERE checkr_candidate_id = ?
 *
 * A status string. Nothing else. Specifically NOT is_background_checked, which is the column
 * every work gate in the app actually reads. So a caregiver who had already been cleared —
 * initial report clear, or a `consider` an admin approved — and who later failed adverse action
 * kept is_background_checked = 1 and kept being offered jobs across the whole platform. The
 * status said did_not_pass and every gate said yes.
 *
 * The second hole is the vouch. Both work gates read
 *
 *     is_background_checked = 1 OR <an active admin vouch for this family>
 *
 * and a vouch was revoked only by an admin clicking revoke. Nothing in the Checkr path touched
 * it. So a caregiver Pete had vouched for, who then failed, went on working for that family
 * indefinitely.
 *
 * This is the one place that closes both, plus the account pause the manual admin reject already
 * used. One transaction, because a half-applied block is a caregiver who is unavailable but
 * still vouched, or blocked platform-wide but still working for one family.
 *
 * Deliberately NOT a decision. It is a hold: the caregiver is stopped and Pete is told. What
 * happens next is his, which is the whole point of the rule.
 */

/**
 * @param {object} db
 * @param {object} opts
 * @param {string} [opts.caregiverUserId]  resolve by user id…
 * @param {string} [opts.candidateId]      …or by Checkr candidate id (what the webhooks carry)
 * @param {string} opts.reason             shown to the caregiver and stored on the profile
 * @param {string} opts.source             audit breadcrumb, e.g. "checkr:post_adverse_action"
 * @returns {Promise<{blocked: boolean, userId: string|null, vouchesRevoked: number, wasCleared: boolean}>}
 */
async function blockPendingAdminReview(db, { caregiverUserId = null, candidateId = null, reason, source }) {
  const profile = caregiverUserId
    ? await db.prepare(
        "SELECT user_id, is_background_checked, account_paused FROM caregiver_profiles WHERE user_id = ?"
      ).get(caregiverUserId)
    : await db.prepare(
        "SELECT user_id, is_background_checked, account_paused FROM caregiver_profiles WHERE checkr_candidate_id = ?"
      ).get(candidateId);

  if (!profile) return { blocked: false, userId: null, vouchesRevoked: 0, wasCleared: false };

  const userId = profile.user_id;
  // Worth reporting separately: this one was actively cleared for work until now, so the block
  // is a change in what they can do today, not a formality on someone already stopped.
  const wasCleared = !!profile.is_background_checked;

  let vouchesRevoked = 0;
  await db.transaction(async (tx) => {
    await tx.prepare(`
      UPDATE caregiver_profiles SET
        is_background_checked = 0,
        is_available = 0,
        account_paused = 1,
        account_paused_reason = ?,
        account_paused_at = NOW(),
        updated_at = NOW()
      WHERE user_id = ?
    `).run(reason, userId);

    // revoked_by is a TEXT column and normally holds an admin user id. No admin is acting here,
    // so it records the system path instead — an audit trail that says a machine did this, and
    // which webhook, rather than silently looking like someone clicked revoke.
    const r = await tx.prepare(
      "UPDATE bg_admin_vouches SET revoked_at = NOW(), revoked_by = ? WHERE caregiver_user_id = ? AND revoked_at IS NULL"
    ).run(`system:${source}`, userId);
    vouchesRevoked = (r && r.changes) || 0;
  });

  return { blocked: true, userId, vouchesRevoked, wasCleared };
}

module.exports = { blockPendingAdminReview };
