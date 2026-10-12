// The cancellation-fee sheet, rendered. (v1.109.9)
//
// 9d286a8a — the fee push had nowhere to land; this is where it lands now.

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const compile = (src) => babel.transformSync(src, { presets: [["@babel/preset-react"]], configFile: false }).code;

function load(file, exportName, seeds, extra = {}) {
  const win = { __currentUserId: "me", ...extra.window };
  let i = 0;
  const useState = (init) => {
    const v = i < seeds.length ? seeds[i] : init;
    i += 1;
    return [v, () => {}];
  };
  const shim = { ...React, useState, useEffect: () => {} };
  const TimezoneHelper = { DEFAULT_TZ: "America/New_York", getDateLabel: (d) => `on ${d}`, formatTime: (t) => t };
  const names = ["window", "React", "useState", "useEffect", "useCallback", "useRef", "useToast", "apiFetch", "TimezoneHelper", ...Object.keys(extra.globals || {})];
  const fn = new Function(...names, compile(read("public", "js", "components", file)) + `\nreturn window.${exportName};`);
  return fn(win, shim, useState, () => {}, React.useCallback, React.useRef, () => ({ showToast: () => {} }),
    async () => ({ ok: true, json: async () => ({}) }), TimezoneHelper, ...Object.values(extra.globals || {}));
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the cancellation-fee sheet", () => {
  // seeds: sessionId, fee, loadError, reason, busy, confirmWaive, doneMessage
  const fee = (over = {}) => ({
    status: "pending", amountCents: 5000, deadline: "2026-10-13T18:00:00Z", viewer: "family",
    canDispute: true, canWaive: false, recipientFirstName: "Betty", scheduledDate: "2026-10-13",
    scheduledTime: "10:00", serviceType: "companionship", timezone: "America/New_York", ...over,
  });
  const draw = (f, rest = []) => {
    const C = load("CancelFeeSheet.js", "CancelFeeSheet", ["s1", f, null, ...rest]);
    return text(renderToStaticMarkup(React.createElement(C)));
  };

  test("closed, it draws nothing", () => {
    const C = load("CancelFeeSheet.js", "CancelFeeSheet", [null]);
    expect(renderToStaticMarkup(React.createElement(C))).toBe("");
  });

  test("the family sees the amount, why, when, and a place to say something's wrong", () => {
    const t = draw(fee());
    expect(t).toContain("Cancellation fee — $50.00");
    expect(t).toContain("caregiver still gets paid");
    expect(t).toMatch(/charged on .*Oct 13/);
    expect(t).toContain("Something’s wrong?");
    expect(t).toContain("Tell InPlace something’s wrong");
    expect(t).not.toContain("Waive this fee");
  });

  test("the caregiver sees she is owed it, and can waive it", () => {
    const t = draw(fee({ viewer: "caregiver", canDispute: false, canWaive: true }));
    expect(t).toContain("Late cancellation — $50.00");
    expect(t).toContain("Waive this fee");
    expect(t).not.toContain("Something’s wrong?");
  });

  test("waiving asks first", () => {
    const t = draw(fee({ viewer: "caregiver", canDispute: false, canWaive: true }), ["", false, true]);
    expect(t).toContain("Yes, waive $50.00");
    expect(t).toContain("can’t be undone");
  });

  test.each([
    ["waived", /waived this fee/],
    ["disputed", /paused while a person/],
    ["charged", /was charged/],
    ["dropped", /dropped/],
    ["none", /no cancellation fee/],
  ])("a %s fee is said plainly, with no buttons to act", (status, re) => {
    const t = draw(fee({ status, canDispute: false, canWaive: false }));
    expect(t).toMatch(re);
    expect(t).not.toContain("Tell InPlace");
    expect(t).not.toContain("Waive this fee");
  });
});
