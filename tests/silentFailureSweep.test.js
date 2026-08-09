// v1.105.48 — the sweep.
//
// Three days of bugs that all had the same shape: the app going quiet instead of saying
// something. A badge that counted a predicate which was always true. A geofence that bailed
// on a Chrome-only capability check. A save that hung forever because fetch has no timeout.
// Each was found by Pete tripping over it, which is the expensive way.
//
// So we went looking on purpose. What follows are the ones that were real, in the two
// categories he picked first: things that touch money or legal obligations, and things that
// touch safety. Every one of them had been failing since the day it was written, and not one
// of them had ever produced a symptom anybody could see.
//
// These are source-shape tests. Where behaviour is testable it is tested in the integration
// suite; what belongs here is a record of the exact wrong thing, so it cannot come back.

const { code } = require("./helpers/source");

describe("things that were legally or financially broken", () => {
  test("account deletion targets a column that exists", () => {
    // `authorization_documents.uploaded_by_user_id` has never existed — the column is
    // `submitted_by`. The statement sits inside the delete TRANSACTION, so it threw, rolled
    // everything back and answered 500. "Delete my account" has never worked for anyone,
    // and no PII was ever anonymised.
    const auth = code("src/routes/auth.js");
    expect(auth).toMatch(/UPDATE authorization_documents SET retained_from_deleted = 1, deleted_user_email = \? WHERE submitted_by = \?/);
    expect(auth).not.toMatch(/uploaded_by_user_id/);
  });

  test("remove-role is one transaction, and every column in it is real", () => {
    // Three defects in one handler: availability keyed by profile id but passed a user id;
    // caregiver_assignments.caregiver_id (it's caregiver_profile_id); and activity_feed
    // columns that don't exist. It always 500'd — but the roles UPDATE had already
    // committed outside any transaction, so the user was told it failed while it half had.
    const auth = code("src/routes/auth.js");
    const start = auth.indexOf("const newRoles = currentRoles.filter");
    const fn = auth.slice(start, auth.indexOf("res.json({ roles: newRoles", start));
    expect(fn).toMatch(/await db\.transaction\(async \(tx\) => \{/);
    expect(fn).toMatch(/SELECT id FROM caregiver_profiles WHERE user_id = \?/);
    expect(fn).toMatch(/DELETE FROM availability WHERE caregiver_id = \?\"\)\.run\(profile\.id\)/);
    expect(fn).toMatch(/DELETE FROM caregiver_assignments WHERE caregiver_profile_id = \?/);
    expect(fn).toMatch(/INSERT INTO activity_feed \(id, family_user_id, event_type, title, message, created_at\)/);
    expect(fn).not.toMatch(/caregiver_assignments WHERE caregiver_id/);
  });

  test("a failed payment capture is retried, not shrugged off", () => {
    // Check-out left payment_status = 'authorized' on failure. The auto-pay sweeper takes
    // only NULL or 'pending'; the lockout banner fires only on 'failed'. So the caregiver
    // was never paid, the family never charged, and the hold expired a week later in
    // silence. Check-out still succeeds — the visit happened — but the money is now chased.
    const s = code("src/routes/sessions.js");
    expect(s).toMatch(/const failCapture = async \(why\) => \{/);
    expect(s).toMatch(/UPDATE care_sessions SET payment_status = 'pending'/);
    expect(s).toMatch(/where: "checkout: capture"/);
  });

  test("we only say 'you have not been charged' when the hold actually released", () => {
    const safety = code("src/routes/safety.js");
    expect(safety).toMatch(/const voided = await voidSessionPayment\(s\.id\);/);
    expect(safety).toMatch(/voidFailures\+\+/);
    expect(safety).toMatch(/We couldn't release one of the payment holds/);
  });

  test("a no-show promises no charge only after voiding, and reports it when it can't", () => {
    const acc = code("src/routes/accountability.js");
    expect(acc).toMatch(/const voidedNoShow = await voidSessionPayment\(s\.id\);/);
    expect(acc).toMatch(/where: "accountability: no-show void"/);
  });

  test("a disputed fee is marked 'dropped' only once it really is", () => {
    // It used to write 'dropped' whether or not the void succeeded — a record asserting the
    // fee was released while the hold sat live on the card.
    const acc = code("src/routes/accountability.js");
    expect(acc).toMatch(/const voidedStale = await voidSessionPayment\(s\.id\);/);
    expect(acc).toMatch(/continue; \/\/ leave it 'disputed' so the next sweep retries it/);
  });

  test("the two money webhooks no longer swallow with a bare catch", () => {
    const pay = code("src/routes/payments.js");
    expect(pay).toMatch(/where: "payments: ACH-failed notify"/);
    expect(pay).toMatch(/where: "payments: ACH-settled digest"/);
  });
});

describe("things that were broken where it matters most", () => {
  test("the admin safety panel queries columns that exist", () => {
    // reporter_user_id, flagged_user_id, caregiver_user_id and description were all
    // invented. The query threw every time and an empty catch turned that into an empty
    // array — so an admin checking whether someone had ever been reported saw a clean
    // record. For every user. Including the ones with flags.
    const ov = code("src/routes/admin/overview.js");
    expect(ov).toMatch(/SELECT id, flag_type, user_message, status, severity, created_at/);
    const qi = ov.indexOf("SELECT id, flag_type, user_message");
    const q = ov.slice(qi, qi + 260);
    expect(q).toMatch(/FROM safety_flags\s+WHERE user_id = \?/);
    // (admin_tickets legitimately has reporter_user_id — scope the check to this query.)
    expect(q).not.toMatch(/reporter_user_id|flagged_user_id|caregiver_user_id|description/);
    expect(ov).toMatch(/where: "admin\/overview: safety flags"/);
  });

  test("a lost abuse flag is reported instead of vanishing", () => {
    const ms = code("src/utils/messageSafety.js");
    expect(ms).toMatch(/where: "messageSafety: screening"/);
  });

  test("the safety-flag audit write can no longer disappear", () => {
    // `.catch(() => {})` on the row that records WHO dismissed an abuse flag and why —
    // including on the passkey-verified route whose entire purpose is provenance.
    const as = code("src/routes/admin/safety.js");
    expect(as).not.toMatch(/INSERT INTO safety_flag_events[\s\S]{0,400}?\)\.catch\(\(\) => \{\}\)/);
    expect((as.match(/INSERT INTO safety_flag_events/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("the care team is told when a caregiver accepts", () => {
    // `AND ctm.status = 'active'` — care_team_members has no status column, so the query
    // threw and the catch logged a line. Siblings and other adult children were never
    // notified that a caregiver had accepted; only the person who booked it found out.
    const s = code("src/routes/sessions.js");
    const at = s.indexOf("SELECT DISTINCT ctm.user_id");
    const block = s.slice(at, at + 320);
    expect(block).not.toMatch(/ctm\.status/);
    expect(block).toMatch(/WHERE cr\.id = \? AND ctm\.user_id != \?/);
  });

  test("accessibility preferences can actually be saved", () => {
    // Same phantom `status = 'accepted'`, unguarded, so the route always 500'd. Text size
    // for a care recipient has never been settable.
    const ct = code("src/routes/careTeams.js");
    expect(ct).not.toMatch(/care_team_members WHERE care_team_id = \? AND user_id = \? AND status = 'accepted'/);
    expect(ct).not.toMatch(/ctm\.status = 'accepted'/);
  });

  test("the consent audit trail loads", () => {
    // attestation_signer / _relationship / _signed_at are aliases over the `attestations`
    // table, not columns on care_recipients. Selecting them off cr threw, so
    // GET /api/documents/audit/:id has always 500'd and the trail never rendered.
    const d = code("src/routes/documents.js");
    expect(d).toMatch(/LEFT JOIN LATERAL \(/);
    expect(d).toMatch(/att\.signature_name AS attestation_signer/);
    expect(d).not.toMatch(/cr\.attestation_signer/);
  });
});
