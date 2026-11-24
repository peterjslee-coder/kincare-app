// v1.155.0 — photos on the InPlace Hub, the client halves.
// The Hub shows the photo only when nothing more urgent is up (a note, a waiting message), the
// Add photo picker never forces the camera (no `capture`), and the caregiver's tick is sent only
// when the server said the Hub is on.
const { raw, code } = require("./helpers/source");

const hub = code("public/js/components/RecipientPhone.js");
const dash = code("public/js/components/Dashboard.js");
const cg = code("public/js/components/CaretakerHub.js");

test("the Hub photo yields to a note or a waiting message", () => {
  expect(hub).toMatch(/\{!note && !waiting && !readFlash && hub\.showPhotos !== false && \(\s*<HubPhoto/);
});

test("the Hub drops a photo that fails to load instead of showing a broken image", () => {
  expect(hub).toMatch(/onError=\{\(\) => setBroken/);
});

test("Add photo uses the safe upload path and never forces the camera", () => {
  const add = dash.slice(dash.indexOf("const AddCarePhoto"), dash.indexOf("const tipCardTotal"));
  expect(add).toContain("uploadSafeFile(");
  expect(add).toContain("downscaleImageFile(");
  expect(add).toMatch(/type="file" accept="image\/\*"/);
  expect(add).not.toMatch(/\bcapture\b/);
});

test("the caregiver's tick is sent only when the Hub option came back", () => {
  expect(cg).toContain("if (checkOutHubOption && checkOutShowOnHub) formData.append('showOnHub', '1');");
  expect(raw("public/js/components/CaretakerHub.js")).toContain("const [checkOutShowOnHub, setCheckOutShowOnHub] = useState(false);");
});

test("the Hub shows Tomorrow, not Coming up, with visits as one line of names and times", () => {
  expect(hub).toContain('data-testid="hub-tomorrow"');
  expect(hub).toMatch(/tmrVisits\.map\(\(v\) => `\$\{v\.who \|\| 'A caregiver'\}\$\{v\.time \? ` at \$\{simpleFmtTime\(v\.time\)\}` : ''\}`\)\.join\(', '\)/);
  const board = hub.slice(hub.indexOf("const HubBoard"), hub.indexOf("const SimpleViewInner") > 0 ? hub.indexOf("const SimpleViewInner") : undefined);
  expect(board).not.toMatch(/>Coming up</);
});

test("the Hub's own Call buttons win over the phone's when the leader picked some", () => {
  expect(hub).toContain("const hubCalls = (hub.calls && hub.calls.length) ? hub.calls : calls;");
  expect(hub).toMatch(/\{hubCalls\.map\(\(c\) => \(/);
});

test("Add photo offers a crop frame the shape of the Hub photo space, and sends the crop", () => {
  const add = dash.slice(dash.indexOf("const HUB_PHOTO_ASPECT"), dash.indexOf("const tipCardTotal"));
  expect(add).toContain("const HUB_PHOTO_ASPECT = 4 / 3;");
  expect(add).toContain("fd.append('crop', JSON.stringify(crop.current))");
  expect(add).not.toMatch(/\bcapture\b/);
});

test("a waiting message and a note on the Hub carry the green shimmer, keyed so a new one replays it", () => {
  expect(hub).toMatch(/key=\{'msg-' \+ [^}]+\} className="hub-new-shimmer"/);
  expect(hub).toMatch(/key=\{'note-' \+ note\.id\} className="hub-new-shimmer"/);
  const css = require("fs").readFileSync(require("path").join(__dirname, "../public/css/styles.css"), "utf8");
  expect(css).toMatch(/\.hub-new-shimmer::after \{[\s\S]*?animation: hubNewShimmer/);
});

test("an open panel goes home by itself: soon after a text is sent, and after a quiet spell", () => {
  expect(hub).toContain("const PANEL_IDLE_MS = 90000;");
  expect(hub).toContain("const SENT_HOME_MS = 3000;");
  expect(hub).toMatch(/if \(Date\.now\(\) - lastTouch\.current > limit\) goHome\(\);/);
  expect(hub).toMatch(/setTimeout\(\(\) => \{\s*setPanel\(\(p\) => \(p === 'text' \? null : p\)\)/);
  expect(hub).toContain('data-testid="simple-back-home"');
});
