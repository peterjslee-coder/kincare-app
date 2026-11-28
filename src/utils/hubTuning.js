// ─── Teaching the Hub from the family's marks (v1.167.0) ───
//
// Pete, 11/27: "I want to be able to train the system. 'Good test' or 'not movement to count
// as up' etc." Then: "Suggest and confirm."
//
// The camera's model on the tablet can't be retrained. What can change are the rules around it,
// and those are the three settings below. Each saved minute in Admin → Hub check can be marked:
//   right   — it got this minute right (up when she was up, not up when she wasn't)
//   not_up  — it counted this minute, but it wasn't her being up (TV, movement, someone else)
//   missed  — it didn't count this minute, but she was up
// The marks are kept without the picture or sound (verdict + what the Hub noticed), so they
// still count after the review is deleted. suggestions() reads them and proposes a change only
// when the evidence is clear; nothing changes until the leader taps Apply.

const DEFAULTS = Object.freeze({
  personMin: 0.45,        // how sure the camera must be that it's a person (matches hubPersonCheck.js)
  motionNearPerson: true, // movement counts within 5 minutes of seeing a person
  soundNearPerson: true,  // sound counts within 5 minutes of seeing a person
});
const PERSON_MIN_RANGE = [0.3, 0.8];
const MIN_MARKS = 5;      // never suggest from fewer than this many marks of one kind

function cleanTuning(raw) {
  const out = { ...DEFAULTS };
  if (raw && typeof raw === "object") {
    const pm = Number(raw.personMin);
    if (Number.isFinite(pm)) out.personMin = Math.round(Math.max(PERSON_MIN_RANGE[0], Math.min(PERSON_MIN_RANGE[1], pm)) * 100) / 100;
    for (const k of ["motionNearPerson", "soundNearPerson"]) if (typeof raw[k] === "boolean") out[k] = raw[k];
  }
  return out;
}

/** What made a counted minute count, from the signals the Hub saved with it. */
function reasonOf(signals) {
  const g = signals || {};
  if (g.person === true) return "person";
  if (g.touches) return "touch";
  if (g.voiceSeconds >= 10 && !g.motion) return "sound";
  if (g.motion && !(g.voiceSeconds >= 10)) return "movement";
  if (g.motion) return "movement_sound";
  return "other";
}

/**
 * marks: [{ verdict, counted, signals }] → { score, suggestions: [{ key, change, title, why }] }.
 * Only suggests what would change the current tuning.
 */
function suggestions(marks, tuning) {
  const t = cleanTuning(tuning);
  const list = Array.isArray(marks) ? marks : [];
  const score = { marked: list.length, right: list.filter((m) => m.verdict === "right").length };
  score.notUp = list.filter((m) => m.verdict === "not_up").length;
  score.missed = list.filter((m) => m.verdict === "missed").length;

  const counted = list.filter((m) => m.counted);
  const by = (r) => counted.filter((m) => reasonOf(m.signals) === r || (r !== "person" && reasonOf(m.signals) === "movement_sound" && (r === "movement" || r === "sound")));
  const wrongShare = (ms) => (ms.length ? ms.filter((m) => m.verdict === "not_up").length / ms.length : 0);
  const out = [];
  const pct = (x) => `${Math.round(x * 100)}%`;

  const sound = by("sound");
  if (t.soundNearPerson && sound.length >= MIN_MARKS && wrongShare(sound) >= 0.7) {
    out.push({ key: "soundNearPerson", change: { soundNearPerson: false },
      title: "Stop counting sound when no one is in view",
      why: `You marked ${pct(wrongShare(sound))} of the minutes it counted for sound as not her being up (${sound.length} marked).` });
  }
  const move = by("movement");
  if (t.motionNearPerson && move.length >= MIN_MARKS && wrongShare(move) >= 0.7) {
    out.push({ key: "motionNearPerson", change: { motionNearPerson: false },
      title: "Stop counting movement when no one is in view",
      why: `You marked ${pct(wrongShare(move))} of the minutes it counted for movement as not her being up (${move.length} marked).` });
  }
  const person = by("person");
  if (person.length >= MIN_MARKS && wrongShare(person) >= 0.4 && t.personMin < PERSON_MIN_RANGE[1]) {
    const next = Math.min(PERSON_MIN_RANGE[1], Math.round((t.personMin + 0.1) * 100) / 100);
    out.push({ key: "personMin", change: { personMin: next },
      title: "Be stricter about what counts as a person",
      why: `It saw a "person" in ${person.length} minutes you marked, and ${pct(wrongShare(person))} weren't her being up. It would need ${Math.round(next * 100)}% sure instead of ${Math.round(t.personMin * 100)}%.` });
  }
  // Missed minutes that the camera saw only faintly: be a little less strict.
  const missed = list.filter((m) => !m.counted);
  const missedShare = missed.length ? missed.filter((m) => m.verdict === "missed").length / missed.length : 0;
  if (missed.length >= MIN_MARKS && missedShare >= 0.5 && t.personMin > PERSON_MIN_RANGE[0] && !out.some((o) => o.key === "personMin")) {
    const next = Math.max(PERSON_MIN_RANGE[0], Math.round((t.personMin - 0.1) * 100) / 100);
    out.push({ key: "personMin", change: { personMin: next },
      title: "Be less strict about what counts as a person",
      why: `Of ${missed.length} minutes it didn't count, you marked ${pct(missedShare)} as her being up. It would need ${Math.round(next * 100)}% sure instead of ${Math.round(t.personMin * 100)}%.` });
  }
  return { score, suggestions: out };
}

module.exports = { DEFAULTS, cleanTuning, reasonOf, suggestions, MIN_MARKS, PERSON_MIN_RANGE };
