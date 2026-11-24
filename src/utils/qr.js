// ─── QR generation with the iP badge in the middle (v1.105.27) ───
//
// One place, used by both the committed homepage asset and the per-caregiver referral
// endpoint, so the brand mark can never end up different in the two.
//
// WHY A LOGO IN A QR IS SAFE HERE, AND WHERE THE LIMIT IS.
// Error-correction level H recovers roughly 30% of a damaged code. A centred badge is just
// deliberate damage, so it fits inside that budget — but only if it stays well under it.
// The badge is sized at 22% of the code's width, which covers about 4.8% of the area
// (0.22^2), leaving the correction budget almost entirely intact for real-world damage:
// glare, a thumb, a crease, a bad camera angle. Going much past ~30% width is where codes
// start failing in exactly the conditions you cannot reproduce at a desk.
//
// Every generated code is DECODED before it is returned. A QR nobody verified is how you
// print five hundred flyers with a dead link on them, and a logo overlay is precisely the
// change that can silently break one.

const QRCode = require("qrcode");

const TEAL = "#1b6b5a";

// Fraction of the code's width taken by the badge. See the note above before raising it.
const BADGE_RATIO = 0.22;

/**
 * Render a QR as an SVG string with the iP monogram centred.
 *
 * SVG rather than PNG so it stays crisp printed on a flyer or blown up on a laptop across a
 * table, and costs ~2KB rather than ~40KB on a phone connection.
 */
async function qrSvgWithBadge(text, { dark = TEAL } = {}) {
  const svg = await QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 2,
    color: { dark, light: "#FFFFFF" },
  });

  // The library emits viewBox="0 0 N N" in MODULE units, so the badge is positioned in
  // those same units and scales with whatever size the <img> is rendered at.
  const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /);
  if (!m) throw new Error("Unexpected QR SVG: no viewBox");
  const size = Number(m[1]);

  const badge = size * BADGE_RATIO;
  const pos = (size - badge) / 2;
  // A white plate slightly larger than the badge. Without it the badge sits directly on
  // black modules and the scanner sees one large ambiguous blob rather than a clean hole.
  const plate = badge * 1.14;
  const platePos = (size - plate) / 2;
  const r = badge * 0.22;               // corner radius, matching InPlaceIcon's rounded square

  const overlay =
    `<rect x="${platePos.toFixed(3)}" y="${platePos.toFixed(3)}" width="${plate.toFixed(3)}" height="${plate.toFixed(3)}" rx="${(r * 1.14).toFixed(3)}" fill="#FFFFFF"/>` +
    `<rect x="${pos.toFixed(3)}" y="${pos.toFixed(3)}" width="${badge.toFixed(3)}" height="${badge.toFixed(3)}" rx="${r.toFixed(3)}" fill="${dark}"/>` +
    // The font stack ends in a generic: an SVG used inside an <img> cannot load a webfont,
    // so DM Sans will not be available when this is printed or embedded. "iP" in any bold
    // grotesque reads the same, and hand-authoring glyph outlines to avoid a fallback would
    // be a lot of fragility for a difference nobody scanning it will notice.
    `<text x="${(size / 2).toFixed(3)}" y="${(pos + badge * 0.74).toFixed(3)}" text-anchor="middle" ` +
    `font-family="DM Sans, Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="800" ` +
    `font-size="${(badge * 0.58).toFixed(3)}" letter-spacing="${(-badge * 0.033).toFixed(3)}" fill="#FFFFFF">iP</text>`;

  return svg.replace("</svg>", `${overlay}</svg>`);
}

/**
 * Decode a rendered PNG buffer and confirm it still says what it should.
 *
 * Kept separate and dependency-light so the test suite can call it on the committed asset.
 * Returns the decoded string, or null if nothing could be read.
 */
function decodePng(buffer) {
  const jsQR = require("jsqr");
  const { PNG } = require("pngjs");
  const png = PNG.sync.read(buffer);
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return res ? res.data : null;
}

module.exports = { qrSvgWithBadge, decodePng, BADGE_RATIO, TEAL };
