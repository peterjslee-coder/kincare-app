/**
 * Reviewed exemptions for lint:blobs (v1.106.8).
 *
 * Its own module so the gate and tests/batch4Storage.test.js read the SAME list — a second
 * copy is how an exemption outlives its reason. Every entry is "<file> — <why>", and the test
 * fails an entry with no reason written down.
 */
const BASELINE = [
  // Each entry needs a reason and stays only as long as the reason does.
  "src/routes/oauth.js — writes a REMOTE https avatar URL from Google, not bytes we hold. " +
    "profile_photo means 'an image we store'; avatar_url is where a third party's URL goes. " +
    "Two columns with two meanings is not duplication. (Note: media.js cannot serve a remote " +
    "URL — v1.106.3 removed the 302 on purpose — so these avatars do not render. Separate bug.)",
  "src/seed.js — demo data. Runs against an empty database, never in a user's request path.",
  "src/repair-demo.js — demo repair script, same reason as seed.js.",
  "src/routes/admin/demoTools.js — rewrites demo accounts' pravatar URLs; remote URLs, not bytes.",
];

module.exports = { BASELINE };
