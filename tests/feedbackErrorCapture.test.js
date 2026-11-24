// The feedback loop was throwing away the cause and keeping the punctuation. (v1.105.146)
//
// Pete's report 3ad54eea arrived with "⚠️ Console errors: Dashboard fetch error: {}" — four
// times over. The dashboard was not logging an empty object. `message` and `stack` are
// NON-ENUMERABLE on Error, so JSON.stringify(err) is "{}" for every error that has ever been
// thrown, and the capture used JSON.stringify for anything that was not already a string.
//
// This is the channel real users report through. Every console.error ever attached to a
// feedback report has arrived stripped of the one field that says what happened.

const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(
  path.join(__dirname, "..", "public", "js", "components", "FeedbackButton.js"), "utf8"
);

// The describe() helper is self-contained; lift it out and run it against real values.
const body = src.slice(src.indexOf("const describe = (a) =>"), src.indexOf("console.error = function"));
const describeFn = new Function(`${body}\nreturn describe;`)();

describe("what the capture keeps", () => {
  test("an Error keeps its name and message", () => {
    expect(describeFn(new TypeError("x is not a function"))).toBe("TypeError: x is not a function");
  });

  test("the exact case from the report is no longer {}", () => {
    const err = new Error("Request timed out after 25s: /api/dashboard");
    expect(describeFn(err)).toBe("Error: Request timed out after 25s: /api/dashboard");
    expect(JSON.stringify(err)).toBe("{}"); // ...which is what it used to send
  });

  test("strings pass through untouched", () => {
    expect(describeFn("Dashboard fetch error:")).toBe("Dashboard fetch error:");
  });

  test("an error-shaped object that is not an Error still reports", () => {
    // DOMException, ErrorEvent, and anything a library throws with a message and no
    // enumerable keys.
    expect(describeFn({ name: "AbortError", message: "The operation was aborted." }))
      .toBe("AbortError: The operation was aborted.");
  });

  test("a plain object is still its JSON", () => {
    expect(describeFn({ status: 500, route: "/api/dashboard" }))
      .toBe('{"status":500,"route":"/api/dashboard"}');
  });

  test("something with no useful shape names its type rather than {}", () => {
    expect(describeFn(Object.create(null, {}))).toMatch(/\[object /);
  });

  test("nothing here can throw — a reporter that throws is worse than one that lies", () => {
    const circular = {}; circular.self = circular;
    expect(() => describeFn(circular)).not.toThrow();
    expect(describeFn(circular)).toMatch(/\[object /);
    expect(() => describeFn(undefined)).not.toThrow();
  });
});

describe("and the dashboard says what its failure was", () => {
  const dash = fs.readFileSync(
    path.join(__dirname, "..", "public", "js", "components", "Dashboard.js"), "utf8"
  );

  test("name and message, not the object", () => {
    expect(dash).toMatch(/console\.error\('Dashboard fetch error:', err\?\.name \|\| 'Error', err\?\.message \|\| String\(err\)\)/);
  });

  test("and it reaches Sentry, since three retries failing is not nothing", () => {
    expect(dash).toMatch(/reportClientError\(err, \{ page: 'dashboard' \}\)/);
  });
});
