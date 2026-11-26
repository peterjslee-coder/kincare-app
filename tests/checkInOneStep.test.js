// v1.165.0 — check-in, one step per screen (Pete, 11/26: "Kay has trouble checking in… She keeps
// trying to hit the check-in button because it looks like that's what she's supposed to do").
// Source-level pins on CaretakerHub.js; the server side of check-in is unchanged.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "public/js/components/CaretakerHub.js"), "utf8");

describe("check-in wizard, one step at a time", () => {
  test("the steps run start → instructions → briefing → first visit → check in", () => {
    expect(src).toMatch(/const ciAllSteps = \['start', \.\.\.ciWorkSteps, 'checkin'\];/);
    expect(src).toMatch(/\.\.\.\(firstVisitNeeded \? \['first-visit'\] : \[\]\),\s*\];/);
  });
  test("'Check in now' is only ever on the last step", () => {
    const hits = src.match(/'Check in now'/g) || [];
    expect(hits.length).toBe(1);
    expect(src).toMatch(/checkInStep === 'checkin' && \(\s*<button data-testid="checkin-submit"[^>]*onClick=\{ciDoCheckIn\}/);
    expect(src).not.toMatch(/Continue to Check In/);
  });
  test("a good check-in lands on the green done screen instead of closing", () => {
    const fn = src.slice(src.indexOf("const ciDoCheckIn = "), src.indexOf("// ─── v1.165.0 — the check-in wizard") > 0 ? undefined : undefined);
    const body = fn.slice(0, fn.indexOf("setCheckSubmitting(false);"));
    expect(body).toMatch(/setCheckInStep\('done'\)/);
    expect(body).not.toMatch(/showToast\('Checked in! Session started\.'/);
    expect(src).toMatch(/data-testid="checkin-done"/);
  });
  test("offline saves still say so, on the done screen", () => {
    expect(src).toMatch(/setCheckInDone\(\{ offline: true \}\);/);
  });
  test("every way in starts on the first screen with nothing ticked", () => {
    expect(src).toMatch(/if \(!ciOpenedId\) return undefined;[\s\S]{0,80}setCheckInStep\('start'\);\s*setBriefingAcked\(false\);\s*setInstructionsAcked\(false\);/);
  });
  test("asleep or awake moves her on in one tap; a concern still asks for notes", () => {
    expect(src).toMatch(/if \(opt\.key === 'yes' \|\| opt\.key === 'asleep'\) ciSubmitFirstVisit\(opt\.key, null\);/);
    expect(src).toMatch(/onClick=\{\(\) => ciSubmitFirstVisit\(firstVisitChoice, firstVisitNotes\)\}/);
  });
});
