// ─── Checking the noticing (v1.164.0) ───
//
// Pete, 11/26, looking at a night the Hub said Betty was up from 6 PM on: "I don't believe this
// report... The only way it's going to work is if I can review and verify what the camera is
// seeing. I want to record the photos of every 'up' and get the sound that together the app is
// counting as 'up'. It's listening to the tv... it's my mother, my sister is aware, and no I'm
// not going to keep this on the app. Delete it after every review, until I'm sure it's accurate."
//
// The drop-in consent she has (utils/dropIn.js) says "No pictures, video or sound are recorded or
// saved." This is the one thing that changes that, so it is its own signature with its own words,
// signed by the same people who may sign the drop-in consent (herself, her POA agent or her
// healthcare agent), and it limits itself:
//   • It lasts REVIEW_DAYS from signing, then stops on its own. It can be withdrawn any time.
//   • While it lasts, each minute the Hub reports noticing something, it sends one camera picture
//     and the last ~15 seconds of sound, with what it noticed and whether that minute counted.
//   • Only the care team leader can see or play them.
//   • They are deleted when the leader marks them reviewed, and always CLIP_HOURS after they
//     were taken, whichever is first. Bytes live in R2, never in Postgres.
//   • The Hub shows a small "Checking" mark while it is on, so it is never secret in her home.

const { v4: uuid } = require("uuid");

const REVIEW_DAYS = 7;
const CLIP_HOURS = 72;
const MAX_PHOTO_BYTES = 400 * 1024;
const MAX_AUDIO_BYTES = 600 * 1024;
const WORDING_VERSION = "2026-11-26";
const wordingFor = (name) => [
  `I agree that, for ${REVIEW_DAYS} days from now, the InPlace Hub in ${name}'s home may save what it sees and hears when it notices something, so the care team leader can check whether it is noticing ${name} or something else, like the TV:`,
  `Each minute it notices movement, talking, a person or a touch, it saves one camera picture and about 15 seconds of sound, with what it noticed. Only the care team leader can see or play them. They are deleted when the leader marks them reviewed, and always within ${CLIP_HOURS} hours. The Hub shows a small "Checking" mark while this is on.`,
  `I am ${name}, or I hold ${name}'s durable power of attorney or am ${name}'s healthcare agent, and I am choosing this on purpose. It ends by itself after ${REVIEW_DAYS} days, and anyone signing it, ${name}, or the care team leader can stop it sooner in InPlace.`,
].join("\n\n");

async function current(db, careRecipientId) {
  return db.prepare(
    `SELECT * FROM hub_review_consents WHERE care_recipient_id = ? AND revoked_at IS NULL AND ends_at > NOW()
      ORDER BY created_at DESC LIMIT 1`
  ).get(careRecipientId);
}

/** Checking is on only with a live signature AND the drop-in consent noticing depends on. */
async function isOn(db, careRecipientId) {
  const D = require("./dropIn");
  if (!(await D.mayNotice(db, careRecipientId))) return false;
  return !!(await current(db, careRecipientId));
}

async function sign(db, cr, user, capacity, signerName) {
  const id = uuid();
  await db.prepare(
    `INSERT INTO hub_review_consents (id, care_recipient_id, signed_by, signer_capacity, signer_name, wording_version, wording_text, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL '${REVIEW_DAYS} days')`
  ).run(id, cr.id, user.id, capacity, String(signerName).slice(0, 120), WORDING_VERSION, wordingFor(cr.first_name || "them"));
  return current(db, cr.id);
}

async function withdraw(db, careRecipientId, userId) {
  await db.prepare(
    "UPDATE hub_review_consents SET revoked_at = NOW(), revoked_by = ? WHERE care_recipient_id = ? AND revoked_at IS NULL"
  ).run(userId, careRecipientId);
  // Stopping means stopping: what was saved goes too.
  return deleteClips(db, careRecipientId);
}

/** Delete clips (all, or those taken up to `before`), bytes first. Returns how many. */
async function deleteClips(db, careRecipientId, opts) {
  const { before = null, expiredOnly = false } = opts || {};
  const S = require("./storage");
  const rows = await db.prepare(
    `SELECT id, photo_ref, audio_ref FROM hub_review_clips WHERE care_recipient_id = ?
      ${expiredOnly ? "AND expires_at <= NOW()" : ""} ${before ? "AND taken_at <= ?" : ""}`
  ).all(...[careRecipientId, ...(before ? [before] : [])]);
  for (const r of rows) {
    await S.deleteFileData(r.photo_ref);
    await S.deleteFileData(r.audio_ref);
    await db.prepare("DELETE FROM hub_review_clips WHERE id = ?").run(r.id);
  }
  return rows.length;
}

const DATA_URI = /^data:(image\/jpeg|audio\/webm|audio\/ogg|audio\/mp4)(;[^,]*)?;base64,/;
const bytesOf = (uri) => Math.floor((String(uri).length - String(uri).indexOf(",") - 1) * 3 / 4);

/**
 * Save one minute. → { saved } or { saved: false, reason }. Never stores bytes in Postgres:
 * without R2 configured it refuses (the base64-in-Postgres class, CLAUDE.md rule 9).
 */
async function saveClip(db, careRecipientId, { photo, audio, counted, signals }) {
  const S = require("./storage");
  if (!S.isEnabled()) return { saved: false, reason: "no_storage" };
  const okPhoto = typeof photo === "string" && DATA_URI.test(photo) && photo.startsWith("data:image/jpeg") && bytesOf(photo) <= MAX_PHOTO_BYTES;
  const okAudio = typeof audio === "string" && DATA_URI.test(audio) && audio.startsWith("data:audio/") && bytesOf(audio) <= MAX_AUDIO_BYTES;
  if (!okPhoto && !okAudio) return { saved: false, reason: "nothing_to_save" };
  const photoRef = okPhoto ? await S.storeFileData("hubreview", photo) : null;
  const audioRef = okAudio ? await S.storeFileData("hubreview", audio) : null;
  if ((photoRef && !S.isRemote(photoRef)) || (audioRef && !S.isRemote(audioRef))) return { saved: false, reason: "no_storage" };
  const clean = {
    motion: !!(signals && signals.motion),
    voiceSeconds: Math.max(0, Math.min(60, Number(signals && signals.voiceSeconds) || 0)),
    touches: Math.max(0, Math.min(200, Math.floor(Number(signals && signals.touches) || 0))),
    person: signals && signals.person === true ? true : signals && signals.person === false ? false : null,
    seen: Array.isArray(signals && signals.seen) ? signals.seen.slice(0, 12).map((x) => String(x).slice(0, 40)) : [],
    personCheck: String((signals && signals.personCheck) || "").slice(0, 20) || null,
  };
  await db.prepare(
    `INSERT INTO hub_review_clips (id, care_recipient_id, counted, signals, photo_ref, audio_ref, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW() + INTERVAL '${CLIP_HOURS} hours')`
  ).run(uuid(), careRecipientId, !!counted, JSON.stringify(clean), photoRef, audioRef);
  return { saved: true };
}

async function listClips(db, careRecipientId) {
  await deleteClips(db, careRecipientId, { expiredOnly: true });
  const rows = await db.prepare(
    "SELECT id, taken_at, counted, signals, photo_ref, audio_ref, expires_at FROM hub_review_clips WHERE care_recipient_id = ? ORDER BY taken_at"
  ).all(careRecipientId);
  return rows.map((r) => {
    let signals = {};
    try { signals = JSON.parse(r.signals || "{}"); } catch { signals = {}; }
    return { id: r.id, takenAt: r.taken_at, counted: !!r.counted, signals, hasPhoto: !!r.photo_ref, hasAudio: !!r.audio_ref, expiresAt: r.expires_at };
  });
}

module.exports = {
  REVIEW_DAYS, CLIP_HOURS, WORDING_VERSION, wordingFor, MAX_PHOTO_BYTES, MAX_AUDIO_BYTES,
  current, isOn, sign, withdraw, deleteClips, saveClip, listClips,
};
