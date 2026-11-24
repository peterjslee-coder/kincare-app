// Sentry triage, 8/30. Two of seven unresolved issues were worth code. (v1.105.150)
//
//   INPLACE-G  "Unexpected end of form", UNHANDLED, 16h old, on a new user's first photo
//              message. busboy raises it when a multipart body stops arriving before the form
//              is complete — a phone that lost signal mid-upload, an app backgrounded halfway
//              through. A normal thing for a network to do, reaching Express's default handler
//              as an unhandled 500.
//
//   INPLACE-H  "[client] Load failed", 12 events in four hours, ESCALATING, all one iPhone on
//              1.105.149, all page: dashboard. WebKit's message for a fetch that did not
//              finish — most often iOS killing in-flight requests when the app backgrounds.
//              A pile I built from both ends: .146 started reporting the dashboard's final
//              failure, .148 added catch-up fetches on every reconnect and foreground.

const { code } = require("./helpers/source");
const utils = code("public/js/utils.js");
const messages = code("src/routes/messages.js");

describe("an interrupted upload is not a crash", () => {
  test("the messages router has the multer handler photos.js has had all along", () => {
    // The difference between the two routers only shows up when someone's upload is cut off.
    expect(messages).toMatch(/err instanceof multer\.MulterError/);
    expect(messages).toMatch(/LIMIT_FILE_SIZE/);
  });

  test("a truncated body answers 408, not an unhandled 500", () => {
    expect(messages).toMatch(/Unexpected end of form\|Unexpected end of multipart data\|aborted/);
    expect(messages).toMatch(/res\.status\(408\)/);
  });

  test("it does not write to a socket that is already gone", () => {
    expect(messages).toMatch(/if \(res\.headersSent \|\| req\.destroyed\) return;/);
  });

  test("anything it does not recognise still goes to the error handler", () => {
    // Swallowing unknown errors here would trade a noisy alert for a silent one.
    //
    // Sliced from the handler's own code, not from its comment: helpers/source strips
    // own-line comments, so a marker in prose is not there to find. (Same trap that helper
    // exists to document.)
    const handler = messages.slice(messages.indexOf("err instanceof multer.MulterError"));
    expect(handler).toMatch(/return next\(err\);/);
  });
});

describe("client errors: report the app's failures, not the network's", () => {
  test("nothing is reported while offline or hidden", () => {
    expect(utils).toMatch(/if \(!online \|\| !visible \|\| aborted\) return;/);
  });

  test("an abort is something we or the browser did on purpose", () => {
    expect(utils).toMatch(/name === 'AbortError'/);
  });

  test("what IS reported now says whether the page could even have succeeded", () => {
    // So the next one of these can be read rather than guessed at.
    expect(utils).toMatch(/online, visible,/);
  });

  test("the reporter still cannot throw", () => {
    const fn = utils.slice(utils.indexOf("const reportClientError"), utils.indexOf("const apiFetch"));
    expect(fn).toMatch(/\}\).catch\(\(\) => \{\}\);/);
    expect(fn).toMatch(/\} catch \{\}/);
  });

  test("navigator.onLine being absent does not silence real errors", () => {
    // A missing API must fail OPEN — report — not closed.
    expect(utils).toMatch(/typeof navigator\.onLine === 'boolean' \? navigator\.onLine : true/);
    expect(utils).toMatch(/typeof document !== 'undefined' \? document\.visibilityState !== 'hidden' : true/);
  });
});
