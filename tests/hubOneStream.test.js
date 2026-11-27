// v1.161.0 — Pete, 11/25: "yes to one stream...no tapping. big reminder pop up until
// acknowledged or replied, then back to pictures streaming." and "a plus a reminder (not on
// hub) to rotate phone if not already." Server behaviour: tests/integration/quickAddTextGroup.itest.js.
const { code, raw } = require("./helpers/source");
const phone = code("public/js/components/RecipientPhone.js");
const overlay = code("public/js/components/VideoCallOverlay.js");

describe("one stream", () => {
  test("a private message says so, in words, with no extra tap", () => {
    expect(raw("public/js/components/RecipientPhone.js")).toMatch(/w\.private \? `Just to you, from \$\{w\.from\}`/);
  });
  test("the pop-up stays until Got it or a reply — Write back no longer dismisses it", () => {
    expect(phone).toMatch(/\{ label: 'Write back', onClick: \(\) => onText\(waiting\) \}/);
    expect(phone).not.toMatch(/label: 'Write back', onClick: \(\) => \{ done\(k\); onText\(\); \}/);
  });
  test("Write back answers the way it came; Text my family goes to the group", () => {
    expect(phone).toMatch(/const target = w && w\.private && w\.conversationId \? w : null;/);
    expect(phone).toMatch(/onClick=\{\(\) => openText\(null\)\}/);
    // A private reply takes that message off her screen.
    expect(phone).toMatch(/if \(replyTo && data\?\.careRecipientId\) \{\s*apiFetch\(`\/api\/care-recipients\/\$\{data\.careRecipientId\}\/simple-screen\/text-ack`/);
  });
  test("Got it names every thread the pop-up came from", () => {
    expect(phone).toMatch(/body: JSON\.stringify\(\{ conversationIds: convs \}\)/);
  });
  test("v1.162.1 — a message or note chimes every 10 minutes until answered; others keep 3 chimes", () => {
    expect(phone).toMatch(/const MESSAGE_CHIME_EVERY_MS = 10 \* 60000;/);
    expect(phone).toMatch(/popKey=\{k\} chimes=\{Infinity\} chimeEveryMs=\{MESSAGE_CHIME_EVERY_MS\} face=\{note\.fromPhoto\}/);
    expect(phone).toMatch(/popKey=\{k\} chimes=\{Infinity\} chimeEveryMs=\{MESSAGE_CHIME_EVERY_MS\} face=\{waiting\.fromPhoto\}/);
    expect(phone).toMatch(/popKey=\{k\} chimes=\{ARRIVING_CHIMES\} face=\{a\.photo\}/);
    expect(phone).toMatch(/if \(hubIsNight\(now, hub\.dimFrom, hub\.dimTo\)\) return null;/);
  });
  test("the family's Messages pins Betty's Hub", () => {
    const m = code("public/js/components/Messages.js");
    expect(m).toMatch(/if \(!!a\.hubGroup !== !!b\.hubGroup\) return a\.hubGroup \? -1 : 1;/);
  });
});

describe("full-screen video on her screens", () => {
  test("her screens fill a wide screen, held toward the top; a tap shows the whole picture", () => {
    expect(phone).toMatch(/VideoCallOverlay, \{ callState, onEndCall: endCall, currentUserId: null, ringStatus, fillWide: true \}/);
    expect(overlay).toMatch(/videoEl\.style\.objectFit = type === 'local' \? 'cover' : \(fillNow\(\) && !wholePictureRef\.current \? 'cover' : 'contain'\);/);
    expect(overlay).toMatch(/if \(type === 'remote'\) videoEl\.style\.objectPosition = 'center 20%';/);
    expect(overlay).toMatch(/onClick: fillWide \? \(\) => setWholePicture\(\(w\) => !w\) : undefined/);
  });
  test("the caller (never the Hub) is told to turn the phone when it's upright and the other screen is wide", () => {
    expect(overlay).toMatch(/isVideo && !fillWide && status === 'connected' && localPortrait && remoteWide && React\.createElement/);
    expect(raw("public/js/components/VideoCallOverlay.js")).toMatch(/Turn your phone sideways for a bigger picture on their screen/);
  });
});

// v1.165.1 — Pete, 11/27: "it swung all the way to no activity at all since 6pm?" Without a
// running person check the Hub can't tell her from the TV, so it must not record "watching".
describe("watching needs a running person check", () => {
  const { code } = require("./helpers/source");
  test("hub-status records watching only with personCheck 'ready'", () => {
    expect(code("src/routes/careRecipients.js")).toMatch(/req\.body\.watching === true && req\.body\.personCheck === "ready" && await require\("\.\.\/utils\/dropIn"\)\.mayNotice/);
  });
  test("the admin list never says 'Nothing saved yet' over hidden minutes", () => {
    const phone = code("public/js/components/RecipientPhone.js");
    expect(phone).toMatch(/clips\.length === 0 && \(v\.clips \|\| \[\]\)\.length === 0 &&/);
    expect(phone).toMatch(/None of the \{\(v\.clips \|\| \[\]\)\.length\} saved minutes counted as up\./);
  });
});
