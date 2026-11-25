// v1.158.5 — a call that never connected must not keep the microphone.
// Pete, 11/24: after a failed call from his iPhone, the red microphone dot stayed on and the
// dictation tones played every time he switched apps. Three leaks, each closed here:
//   1. hung up while iOS was still granting the mic → the tracks arrived after cleanup;
//   2. a connect attempt that lost the timeout race finished later and joined the room;
//   3. the error path skipped releasing the tracks when the call was already cancelled.
const { code } = require("./helpers/source");
const o = code("public/js/components/VideoCallOverlay.js");

test("tracks that arrive after hang-up are stopped at once", () => {
  expect(o).toMatch(/mediaTracks = stream\.getTracks\(\);\s*if \(cancelled\) \{ mediaTracks\.forEach\(\(t\) => \{ try \{ t\.stop\(\); \}/);
});

test("a connect we gave up on disconnects itself if it ever finishes", () => {
  expect(o).toMatch(/const pending = Video\.connect\(token, connectOptions\);/);
  expect(o).toMatch(/pending\.then\(\(r\) => \{ if \(gaveUp \|\| cancelled\) leaveRoom\(r\); \}/);
  expect(o).toMatch(/gaveUp = true;\s*try \{ if \(typeof pending\.cancel === 'function'\) pending\.cancel\(\); \}/);
  expect(o).not.toMatch(/Promise\.race\(\[\s*Video\.connect\(/);
});

test("the error path releases the microphone even after a hang-up", () => {
  expect(o).toMatch(/\} catch \(err\) \{\s*if \(cancelled\) \{\s*\(acquiredTracksRef\.current \|\| \[\]\)\.forEach\(\(t\) => \{ try \{ if \(t && t\.readyState !== 'ended'\) t\.stop\(\); \}/);
});

test("v1.160.1 — every way out of a room stops Twilio's own local tracks too", () => {
  // iOS: Twilio restarts the mic track when the app is backgrounded; that track is Twilio's, and
  // room.disconnect() leaves it running (Pete, 11/25: red dot after a voice call that ended fine).
  expect(o).toMatch(/function leaveRoom\(r\) \{[\s\S]*?r\.localParticipant\.tracks\.forEach\(\(pub\) => \{ try \{ if \(pub\.track\) pub\.track\.stop\(\); \}[\s\S]*?r\.disconnect\(\);/);
  // The only bare disconnect left is inside leaveRoom itself.
  expect((o.match(/\.disconnect\(\)/g) || []).length).toBe(1);
  expect(o).toMatch(/twilioRoom\.on\('disconnected', \(_room, discErr\) => \{[\s\S]{0,200}twilioRoom\.localParticipant\.tracks\.forEach\(\(pub\) => \{ try \{ if \(pub\.track\) pub\.track\.stop\(\);/);
});
