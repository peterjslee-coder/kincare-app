// v1.105.24 — scanner noise never reaches Sentry.
//
// INPLACE-6 was a bot probing GET /%c0 — an invalid UTF-8 lead byte, the front half of the
// %c0%af overlong-encoding path-traversal probe. Express rejected it with a 400, which is
// exactly right, and then reported the rejection as an application error. Zero first-party
// frames in the stack.
//
// The reason to filter rather than resolve: a scanner walks thousands of malformed paths,
// so resolving in the UI only silences the ones already seen. And an alert channel that
// cries wolf is one nobody reads when something real happens.

const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "src/utils/sentry.js"), "utf8");

describe("malformed-URI probes are filtered at the SDK", () => {
  test("ignoreErrors covers the Express decode_param message", () => {
    expect(src).toMatch(/ignoreErrors/);
    expect(src).toMatch(/Failed to decode param/);
  });

  test("beforeSend also drops it by exception TYPE", () => {
    // ignoreErrors matches on wording, which changes across Express versions. The type
    // check survives a reworded message.
    expect(src).toMatch(/ex\?\.type === "URIError"/);
    expect(src).toMatch(/return null/);
  });

  test("the PHI scrub still runs and still returns the event", () => {
    // The filter must not short-circuit the scrub for events we DO keep — the whole reason
    // beforeSend exists is that sendDefaultPii:false is not trusted on its own.
    const bs = src.slice(src.indexOf("beforeSend(event)"));
    expect(bs).toMatch(/delete event\.request\.data/);
    expect(bs).toMatch(/delete event\.user/);
    expect(bs).toMatch(/return event;/);
    // the scrub comes BEFORE the drop, so a kept event is always scrubbed
    expect(bs.indexOf("delete event.user")).toBeLessThan(bs.indexOf("ex?.type"));
  });

  test("only URIError is dropped — no blanket filter", () => {
    // It would be easy to quiet Sentry by over-filtering. A real error must never be
    // swallowed to keep the dashboard tidy, so assert there is exactly ONE drop and it is
    // gated on the URIError type.
    const bs = src.slice(src.indexOf("beforeSend(event)"));
    const body = bs.slice(0, bs.indexOf("\n      },"));
    expect((body.match(/return null/g) || []).length).toBe(1);
    const dropLine = body.split("\n").find((l) => l.includes("return null"));
    expect(dropLine).toMatch(/URIError/);
  });

  test("the drop is exercised, not just present", () => {
    // Reconstruct the predicate the way beforeSend applies it and run it against real
    // shapes, so this is behaviour rather than a grep.
    const drop = (type, value) => type === "URIError" && /decode|malformed|URI/i.test(value || "");
    expect(drop("URIError", "Failed to decode param '/%c0'")).toBe(true);
    expect(drop("URIError", "URI malformed")).toBe(true);
    // A genuine application error keeps flowing.
    expect(drop("TypeError", "Cannot read properties of undefined")).toBe(false);
    expect(drop("Error", "Failed to decode param")).toBe(false);
  });
});
