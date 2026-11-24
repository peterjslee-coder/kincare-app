// ─── What one person may do with one care recipient (v1.105.78) ───
//
// Until now this was a single string on care_recipient_shares: 'view' or 'edit'. That is too
// coarse for the two real shapes Pete needs on Betty's team:
//
//   Julia  — reads notes and visit history, logs her own visits. Nothing to do with medication.
//   Peggy  — brings dinner, sometimes gives Betty her medication. Should be able to leave a
//            note and record that she was there, should NOT be able to read Betty's health
//            record, and should see medication tasks only if Pete deliberately grants it.
//
// Neither is expressible as view/edit, and 'view' turned out to be far more permissive than
// its name: careTasks.js gated check-off on `canCheckOff = (access) => !!access`, so ANY share
// — including view — could tick off a medication task. A guard that reads like a permission
// check and admits everyone is the same shape as the vacuous SQL predicates in v1.105.77.
//
// Capabilities are additive and explicit. The legacy strings map onto sets that preserve
// today's behaviour EXACTLY, so this migration changes nobody's access on the day it ships —
// including the surprising parts. Tightening is a separate, deliberate decision per invite.

const CAP = Object.freeze({
  READ_PROFILE: "read_profile",   // Betty's conditions, medications list, health record
  READ_NOTES: "read_notes",
  WRITE_NOTES: "write_notes",
  READ_VISITS: "read_visits",
  WRITE_VISITS: "write_visits",   // log a family visit — "someone was there"
  READ_TASKS: "read_tasks",       // see care tasks, including medication
  CHECK_TASKS: "check_tasks",     // tick one off / undo
  // ─── v1.105.165 — Pete: "new categoy of access for care team members: the ability to
  // schedule appointments." ───
  //
  // Adding a doctor's appointment needed MANAGE, which is also "edit the care profile and
  // delete any task". So a sibling who should be able to put cardiology on Tuesday had to be
  // handed the keys to the whole record. Its own capability now.
  SCHEDULE_EVENTS: "schedule_events", // add/edit appointments, outings — Betty's calendar
  // ─── The wall Pete asked for, and it did not exist ───
  //
  // "there needs to be a wall where the team leader controls who can bring caregivers (and
  // spend betty's money in doing so) into the home."
  //
  // POST /api/sessions accepted the owner, ANY care_recipient_shares row at any level, and ANY
  // care_team_members row. So every member of Betty's team — including a helper invited to
  // bring dinner — could raise a care request that books a stranger into the house and commits
  // the billing contact's card. Nothing anywhere asked whether they were allowed to.
  //
  // Deliberately NOT part of MANAGE: managing the care record and spending money are different
  // kinds of trust, and conflating them is how the gap above happened.
  BOOK_CARE: "book_care",         // raise a care request — brings a caregiver in, and bills
  MANAGE: "manage",               // create, edit, delete tasks and the care profile itself
});

const ALL = Object.freeze(Object.values(CAP));

// ─── Legacy mapping. Behaviour-preserving, deliberately. ───
//
// 'view' includes READ_TASKS and CHECK_TASKS because that is what it has always granted. It
// looks wrong and it IS wrong as a default, but silently revoking access from every existing
// share on deploy would be worse than the bug. Pete tightens it per person from the invite UI.
const VIEW_SET = [CAP.READ_PROFILE, CAP.READ_NOTES, CAP.WRITE_NOTES, CAP.READ_VISITS, CAP.WRITE_VISITS, CAP.READ_TASKS, CAP.CHECK_TASKS];

// ─── v1.105.165 — the one place this file deliberately does NOT preserve today's behaviour ───
//
// Everything else here maps legacy access onto exactly what it already granted, because
// silently revoking on deploy is worse than the bug. BOOK_CARE is the exception, and Pete
// asked for it in those words: booking a caregiver spends the billing contact's money and puts
// a stranger in Betty's house. It is not something a share should acquire by default because
// nobody thought to withhold it.
//
// So: owner, admin, and the levels that were given EVERYTHING (edit/full) keep it. A plain
// team member or viewer does not, and the team leader grants it per person. Anyone who could
// book yesterday and cannot today is exactly the set he wants to decide about.
const BOOKERS = [CAP.BOOK_CARE];

const LEGACY = Object.freeze({
  view: VIEW_SET,
  // careTasks.js has its own hasAccess() that returns "member" for a care-team member and for
  // an assigned caregiver. It is NOT the same word as the care_team_invites role of the same
  // name. Under the old guards ("member" satisfied `!!access` but failed canManage) it meant
  // exactly VIEW_SET — so that is what it maps to. Omitting it 403'd five integration tests
  // and would have locked every team member out of Care Tasks in production.
  member: VIEW_SET,
  edit: ALL,
  full: ALL,
  owner: ALL,
  admin: ALL,
});

// The two presets the invite UI offers, named for the people who prompted them.
const PRESETS = Object.freeze({
  viewer: [CAP.READ_PROFILE, CAP.READ_NOTES, CAP.WRITE_NOTES, CAP.READ_VISITS, CAP.WRITE_VISITS],
  helper: [CAP.WRITE_NOTES, CAP.WRITE_VISITS],
  // v1.105.165 — "member" is the preset for a sibling who helps run things: the whole record,
  // appointments included. Booking paid care is still granted deliberately, not by preset.
  member: ALL.filter((c) => c !== CAP.BOOK_CARE),
});

/**
 * Resolve whatever is stored on a share into a capability list.
 * Accepts a JSON array (the new shape), a legacy level string, or null.
 */
function capabilitiesFor(stored, legacyLevel) {
  if (stored) {
    try {
      const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
      if (Array.isArray(parsed)) return parsed.filter((c) => ALL.includes(c));
    } catch { /* fall through to the legacy level */ }
  }
  return LEGACY[legacyLevel] ? [...LEGACY[legacyLevel]] : [];
}

/** Does this access result permit `cap`? Accepts a capability list or a legacy level string. */
function can(access, cap) {
  if (!access) return false;
  if (Array.isArray(access)) return access.includes(cap);
  const list = LEGACY[access];
  return Array.isArray(list) && list.includes(cap);
}

module.exports = { CAP, ALL, LEGACY, PRESETS, capabilitiesFor, can };
