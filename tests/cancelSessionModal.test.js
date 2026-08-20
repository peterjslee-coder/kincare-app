// The one cancel dialog, rendered rather than grepped. (v1.105.117)
//
// "Cancel requests from Schedule page" sat open for five months because the work was
// never the button — it was the 60 lines of fee preview and copy behind it, which lived
// inside Dashboard.js. Cloning those lines into Schedule would have split the v1.105.15
// wording fix across two files, and the next person to correct one would have missed the
// other. So it moved into CancelSessionModal, and this file pins the properties that
// actually protect the user.
//
// The three-state rule is the reason this is a render test and not a string match: a
// preview that could not be fetched is NOT the same as a preview that came back saying
// "no fee", and the only way to prove those draw differently is to draw them.

const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const src = read("public", "js", "components", "CancelSessionModal.js");

const compiled = babel.transformSync(src, {
  presets: [["@babel/preset-react"]],
  configFile: false,
}).code;

// public/js is one concatenated scope with no module system, so the component reads its
// helpers off the global. Hand it doubles for exactly the ones it uses.
function build({ preview }) {
  const win = {};
  // useState is called in declaration order: reason, preview, loading. Only the preview
  // slot varies per case; the setters are no-ops because nothing here re-renders.
  const seeds = ["", preview, false];
  let i = 0;
  const useState = (init) => {
    const v = i < seeds.length ? seeds[i] : init;
    i += 1;
    return [v, () => {}];
  };
  const useEffect = () => {}; // effects don't run in static rendering; the fetch is stubbed out
  const TimezoneHelper = {
    buildDateTime: () => new Date("2026-08-21T18:00:00Z"),
    realNowMs: () => new Date("2026-08-21T12:00:00Z").getTime(), // 6h out => inside the 24h window
    parseDate: (d) => new Date(d + "T12:00:00Z"),
  };
  const fn = new Function(
    "window", "React", "useState", "useEffect", "apiFetch", "TimezoneHelper",
    compiled + "\nreturn window.CancelSessionModal;"
  );
  return fn(win, React, useState, useEffect, async () => ({ ok: false }), TimezoneHelper);
}

const text = ({ preview, caregiverName }) => {
  const C = build({ preview });
  return renderToStaticMarkup(
    React.createElement(C, {
      sessionId: "s1",
      dateISO: "2026-08-21",
      time: "18:00",
      timezone: "America/New_York",
      caregiverName,
      recipientName: "Betty Lee",
      onClose: () => {},
      onCancelled: () => {},
    })
  ).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

describe("the cancel dialog says what will actually happen", () => {
  test("no caregiver assigned is stated as free, with no fee talk", () => {
    const t = text({ preview: null, caregiverName: null });
    expect(t).toContain("free to cancel with no fee");
    expect(t).not.toMatch(/cancellation fee applies/i);
  });

  test("a real preview is quoted verbatim rather than paraphrased", () => {
    // The contract charges the fee "posted at the time of cancellation". Whatever the
    // server computed is what the user must see — the client must not restate it.
    const t = text({
      preview: { message: "A $45.00 cancellation fee applies." },
      caregiverName: "Maria Santos",
    });
    expect(t).toContain("A $45.00 cancellation fee applies.");
  });

  test("an unreachable preview says so — it never reads as free", () => {
    // The third state. Not-known-yet must never draw as not-charged.
    const t = text({ preview: { unavailable: true }, caregiverName: "Maria Santos" });
    expect(t).toMatch(/could not check whether a cancellation fee applies/i);
    expect(t).not.toContain("free to cancel with no fee");
  });

  test("a preview still in flight says it is checking, and promises nothing", () => {
    const t = text({ preview: null, caregiverName: "Maria Santos" });
    expect(t).toMatch(/Checking whether a cancellation fee applies/i);
    expect(t).not.toContain("free to cancel with no fee");
  });

  test("the old false claim is gone from what it renders", () => {
    for (const preview of [null, { unavailable: true }, { message: "x" }]) {
      for (const caregiverName of [null, "Maria Santos"]) {
        expect(text({ preview, caregiverName })).not.toMatch(/still be charged for this session/i);
      }
    }
  });

  test("both ways out are offered, and the safe one is not the destructive one", () => {
    const t = text({ preview: null, caregiverName: "Maria Santos" });
    expect(t).toContain("Keep Session");
    expect(t).toContain("Cancel Session");
  });
});
