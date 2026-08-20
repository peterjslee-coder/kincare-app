// ─── src/utils/age.js — signup age gate (v1.105.8) ───
//
// WHY 13
// ------
// The app had NO age gate at all: no date of birth collected anywhere, no minimum age
// enforced, while the Privacy Policy claimed under-13s were not intended users. Both app
// stores make you DECLARE an age rating, which is a statement about who can use the app —
// so it needs to be true before it's declared.
//
// 13 is the right floor, and three separate things line up on it:
//   * COPPA attaches below 13. Verifiable parental consent on a product holding health data
//     is a burden worth avoiding entirely.
//   * Google Play's Families policy applies to apps whose audience includes under-13s.
//   * Stripe will not open an account below 13 either, so a younger child could never be paid
//     regardless — and for anyone 13–17 Stripe requires an adult Representative (a parent or
//     guardian) on the account.
//
// Younger family members are still recordable WITHOUT an account: Care Tasks supports a named
// non-user helper. That's the route for a 10-year-old grandchild, not an account.
//
// NOTE: this gates ACCOUNT CREATION only. Existing users predate it and have a null
// date_of_birth; they are not locked out. Whether a 13–17-year-old may be PAID is a separate
// and much harder question (child labour law, capacity to contract, background checks,
// insurance) — on the lawyer agenda, deliberately not encoded here.

const MIN_SIGNUP_AGE = 13;

/**
 * Whole years between a date of birth and a reference date.
 *
 * Deliberately calendar arithmetic on Y/M/D integers rather than millisecond subtraction:
 * ms-based age is wrong across leap years and DST, and `new Date(str)` parses a bare
 * "YYYY-MM-DD" as UTC midnight, which can land on the previous day in a negative-offset
 * timezone — the app already got burned by exactly that class of bug (see the timezone rules
 * in CLAUDE.md). Someone born on Feb 29 turns 13 on Mar 1 in a non-leap year, which falls out
 * of this comparison naturally.
 *
 * @param {string} dob  "YYYY-MM-DD"
 * @param {Date}   [now] reference date; defaults to now. Read in UTC — see below.
 * @returns {number|null} whole years, or null if the input isn't a valid calendar date
 */
function ageInYears(dob, now = new Date()) {
  if (typeof dob !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim());
  if (!m) return null;

  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // Reject dates that don't exist (2025-02-30, 2025-04-31, …).
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }

  // v1.105.102 — UTC on BOTH sides. This read `now.getFullYear()/getMonth()/getDate()`,
  // i.e. the SERVER'S LOCAL DATE, while the dob above is parsed as bare calendar integers.
  // Two frames in one comparison: the same date of birth got a different answer depending on
  // which machine asked. Railway runs UTC and GitHub Actions runs UTC, so production and CI
  // agreed and nothing showed — but on a developer machine in Eastern time, every evening
  // after 8pm the gate rejected people on their own 13th birthday, and
  // tests/integration/auth.itest.js failed for that reason alone.
  // The same class as the timezone-frame rule in CLAUDE.md: never compare a value in one
  // frame against a value in another.
  const ny = now.getUTCFullYear(), nmo = now.getUTCMonth() + 1, nd = now.getUTCDate();
  let age = ny - y;
  if (nmo < mo || (nmo === mo && nd < d)) age -= 1;
  return age;
}

/**
 * @returns {{ok: true, age: number} | {ok: false, reason: string, message: string}}
 * `message` is user-facing and deliberately does NOT say "you are too young" — it states the
 * requirement, so a mistyped year reads as a correctable input error rather than a rejection.
 */
function checkSignupAge(dob, now = new Date()) {
  const age = ageInYears(dob, now);

  if (age === null) {
    return { ok: false, reason: "invalid", message: "Please enter your date of birth as a valid date." };
  }
  if (age < 0) {
    return { ok: false, reason: "future", message: "That date of birth is in the future — please check it." };
  }
  if (age > 120) {
    return { ok: false, reason: "implausible", message: "Please check your date of birth." };
  }
  if (age < MIN_SIGNUP_AGE) {
    return {
      ok: false,
      reason: "under_age",
      message:
        `You must be at least ${MIN_SIGNUP_AGE} to have an InPlace account. ` +
        `A parent or guardian can add a younger family member to a care team as a helper without an account.`,
    };
  }
  return { ok: true, age };
}

module.exports = { MIN_SIGNUP_AGE, ageInYears, checkSignupAge };
