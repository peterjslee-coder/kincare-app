// v1.141.2 — Kay's Samsung in dark mode showed "What to know today" as a blank grey panel: a
// hard-coded pale background behind var(--text-primary) text (near-white in dark mode). The
// caregiver's screens use theme colours for panel backgrounds.
const { code } = require("./helpers/source");

describe("caregiver screens: no hard-coded pale panels behind theme text", () => {
  const files = ["public/js/components/CaretakerHub.js", "public/js/components/CaregiverCalendar.js"];
  for (const f of files) {
    test(f, () => {
      const src = code(f);
      // pale gradients and the specific pale hexes that were behind theme-coloured text
      expect(src).not.toMatch(/linear-gradient\(135deg, #f[0-9a-f]{5}/i);
      expect(src).not.toMatch(/background: '#(f8f8f8|f8f4ff|f5f0ff|ede7f6|faf5ff|f8fdf8|fffbf0)'/i);
      expect(src).not.toMatch(/'var\(--text-on-primary\)';\s*(\/\/.*)?\n\s*const shadow/);
    });
  }
});
