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
