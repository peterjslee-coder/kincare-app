// ─── v1.109.6 — did she read what you asked? ───
//
// Pete, 9/28: "if I leave caregiver instructions, does it require the caretaker to acknowledge
// them? I get the sense Tina is just sort of blasting through the check in and missing notes."
//
// Until now: one checkbox covered the briefing, the AI synthesis, the notes AND the family's
// instructions, and instructions added AFTER check-in reached the caregiver by no route at all —
// no push, no socket event, nothing on her active-visit card. The missed shower in feedback
// 06bc6bd3 is that second hole.
//
// Two timestamps on care_sessions carry it (migration 048):
//   instructions_updated_at       — the family last CHANGED the text
//   instructions_acknowledged_at  — the caregiver last confirmed she read it
// An acknowledgement only counts for the text she was actually shown: every acknowledging
// request carries the text on her screen, and a mismatch stamps nothing. That is what makes an
// offline check-in honest — if the family edited while she was in a dead zone, the queued ack is
// for words that no longer exist, and her card asks again.

function normalize(text) {
  return String(text == null ? "" : text).replace(/\r\n/g, "\n").trim();
}

function sameInstructions(a, b) {
  return normalize(a) === normalize(b);
}

/** True when there is instruction text the assigned caregiver has not confirmed reading. */
function instructionsNeedAck(session) {
  if (!session) return false;
  if (!normalize(session.special_instructions)) return false;
  if (!session.instructions_acknowledged_at) return true;
  if (!session.instructions_updated_at) return false;
  return new Date(session.instructions_updated_at) > new Date(session.instructions_acknowledged_at);
}

module.exports = { normalize, sameInstructions, instructionsNeedAck };
