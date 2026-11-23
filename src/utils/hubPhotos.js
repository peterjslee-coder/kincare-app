// ─── Photos on the InPlace Hub (v1.155.0) ───
//
// The decision (11/23): anyone on the care team can add a photo to the person's screen and see
// it, and a caregiver's photo shows there only if she chooses "Show on <name>'s screen".
//
// No third copy of anyone's photo: a `show_on_hub` flag on the two tables that already hold
// them — care_photos (family: saved from Messages, or added directly) and visit_photos
// (caregivers, at check-out). This module is the one place that decides:
//   - whether a person's Hub is on (only then is the choice offered at all),
//   - which photos her screen shows, newest first,
//   - who may load one of those images (her own trusted account, or family on her team).

const { parseSimpleMode } = require("./simpleMode");
const { TRUSTED_LINK_SQL } = require("./linkedAccount");

const HUB_PHOTO_LIMIT = 8;

/** Is the Simple screen on, with the Hub on, for this care recipient? */
async function hubOn(db, recipientId) {
  if (!recipientId) return false;
  const row = await db.prepare("SELECT simple_mode FROM care_recipients WHERE id = ?").get(recipientId);
  if (!row) return false;
  const mode = parseSimpleMode(row.simple_mode);
  return !!(mode.on && mode.hub && mode.hub.on);
}

/** URL the Hub (and family) load a flagged photo from. */
function hubImageUrl(kind, id) {
  return `/api/care-photos/hub/${kind === "visit" ? "visit" : "care"}/${id}/image`;
}

/** The photos her screen shows: flagged, not deleted, newest first. */
async function hubPhotosFor(db, recipientId, limit = HUB_PHOTO_LIMIT) {
  const n = Math.max(1, Math.min(20, Number(limit) | 0 || HUB_PHOTO_LIMIT));
  const care = await db.prepare(`
    SELECT p.id, p.caption, p.created_at, 'care' AS kind,
           COALESCE(au.first_name, su.first_name) AS from_first
      FROM care_photos p
      LEFT JOIN users au ON p.added_by = au.id
      LEFT JOIN messages m ON p.source_message_id = m.id
      LEFT JOIN users su ON m.sender_id = su.id
     WHERE p.care_recipient_id = ? AND p.show_on_hub = 1 AND p.deleted_at IS NULL
     ORDER BY p.created_at DESC LIMIT ${n}
  `).all(recipientId);
  const visit = await db.prepare(`
    SELECT vp.id, vp.caption, vp.created_at, 'visit' AS kind, u.first_name AS from_first
      FROM visit_photos vp
      JOIN visit_logs vl ON vp.visit_log_id = vl.id
      JOIN care_sessions cs ON vl.session_id = cs.id
      JOIN caregiver_profiles cp ON vl.caregiver_id = cp.id
      JOIN users u ON cp.user_id = u.id
     WHERE cs.care_recipient_id = ? AND vp.show_on_hub = 1
     ORDER BY vp.created_at DESC LIMIT ${n}
  `).all(recipientId);
  return [...care, ...visit]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, n)
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      url: hubImageUrl(p.kind, p.id),
      from: p.from_first || null,
      caption: p.caption || null,
      createdAt: p.created_at,
    }));
}

/** The stored row behind a Hub photo: { photo_url, care_recipient_id, show_on_hub } or null. */
async function hubPhotoRow(db, kind, id) {
  if (kind === "care") {
    return db.prepare(
      "SELECT id, photo_url, care_recipient_id, show_on_hub FROM care_photos WHERE id = ? AND deleted_at IS NULL"
    ).get(id);
  }
  if (kind === "visit") {
    return db.prepare(`
      SELECT vp.id, vp.photo_url, cs.care_recipient_id, vp.show_on_hub
        FROM visit_photos vp
        JOIN visit_logs vl ON vp.visit_log_id = vl.id
        JOIN care_sessions cs ON vl.session_id = cs.id
       WHERE vp.id = ?
    `).get(id);
  }
  return null;
}

/** Is `userId` this person's own trusted account? */
async function isTheirOwnAccount(db, recipientId, userId) {
  const row = await db.prepare(
    `SELECT 1 FROM care_recipients cr WHERE cr.id = ? AND cr.linked_user_id = ? AND ${TRUSTED_LINK_SQL}`
  ).get(recipientId, userId);
  return !!row;
}

/** Family on her team (anyone who can read her visits and is not acting as a caregiver). */
async function isFamilyFor(db, recipientId, user) {
  if ((user.activeRole || user.role) === "caregiver") return false;
  if (await isTheirOwnAccount(db, recipientId, user.id)) return false; // she is not her own family
  const { recipientsWithCapabilityFor } = require("./access");
  const { CAP } = require("./capabilities");
  const list = await recipientsWithCapabilityFor(db, user.id, CAP.READ_VISITS);
  return list.some((r) => r.id === recipientId);
}

/**
 * May this user load this Hub photo? Her own account: only while it is flagged for her screen.
 * Family on her team: always (they can already see the photo elsewhere). Returns the row or null.
 */
async function hubPhotoForViewer(db, kind, id, user) {
  const row = await hubPhotoRow(db, kind, id);
  if (!row) return null;
  // Her own account is decided here and only here: she can read her own visits, so the family
  // test below would otherwise let her open a photo the team took off her screen.
  if (await isTheirOwnAccount(db, row.care_recipient_id, user.id)) return row.show_on_hub === 1 ? row : null;
  if (await isFamilyFor(db, row.care_recipient_id, user)) return row;
  return null;
}

module.exports = { HUB_PHOTO_LIMIT, hubOn, hubImageUrl, hubPhotosFor, hubPhotoRow, hubPhotoForViewer, isFamilyFor, isTheirOwnAccount };
